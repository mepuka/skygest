import { Array, Config, ConfigProvider, ServiceMap, Effect, Layer, Redacted, Result } from "effect";
import { CloudflareEnv } from "./Env";

const RawConfigSchema = Config.all({
  publicApi: Config.withDefault(
    Config.string("PUBLIC_BSKY_API"),
    "https://public.api.bsky.app"
  ),
  ingestShardCount: Config.withDefault(Config.int("INGEST_SHARD_COUNT"), 1),
  defaultDomain: Config.withDefault(Config.string("DEFAULT_DOMAIN"), "energy"),
  mcpLimitDefault: Config.withDefault(Config.int("MCP_LIMIT_DEFAULT"), 20),
  mcpLimitMax: Config.withDefault(Config.int("MCP_LIMIT_MAX"), 100),
  operatorSecret: Config.withDefault(
    Config.redacted("OPERATOR_SECRET"),
    Redacted.make("")
  ),
  enableStagingOps: Config.withDefault(Config.boolean("ENABLE_STAGING_OPS"), false),
  editorialDefaultExpiryHours: Config.withDefault(Config.int("EDITORIAL_DEFAULT_EXPIRY_HOURS"), 24),
  curationMinSignalScore: Config.withDefault(Config.int("CURATION_MIN_SIGNAL_SCORE"), 30)
});

export type AppConfigShape = Config.Success<typeof RawConfigSchema>;

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
      const config = yield* RawConfigSchema.parse(provider);

      return config satisfies AppConfigShape;
    })
  );
}
