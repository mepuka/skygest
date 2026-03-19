# SKY-16 Addendum — Google GenAI SDK Integration

Research notes for SKY-16 Slice 2: Gemini vision client + structured response contract.

## SDK Choice

Use `@google/genai` (the new SDK), not `@google/generative-ai` (deprecated).

```
bun install @google/genai
```

## Three Primitives

### 1. File Upload API — Upload Once, Reference Many

`ai.files.upload()` persists images for 48 hours. Upload once per image, reference across multiple extraction calls without re-uploading.

```typescript
const uploaded = await ai.files.upload({
  file: imageBlob,
  config: { mimeType: "image/png" },
});
// uploaded.uri persists 48 hours
// uploaded.name for management
```

Decision criteria:

| Method | Max Size | Persists | Best For |
|---|---|---|---|
| `inlineData` (base64) | 20MB req | No | One-off, small images |
| `ai.files.upload()` | 2GB/file | 48 hours | Reuse across calls |
| HTTPS URL | 100MB/req | No | Public CDN-hosted images |

For Skygest: use File API for all chart images. Bluesky CDN URLs could be used directly but are less reliable for retries.

### 2. Context Caching — 75% Token Discount

For multi-pass extraction on the same image (classify then extract), explicit caching reduces input token cost by 75%.

```typescript
const cache = await ai.caches.create({
  model: "gemini-2.5-flash",
  config: {
    contents: createUserContent([
      createPartFromUri(uploaded.uri, uploaded.mimeType),
    ]),
    systemInstruction: "You are an expert energy data analyst...",
    ttl: "3600s",
  },
});

// Subsequent calls reference cache — image tokens at 25% rate
const result = await ai.models.generateContent({
  model: "gemini-2.5-flash",
  contents: "Extract chart structure as JSON.",
  config: { cachedContent: cache.name },
});
```

Minimum threshold: 1,024 tokens for Gemini 2.5 Flash. Typical chart image (~1024x768) = ~1,032 tokens. Clears the threshold.

Implicit caching also available — Google may automatically cache repeated prefixes at the same 75% discount with no code changes.

### 3. Structured Output — Schema-Constrained JSON

Use `responseJsonSchema` (full JSON Schema support in Gemini 2.5+). This guarantees schema-conformant output.

```typescript
const response = await ai.models.generateContent({
  model: "gemini-2.5-flash",
  contents: createUserContent([
    createPartFromUri(imageUri, mimeType),
    EXTRACTION_PROMPT,
  ]),
  config: {
    responseMimeType: "application/json",
    responseJsonSchema: jsonSchema,
  },
});
```

Integration with our Effect Schema types: generate JSON Schema from our enrichment.ts types → pass to Gemini → validate response with Effect Schema decode.

## Extraction Strategy

### Two-Pass Pattern (Recommended)

**Pass 1 — Classification** (cheap, gates detailed extraction):
- Is this a chart? What type? Is it worth detailed extraction?
- Simple schema: `{ mediaType, chartTypes, hasDataPoints, estimatedComplexity }`
- Skip Pass 2 for photos, decorative images, screenshots without data

**Pass 2 — Full Extraction** (only for confirmed charts):
- Detailed structured output: axes, series, data points, source lines, temporal coverage, key findings, alt text
- Maps directly to VisionEnrichment schema from enrichment.ts
- Use Charts-of-Thought prompting for accuracy

### Single-Pass Alternative

For simple cases or when classification is obvious from embed context, a single comprehensive prompt is cheaper and faster. Use when:
- Post text already mentions "chart" or specific data
- Only one image in the post
- Latency matters more than cost optimization

### Multi-Image Thread Strategy (Blake Shaffer pattern)

For threads with 10+ chart images:

1. Upload all images via File API (parallel)
2. Create cache with system prompt + all images (single cache)
3. Run per-image classification (cached, 75% discount per call)
4. Run detailed extraction only on confirmed charts (cached)
5. Post-level synthesis pass over all extracted results
6. Cleanup cache

Alternative: single multi-image call with all images + one comprehensive prompt. Simpler but less controllable per-asset output quality.

## Charts-of-Thought Prompting

Research-backed structured prompting approach (9-21% accuracy improvement over direct prompts):

```
Analyze this energy chart step by step:

Task 1 - DATA EXTRACTION: List ALL numerical values visible on both axes.
Create a structured table of ALL data points visible in the chart.

Task 2 - SORTING: Sort data in descending order by numerical values.

Task 3 - VERIFICATION: Compare each value in your table with the chart image.
Flag any discrepancies.

Task 4 - ANALYSIS: Using ONLY verified data, produce the structured JSON output.
```

Particularly important for:
- Dense bar charts (weakest category for Gemini vision)
- Stacked bar charts with multiple series
- Charts with small or rotated axis labels

## Accuracy by Chart Type

| Chart Type | Gemini 2.5 Flash Accuracy | Notes |
|---|---|---|
| Line charts | High | Best performance |
| Area charts | High | Similar to line |
| Pie charts | High | Reliable segment detection |
| Scatter plots | Medium-High | Good with structured prompting |
| Bar charts | Medium | Struggles with dense bars — use CoT |
| Stacked bar | Medium | Multi-series adds complexity |
| Data tables | High | OCR-like extraction |

## Image Token Costs

- Both dimensions <= 384px: 258 tokens flat
- Larger: tiled into 768×768 chunks, 258 tokens per tile
- Formula: `ceil(width/768) * ceil(height/768) * 258`
- Typical chart (1200×800): 2×2 = 4 tiles = 1,032 tokens
- Use `ai.models.countTokens()` to verify

Pricing at Gemini 2.5 Flash rates ($0.15/1M input, $0.60/1M output):
- Single chart analysis: ~$0.0002
- 10-chart thread (cached): ~$0.001
- Batch API (50% off, 24hr turnaround): half the above

## Effect Service Shape

```typescript
export class GeminiVisionService extends Context.Tag("@skygest/GeminiVisionService")<
  GeminiVisionService,
  {
    readonly uploadImage: (
      data: Uint8Array, mimeType: string
    ) => Effect.Effect<{ uri: string; name: string }, GeminiApiError>;

    readonly classifyImage: (
      imageUri: string, mimeType: string
    ) => Effect.Effect<ImageClassification, GeminiApiError | GeminiParseError>;

    readonly extractChartData: (
      imageUri: string, mimeType: string
    ) => Effect.Effect<VisionEnrichment, GeminiApiError | GeminiParseError>;
  }
>() {}
```

Error types:
- `GeminiApiError` — network/API failures, rate limits
- `GeminiParseError` — structured output failed schema validation

The SDK has built-in exponential backoff. Add `Effect.retry` with `Schedule` only for rate limit (429) responses.

## Mapping to Existing Domain Types

The structured output schema should map to our existing types:

| Gemini Output Field | Domain Type | Location |
|---|---|---|
| Chart type detection | `ChartType` (14 values) | `media.ts` |
| Media classification | `MediaType` (5 values) | `media.ts` |
| Alt text generation | `altText` + `AltTextProvenance` | `media.ts` |
| Axis extraction | `ChartAxis { label, unit }` | `media.ts` |
| Series detection | `ChartSeries { legendLabel, unit }` | `media.ts` |
| Source text | `ChartSourceLine { sourceText }` | `media.ts` |
| Date range | `TemporalCoverage { startDate, endDate }` | `media.ts` |
| Key takeaways | `keyFindings: string[]` | `enrichment.ts` |
| Full result | `VisionEnrichment` | `enrichment.ts` |

No new domain types needed — the SKY-24 unified runtime schema already covers the full output shape.

## Open Questions

1. **AI Gateway:** Should Gemini calls go through Cloudflare AI Gateway for logging/rate control, or direct? Gateway adds observability but another hop.
2. **R2 raw storage:** Store raw Gemini responses in R2 for audit? The workflow spec recommends it.
3. **Batch API for backfill:** 50% cost discount with 24hr turnaround. Worth wiring up for historical processing?
4. **Image source:** Use Bluesky CDN URLs directly (simpler) or download + upload via File API (more reliable for retries)?
