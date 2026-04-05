/**
 * Shared config key declarations — no Cloudflare Worker type dependencies.
 * Importable by skygest-editorial via @skygest/platform/ConfigShapes.
 *
 * Keys are exported as plain records of individual Config<T> values,
 * NOT wrapped in Config.all. This lets the validator resolve each key
 * independently for all-at-once error reporting.
 */
import { Config, ConfigProvider, Effect, Redacted } from "effect";

// ── Helpers ────────────────────────────────────────────────────────────

/** Redacted config that rejects empty/whitespace-only values. */
const nonEmptyRedacted = (name: string) =>
  Config.redacted(name).pipe(
    Config.mapOrFail((value) =>
      Redacted.value(value).trim().length > 0
        ? Effect.succeed(value)
        : Effect.fail(
            new Config.ConfigError(
              new ConfigProvider.SourceError({
                message: `${name} must not be empty`
              })
            )
          )
    )
  );

// ── Operator / Editorial keys ──────────────────────────────────────────

export const OperatorKeys = {
  operatorSecret: nonEmptyRedacted("SKYGEST_OPERATOR_SECRET"),
  baseUrl: Config.url("SKYGEST_STAGING_BASE_URL")
} as const;

// ── Worker runtime keys ────────────────────────────────────────────────

export const WorkerKeys = {
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
  enableStagingOps: Config.withDefault(
    Config.boolean("ENABLE_STAGING_OPS"),
    false
  ),
  editorialDefaultExpiryHours: Config.withDefault(
    Config.int("EDITORIAL_DEFAULT_EXPIRY_HOURS"),
    24
  ),
  curationMinSignalScore: Config.withDefault(
    Config.int("CURATION_MIN_SIGNAL_SCORE"),
    30
  )
} as const;

// ── Enrichment keys ────────────────────────────────────────────────────

export const EnrichmentKeys = {
  googleApiKey: Config.redacted("GOOGLE_API_KEY"),
  visionModel: Config.withDefault(
    Config.string("GEMINI_VISION_MODEL"),
    "gemini-2.5-flash"
  )
} as const;
