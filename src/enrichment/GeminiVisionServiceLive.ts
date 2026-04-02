/**
 * GeminiVisionServiceLive — live implementation of GeminiVisionService
 * backed by @google/genai SDK (Gemini 2.5 Flash).
 *
 * Two-pass pattern:
 * 1. classifyImage — lightweight classification with small JSON schema
 * 2. extractChartData — full asset analysis extraction with detailed schema
 *
 * Uses structured output (responseMimeType + responseJsonSchema) to get
 * typed JSON responses directly from Gemini.
 *
 * JSON schemas for Gemini structured output are derived from Effect schemas
 * via JsonSchema.fromAST(), keeping enum values in sync with domain types.
 */

import { GoogleGenAI, createUserContent, createPartFromUri } from "@google/genai";
import { Clock, Config, Effect, Layer, Schema, SchemaGetter } from "effect";
import * as JsonSchema from "effect/JsonSchema";
import { VisionAssetAnalysis as VisionAssetAnalysisSchema } from "../domain/enrichment";
import {
  MediaType,
  normalizeMediaType,
  ChartType,
  ChartAxis,
  ChartSeries,
  TemporalCoverage
} from "../domain/media";
import { GeminiApiError, GeminiParseError } from "../domain/errors";
import { formatSchemaParseError } from "../platform/Json";
import {
  VisionOrganizationMention,
  VisionSourceLineAttribution
} from "../domain/sourceMatching";
import {
  GeminiVisionService,
  ImageClassification,
  type UploadedFile
} from "./GeminiVisionService";
import {
  VISION_CLASSIFICATION_PROMPT,
  VISION_EXTRACTION_PROMPT
} from "./prompts";

// ---------------------------------------------------------------------------
// Gemini extraction schemas
//
// Two schemas serve different purposes:
// - GeminiExtractionContract: strict schema sent TO Gemini via structured output.
//   Preserves enum constraints and required fields to maximize response quality.
// - GeminiExtractionDecoder: lenient schema for decoding Gemini's response.
//   Normalizes loose mediaType values (case, aliases) and defaults missing
//   optional fields. Acts as a safety net for when Gemini returns off-spec.
// ---------------------------------------------------------------------------

/** Shared struct fields used by both contract and decoder schemas. */
const extractionFields = {
  xAxis: Schema.NullOr(ChartAxis),
  yAxis: Schema.NullOr(ChartAxis),
  series: Schema.Array(ChartSeries),
  sourceLines: Schema.Array(VisionSourceLineAttribution),
  temporalCoverage: Schema.NullOr(TemporalCoverage),
  keyFindings: Schema.Array(Schema.String),
  visibleUrls: Schema.Array(Schema.String),
  organizationMentions: Schema.Array(VisionOrganizationMention),
  logoText: Schema.Array(Schema.String)
} as const;

/** Strict schema sent to Gemini — preserves enum + required in JSON schema. */
const GeminiExtractionContract = Schema.Struct({
  mediaType: MediaType,
  chartTypes: Schema.Array(ChartType),
  altText: Schema.NullOr(Schema.String),
  title: Schema.NullOr(Schema.String),
  ...extractionFields
});

/** Lenient MediaType: normalizes case + aliases before validating against enum. */
const LenientMediaType = Schema.String.pipe(
  Schema.decode({
    decode: SchemaGetter.transform(normalizeMediaType),
    encode: SchemaGetter.passthrough()
  }),
  Schema.decodeTo(MediaType)
);

/** Lenient decoder for Gemini responses — tolerates missing keys and loose values. */
const GeminiExtractionDecoder = Schema.Struct({
  mediaType: LenientMediaType,
  chartTypes: Schema.Array(ChartType).pipe(Schema.withDecodingDefaultKey(() => [] as const)),
  altText: Schema.NullOr(Schema.String).pipe(Schema.withDecodingDefaultKey(() => null)),
  title: Schema.NullOr(Schema.String).pipe(Schema.withDecodingDefaultKey(() => null)),
  ...extractionFields
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const extractErrorStatus = (cause: unknown): number | undefined => {
  if (cause instanceof Error && "status" in cause) {
    const status = (cause as Record<string, unknown>).status;
    return typeof status === "number" ? status : undefined;
  }
  return undefined;
};

// ---------------------------------------------------------------------------
// JSON Schemas for Gemini structured output (derived from Effect schemas)
// ---------------------------------------------------------------------------

const makeJsonSchema = (schema: Schema.Top): JsonSchema.JsonSchema => {
  const doc = Schema.toJsonSchemaDocument(schema);
  // Gemini expects the schema without $schema and $defs at the top level
  const { $schema: _, ...rest } = doc as unknown as Record<string, unknown>;
  return rest as JsonSchema.JsonSchema;
};

const CLASSIFICATION_JSON_SCHEMA = makeJsonSchema(ImageClassification);
const EXTRACTION_JSON_SCHEMA = makeJsonSchema(GeminiExtractionContract);

// ---------------------------------------------------------------------------
// Layer
// ---------------------------------------------------------------------------

export const GeminiVisionServiceLive = Layer.effect(
  GeminiVisionService,
  Effect.gen(function* () {
    const apiKey = yield* Config.string("GOOGLE_API_KEY");
    const model = yield* Config.string("GEMINI_VISION_MODEL").pipe(
      Config.withDefault("gemini-2.5-flash")
    );
    const ai = new GoogleGenAI({ apiKey });

    // -----------------------------------------------------------------------
    // uploadImage
    // -----------------------------------------------------------------------

    const uploadImage = Effect.fn("GeminiVision.uploadImage")(
      function* (data: Uint8Array, mimeType: string) {
        const uploaded = yield* Effect.tryPromise({
          try: () =>
            ai.files.upload({
              file: new Blob([data], { type: mimeType }),
              config: { mimeType }
            }),
          catch: (cause) =>
            new GeminiApiError({
              message: cause instanceof Error
                ? cause.message
                : "Gemini Files API upload failed",
              ...(extractErrorStatus(cause) !== undefined ? { status: extractErrorStatus(cause)! } : {})
            })
        });

        if (!uploaded.uri || !uploaded.name) {
          return yield* new GeminiApiError({
            message: "Gemini upload returned missing uri or name"
          });
        }

        return { uri: uploaded.uri, name: uploaded.name } satisfies UploadedFile;
      }
    );

    // -----------------------------------------------------------------------
    // classifyImage
    // -----------------------------------------------------------------------

    const classifyImage = Effect.fn("GeminiVision.classifyImage")(
      function* (imageUri: string, mimeType: string) {
        const response = yield* Effect.tryPromise({
          try: () =>
            ai.models.generateContent({
              model,
              contents: createUserContent([
                createPartFromUri(imageUri, mimeType),
                VISION_CLASSIFICATION_PROMPT
              ]),
              config: {
                responseMimeType: "application/json",
                responseJsonSchema: CLASSIFICATION_JSON_SCHEMA
              }
            }),
          catch: (cause) =>
            new GeminiApiError({
              message: cause instanceof Error
                ? cause.message
                : "Gemini generateContent failed during classification",
              ...(extractErrorStatus(cause) !== undefined ? { status: extractErrorStatus(cause)! } : {})
            })
        });

        const rawText = response.text;
        if (!rawText) {
          return yield* new GeminiParseError({
            message: "Gemini classification returned empty response"
          });
        }

        const classification = yield* Schema.decodeUnknownEffect(
          Schema.fromJsonString(ImageClassification)
        )(rawText).pipe(
          Effect.mapError((error) =>
            new GeminiParseError({
              message: `Classification parse/validation failed: ${formatSchemaParseError(error)}`,
              rawOutput: rawText
            })
          )
        );

        return classification;
      }
    );

    // -----------------------------------------------------------------------
    // extractChartData
    // -----------------------------------------------------------------------

    const extractChartData = Effect.fn("GeminiVision.extractChartData")(
      function* (imageUri: string, mimeType: string) {
        const response = yield* Effect.tryPromise({
          try: () =>
            ai.models.generateContent({
              model,
              contents: createUserContent([
                createPartFromUri(imageUri, mimeType),
                VISION_EXTRACTION_PROMPT
              ]),
              config: {
                responseMimeType: "application/json",
                responseJsonSchema: EXTRACTION_JSON_SCHEMA
              }
            }),
          catch: (cause) =>
            new GeminiApiError({
              message: cause instanceof Error
                ? cause.message
                : "Gemini generateContent failed during extraction",
              ...(extractErrorStatus(cause) !== undefined ? { status: extractErrorStatus(cause)! } : {})
            })
        });

        const rawText = response.text;
        if (!rawText) {
          return yield* new GeminiParseError({
            message: "Gemini extraction returned empty response"
          });
        }

        const geminiResult = yield* Schema.decodeUnknownEffect(
          Schema.fromJsonString(GeminiExtractionDecoder)
        )(rawText).pipe(
          Effect.mapError((error) =>
            new GeminiParseError({
              message: `Extraction parse/validation failed: ${formatSchemaParseError(error)}`,
              rawOutput: rawText
            })
          )
        );

        const normalizedMediaType = geminiResult.mediaType;

        const now = yield* Clock.currentTimeMillis;
        const enrichment = yield* Schema.decodeUnknownEffect(VisionAssetAnalysisSchema)({
          ...geminiResult,
          mediaType: normalizedMediaType,
          altTextProvenance: "synthetic" as const,
          modelId: model,
          processedAt: now
        }).pipe(
          Effect.mapError((error) =>
            new GeminiParseError({
              message: `Vision asset analysis validation failed: ${formatSchemaParseError(error)}`,
              rawOutput: rawText
            })
          )
        );

        return enrichment;
      }
    );

    // -----------------------------------------------------------------------
    // Service
    // -----------------------------------------------------------------------

    return {
      uploadImage,
      classifyImage,
      extractChartData
    };
  })
);
