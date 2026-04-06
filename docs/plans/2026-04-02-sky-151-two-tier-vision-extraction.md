# SKY-151: Two-Tier Vision Extraction

## Problem

`extractChartData` sends the same strict schema to Gemini for every image. Simple charts conform; complex dashboards and multi-panel screenshots do not. Gemini returns malformed JSON, the decoder fails, and the enrichment run marks as failed. The post gets no vision data at all.

A single prompt instruction ("if the image is a dashboard, return one object...") does not fix this. The schema still demands `xAxis`, `yAxis`, `series`, and `temporalCoverage` — fields that have no clean mapping for a dashboard with a contour map, two pie charts, and a legend panel.

## Principle

Successful partial data beats a failed full extraction. Source attribution, alt text, and key findings are more valuable than nothing. The lightweight path should almost never fail because the schema is flat and the ask is simple.

## Design

### Classification gate

Every image already passes through `uploadImage`. After upload, the executor calls `classifyImage` — a cheap Gemini call with a tiny schema — to determine what the image contains. Today `classifyImage` exists but is never called in the production flow.

The classification schema gains one new field:

```ts
export const ImageClassification = Schema.Struct({
  mediaType: MediaType,
  chartTypes: Schema.Array(ChartType),
  hasDataPoints: Schema.Boolean,
  isCompound: Schema.Boolean   // ← NEW
});
```

`isCompound` asks the model directly: "Is this a single standalone visualization, or a compound image containing multiple distinct panels, charts, or dashboard sections?" This replaces the `chartTypes.length` heuristic, which failed to catch dashboards that happen to have two or fewer chart types.

The classification prompt adds:

> **isCompound**: Is this a single standalone chart or visualization, or a compound image containing multiple distinct panels, dashboard sections, or chart grids? A single chart with a legend or inset is NOT compound. A dashboard with separate chart panels IS compound.

The routing rule:

| Condition | Route |
|-----------|-------|
| `isCompound === false` AND `mediaType === "chart"` AND `hasDataPoints === true` | Full extraction |
| Everything else | Lightweight extraction |

### Flow

```
analyzeAsset(asset)
  |-- fetchAsset()
  |-- uploadImage()
  |-- classifyImage()                    <-- now called
  |-- if fullExtractionEligible(classification)
  |    \-- extractChartData()            <-- existing, unchanged
  | else
  |    \-- extractImageSummary()         <-- new
  \-- decode into VisionAssetEnrichment (with extractionRoute)
```

Both paths produce a `VisionAssetAnalysis`. The lightweight path sets chart-specific fields (`xAxis`, `yAxis`, `series`, `temporalCoverage`) to null or empty. These fields are already nullable in the domain schema.

### Lightweight extraction

**Prompt**: Same Charts-of-Thought structure (Extract -> Sort -> Verify -> Analyze) but scoped to metadata and provenance. Does not ask for axis labels, data series, or temporal coverage. Explicitly instructs Gemini to focus on what the image communicates and where the data originates.

**Schema** (`GeminiLightweightExtractionContract`):

```ts
{
  mediaType: MediaType,
  chartTypes: ChartType[],
  altText: string | null,
  title: string | null,
  keyFindings: string[],
  sourceLines: VisionSourceLineAttribution[],
  visibleUrls: string[],
  organizationMentions: VisionOrganizationMention[],
  logoText: string[]
}
```

Absent from this schema: `xAxis`, `yAxis`, `series`, `temporalCoverage`. A matching lenient decoder follows the same `withDecodingDefaultKey` pattern as the full decoder.

The lightweight decoder supports `Schema.Union([single, array])` like the full decoder. Gemini occasionally returns arrays even when asked for a single object. The same `normalizeExtractionResponse` merge logic applies — collect source lines, dedupe key findings, take first non-null title.

### Classification failure fallback

If `classifyImage` fails (rate limit, malformed response, timeout), default to full extraction. Classification is purely additive — it can improve outcomes but must never degrade them:

```ts
const classification = yield* gemini.classifyImage(uploaded.uri, fetched.mimeType).pipe(
  Effect.catchAll(() =>
    Effect.succeed({
      mediaType: "chart" as const,
      chartTypes: [],
      hasDataPoints: true,
      isCompound: false
    })
  )
);
```

This preserves current behavior for any image where classification itself fails.

### Fix: chartTypes type mismatch (latent bug)

`VisionAssetAnalysisV2.chartTypes` accepts any string, but `VisionPostSummary.chartTypes` requires the strict `ChartType` enum. The `LenientChartType` decoder normalizes Gemini responses but can produce values outside the enum. When the executor builds the post summary, non-enum chart types cause `Schema.decodeUnknownEffect(VisionEnrichmentSchema)` to fail.

This is an existing bug, not introduced by SKY-151, but the lightweight path increases exposure because dashboards produce more diverse chart type strings. Fix: filter non-enum values before building the summary, or relax `VisionPostSummary.chartTypes` to `Schema.Array(Schema.String)` to match the asset-level schema.

### Output shape changes

Two changes to persisted types:

**1. `ImageClassification` gains `isCompound: boolean`.**

Only used at classification time, not persisted in enrichment output. No migration needed.

**2. `VisionAssetEnrichment` gains `extractionRoute: "full" | "lightweight"`.**

Records which extraction path ran, per image. A single enrichment run can contain a mix of both routes (e.g., a thread with one simple chart and one dashboard screenshot). This is a real contract change — downstream consumers that read `VisionAssetEnrichment` will see the new field. Default to `"full"` for backward compatibility with existing stored enrichments.

```ts
export const ExtractionRoute = Schema.Literal("full", "lightweight");

export const VisionAssetEnrichment = Schema.Struct({
  assetKey: ...,
  assetType: ...,
  source: ...,
  index: ...,
  originalAltText: ...,
  analysis: VisionAssetAnalysis,
  extractionRoute: ExtractionRoute.pipe(
    Schema.withDecodingDefaultKey(() => "full" as const)
  )
});
```

The `withDecodingDefaultKey` ensures existing records without the field decode as `"full"`.

### Quality gate

The quality gate (`assessVisionQuality`) checks two predicates:

1. `hasAssets` — at least one asset was analyzed
2. `hasAnalysisSignal` — at least one asset has a chart type, visible URL, organization mention, source line, logo text, or title

The gate does **not** check `altText` or `keyFindings`. A lightweight result that only produces alt text and findings but no other signal would be marked as needing review. The lightweight path should naturally produce source lines, visible URLs, and organization mentions — these are its primary purpose — so it should pass the gate in practice. No gate changes are needed, but the lightweight prompt must be written to reliably extract at least one of the `hasAnalysisSignal` fields.

### What does NOT change

- **`VisionAssetAnalysis` (domain model)**: No new fields. Already has nullable chart fields.
- **`EnrichmentRunWorkflow`**: Calls `executor.execute()`, does not know about routes.
- **`VisionEnrichment` (post-level summary)**: Aggregates across assets regardless of extraction depth.
- **Source attribution**: Consumes `sourceLines`, `visibleUrls`, `organizationMentions` — all present in both routes.
- **Quality gate logic**: Same predicates, same thresholds.

### Observability

`extractionRoute` on `VisionAssetEnrichment` records which path ran per image. This is necessary because the full extraction path already returns null chart fields for non-chart images — null axes alone does not distinguish routes.

The executor also logs the classification result and routing decision per asset for runtime debugging.

## Implementation

### Task 1: Classification update + lightweight prompt

- Add `isCompound` to `ImageClassification` schema in `GeminiVisionService.ts`.
- Update `VISION_CLASSIFICATION_PROMPT` in `prompts.ts` with the `isCompound` instruction.
- Add `VISION_LIGHTWEIGHT_EXTRACTION_PROMPT` to `prompts.ts`.
- Bump `VISION_PROMPT_VERSION` to `v3.0.0`.

### Task 2: Service interface + implementation

- Add `extractImageSummary` to `GeminiVisionService` interface.
- Implement in `GeminiVisionServiceLive` with `GeminiLightweightExtractionContract`, `GeminiLightweightExtractionDecoder`, and new JSON schema constant.
- The implementation must inject runtime fields (`altTextProvenance: "synthetic"`, `modelId`, `processedAt` via `Clock.currentTimeMillis`) — same pattern as `extractChartData`.

### Task 3: Domain + executor routing + chartTypes fix

- Add `ExtractionRoute` to domain and `extractionRoute` to `VisionAssetEnrichment` with decode default.
- Add `classifyImage` call with `Effect.catchAll` fallback to `VisionEnrichmentExecutor.analyzeAsset`.
- Extract `fullExtractionEligible(classification)` as a pure function for testability.
- Pass `extractionRoute` through to `VisionAssetEnrichment` construction.
- Fix the `chartTypes` mismatch by filtering non-enum values before building `VisionPostSummary`.

### Task 4: Tests

- Unit test `fullExtractionEligible` with classification variants: single chart, compound dashboard, photo, document, infographic-with-embedded-chart.
- Update existing executor test mocks: `classifyImage` currently mocks as `Effect.die()` — must become a working mock returning `isCompound: false`. Add `extractImageSummary` to mock interface.
- Integration test both routes through `analyzeAsset` with mocked Gemini responses. Verify `extractionRoute` is set correctly on the output.
- Add tests for `extractImageSummary` in `gemini-vision-service.test.ts`.
- Run existing eval harness to confirm no regression on single-chart images.

### Task 5: Routing eval

- Add a routing-specific eval pass that runs `classifyImage` on the golden set images and verifies the routing decision matches the expected route for each image.
- This closes the feedback loop for threshold tuning — without it, we cannot measure whether the `isCompound` signal is accurate on real examples.

## Files

| File | Change |
|------|--------|
| `src/enrichment/prompts.ts` | Update classification prompt (`isCompound`), add lightweight prompt, bump version |
| `src/enrichment/GeminiVisionService.ts` | Add `isCompound` to `ImageClassification`, add `extractImageSummary` to interface |
| `src/enrichment/GeminiVisionServiceLive.ts` | Update classification JSON schema, add lightweight schema + decoder + implementation |
| `src/enrichment/VisionEnrichmentExecutor.ts` | Classify -> route in `analyzeAsset`, pass `extractionRoute`, fix chartTypes filter |
| `src/domain/enrichment.ts` | Add `ExtractionRoute`, add `extractionRoute` to `VisionAssetEnrichment` |
| `tests/vision-enrichment-executor.test.ts` | Fix `classifyImage` mock, add `extractImageSummary` to mock, add routing tests |
| `tests/gemini-vision-service.test.ts` | Add tests for `extractImageSummary` |
| `eval/vision/` or `scripts/` | Add routing eval pass for classification accuracy on golden set |

## Risks

- **Extra API call per image**: Classification adds latency (~1-2s). Acceptable given images are processed asynchronously in a Workflow.
- **Classification accuracy**: Gemini may misclassify `isCompound`. The downside of misrouting to lightweight is reduced data, not failure. Misrouting to full may still fail on complex images — but that is the status quo, not a regression.
- **Infographics with embedded charts**: An infographic with a single embedded chart routes to lightweight because `mediaType !== "chart"`. Acceptable — infographic layouts have the same rigid-schema problem as dashboards. Relaxable later if eval shows otherwise.
- **Prompt version ambiguity**: `VISION_PROMPT_VERSION` bumps to `v3.0.0` for both routes. The `extractionRoute` field on `VisionAssetEnrichment` is the authoritative signal for which path ran.
