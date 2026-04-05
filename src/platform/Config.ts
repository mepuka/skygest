import { Array, Config, ConfigProvider, ServiceMap, Effect, Layer, Result } from "effect";
import { CloudflareEnv } from "./Env";
import { WorkerKeys, EnrichmentKeys } from "./ConfigShapes";
import { validateKeys } from "./ConfigValidation";

const WorkerConfig = Config.all(WorkerKeys);

export type AppConfigShape = Config.Success<typeof WorkerConfig>;

export class AppConfig extends ServiceMap.Service<
  AppConfig,
  AppConfigShape
>()("@skygest/AppConfig") {
  static layer = Layer.effect(
    AppConfig,
    Effect.gen(function* () {
      const env = yield* CloudflareEnv;
      const entries = Array.filterMap(
        [
          ["PUBLIC_BSKY_API", env.PUBLIC_BSKY_API],
          ["INGEST_SHARD_COUNT", env.INGEST_SHARD_COUNT],
          ["DEFAULT_DOMAIN", env.DEFAULT_DOMAIN],
          ["MCP_LIMIT_DEFAULT", env.MCP_LIMIT_DEFAULT],
          ["MCP_LIMIT_MAX", env.MCP_LIMIT_MAX],
          ["OPERATOR_SECRET", env.OPERATOR_SECRET],
          ["ENABLE_STAGING_OPS", env.ENABLE_STAGING_OPS],
          ["EDITORIAL_DEFAULT_EXPIRY_HOURS", env.EDITORIAL_DEFAULT_EXPIRY_HOURS],
          ["CURATION_MIN_SIGNAL_SCORE", env.CURATION_MIN_SIGNAL_SCORE]
        ] as const,
        ([key, value]) =>
          value == null
            ? Result.failVoid
            : Result.succeed([key, String(value)] as const)
      );
      const provider = ConfigProvider.fromUnknown(Object.fromEntries(entries));
      const config = yield* WorkerConfig.parse(provider);

      return config satisfies AppConfigShape;
    })
  );

  /** Validate all worker + enrichment config keys at once.
   *  Use at startup or /health endpoints for diagnostic output. */
  static validate = (provider: ConfigProvider.ConfigProvider) =>
    validateKeys({ ...WorkerKeys, ...EnrichmentKeys }, provider);
}
