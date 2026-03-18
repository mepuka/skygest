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
 */

import { GoogleGenAI, createUserContent, createPartFromUri } from "@google/genai";
import { Config, Effect, Layer, Schema } from "effect";
import type { VisionEnrichment } from "../domain/enrichment";
import { VisionEnrichment as VisionEnrichmentSchema } from "../domain/enrichment";
import { GeminiApiError, GeminiParseError } from "../domain/errors";
import {
  GeminiVisionService,
  ImageClassification,
  type UploadedFile
} from "./GeminiVisionService";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_MODEL = "gemini-2.5-flash";

// ---------------------------------------------------------------------------
// JSON Schemas for Gemini structured output
// ---------------------------------------------------------------------------

const MEDIA_TYPE_ENUM = [
  "chart",
  "document-excerpt",
  "photo",
  "infographic",
  "video"
] as const;

const CHART_TYPE_ENUM = [
  "area-chart",
  "bar-chart",
  "candlestick-chart",
  "choropleth-map",
  "data-table",
  "dual-axis-chart",
  "heatmap",
  "line-chart",
  "pie-chart",
  "point-map",
  "sankey-diagram",
  "scatter-plot",
  "stacked-bar-chart",
  "treemap"
] as const;

const ALT_TEXT_PROVENANCE_ENUM = ["original", "synthetic", "absent"] as const;

/**
 * Lightweight classification schema — used by classifyImage.
 */
const CLASSIFICATION_JSON_SCHEMA = {
  type: "object",
  properties: {
    mediaType: {
      type: "string",
      enum: [...MEDIA_TYPE_ENUM],
      description: "The primary media type of the image content."
    },
    chartTypes: {
      type: "array",
      items: {
        type: "string",
        enum: [...CHART_TYPE_ENUM]
      },
      description:
        "Chart types present in the image. Empty array if not a chart."
    },
    hasDataPoints: {
      type: "boolean",
      description:
        "True if the image contains extractable quantitative data points."
    }
  },
  required: ["mediaType", "chartTypes", "hasDataPoints"]
} as const;

/**
 * Full extraction schema — used by extractChartData.
 * Matches the VisionEnrichment domain shape.
 */
const EXTRACTION_JSON_SCHEMA = {
  type: "object",
  properties: {
    mediaType: {
      type: "string",
      enum: [...MEDIA_TYPE_ENUM],
      description: "The primary media type of the image."
    },
    chartTypes: {
      type: "array",
      items: {
        type: "string",
        enum: [...CHART_TYPE_ENUM]
      },
      description: "All chart types present in the image."
    },
    altText: {
      type: "string",
      nullable: true,
      description:
        "A concise, accessible alt-text description of the image. Null only if the image is completely uninterpretable."
    },
    altTextProvenance: {
      type: "string",
      enum: [...ALT_TEXT_PROVENANCE_ENUM],
      description:
        "Set to 'synthetic' since this alt text is AI-generated."
    },
    title: {
      type: "string",
      nullable: true,
      description:
        "The chart or image title as it appears in the image. Null if none visible."
    },
    xAxis: {
      type: "object",
      nullable: true,
      properties: {
        label: {
          type: "string",
          nullable: true,
          description: "X-axis label text."
        },
        unit: {
          type: "string",
          nullable: true,
          description: "X-axis unit (e.g. 'years', 'months', 'MW')."
        }
      },
      required: ["label", "unit"],
      description: "X-axis metadata. Null if no x-axis is present."
    },
    yAxis: {
      type: "object",
      nullable: true,
      properties: {
        label: {
          type: "string",
          nullable: true,
          description: "Y-axis label text."
        },
        unit: {
          type: "string",
          nullable: true,
          description: "Y-axis unit (e.g. 'GWh', 'USD/MWh', '%')."
        }
      },
      required: ["label", "unit"],
      description: "Y-axis metadata. Null if no y-axis is present."
    },
    series: {
      type: "array",
      items: {
        type: "object",
        properties: {
          legendLabel: {
            type: "string",
            description: "The label for this data series as shown in the legend."
          },
          unit: {
            type: "string",
            nullable: true,
            description: "Unit for this series if different from the axis unit."
          }
        },
        required: ["legendLabel", "unit"]
      },
      description: "Data series visible in the chart. Empty array if none."
    },
    sourceLines: {
      type: "array",
      items: {
        type: "object",
        properties: {
          sourceText: {
            type: "string",
            description:
              "Verbatim source/attribution text from the image (e.g. 'Source: EIA')."
          }
        },
        required: ["sourceText"]
      },
      description:
        "Source attribution lines visible in the image. Empty array if none."
    },
    temporalCoverage: {
      type: "object",
      nullable: true,
      properties: {
        startDate: {
          type: "string",
          nullable: true,
          description: "Start date of the data (ISO 8601 or partial, e.g. '2020' or '2020-01')."
        },
        endDate: {
          type: "string",
          nullable: true,
          description: "End date of the data (ISO 8601 or partial, e.g. '2024' or '2024-12')."
        }
      },
      required: ["startDate", "endDate"],
      description: "Temporal range of the data shown. Null if not time-series data."
    },
    keyFindings: {
      type: "array",
      items: {
        type: "string"
      },
      description:
        "1-5 key findings or takeaways from the image, written as concise energy-domain statements."
    }
  },
  required: [
    "mediaType",
    "chartTypes",
    "altText",
    "altTextProvenance",
    "title",
    "xAxis",
    "yAxis",
    "series",
    "sourceLines",
    "temporalCoverage",
    "keyFindings"
  ]
} as const;

// ---------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------

const CLASSIFICATION_PROMPT = `You are an expert energy-sector image analyst. Classify this image.

Determine:
1. **mediaType**: What kind of media is this? (chart, document-excerpt, photo, infographic, or video)
2. **chartTypes**: If it contains charts, which specific chart types are present? Use exact values from the enum. Return an empty array if not a chart.
3. **hasDataPoints**: Does this image contain extractable quantitative data points (numbers, percentages, values on axes)?

Focus on energy, electricity, climate, and commodity domains. Be precise with chart type identification — a chart with filled areas is an area-chart, vertical bars are bar-chart, etc.`;

const EXTRACTION_PROMPT = `You are an expert energy-sector data analyst performing structured chart/image analysis. Follow the Charts-of-Thought process:

**Step 1 — Extract**: Identify all visible text, labels, axes, legends, data series, source attributions, and title.

**Step 2 — Sort**: Organize the extracted information into the structured fields: title, axes (with units), series (with legend labels), source lines, temporal coverage, and chart types.

**Step 3 — Verify**: Cross-check that extracted series match the legend, axis labels match the data, and temporal coverage spans the full range shown.

**Step 4 — Analyze**: Write 1-5 key findings as concise energy-domain statements. Focus on trends, comparisons, and notable data points.

Additional instructions:
- altText: Write a concise, accessible description suitable for screen readers. Describe what the chart shows, not just its type.
- altTextProvenance: Always set to "synthetic" since you are generating this.
- sourceLines: Extract verbatim source/attribution text (e.g., "Source: EIA", "Data: AESO").
- temporalCoverage: Use ISO 8601 partial dates (e.g., "2020", "2024-Q3", "2024-01").
- keyFindings: Energy-domain insights, not generic observations. Be specific about values and trends.
- For non-chart images (photos, documents), still provide altText and mediaType. Set chart-specific fields to null/empty as appropriate.`;

// ---------------------------------------------------------------------------
// Layer
// ---------------------------------------------------------------------------

export const GeminiVisionServiceLive = Layer.effect(
  GeminiVisionService,
  Effect.gen(function* () {
    const apiKey = yield* Config.string("GOOGLE_API_KEY");
    const ai = new GoogleGenAI({ apiKey });
    const model = DEFAULT_MODEL;

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
                : "Gemini Files API upload failed"
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
                CLASSIFICATION_PROMPT
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
                : "Gemini generateContent failed during classification"
            })
        });

        const rawText = response.text;
        if (!rawText) {
          return yield* new GeminiParseError({
            message: "Gemini classification returned empty response"
          });
        }

        const parsed = yield* Effect.try({
          try: () => JSON.parse(rawText) as unknown,
          catch: () =>
            new GeminiParseError({
              message: "Failed to parse classification JSON",
              rawOutput: rawText
            })
        });

        const classification = yield* Schema.decodeUnknown(ImageClassification)(
          parsed
        ).pipe(
          Effect.mapError((error) =>
            new GeminiParseError({
              message: `Classification schema validation failed: ${error.message}`,
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
                EXTRACTION_PROMPT
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
                : "Gemini generateContent failed during extraction"
            })
        });

        const rawText = response.text;
        if (!rawText) {
          return yield* new GeminiParseError({
            message: "Gemini extraction returned empty response"
          });
        }

        const parsed = yield* Effect.try({
          try: () => JSON.parse(rawText) as unknown,
          catch: () =>
            new GeminiParseError({
              message: "Failed to parse extraction JSON",
              rawOutput: rawText
            })
        });

        // Merge Gemini output with runtime fields to form VisionEnrichment
        const enrichmentInput = {
          ...(parsed as Record<string, unknown>),
          kind: "vision" as const,
          modelId: model,
          processedAt: Date.now()
        };

        const enrichment = yield* Schema.decodeUnknown(VisionEnrichmentSchema)(
          enrichmentInput
        ).pipe(
          Effect.mapError((error) =>
            new GeminiParseError({
              message: `Extraction schema validation failed: ${error.message}`,
              rawOutput: rawText
            })
          )
        );

        return enrichment as VisionEnrichment;
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
