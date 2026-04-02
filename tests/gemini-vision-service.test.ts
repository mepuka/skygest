import { Cause, ConfigProvider, Effect, Exit, Layer } from "effect";
import { describe, expect, it } from "@effect/vitest";
import { vi } from "vitest";
import { encodeJsonString } from "../src/platform/Json.ts";

// ---------------------------------------------------------------------------
// Mock @google/genai — must be before the dynamic import
// ---------------------------------------------------------------------------

const mockUpload = vi.fn();
const mockGenerateContent = vi.fn();

vi.mock("@google/genai", () => ({
  GoogleGenAI: class {
    readonly files = { upload: mockUpload };
    readonly models = { generateContent: mockGenerateContent };
  },
  createUserContent: (...args: unknown[]) => args,
  createPartFromUri: (uri: string, mimeType: string) => ({ uri, mimeType })
}));

// Dynamic import so the mock is in place before module evaluation
const { GeminiVisionServiceLive } = await import(
  "../src/enrichment/GeminiVisionServiceLive"
);
const { GeminiVisionService } = await import(
  "../src/enrichment/GeminiVisionService"
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Config layer that satisfies the service's Config requirements. */
const TestConfig = ConfigProvider.layer(
  ConfigProvider.fromUnknown({
    GOOGLE_API_KEY: "test-api-key",
    GEMINI_VISION_MODEL: "test-model"
  })
);

/** Full test layer: live service backed by our mocked SDK + test config. */
const TestLayer = GeminiVisionServiceLive.pipe(Layer.provide(TestConfig));

/** Provide GeminiVisionService + Config to an effect. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const runWith = (effect: Effect.Effect<any, any, any>) => Effect.provide(effect, TestLayer);

/** Valid classification JSON that matches ImageClassification schema. */
const validClassificationJson = encodeJsonString({
  mediaType: "chart",
  chartTypes: ["bar-chart"],
  hasDataPoints: true,
  isCompound: false
});

/** Valid extraction JSON that matches GeminiExtractionOutput schema. */
const validExtractionJson = encodeJsonString({
  mediaType: "chart",
  chartTypes: ["bar-chart", "line-chart"],
  altText: "Alberta electricity prices from 2020 to 2024",
  title: "Alberta Pool Price",
  xAxis: { label: "Year", unit: null },
  yAxis: { label: "Price", unit: "$/MWh" },
  series: [{ legendLabel: "Pool Price", unit: "$/MWh" }],
  sourceLines: [{ sourceText: "Source: AESO", datasetName: null }],
  temporalCoverage: { startDate: "2020", endDate: "2024" },
  keyFindings: ["Prices peaked in 2022", "Steady decline through 2023"],
  visibleUrls: [],
  organizationMentions: [],
  logoText: []
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GeminiVisionService", () => {
  // Reset mocks between tests
  it.effect.each([undefined])("reset mocks", () =>
    Effect.sync(() => {
      mockUpload.mockReset();
      mockGenerateContent.mockReset();
    })
  );

  // -------------------------------------------------------------------------
  // uploadImage
  // -------------------------------------------------------------------------

  describe("uploadImage", () => {
    it.effect("returns UploadedFile on success", () =>
      Effect.gen(function* () {
        mockUpload.mockReset();
        mockUpload.mockResolvedValueOnce({
          uri: "https://gemini.files/abc",
          name: "files/abc"
        });

        const svc = yield* GeminiVisionService;
        const result = yield* svc.uploadImage(
          new Uint8Array([1, 2, 3]),
          "image/png"
        );

        expect(result).toEqual({
          uri: "https://gemini.files/abc",
          name: "files/abc"
        });
        expect(mockUpload).toHaveBeenCalledOnce();
      }).pipe(runWith)
    );

    it.effect("fails with GeminiApiError when upload throws", () =>
      Effect.gen(function* () {
        mockUpload.mockReset();
        mockUpload.mockRejectedValueOnce(new Error("network timeout"));

        const svc = yield* GeminiVisionService;
        const exit = yield* Effect.exit(
          svc.uploadImage(new Uint8Array([1, 2, 3]), "image/png")
        );

        expect(Exit.isFailure(exit)).toBe(true);
        if (Exit.isFailure(exit)) {
          const error = Cause.squash(exit.cause);
          expect(error).toBeDefined();
          expect((error as any)._tag).toBe("GeminiApiError");
          expect((error as any).message).toBe("network timeout");
        }
      }).pipe(runWith)
    );

    it.effect("fails with GeminiApiError when upload returns missing uri", () =>
      Effect.gen(function* () {
        mockUpload.mockReset();
        mockUpload.mockResolvedValueOnce({
          uri: undefined,
          name: "files/abc"
        });

        const svc = yield* GeminiVisionService;
        const exit = yield* Effect.exit(
          svc.uploadImage(new Uint8Array([1, 2, 3]), "image/png")
        );

        expect(Exit.isFailure(exit)).toBe(true);
        if (Exit.isFailure(exit)) {
          const error = Cause.squash(exit.cause);
          expect(error).toBeDefined();
          expect((error as any)._tag).toBe("GeminiApiError");
          expect((error as any).message).toContain("missing uri or name");
        }
      }).pipe(runWith)
    );

    it.effect(
      "fails with GeminiApiError preserving status from SDK error",
      () =>
        Effect.gen(function* () {
          mockUpload.mockReset();
          const sdkError = Object.assign(new Error("rate limited"), {
            status: 429
          });
          mockUpload.mockRejectedValueOnce(sdkError);

          const svc = yield* GeminiVisionService;
          const exit = yield* Effect.exit(
            svc.uploadImage(new Uint8Array([1, 2, 3]), "image/png")
          );

          expect(Exit.isFailure(exit)).toBe(true);
          if (Exit.isFailure(exit)) {
            const error = Cause.squash(exit.cause);
            expect((error as any)._tag).toBe("GeminiApiError");
            expect((error as any).status).toBe(429);
          }
        }).pipe(runWith)
    );
  });

  // -------------------------------------------------------------------------
  // classifyImage
  // -------------------------------------------------------------------------

  describe("classifyImage", () => {
    it.effect("returns ImageClassification for valid JSON response", () =>
      Effect.gen(function* () {
        mockGenerateContent.mockReset();
        mockGenerateContent.mockResolvedValueOnce({
          text: validClassificationJson
        });

        const svc = yield* GeminiVisionService;
        const result = yield* svc.classifyImage(
          "https://gemini.files/abc",
          "image/png"
        );

        expect(result).toEqual({
          mediaType: "chart",
          chartTypes: ["bar-chart"],
          hasDataPoints: true,
          isCompound: false
        });
      }).pipe(runWith)
    );

    it.effect(
      "parses isCompound: true for compound dashboard classification",
      () =>
        Effect.gen(function* () {
          mockGenerateContent.mockReset();
          mockGenerateContent.mockResolvedValueOnce({
            text: encodeJsonString({
              mediaType: "chart",
              chartTypes: ["bar-chart", "line-chart"],
              hasDataPoints: true,
              isCompound: true
            })
          });

          const svc = yield* GeminiVisionService;
          const result = yield* svc.classifyImage(
            "https://gemini.files/abc",
            "image/png"
          );

          expect(result).toEqual({
            mediaType: "chart",
            chartTypes: ["bar-chart", "line-chart"],
            hasDataPoints: true,
            isCompound: true
          });
        }).pipe(runWith)
    );

    it.effect("fails with GeminiParseError for non-JSON text", () =>
      Effect.gen(function* () {
        mockGenerateContent.mockReset();
        mockGenerateContent.mockResolvedValueOnce({
          text: "This is not valid JSON at all"
        });

        const svc = yield* GeminiVisionService;
        const exit = yield* Effect.exit(
          svc.classifyImage("https://gemini.files/abc", "image/png")
        );

        expect(Exit.isFailure(exit)).toBe(true);
        if (Exit.isFailure(exit)) {
          const error = Cause.squash(exit.cause);
          expect((error as any)._tag).toBe("GeminiParseError");
          expect((error as any).message).toContain("Classification parse/validation failed");
          expect((error as any).rawOutput).toBe(
            "This is not valid JSON at all"
          );
        }
      }).pipe(runWith)
    );

    it.effect(
      "fails with GeminiParseError when JSON is valid but missing required fields",
      () =>
        Effect.gen(function* () {
          mockGenerateContent.mockReset();
          // Missing hasDataPoints field
          mockGenerateContent.mockResolvedValueOnce({
            text: encodeJsonString({ mediaType: "chart" })
          });

          const svc = yield* GeminiVisionService;
          const exit = yield* Effect.exit(
            svc.classifyImage("https://gemini.files/abc", "image/png")
          );

          expect(Exit.isFailure(exit)).toBe(true);
          if (Exit.isFailure(exit)) {
            const error = Cause.squash(exit.cause);
            expect((error as any)._tag).toBe("GeminiParseError");
            expect((error as any).message).toContain(
              "Classification parse/validation failed"
            );
          }
        }).pipe(runWith)
    );

    it.effect("fails with GeminiParseError for empty response text", () =>
      Effect.gen(function* () {
        mockGenerateContent.mockReset();
        mockGenerateContent.mockResolvedValueOnce({ text: "" });

        const svc = yield* GeminiVisionService;
        const exit = yield* Effect.exit(
          svc.classifyImage("https://gemini.files/abc", "image/png")
        );

        expect(Exit.isFailure(exit)).toBe(true);
        if (Exit.isFailure(exit)) {
          const error = Cause.squash(exit.cause);
          expect((error as any)._tag).toBe("GeminiParseError");
          expect((error as any).message).toContain("empty response");
        }
      }).pipe(runWith)
    );

    it.effect(
      "fails with GeminiParseError for undefined response text",
      () =>
        Effect.gen(function* () {
          mockGenerateContent.mockReset();
          mockGenerateContent.mockResolvedValueOnce({ text: undefined });

          const svc = yield* GeminiVisionService;
          const exit = yield* Effect.exit(
            svc.classifyImage("https://gemini.files/abc", "image/png")
          );

          expect(Exit.isFailure(exit)).toBe(true);
          if (Exit.isFailure(exit)) {
            const error = Cause.squash(exit.cause);
            expect((error as any)._tag).toBe("GeminiParseError");
            expect((error as any).message).toContain("empty response");
          }
        }).pipe(runWith)
    );

    it.effect(
      "fails with GeminiApiError with status when generateContent throws",
      () =>
        Effect.gen(function* () {
          mockGenerateContent.mockReset();
          const sdkError = Object.assign(
            new Error("quota exceeded"),
            { status: 429 }
          );
          mockGenerateContent.mockRejectedValueOnce(sdkError);

          const svc = yield* GeminiVisionService;
          const exit = yield* Effect.exit(
            svc.classifyImage("https://gemini.files/abc", "image/png")
          );

          expect(Exit.isFailure(exit)).toBe(true);
          if (Exit.isFailure(exit)) {
            const error = Cause.squash(exit.cause);
            expect((error as any)._tag).toBe("GeminiApiError");
            expect((error as any).message).toBe("quota exceeded");
            expect((error as any).status).toBe(429);
          }
        }).pipe(runWith)
    );

    it.effect(
      "fails with GeminiParseError when mediaType has invalid enum value",
      () =>
        Effect.gen(function* () {
          mockGenerateContent.mockReset();
          mockGenerateContent.mockResolvedValueOnce({
            text: encodeJsonString({
              mediaType: "invalid-type",
              chartTypes: [],
              hasDataPoints: false,
              isCompound: false
            })
          });

          const svc = yield* GeminiVisionService;
          const exit = yield* Effect.exit(
            svc.classifyImage("https://gemini.files/abc", "image/png")
          );

          expect(Exit.isFailure(exit)).toBe(true);
          if (Exit.isFailure(exit)) {
            const error = Cause.squash(exit.cause);
            expect((error as any)._tag).toBe("GeminiParseError");
          }
        }).pipe(runWith)
    );
  });

  // -------------------------------------------------------------------------
  // extractChartData
  // -------------------------------------------------------------------------

  describe("extractChartData", () => {
    it.effect(
      "returns VisionAssetAnalysis with runtime fields for valid response",
      () =>
        Effect.gen(function* () {
          mockGenerateContent.mockReset();
          mockGenerateContent.mockResolvedValueOnce({
            text: validExtractionJson
          });

          const svc = yield* GeminiVisionService;
          const before = Date.now();
          const result = yield* svc.extractChartData(
            "https://gemini.files/abc",
            "image/png"
          );

          // Runtime fields injected by the service
          expect(result.modelId).toBe("test-model");
          expect(typeof result.processedAt).toBe("number");

          // Gemini-extracted fields
          expect(result.mediaType).toBe("chart");
          expect(result.chartTypes).toEqual(["bar-chart", "line-chart"]);
          expect(result.altText).toBe(
            "Alberta electricity prices from 2020 to 2024"
          );
          expect(result.altTextProvenance).toBe("synthetic");
          expect(result.title).toBe("Alberta Pool Price");
          expect(result.xAxis).toEqual({ label: "Year", unit: null });
          expect(result.yAxis).toEqual({ label: "Price", unit: "$/MWh" });
          expect(result.series).toEqual([
            { legendLabel: "Pool Price", unit: "$/MWh" }
          ]);
          expect(result.sourceLines).toEqual([
            { sourceText: "Source: AESO", datasetName: null }
          ]);
          expect(result.visibleUrls).toEqual([]);
          expect(result.organizationMentions).toEqual([]);
          expect(result.logoText).toEqual([]);
          expect(result.temporalCoverage).toEqual({
            startDate: "2020",
            endDate: "2024"
          });
          expect(result.keyFindings).toEqual([
            "Prices peaked in 2022",
            "Steady decline through 2023"
          ]);
        }).pipe(runWith)
    );

    it.effect("fails with GeminiParseError for invalid JSON", () =>
      Effect.gen(function* () {
        mockGenerateContent.mockReset();
        mockGenerateContent.mockResolvedValueOnce({
          text: "not json {{{}"
        });

        const svc = yield* GeminiVisionService;
        const exit = yield* Effect.exit(
          svc.extractChartData("https://gemini.files/abc", "image/png")
        );

        expect(Exit.isFailure(exit)).toBe(true);
        if (Exit.isFailure(exit)) {
          const error = Cause.squash(exit.cause);
          expect((error as any)._tag).toBe("GeminiParseError");
          expect((error as any).message).toContain(
            "Extraction parse/validation failed"
          );
          expect((error as any).rawOutput).toBe("not json {{{}")
        }
      }).pipe(runWith)
    );

    it.effect("fails with GeminiParseError for empty response", () =>
      Effect.gen(function* () {
        mockGenerateContent.mockReset();
        mockGenerateContent.mockResolvedValueOnce({ text: "" });

        const svc = yield* GeminiVisionService;
        const exit = yield* Effect.exit(
          svc.extractChartData("https://gemini.files/abc", "image/png")
        );

        expect(Exit.isFailure(exit)).toBe(true);
        if (Exit.isFailure(exit)) {
          const error = Cause.squash(exit.cause);
          expect((error as any)._tag).toBe("GeminiParseError");
          expect((error as any).message).toContain("empty response");
        }
      }).pipe(runWith)
    );

    it.effect(
      "fails with GeminiApiError when generateContent throws during extraction",
      () =>
        Effect.gen(function* () {
          mockGenerateContent.mockReset();
          mockGenerateContent.mockRejectedValueOnce(
            new Error("internal server error")
          );

          const svc = yield* GeminiVisionService;
          const exit = yield* Effect.exit(
            svc.extractChartData("https://gemini.files/abc", "image/png")
          );

          expect(Exit.isFailure(exit)).toBe(true);
          if (Exit.isFailure(exit)) {
            const error = Cause.squash(exit.cause);
            expect((error as any)._tag).toBe("GeminiApiError");
            expect((error as any).message).toBe("internal server error");
          }
        }).pipe(runWith)
    );

    it.effect(
      "fails with GeminiParseError when extraction JSON has wrong schema",
      () =>
        Effect.gen(function* () {
          mockGenerateContent.mockReset();
          // Valid JSON structure but invalid field types/enum values.
          mockGenerateContent.mockResolvedValueOnce({
            text: encodeJsonString({
              mediaType: "chart",
              chartTypes: ["not-a-chart"],
              altText: "some alt text",
              title: "Broken payload",
              xAxis: null,
              yAxis: null,
              series: [],
              sourceLines: [],
              temporalCoverage: null,
              keyFindings: "not-an-array",
              visibleUrls: [],
              organizationMentions: [],
              logoText: []
            })
          });

          const svc = yield* GeminiVisionService;
          const exit = yield* Effect.exit(
            svc.extractChartData("https://gemini.files/abc", "image/png")
          );

          expect(Exit.isFailure(exit)).toBe(true);
          if (Exit.isFailure(exit)) {
            const error = Cause.squash(exit.cause);
            expect((error as any)._tag).toBe("GeminiParseError");
            expect((error as any).message).toContain(
              "Extraction parse/validation failed"
            );
          }
        }).pipe(runWith)
    );

    it.effect(
      "handles extraction with all nullable fields set to null",
      () =>
        Effect.gen(function* () {
          mockGenerateContent.mockReset();
          mockGenerateContent.mockResolvedValueOnce({
            text: encodeJsonString({
              mediaType: "photo",
              chartTypes: [],
              altText: null,
              title: null,
              xAxis: null,
              yAxis: null,
              series: [],
              sourceLines: [],
              temporalCoverage: null,
              keyFindings: [],
              visibleUrls: [],
              organizationMentions: [],
              logoText: []
            })
          });

          const svc = yield* GeminiVisionService;
          const result = yield* svc.extractChartData(
            "https://gemini.files/abc",
            "image/jpeg"
          );

          expect(result.modelId).toBe("test-model");
          expect(result.mediaType).toBe("photo");
          expect(result.altText).toBeNull();
          expect(result.xAxis).toBeNull();
          expect(result.yAxis).toBeNull();
          expect(result.series).toEqual([]);
          expect(result.temporalCoverage).toBeNull();
          expect(result.keyFindings).toEqual([]);
        }).pipe(runWith)
    );

    it.effect("Gemini JSON schema preserves mediaType enum constraint", () =>
      Effect.gen(function* () {
        // The EXTRACTION_JSON_SCHEMA is derived from GeminiExtractionContract
        // (not the lenient decoder), so the mediaType enum must be preserved.
        // Access it indirectly by checking what generateContent receives.
        mockGenerateContent.mockReset();
        mockGenerateContent.mockResolvedValueOnce({ text: validExtractionJson });

        const svc = yield* GeminiVisionService;
        yield* svc.extractChartData("https://gemini.files/abc", "image/png");

        const call = mockGenerateContent.mock.calls[0];
        const jsonSchema = call?.[0]?.config?.responseJsonSchema;
        // The schema may nest under a .schema key (Effect's toJsonSchemaDocument format)
        const schema = jsonSchema?.schema ?? jsonSchema;
        // mediaType should have enum constraint, not just { type: "string" }
        expect(schema?.properties?.mediaType?.enum).toBeDefined();
        expect(schema?.properties?.mediaType?.enum).toContain("chart");
        expect(schema?.properties?.mediaType?.enum).toContain("photo");
        expect(schema?.properties?.mediaType?.enum).not.toContain("image");
        // chartTypes, altText, title should be in required
        expect(schema?.required).toContain("chartTypes");
        expect(schema?.required).toContain("altText");
        expect(schema?.required).toContain("title");
      }).pipe(runWith)
    );

    it.effect("normalizes 'image' mediaType to 'photo'", () =>
      Effect.gen(function* () {
        mockGenerateContent.mockReset();
        mockGenerateContent.mockResolvedValueOnce({
          text: encodeJsonString({
            mediaType: "image",
            chartTypes: [],
            altText: "A photo of solar panels",
            title: null,
            xAxis: null,
            yAxis: null,
            series: [],
            sourceLines: [],
            temporalCoverage: null,
            keyFindings: [],
            visibleUrls: [],
            organizationMentions: [],
            logoText: []
          })
        });

        const svc = yield* GeminiVisionService;
        const result = yield* svc.extractChartData("https://gemini.files/abc", "image/jpeg");
        expect(result.mediaType).toBe("photo");
      }).pipe(runWith)
    );

    it.effect("normalizes PascalCase 'Chart' mediaType to 'chart'", () =>
      Effect.gen(function* () {
        mockGenerateContent.mockReset();
        mockGenerateContent.mockResolvedValueOnce({
          text: encodeJsonString({
            mediaType: "Chart",
            chartTypes: ["bar-chart"],
            altText: "Bar chart of energy output",
            title: "Energy Output",
            xAxis: { label: "Month", unit: null },
            yAxis: { label: "GWh", unit: "GWh" },
            series: [{ legendLabel: "Output", unit: "GWh" }],
            sourceLines: [],
            temporalCoverage: null,
            keyFindings: ["Output rose 15%"],
            visibleUrls: [],
            organizationMentions: [],
            logoText: []
          })
        });

        const svc = yield* GeminiVisionService;
        const result = yield* svc.extractChartData("https://gemini.files/abc", "image/png");
        expect(result.mediaType).toBe("chart");
        expect(result.chartTypes).toEqual(["bar-chart"]);
      }).pipe(runWith)
    );

    it.effect("defaults missing chartTypes to empty array", () =>
      Effect.gen(function* () {
        mockGenerateContent.mockReset();
        mockGenerateContent.mockResolvedValueOnce({
          text: encodeJsonString({
            mediaType: "photo",
            altText: "Wind turbines",
            title: null,
            xAxis: null,
            yAxis: null,
            series: [],
            sourceLines: [],
            temporalCoverage: null,
            keyFindings: [],
            visibleUrls: [],
            organizationMentions: [],
            logoText: []
          })
        });

        const svc = yield* GeminiVisionService;
        const result = yield* svc.extractChartData("https://gemini.files/abc", "image/jpeg");
        expect(result.chartTypes).toEqual([]);
        expect(result.mediaType).toBe("photo");
      }).pipe(runWith)
    );

    it.effect("defaults missing title and altText to null", () =>
      Effect.gen(function* () {
        mockGenerateContent.mockReset();
        mockGenerateContent.mockResolvedValueOnce({
          text: encodeJsonString({
            mediaType: "infographic",
            chartTypes: [],
            xAxis: null,
            yAxis: null,
            series: [],
            sourceLines: [],
            temporalCoverage: null,
            keyFindings: [],
            visibleUrls: [],
            organizationMentions: [],
            logoText: []
          })
        });

        const svc = yield* GeminiVisionService;
        const result = yield* svc.extractChartData("https://gemini.files/abc", "image/png");
        expect(result.title).toBeNull();
        expect(result.altText).toBeNull();
        expect(result.mediaType).toBe("infographic");
      }).pipe(runWith)
    );

    it.effect("collapses multi-panel array responses into a single analysis", () =>
      Effect.gen(function* () {
        mockGenerateContent.mockReset();
        mockGenerateContent.mockResolvedValueOnce({
          text: encodeJsonString([
            {
              mediaType: "chart",
              chartTypes: ["choropleth-map"],
              altText: "SPP dashboard with a price contour map and generation mix panels",
              chartTitle: "Price Contour Map",
              sourceLines: [{ sourceText: "Source: SPP", datasetName: null }],
              keyFindings: ["High prices cluster in the central region"],
              visibleUrls: ["spp.org"],
              organizationMentions: [{ name: "SPP", location: "footer" }],
              logoText: ["SPP"]
            },
            {
              chartTypes: ["pie-chart"],
              chartTitle: "East BA Generation Mix",
              series: [
                { legendLabel: "Gas", unit: "%" },
                { legendLabel: "Wind", unit: "%" }
              ],
              keyFindings: ["Gas dominates the east balancing area mix"],
              sourceLines: [{ sourceText: "Source: SPP", datasetName: null }],
              organizationMentions: [{ name: "SPP", location: "footer" }],
              logoText: ["SPP"]
            }
          ])
        });

        const svc = yield* GeminiVisionService;
        const result = yield* svc.extractChartData("https://gemini.files/abc", "image/png");

        expect(result.mediaType).toBe("chart");
        expect(result.chartTypes).toEqual(["choropleth-map", "pie-chart"]);
        expect(result.title).toBe("Price Contour Map");
        expect(result.altText).toBe(
          "SPP dashboard with a price contour map and generation mix panels"
        );
        expect(result.series).toEqual([
          { legendLabel: "Gas", unit: "%" },
          { legendLabel: "Wind", unit: "%" }
        ]);
        expect(result.sourceLines).toEqual([
          { sourceText: "Source: SPP", datasetName: null }
        ]);
        expect(result.keyFindings).toEqual([
          "High prices cluster in the central region",
          "Gas dominates the east balancing area mix"
        ]);
        expect(result.visibleUrls).toEqual(["spp.org"]);
        expect(result.organizationMentions).toEqual([
          { name: "SPP", location: "footer" }
        ]);
        expect(result.logoText).toEqual(["SPP"]);
      }).pipe(runWith)
    );

    it.effect("infers chart mediaType when Gemini omits it on chart-like output", () =>
      Effect.gen(function* () {
        mockGenerateContent.mockReset();
        mockGenerateContent.mockResolvedValueOnce({
          text: encodeJsonString({
            chartTypes: ["line-chart"],
            altText: "Line chart of hourly demand",
            title: "Hourly Demand",
            xAxis: { label: "Hour", unit: null },
            yAxis: { label: "Load", unit: "MW" },
            series: [{ legendLabel: "Demand", unit: "MW" }],
            sourceLines: [],
            temporalCoverage: null,
            keyFindings: ["Demand peaks in the evening"],
            visibleUrls: [],
            organizationMentions: [],
            logoText: []
          })
        });

        const svc = yield* GeminiVisionService;
        const result = yield* svc.extractChartData("https://gemini.files/abc", "image/png");

        expect(result.mediaType).toBe("chart");
        expect(result.chartTypes).toEqual(["line-chart"]);
        expect(result.title).toBe("Hourly Demand");
      }).pipe(runWith)
    );

    it.effect("normalizes 'Infographic' (PascalCase) to 'infographic'", () =>
      Effect.gen(function* () {
        mockGenerateContent.mockReset();
        mockGenerateContent.mockResolvedValueOnce({
          text: encodeJsonString({
            mediaType: "Infographic",
            chartTypes: [],
            altText: null,
            title: null,
            xAxis: null,
            yAxis: null,
            series: [],
            sourceLines: [],
            temporalCoverage: null,
            keyFindings: [],
            visibleUrls: [],
            organizationMentions: [],
            logoText: []
          })
        });

        const svc = yield* GeminiVisionService;
        const result = yield* svc.extractChartData("https://gemini.files/abc", "image/png");
        expect(result.mediaType).toBe("infographic");
      }).pipe(runWith)
    );

    it.effect("normalizes PascalCase chartTypes ('Contour Map' → 'contour-map')", () =>
      Effect.gen(function* () {
        mockGenerateContent.mockReset();
        mockGenerateContent.mockResolvedValueOnce({
          text: encodeJsonString({
            mediaType: "chart",
            chartTypes: ["Contour Map", "Pie Chart"],
            altText: "SPP grid status dashboard",
            title: "SPP Real-Time",
            xAxis: null,
            yAxis: null,
            series: [],
            sourceLines: [],
            temporalCoverage: null,
            keyFindings: ["Wind dominates East BA"],
            visibleUrls: [],
            organizationMentions: [],
            logoText: []
          })
        });

        const svc = yield* GeminiVisionService;
        const result = yield* svc.extractChartData("https://gemini.files/abc", "image/png");
        expect(result.chartTypes).toEqual(["contour-map", "pie-chart"]);
      }).pipe(runWith)
    );

    it.effect("normalizes lowercase spaced chartType ('heatmap' stays, 'scatter plot' → 'scatter-plot')", () =>
      Effect.gen(function* () {
        mockGenerateContent.mockReset();
        mockGenerateContent.mockResolvedValueOnce({
          text: encodeJsonString({
            mediaType: "chart",
            chartTypes: ["heatmap", "scatter plot"],
            altText: "Temperature data",
            title: null,
            xAxis: null,
            yAxis: null,
            series: [],
            sourceLines: [],
            temporalCoverage: null,
            keyFindings: [],
            visibleUrls: [],
            organizationMentions: [],
            logoText: []
          })
        });

        const svc = yield* GeminiVisionService;
        const result = yield* svc.extractChartData("https://gemini.files/abc", "image/png");
        expect(result.chartTypes).toEqual(["heatmap", "scatter-plot"]);
      }).pipe(runWith)
    );
  });
});
