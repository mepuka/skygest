/**
 * GeminiVisionServiceLive — live implementation of GeminiVisionService
 * backed by @google/genai SDK (Gemini 2.5 Flash).
 *
 * Three-pass pattern:
 * 1. classifyImage — lightweight classification with small JSON schema
 * 2. extractChartData — full asset analysis extraction with detailed schema
 * 3. extractImageSummary — lightweight extraction (metadata + provenance only)
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
  normalizeChartType,
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
  VISION_EXTRACTION_PROMPT,
  VISION_LIGHTWEIGHT_EXTRACTION_PROMPT
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

/** Lenient ChartType: normalizes to kebab-case but accepts any value.
 *  The contract sends the enum to guide Gemini, but the decoder is permissive
 *  so unknown chart types don't fail enrichment. Validate downstream if needed. */
const LenientChartType = Schema.String.pipe(
  Schema.decode({
    decode: SchemaGetter.transform(normalizeChartType),
    encode: SchemaGetter.passthrough()
  })
);

/** Lenient decoder for Gemini responses — tolerates missing keys and loose values. */
const GeminiExtractionDecoder = Schema.Struct({
  mediaType: Schema.optionalKey(LenientMediaType),
  chartTypes: Schema.Array(LenientChartType).pipe(
    Schema.withDecodingDefaultKey(() => [] as const)
  ),
  altText: Schema.NullOr(Schema.String).pipe(
    Schema.withDecodingDefaultKey(() => null)
  ),
  title: Schema.NullOr(Schema.String).pipe(
    Schema.withDecodingDefaultKey(() => null)
  ),
  chartTitle: Schema.NullOr(Schema.String).pipe(
    Schema.withDecodingDefaultKey(() => null)
  ),
  xAxis: Schema.NullOr(ChartAxis).pipe(
    Schema.withDecodingDefaultKey(() => null)
  ),
  yAxis: Schema.NullOr(ChartAxis).pipe(
    Schema.withDecodingDefaultKey(() => null)
  ),
  series: Schema.Array(ChartSeries).pipe(
    Schema.withDecodingDefaultKey(() => [] as const)
  ),
  sourceLines: Schema.Array(VisionSourceLineAttribution).pipe(
    Schema.withDecodingDefaultKey(() => [] as const)
  ),
  temporalCoverage: Schema.NullOr(TemporalCoverage).pipe(
    Schema.withDecodingDefaultKey(() => null)
  ),
  keyFindings: Schema.Array(Schema.String).pipe(
    Schema.withDecodingDefaultKey(() => [] as const)
  ),
  visibleUrls: Schema.Array(Schema.String).pipe(
    Schema.withDecodingDefaultKey(() => [] as const)
  ),
  organizationMentions: Schema.Array(VisionOrganizationMention).pipe(
    Schema.withDecodingDefaultKey(() => [] as const)
  ),
  logoText: Schema.Array(Schema.String).pipe(
    Schema.withDecodingDefaultKey(() => [] as const)
  )
});

const GeminiExtractionResponseDecoder = Schema.Union([
  GeminiExtractionDecoder,
  Schema.Array(GeminiExtractionDecoder)
]);

type GeminiExtractionCandidate = Schema.Schema.Type<typeof GeminiExtractionDecoder>;

// ---------------------------------------------------------------------------
// Lightweight extraction schemas (metadata + provenance only)
//
// Used for compound/dashboard images where full axis/series extraction would
// fail or produce noise. Same contract/decoder split as the full schemas.
// ---------------------------------------------------------------------------

/** Strict schema sent to Gemini for lightweight extraction. */
const GeminiLightweightExtractionContract = Schema.Struct({
  mediaType: MediaType,
  chartTypes: Schema.Array(ChartType),
  altText: Schema.NullOr(Schema.String),
  title: Schema.NullOr(Schema.String),
  keyFindings: Schema.Array(Schema.String),
  sourceLines: Schema.Array(VisionSourceLineAttribution),
  visibleUrls: Schema.Array(Schema.String),
  organizationMentions: Schema.Array(VisionOrganizationMention),
  logoText: Schema.Array(Schema.String)
});

/** Lenient decoder for lightweight Gemini responses. */
const GeminiLightweightExtractionDecoder = Schema.Struct({
  mediaType: Schema.optionalKey(LenientMediaType),
  chartTypes: Schema.Array(LenientChartType).pipe(
    Schema.withDecodingDefaultKey(() => [] as const)
  ),
  altText: Schema.NullOr(Schema.String).pipe(
    Schema.withDecodingDefaultKey(() => null)
  ),
  title: Schema.NullOr(Schema.String).pipe(
    Schema.withDecodingDefaultKey(() => null)
  ),
  chartTitle: Schema.NullOr(Schema.String).pipe(
    Schema.withDecodingDefaultKey(() => null)
  ),
  keyFindings: Schema.Array(Schema.String).pipe(
    Schema.withDecodingDefaultKey(() => [] as const)
  ),
  sourceLines: Schema.Array(VisionSourceLineAttribution).pipe(
    Schema.withDecodingDefaultKey(() => [] as const)
  ),
  visibleUrls: Schema.Array(Schema.String).pipe(
    Schema.withDecodingDefaultKey(() => [] as const)
  ),
  organizationMentions: Schema.Array(VisionOrganizationMention).pipe(
    Schema.withDecodingDefaultKey(() => [] as const)
  ),
  logoText: Schema.Array(Schema.String).pipe(
    Schema.withDecodingDefaultKey(() => [] as const)
  ),
  // Absent chart-detail fields — default to null/empty so
  // normalizeExtractionResponse works unchanged.
  xAxis: Schema.NullOr(ChartAxis).pipe(
    Schema.withDecodingDefaultKey(() => null)
  ),
  yAxis: Schema.NullOr(ChartAxis).pipe(
    Schema.withDecodingDefaultKey(() => null)
  ),
  series: Schema.Array(ChartSeries).pipe(
    Schema.withDecodingDefaultKey(() => [] as const)
  ),
  temporalCoverage: Schema.NullOr(TemporalCoverage).pipe(
    Schema.withDecodingDefaultKey(() => null)
  )
});

const GeminiLightweightExtractionResponseDecoder = Schema.Union([
  GeminiLightweightExtractionDecoder,
  Schema.Array(GeminiLightweightExtractionDecoder)
]);

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

const isNonEmptyString = (value: string | null | undefined): value is string =>
  value !== null && value !== undefined && value.trim().length > 0;

const firstNonNull = <A>(
  values: ReadonlyArray<A | null | undefined>
): A | null => {
  for (const value of values) {
    if (value !== null && value !== undefined) {
      return value;
    }
  }
  return null;
};

const firstNonEmptyArray = <A>(
  values: ReadonlyArray<ReadonlyArray<A>>
): ReadonlyArray<A> => {
  for (const value of values) {
    if (value.length > 0) {
      return value;
    }
  }
  return [];
};

const uniqueBy = <A>(
  values: ReadonlyArray<A>,
  keyOf: (value: A) => string
): ReadonlyArray<A> =>
  Array.from(
    values.reduce(
      (map, value) => map.set(keyOf(value), value),
      new Map<string, A>()
    ).values()
  );

const inferMediaType = (
  candidates: ReadonlyArray<GeminiExtractionCandidate>
): Schema.Schema.Type<typeof MediaType> => {
  const explicit = firstNonNull(
    candidates.map((candidate) => candidate.mediaType)
  );
  if (explicit !== null) {
    return explicit;
  }

  const chartLike = candidates.some((candidate) =>
    candidate.chartTypes.length > 0 ||
    candidate.xAxis !== null ||
    candidate.yAxis !== null ||
    candidate.series.length > 0 ||
    candidate.temporalCoverage !== null ||
    candidate.sourceLines.length > 0
  );

  return chartLike ? "chart" : "photo";
};

const normalizeExtractionResponse = (
  decoded: GeminiExtractionCandidate | ReadonlyArray<GeminiExtractionCandidate>
) => {
  const candidates = Array.isArray(decoded) ? decoded : [decoded];

  return {
    mediaType: inferMediaType(candidates),
    chartTypes: Array.from(
      new Set(candidates.flatMap((candidate) => candidate.chartTypes))
    ),
    altText: firstNonNull(candidates.map((candidate) => candidate.altText)),
    title: firstNonNull(
      candidates.map((candidate) => candidate.title ?? candidate.chartTitle)
    ),
    xAxis: firstNonNull(candidates.map((candidate) => candidate.xAxis)),
    yAxis: firstNonNull(candidates.map((candidate) => candidate.yAxis)),
    series: firstNonEmptyArray(candidates.map((candidate) => candidate.series)),
    sourceLines: uniqueBy(
      candidates.flatMap((candidate) => candidate.sourceLines),
      (sourceLine) =>
        `${sourceLine.sourceText}::${sourceLine.datasetName ?? ""}`
    ),
    temporalCoverage: firstNonNull(
      candidates.map((candidate) => candidate.temporalCoverage)
    ),
    keyFindings: Array.from(
      new Set(
        candidates.flatMap((candidate) =>
          candidate.keyFindings.filter(isNonEmptyString)
        )
      )
    ).slice(0, 5),
    visibleUrls: Array.from(
      new Set(
        candidates.flatMap((candidate) =>
          candidate.visibleUrls.filter(isNonEmptyString)
        )
      )
    ),
    organizationMentions: uniqueBy(
      candidates.flatMap((candidate) => candidate.organizationMentions),
      (mention) => `${mention.name}::${mention.location}`
    ),
    logoText: Array.from(
      new Set(
        candidates.flatMap((candidate) =>
          candidate.logoText.filter(isNonEmptyString)
        )
      )
    )
  };
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
const LIGHTWEIGHT_EXTRACTION_JSON_SCHEMA = makeJsonSchema(GeminiLightweightExtractionContract);

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
          Schema.fromJsonString(GeminiExtractionResponseDecoder)
        )(rawText).pipe(
          Effect.mapError((error) =>
            new GeminiParseError({
              message: `Extraction parse/validation failed: ${formatSchemaParseError(error)}`,
              rawOutput: rawText
            })
          )
        );

        const normalizedResult = normalizeExtractionResponse(geminiResult);

        const now = yield* Clock.currentTimeMillis;
        const enrichment = yield* Schema.decodeUnknownEffect(VisionAssetAnalysisSchema)({
          ...normalizedResult,
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
    // extractImageSummary (lightweight: metadata + provenance only)
    // -----------------------------------------------------------------------

    const extractImageSummary = Effect.fn("GeminiVision.extractImageSummary")(
      function* (imageUri: string, mimeType: string) {
        const response = yield* Effect.tryPromise({
          try: () =>
            ai.models.generateContent({
              model,
              contents: createUserContent([
                createPartFromUri(imageUri, mimeType),
                VISION_LIGHTWEIGHT_EXTRACTION_PROMPT
              ]),
              config: {
                responseMimeType: "application/json",
                responseJsonSchema: LIGHTWEIGHT_EXTRACTION_JSON_SCHEMA
              }
            }),
          catch: (cause) =>
            new GeminiApiError({
              message: cause instanceof Error
                ? cause.message
                : "Gemini generateContent failed during lightweight extraction",
              ...(extractErrorStatus(cause) !== undefined ? { status: extractErrorStatus(cause)! } : {})
            })
        });

        const rawText = response.text;
        if (!rawText) {
          return yield* new GeminiParseError({
            message: "Gemini lightweight extraction returned empty response"
          });
        }

        const geminiResult = yield* Schema.decodeUnknownEffect(
          Schema.fromJsonString(GeminiLightweightExtractionResponseDecoder)
        )(rawText).pipe(
          Effect.mapError((error) =>
            new GeminiParseError({
              message: `Lightweight extraction parse/validation failed: ${formatSchemaParseError(error)}`,
              rawOutput: rawText
            })
          )
        );

        const normalizedResult = normalizeExtractionResponse(geminiResult);

        const now = yield* Clock.currentTimeMillis;
        const enrichment = yield* Schema.decodeUnknownEffect(VisionAssetAnalysisSchema)({
          ...normalizedResult,
          altTextProvenance: "synthetic" as const,
          modelId: model,
          processedAt: now
        }).pipe(
          Effect.mapError((error) =>
            new GeminiParseError({
              message: `Vision asset analysis validation failed (lightweight): ${formatSchemaParseError(error)}`,
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
      extractChartData,
      extractImageSummary
    };
  })
);
