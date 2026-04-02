/**
 * GeminiVisionService — interface for Gemini 2.5 Flash vision analysis.
 *
 * Four-step workflow:
 * 1. uploadImage — push image bytes to the Gemini Files API (48h TTL)
 * 2. classifyImage — lightweight classification (mediaType + chartTypes)
 * 3. extractChartData — full structured extraction → VisionAssetAnalysis
 * 4. extractImageSummary — lightweight extraction (metadata + provenance only)
 *
 * Implementation lives in a separate module (Task 2).
 */

import { ServiceMap, Effect, Schema } from "effect";
import type { VisionAssetAnalysis } from "../domain/enrichment";
import type { GeminiApiError, GeminiParseError } from "../domain/errors";
import type { ImageClassification } from "../domain/media";

// Re-export from domain — canonical definition lives in src/domain/media.ts
export { ImageClassification } from "../domain/media";

// ---------------------------------------------------------------------------
// Upload result
// ---------------------------------------------------------------------------

export const UploadedFile = Schema.Struct({
  uri: Schema.String,
  name: Schema.String
});
export type UploadedFile = Schema.Schema.Type<typeof UploadedFile>;

// ---------------------------------------------------------------------------
// Service interface
// ---------------------------------------------------------------------------

export class GeminiVisionService extends ServiceMap.Service<
  GeminiVisionService,
  {
    readonly uploadImage: (
      data: Uint8Array,
      mimeType: string
    ) => Effect.Effect<UploadedFile, GeminiApiError>;

    readonly classifyImage: (
      imageUri: string,
      mimeType: string
    ) => Effect.Effect<ImageClassification, GeminiApiError | GeminiParseError>;

    readonly extractChartData: (
      imageUri: string,
      mimeType: string
    ) => Effect.Effect<VisionAssetAnalysis, GeminiApiError | GeminiParseError>;

    readonly extractImageSummary: (
      imageUri: string,
      mimeType: string
    ) => Effect.Effect<VisionAssetAnalysis, GeminiApiError | GeminiParseError>;
  }
>()("@skygest/GeminiVisionService") {}
