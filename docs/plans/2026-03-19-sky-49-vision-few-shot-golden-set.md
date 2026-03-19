# SKY-49: Vision Few-Shot Golden Set

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Model a schema-validated golden set of few-shot examples for the vision extraction prompt, following the checked-in JSON config pattern established by the provider registry.

**Architecture:** Few-shot examples live as versioned JSON config, validated against Effect schemas at bootstrap, and injected into the extraction prompt at assembly time. No persistence layer — config is checked into the repo.

**Tech Stack:** Effect Schema, JSON config, prompt template assembly

---

## Design Principles

1. **Schema-validated config.** Few-shot examples are decoded through Effect schemas at bootstrap. Invalid examples fail fast, not at inference time.
2. **Aligned with domain types.** The expected output shape reuses `GeminiExtractionOutput` fields — same `MediaType`, `ChartType`, `ChartAxis`, etc. A golden example is literally "for this image description, produce this structured output."
3. **No image binaries.** Examples carry a text description of the chart (what the model would see) and the expected structured output. The Gemini API receives these as text-only few-shot pairs.
4. **Retrievable, not embedded.** Prompt assembly is a function that accepts examples, not a static string. This makes the path to dynamic retrieval (KV, vector search) a config swap, not a prompt rewrite.
5. **Versioned manifest.** Same pattern as `config/source-registry/energy.json` — domain, version, and an array of entries.

---

## Schema Design

### `src/domain/prompts.ts` (new file)

```typescript
import { Schema } from "effect";
import { MediaType, ChartType, ChartAxis, ChartSeries, TemporalCoverage } from "./media";
import { VisionSourceLineAttribution, VisionOrganizationMention } from "./sourceMatching";

// The expected structured output for a few-shot example.
// Mirrors GeminiExtractionOutput exactly — a golden example IS a model response.
export const VisionFewShotExpectedOutput = Schema.Struct({
  mediaType: MediaType,
  chartTypes: Schema.Array(ChartType),
  altText: Schema.NullOr(Schema.String),
  title: Schema.NullOr(Schema.String),
  xAxis: Schema.NullOr(ChartAxis),
  yAxis: Schema.NullOr(ChartAxis),
  series: Schema.Array(ChartSeries),
  sourceLines: Schema.Array(VisionSourceLineAttribution),
  temporalCoverage: Schema.NullOr(TemporalCoverage),
  keyFindings: Schema.Array(Schema.String),
  visibleUrls: Schema.Array(Schema.String),
  organizationMentions: Schema.Array(VisionOrganizationMention),
  logoText: Schema.Array(Schema.String)
});
export type VisionFewShotExpectedOutput = Schema.Schema.Type<
  typeof VisionFewShotExpectedOutput
>;

// A single few-shot example: chart description + expected extraction.
export const VisionFewShotExample = Schema.Struct({
  id: Schema.String.pipe(Schema.minLength(1)),
  description: Schema.String.pipe(Schema.minLength(1)),
  chartDescription: Schema.String.pipe(Schema.minLength(10)),
  expectedOutput: VisionFewShotExpectedOutput
});
export type VisionFewShotExample = Schema.Schema.Type<typeof VisionFewShotExample>;

// The versioned manifest.
export const VisionFewShotManifest = Schema.Struct({
  domain: Schema.String.pipe(Schema.minLength(1)),
  version: Schema.String.pipe(Schema.minLength(1)),
  examples: Schema.Array(VisionFewShotExample).pipe(Schema.minItems(1))
});
export type VisionFewShotManifest = Schema.Schema.Type<typeof VisionFewShotManifest>;
```

### Field semantics

| Field | Purpose |
|-------|---------|
| `id` | Unique identifier for the example (e.g., `"ercot-load-bar-chart"`) |
| `description` | Human-readable note about why this example exists |
| `chartDescription` | Text description of the chart image — what the model sees. This is the "input" side of the few-shot pair. |
| `expectedOutput` | The structured extraction the model should produce — the "output" side. |

---

## Config File

### `config/prompts/vision-few-shots.json`

```json
{
  "domain": "energy",
  "version": "0.1.0",
  "examples": [
    {
      "id": "ercot-load-bar-chart",
      "description": "ERCOT daily load bar chart with source attribution and temporal coverage",
      "chartDescription": "A bar chart titled 'ERCOT Daily System Load' showing daily electricity load in GW for January 2024. The x-axis shows dates from Jan 1 to Jan 31. The y-axis shows load from 0 to 80 GW. A footer reads 'Source: ERCOT'. The domain 'ercot.com' appears as a watermark.",
      "expectedOutput": {
        "mediaType": "chart",
        "chartTypes": ["bar-chart"],
        "altText": "Bar chart showing ERCOT daily system load in GW for January 2024, ranging from approximately 40 to 75 GW",
        "title": "ERCOT Daily System Load",
        "xAxis": { "label": "Date", "unit": null },
        "yAxis": { "label": "Load", "unit": "GW" },
        "series": [{ "legendLabel": "Daily Load", "unit": "GW" }],
        "sourceLines": [
          { "sourceText": "Source: ERCOT", "datasetName": null }
        ],
        "temporalCoverage": { "startDate": "2024-01", "endDate": "2024-01" },
        "keyFindings": [
          "ERCOT daily load ranged from approximately 40 to 75 GW during January 2024",
          "Peak load days appear mid-month, consistent with winter heating demand"
        ],
        "visibleUrls": ["ercot.com"],
        "organizationMentions": [
          { "name": "ERCOT", "location": "footer" }
        ],
        "logoText": []
      }
    }
  ]
}
```

Start with 2-3 examples covering the most common chart types in the energy domain (bar chart, line chart, stacked area).

---

## Bootstrap

### `src/bootstrap/CheckedInFewShotExamples.ts`

```typescript
import { Schema } from "effect";
import { VisionFewShotManifest } from "../domain/prompts";
import fewShotJson from "../../config/prompts/vision-few-shots.json";

export const visionFewShotManifest = Schema.decodeUnknownSync(
  VisionFewShotManifest
)(fewShotJson);

export const visionFewShotExamples = visionFewShotManifest.examples;
```

Same pattern as `CheckedInProviderRegistry.ts` — sync decode at module load, fail fast on invalid config.

---

## Prompt Assembly

### `src/enrichment/prompts.ts` changes

The static `VISION_EXTRACTION_PROMPT` string becomes a function:

```typescript
import type { VisionFewShotExample } from "../domain/prompts";

const formatFewShotExample = (example: VisionFewShotExample): string =>
  `**Example — ${example.description}:**

Input image description: ${example.chartDescription}

Expected output:
\`\`\`json
${JSON.stringify(example.expectedOutput, null, 2)}
\`\`\``;

const EXTRACTION_PREAMBLE = `You are an expert energy-sector data analyst...`;
// (existing prompt text, unchanged)

export const buildExtractionPrompt = (
  examples: ReadonlyArray<VisionFewShotExample>
): string => {
  if (examples.length === 0) return EXTRACTION_PREAMBLE;

  const exampleBlock = examples
    .map(formatFewShotExample)
    .join("\n\n---\n\n");

  return `${EXTRACTION_PREAMBLE}

---

## Few-Shot Examples

The following examples show the expected output format and level of detail:

${exampleBlock}

---

Now analyze the provided image following the same format.`;
};

// Backward-compatible static export for existing callers
export const VISION_EXTRACTION_PROMPT = buildExtractionPrompt([]);
```

### `GeminiVisionServiceLive.ts` changes

Import the bootstrap examples and use `buildExtractionPrompt`:

```typescript
import { visionFewShotExamples } from "../bootstrap/CheckedInFewShotExamples";
import { buildExtractionPrompt } from "./prompts";

// In the layer:
const extractionPrompt = buildExtractionPrompt(visionFewShotExamples);

// In extractChartData:
contents: createUserContent([
  createPartFromUri(imageUri, mimeType),
  extractionPrompt  // was VISION_EXTRACTION_PROMPT
]),
```

---

## Prompt Version

Bump `VISION_PROMPT_VERSION` to `"v2.1.0"` when few-shot examples ship. The version is already stored alongside enrichment results for audit.

---

## Tasks

### Task 1: Domain schema (`src/domain/prompts.ts`)

**Files:**
- Create: `src/domain/prompts.ts`
- Test: `tests/vision-few-shots.test.ts`

Define `VisionFewShotExpectedOutput`, `VisionFewShotExample`, and `VisionFewShotManifest` schemas. Write decode tests for valid and invalid examples.

### Task 2: Seed config (`config/prompts/vision-few-shots.json`)

**Files:**
- Create: `config/prompts/vision-few-shots.json`

Write 2-3 seed examples covering bar chart, line chart, and stacked area chart with energy-domain content. Each example must pass the schema validation from Task 1.

### Task 3: Bootstrap loader (`src/bootstrap/CheckedInFewShotExamples.ts`)

**Files:**
- Create: `src/bootstrap/CheckedInFewShotExamples.ts`
- Test: add to `tests/vision-few-shots.test.ts`

Import the JSON config, decode through schema, export validated examples. Test that the bootstrap succeeds.

### Task 4: Prompt assembly function

**Files:**
- Modify: `src/enrichment/prompts.ts`
- Test: add to `tests/vision-few-shots.test.ts`

Refactor `VISION_EXTRACTION_PROMPT` from static string to `buildExtractionPrompt(examples)`. Keep backward-compatible static export. Bump version to `v2.1.0`.

### Task 5: Wire into GeminiVisionServiceLive

**Files:**
- Modify: `src/enrichment/GeminiVisionServiceLive.ts`
- Test: verify existing `tests/gemini-vision-service.test.ts` still passes

Import bootstrap examples, use `buildExtractionPrompt` instead of static `VISION_EXTRACTION_PROMPT` in `extractChartData`.

---

## Verification

1. `bunx tsc --noEmit` — clean
2. `bun run test` — all tests pass
3. Invalid JSON in `config/prompts/vision-few-shots.json` should fail at import time (bootstrap decode)
4. `buildExtractionPrompt([])` returns the same prompt as before (backward compatible)
5. `buildExtractionPrompt(examples)` includes formatted few-shot pairs
