/**
 * Shared config key declarations — no Cloudflare Worker type dependencies.
 * Importable by skygest-editorial via @skygest/platform/ConfigShapes.
 *
 * Keys are exported as plain records of individual Config<T> values,
 * NOT wrapped in Config.all. This lets the validator resolve each key
 * independently for all-at-once error reporting.
 */
import { Config, ConfigProvider, Effect, Option, Redacted } from "effect";

// ── Helpers ────────────────────────────────────────────────────────────

/** Redacted config that rejects empty/whitespace-only values. */
export const nonEmptyRedacted = (name: string) =>
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
  enableDataRefResolution: Config.withDefault(
    Config.boolean("ENABLE_DATA_REF_RESOLUTION"),
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

// ── Worker deployment validation keys ───────────────────────────────────
// WorkerKeys.operatorSecret defaults to "" for backward compat in local
// dev and AppConfig.layer. For deployment validation (/health), use this
// stricter set that requires a non-empty OPERATOR_SECRET.

export const WorkerDeployKeys = {
  ...WorkerKeys,
  operatorSecret: nonEmptyRedacted("OPERATOR_SECRET")
} as const;

const booleanWithLegacyFallback = (
  preferredName: string,
  legacyName: string,
  defaultValue = false
) =>
  Config.all({
    preferred: Config.option(Config.boolean(preferredName)),
    legacy: Config.option(Config.boolean(legacyName))
  }).pipe(
    Config.map(({ preferred, legacy }) =>
      Option.isSome(preferred)
        ? preferred.value
        : Option.isSome(legacy)
          ? legacy.value
          : defaultValue
    )
  );

const optionalTrimmedString = (name: string) =>
  Config.option(Config.string(name)).pipe(
    Config.map((value) =>
      Option.flatMap(value, (raw) => {
        const trimmed = raw.trim();
        return trimmed.length === 0 ? Option.none() : Option.some(trimmed);
      })
    )
  );

export const ColdStartCommonKeys = {
  rootDir: Config.withDefault(
    Config.string("COLD_START_ROOT"),
    "references/cold-start"
  ),
  dryRun: Config.withDefault(Config.boolean("COLD_START_DRY_RUN"), false),
  noCache: Config.withDefault(Config.boolean("COLD_START_NO_CACHE"), false)
} as const;

export const EiaIngestKeys = {
  ...ColdStartCommonKeys,
  apiKey: nonEmptyRedacted("EIA_API_KEY"),
  minIntervalMs: Config.withDefault(Config.int("EIA_MIN_INTERVAL_MS"), 250),
  maxRetries: Config.withDefault(Config.int("EIA_MAX_RETRIES"), 4),
  cacheTtlDays: Config.withDefault(Config.int("EIA_WALK_CACHE_TTL_DAYS"), 30),
  // Keep the older EIA-specific flags working while new scripts converge on
  // the shared COLD_START_* names.
  dryRun: booleanWithLegacyFallback("COLD_START_DRY_RUN", "EIA_DRY_RUN"),
  noCache: booleanWithLegacyFallback("COLD_START_NO_CACHE", "EIA_NO_CACHE"),
  onlyRoute: optionalTrimmedString("EIA_ONLY_ROUTE")
} as const;

export const EnergyChartsIngestKeys = {
  ...ColdStartCommonKeys,
  openApiUrl: Config.withDefault(
    Config.string("ENERGY_CHARTS_OPENAPI_URL"),
    "https://api.energy-charts.info/openapi.json"
  )
} as const;

export const EmberIngestKeys = {
  ...ColdStartCommonKeys,
  apiKey: nonEmptyRedacted("EMBER_ENERGY_API_KEY"),
  openApiUrl: Config.withDefault(
    Config.string("EMBER_OPENAPI_URL"),
    "https://api.ember-energy.org/v1/openapi.json"
  ),
  minIntervalMs: Config.withDefault(Config.int("EMBER_MIN_INTERVAL_MS"), 1000)
} as const;

export const GridStatusIngestKeys = {
  ...ColdStartCommonKeys,
  apiKey: nonEmptyRedacted("GRIDSTATUS_API_KEY"),
  baseUrl: Config.withDefault(
    Config.string("GRIDSTATUS_BASE_URL"),
    "https://api.gridstatus.io/v1"
  ),
  minIntervalMs: Config.withDefault(
    Config.int("GRIDSTATUS_MIN_INTERVAL_MS"),
    200
  )
} as const;

export const EntsoeIngestKeys = {
  ...ColdStartCommonKeys
} as const;

export const OdreIngestKeys = {
  ...ColdStartCommonKeys,
  baseUrl: Config.withDefault(
    Config.string("ODRE_BASE_URL"),
    "https://odre.opendatasoft.com/api/explore/v2.1"
  ),
  minIntervalMs: Config.withDefault(Config.int("ODRE_MIN_INTERVAL_MS"), 500)
} as const;

// ── Twitter / editorial ingestion keys ────────────────────────────────

/** Non-empty string config that rejects empty/whitespace-only values. */
export const nonEmptyString = (name: string) =>
  Config.string(name).pipe(
    Config.mapOrFail((value) =>
      value.trim().length > 0
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

export const TwitterKeys = {
  twitterCookiePath: nonEmptyString("TWITTER_COOKIE_PATH")
} as const;

// ── Enrichment keys ────────────────────────────────────────────────────

export const EnrichmentKeys = {
  googleApiKey: Config.redacted("GOOGLE_API_KEY"),
  visionModel: Config.withDefault(
    Config.string("GEMINI_VISION_MODEL"),
    "gemini-2.5-flash"
  )
} as const;

// ── D1 snapshot cache (script-side) ────────────────────────────────────
// Consumed by src/platform/D1SnapshotLayer.ts. Scripts run `wrangler d1
// export --remote` + `sqlite3 .read` and cache the resulting sqlite file
// under `cacheDir`. `dbName` is NOT in config — scripts pass the wrangler
// database name directly (staging vs. production vs. sandbox).

export const D1SnapshotKeys = {
  cacheDir: Config.withDefault(
    Config.string("D1_SNAPSHOT_CACHE_DIR"),
    ".cache/d1"
  ),
  maxAgeHours: Config.withDefault(
    Config.int("D1_SNAPSHOT_MAX_AGE_HOURS"),
    24
  )
} as const;
