/**
 * GeminiVisionServiceLive — live implementation of GeminiVisionService
 * backed by @google/genai SDK (Gemini 2.5 Flash).
 *
 * Two-pass pattern:
 * 1. classifyImage — lightweight classification with small JSON schema
 * 2. extractChartData — full VisionEnrichment extraction with detailed schema
 *
 * Uses structured output (responseMimeType + responseJsonSchema) to get
 * typed JSON responses directly from Gemini.
 *
 * JSON schemas for Gemini structured output are derived from Effect schemas
 * via JsonSchema.fromAST(), keeping enum values in sync with domain types.
 */

import { GoogleGenAI, createUserContent, createPartFromUri } from "@google/genai";
import { Config, Effect, Layer, Schema } from "effect";
import * as JsonSchema from "effect/JSONSchema";
import * as AST from "effect/SchemaAST";
import { VisionEnrichment as VisionEnrichmentSchema } from "../domain/enrichment";
import {
  MediaType,
  ChartType,
  ChartAxis,
  ChartSeries,
  ChartSourceLine,
  TemporalCoverage
} from "../domain/media";
import { GeminiApiError, GeminiParseError } from "../domain/errors";
import { formatSchemaParseError } from "../platform/Json";
import {
  GeminiVisionService,
  ImageClassification,
  type UploadedFile
} from "./GeminiVisionService";
import {
  VISION_CLASSIFICATION_PROMPT,
  VISION_EXTRACTION_PROMPT,
  VISION_PROMPT_VERSION
} from "./prompts";

// ---------------------------------------------------------------------------
// Gemini extraction output schema (subset of VisionEnrichment without runtime fields)
// ---------------------------------------------------------------------------

const GeminiExtractionOutput = Schema.Struct({
  mediaType: MediaType,
  chartTypes: Schema.Array(ChartType),
  altText: Schema.NullOr(Schema.String),
  title: Schema.NullOr(Schema.String),
  xAxis: Schema.NullOr(ChartAxis),
  yAxis: Schema.NullOr(ChartAxis),
  series: Schema.Array(ChartSeries),
  sourceLines: Schema.Array(ChartSourceLine),
  temporalCoverage: Schema.NullOr(TemporalCoverage),
  keyFindings: Schema.Array(Schema.String)
});

// ---------------------------------------------------------------------------
// JSON Schemas for Gemini structured output (derived from Effect schemas)
// ---------------------------------------------------------------------------

const makeJsonSchema = (ast: AST.AST): JsonSchema.JsonSchema7 => {
  const props = AST.getPropertySignatures(ast);
  if (props.length === 0) {
    return {
      type: "object",
      properties: {},
      required: [],
      additionalProperties: false
    };
  }
  const $defs = {};
  const schema = JsonSchema.fromAST(ast, {
    definitions: $defs,
    topLevelReferenceStrategy: "skip"
  });
  if (Object.keys($defs).length === 0) return schema;
  (schema as any).$defs = $defs;
  return schema;
};

const CLASSIFICATION_JSON_SCHEMA = makeJsonSchema(ImageClassification.ast);
const EXTRACTION_JSON_SCHEMA = makeJsonSchema(GeminiExtractionOutput.ast);

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
              status: cause instanceof Error && "status" in cause
                ? (cause as Record<string, unknown>).status as number
                : undefined
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
              status: cause instanceof Error && "status" in cause
                ? (cause as Record<string, unknown>).status as number
                : undefined
            })
        });

        const rawText = response.text;
        if (!rawText) {
          return yield* new GeminiParseError({
            message: "Gemini classification returned empty response"
          });
        }

        const classification = yield* Schema.decodeUnknown(
          Schema.parseJson(ImageClassification)
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
              status: cause instanceof Error && "status" in cause
                ? (cause as Record<string, unknown>).status as number
                : undefined
            })
        });

        const rawText = response.text;
        if (!rawText) {
          return yield* new GeminiParseError({
            message: "Gemini extraction returned empty response"
          });
        }

        const geminiResult = yield* Schema.decodeUnknown(
          Schema.parseJson(GeminiExtractionOutput)
        )(rawText).pipe(
          Effect.mapError((error) =>
            new GeminiParseError({
              message: `Extraction parse/validation failed: ${formatSchemaParseError(error)}`,
              rawOutput: rawText
            })
          )
        );

        // Merge Gemini output with runtime fields to form VisionEnrichment
        const enrichment = yield* Schema.decodeUnknown(VisionEnrichmentSchema)({
          ...geminiResult,
          kind: "vision" as const,
          altTextProvenance: "synthetic" as const,
          modelId: model,
          processedAt: Date.now()
        }).pipe(
          Effect.mapError((error) =>
            new GeminiParseError({
              message: `VisionEnrichment validation failed: ${formatSchemaParseError(error)}`,
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

    return GeminiVisionService.of({
      uploadImage,
      classifyImage,
      extractChartData
    });
  })
);
