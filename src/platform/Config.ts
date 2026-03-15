import { Array, Config, ConfigProvider, Context, Effect, Layer, Option } from "effect";
import { CloudflareEnv } from "./Env";

export type OperatorAuthMode = "access" | "shared-secret";

const parseOperatorAuthMode = (value: string): OperatorAuthMode => {
  if (value === "access" || value === "shared-secret") {
    return value;
  }

  throw new Error(
    `OPERATOR_AUTH_MODE must be "access" or "shared-secret", received: ${value}`
  );
};

const RawConfigSchema = Config.all({
  publicApi: Config.withDefault(
    Config.string("PUBLIC_BSKY_API"),
    "https://public.api.bsky.app"
  ),
  ingestShardCount: Config.withDefault(Config.integer("INGEST_SHARD_COUNT"), 1),
  defaultDomain: Config.withDefault(Config.string("DEFAULT_DOMAIN"), "energy"),
  mcpLimitDefault: Config.withDefault(Config.integer("MCP_LIMIT_DEFAULT"), 20),
  mcpLimitMax: Config.withDefault(Config.integer("MCP_LIMIT_MAX"), 100),
  operatorAuthMode: Config.withDefault(Config.string("OPERATOR_AUTH_MODE"), "access"),
  operatorSecret: Config.withDefault(Config.string("OPERATOR_SECRET"), ""),
  accessTeamDomain: Config.withDefault(
    Config.string("ACCESS_TEAM_DOMAIN"),
    ""
  ),
  accessAud: Config.withDefault(Config.string("ACCESS_AUD"), ""),
  editorialDefaultExpiryHours: Config.withDefault(Config.integer("EDITORIAL_DEFAULT_EXPIRY_HOURS"), 24)
});

type RawAppConfigShape = Config.Config.Success<typeof RawConfigSchema>;

export type AppConfigShape = Omit<RawAppConfigShape, "operatorAuthMode"> & {
  readonly operatorAuthMode: OperatorAuthMode;
};

export class AppConfig extends Context.Tag("@skygest/AppConfig")<
  AppConfig,
  AppConfigShape
>() {
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
          ["OPERATOR_AUTH_MODE", env.OPERATOR_AUTH_MODE],
          ["OPERATOR_SECRET", env.OPERATOR_SECRET],
          ["ACCESS_TEAM_DOMAIN", env.ACCESS_TEAM_DOMAIN],
          ["ACCESS_AUD", env.ACCESS_AUD],
          ["EDITORIAL_DEFAULT_EXPIRY_HOURS", env.EDITORIAL_DEFAULT_EXPIRY_HOURS]
        ] as const,
        ([key, value]) =>
          value == null
            ? Option.none()
            : Option.some([key, String(value)] as const)
      );
      const provider = ConfigProvider.fromMap(new Map(entries));
      const config = yield* provider.load(RawConfigSchema);

      return {
        ...config,
        operatorAuthMode: parseOperatorAuthMode(config.operatorAuthMode)
      } satisfies AppConfigShape;
    })
  );
}
