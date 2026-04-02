import { ServiceMap, Effect, Layer, Schema } from "effect";
import {
  type VisionEnrichment,
  VisionEnrichment as VisionEnrichmentSchema,
  VisionAssetEnrichment as VisionAssetEnrichmentSchema
} from "../domain/enrichment";
import {
  EnrichmentAssetFetchError,
  EnrichmentSchemaDecodeError,
  GeminiApiError,
  GeminiParseError
} from "../domain/errors";
import {
  type EnrichmentPlannedAsset,
  VisionExecutionPlan,
  type VisionExecutionPlan as VisionExecutionPlanValue
} from "../domain/enrichmentPlan";
import { formatSchemaParseError } from "../platform/Json";
import { GeminiVisionService } from "./GeminiVisionService";
import { VISION_PROMPT_VERSION } from "./prompts";

const decodeVisionPlan = (input: unknown) =>
  Schema.decodeUnknown(VisionExecutionPlan)(input).pipe(
    Effect.mapError((error) =>
      EnrichmentSchemaDecodeError.make({
        message: formatSchemaParseError(error),
        operation: "VisionEnrichmentExecutor.execute"
      })
    )
  );

const trimToNull = (value: string | null) => {
  if (value === null) {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
};

const isNonEmptyString = (value: string | null | undefined): value is string =>
  typeof value === "string" && value.trim().length > 0;

const uniqueValues = <A>(values: ReadonlyArray<A>) => [...new Set(values)];

const inferMimeTypeFromUrl = (url: string) => {
  const normalized = url.toLowerCase();

  if (normalized.endsWith(".png")) return "image/png";
  if (normalized.endsWith(".webp")) return "image/webp";
  if (normalized.endsWith(".gif")) return "image/gif";
  return "image/jpeg";
};

const normalizeMimeType = (contentType: string | null, fallbackUrl: string) => {
  const mimeType = contentType?.split(";")[0]?.trim();
  return isNonEmptyString(mimeType)
    ? mimeType
    : inferMimeTypeFromUrl(fallbackUrl);
};

const getAssetFetchUrl = (
  asset: EnrichmentPlannedAsset
): Effect.Effect<string, EnrichmentAssetFetchError> => {
  switch (asset.assetType) {
    case "image":
      return Effect.succeed(asset.fullsize);
    case "video":
      return asset.thumbnail === null
        ? Effect.fail(
            EnrichmentAssetFetchError.make({
              assetKey: asset.assetKey,
              message: `video asset ${asset.assetKey} is missing a thumbnail`,
              operation: "VisionEnrichmentExecutor.fetchAsset"
            })
          )
        : Effect.succeed(asset.thumbnail);
  }
};

const getOriginalAltText = (asset: EnrichmentPlannedAsset) => {
  switch (asset.assetType) {
    case "image":
      return trimToNull(asset.alt);
    case "video":
      return trimToNull(asset.alt);
  }
};

const toSummaryText = (
  assetCount: number,
  titles: ReadonlyArray<string>,
  findings: ReadonlyArray<{ readonly text: string }>
) => {
  if (assetCount === 1 && titles[0] !== undefined) {
    return titles[0];
  }

  const leadFindings = findings.slice(0, 3).map((finding) => finding.text);
  if (leadFindings.length > 0) {
    return assetCount === 1
      ? leadFindings.join("; ")
      : `Analyzed ${assetCount} visual assets. Key themes: ${leadFindings.join("; ")}`;
  }

  if (titles.length > 0) {
    return assetCount === 1
      ? titles[0]!
      : `Analyzed ${assetCount} visual assets: ${titles.slice(0, 3).join("; ")}`;
  }

  return assetCount === 1
    ? "Analyzed one visual asset."
    : `Analyzed ${assetCount} visual assets.`;
};

const combineFindings = (
  assets: ReadonlyArray<Schema.Schema.Type<typeof VisionAssetEnrichmentSchema>>
) => {
  const findings = new Map<string, Set<string>>();

  for (const asset of assets) {
    for (const finding of asset.analysis.keyFindings) {
      const text = finding.trim();
      if (text.length === 0) {
        continue;
      }

      const keys = findings.get(text) ?? new Set<string>();
      keys.add(asset.assetKey);
      findings.set(text, keys);
    }
  }

  return Array.from(findings.entries()).map(([text, assetKeys]) => ({
    text,
    assetKeys: Array.from(assetKeys)
  }));
};

export class VisionEnrichmentExecutor extends ServiceMap.Service<
  VisionEnrichmentExecutor,
  {
    readonly execute: (
      input: VisionExecutionPlanValue
    ) => Effect.Effect<
      VisionEnrichment,
      | EnrichmentSchemaDecodeError
      | EnrichmentAssetFetchError
      | GeminiApiError
      | GeminiParseError
    >;
  }
>()("@skygest/VisionEnrichmentExecutor") {
  static readonly layer = Layer.effect(
    VisionEnrichmentExecutor,
    Effect.gen(function* () {
      const gemini = yield* GeminiVisionService;

      const fetchAsset = Effect.fn("VisionEnrichmentExecutor.fetchAsset")(
        function* (asset: EnrichmentPlannedAsset) {
          const assetUrl = yield* getAssetFetchUrl(asset);
          const response = yield* Effect.tryPromise({
            try: () => fetch(assetUrl),
            catch: (cause) =>
              EnrichmentAssetFetchError.make({
                assetKey: asset.assetKey,
                message: cause instanceof Error
                  ? cause.message
                  : `failed to fetch asset ${asset.assetKey}`,
                operation: "VisionEnrichmentExecutor.fetchAsset"
              })
          });

          if (!response.ok) {
            return yield* EnrichmentAssetFetchError.make({
              assetKey: asset.assetKey,
              message: `asset fetch failed for ${asset.assetKey}`,
              status: response.status,
              operation: "VisionEnrichmentExecutor.fetchAsset"
            });
          }

          const bytes = new Uint8Array(yield* Effect.tryPromise({
            try: () => response.arrayBuffer(),
            catch: (cause) =>
              EnrichmentAssetFetchError.make({
                assetKey: asset.assetKey,
                message: cause instanceof Error
                  ? cause.message
                  : `failed to read asset ${asset.assetKey}`,
                operation: "VisionEnrichmentExecutor.fetchAsset"
              })
          }));

          if (bytes.byteLength === 0) {
            return yield* EnrichmentAssetFetchError.make({
              assetKey: asset.assetKey,
              message: `asset ${asset.assetKey} returned empty content`,
              operation: "VisionEnrichmentExecutor.fetchAsset"
            });
          }

          return {
            mimeType: normalizeMimeType(
              response.headers.get("content-type"),
              assetUrl
            ),
            bytes
          } as const;
        }
      );

      const analyzeAsset = Effect.fn("VisionEnrichmentExecutor.analyzeAsset")(
        function* (asset: EnrichmentPlannedAsset) {
          const fetched = yield* fetchAsset(asset);
          const uploaded = yield* gemini.uploadImage(
            fetched.bytes,
            fetched.mimeType
          );
          const analysis = yield* gemini.extractChartData(
            uploaded.uri,
            fetched.mimeType
          );

          return yield* Schema.decodeUnknown(VisionAssetEnrichmentSchema)({
            assetKey: asset.assetKey,
            assetType: asset.assetType,
            source: asset.source,
            index: asset.index,
            originalAltText: getOriginalAltText(asset),
            analysis
          }).pipe(
            Effect.mapError((error) =>
              EnrichmentSchemaDecodeError.make({
                message: formatSchemaParseError(error),
                operation: "VisionEnrichmentExecutor.analyzeAsset"
              })
            )
          );
        }
      );

      const execute = Effect.fn("VisionEnrichmentExecutor.execute")(function* (
        input: VisionExecutionPlanValue
      ) {
        const plan = yield* decodeVisionPlan(input);
        const assets = yield* Effect.forEach(plan.assets, analyzeAsset);
        const titles = uniqueValues(
          assets.flatMap((asset) =>
            isNonEmptyString(asset.analysis.title)
              ? [asset.analysis.title]
              : []
          )
        );
        const keyFindings = combineFindings(assets);
        const modelIds = uniqueValues(
          assets.map((asset) => asset.analysis.modelId)
        );
        const modelId =
          modelIds.length === 1 ? modelIds[0]! : "mixed-gemini-models";
        const processedAt = Math.max(
          ...assets.map((asset) => asset.analysis.processedAt)
        );

        return yield* Schema.decodeUnknown(VisionEnrichmentSchema)({
          kind: "vision",
          summary: {
            text: toSummaryText(assets.length, titles, keyFindings),
            mediaTypes: uniqueValues(
              assets.map((asset) => asset.analysis.mediaType)
            ),
            chartTypes: uniqueValues(
              assets.flatMap((asset) => asset.analysis.chartTypes)
            ),
            titles,
            keyFindings
          },
          assets,
          modelId,
          promptVersion: VISION_PROMPT_VERSION,
          processedAt
        }).pipe(
          Effect.mapError((error) =>
            EnrichmentSchemaDecodeError.make({
              message: formatSchemaParseError(error),
              operation: "VisionEnrichmentExecutor.execute"
            })
          )
        );
      });

      return {
        execute
      };
    })
  );
}
