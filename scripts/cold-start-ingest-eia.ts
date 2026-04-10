/**
 * SKY-254 — EIA DCAT ingestion (Workstream A)
 *
 * Effect-native, schema-validated, idempotent ingestion of the EIA API v2
 * catalog tree into the cold-start registry under references/cold-start/.
 * The script walks api.eia.gov/v2/, builds an IngestGraph of typed nodes
 * (Agent | Catalog | DataService | Dataset | Distribution | CatalogRecord),
 * validates every candidate via Effect.partition, and emits files in
 * topological order so dependencies are written before dependents.
 *
 * See docs/plans/2026-04-10-sky-254-eia-dcat-ingestion.md for the full plan.
 */

import * as BunFileSystem from "@effect/platform-bun/BunFileSystem";
import * as BunPath from "@effect/platform-bun/BunPath";
import * as BunRuntime from "@effect/platform-bun/BunRuntime";
import {
  Cache,
  Clock,
  Config,
  Duration,
  Effect,
  Layer,
  Redacted,
  Schedule,
  Schema,
  Semaphore,
  SynchronizedRef
} from "effect";
import {
  FetchHttpClient,
  HttpClient,
  HttpClientResponse
} from "effect/unstable/http";
import { stringifyUnknown } from "../src/platform/Json";

// ---------------------------------------------------------------------------
// Tagged errors
// ---------------------------------------------------------------------------

export class EiaApiFetchError extends Schema.TaggedErrorClass<EiaApiFetchError>()(
  "EiaApiFetchError",
  {
    route: Schema.String,
    message: Schema.String,
    status: Schema.optionalKey(Schema.Number)
  }
) {}

export class EiaApiDecodeError extends Schema.TaggedErrorClass<EiaApiDecodeError>()(
  "EiaApiDecodeError",
  {
    route: Schema.String,
    message: Schema.String
  }
) {}

export class EiaIngestSchemaError extends Schema.TaggedErrorClass<EiaIngestSchemaError>()(
  "EiaIngestSchemaError",
  {
    kind: Schema.String,
    slug: Schema.String,
    message: Schema.String
  }
) {}

export class EiaIngestFsError extends Schema.TaggedErrorClass<EiaIngestFsError>()(
  "EiaIngestFsError",
  {
    operation: Schema.String,
    path: Schema.String,
    message: Schema.String
  }
) {}

export class EiaIngestLedgerError extends Schema.TaggedErrorClass<EiaIngestLedgerError>()(
  "EiaIngestLedgerError",
  { message: Schema.String }
) {}

// ---------------------------------------------------------------------------
// Script config
// ---------------------------------------------------------------------------

// dryRun / noCache default to false here; onlyRoute defaults to "no scope"
// (Option.none) by being absent. Task 11's CLI flags override these via
// a custom ConfigProvider so main can reference config.dryRun /
// config.noCache / config.onlyRoute uniformly across both env-driven and
// flag-driven invocations.
export const ScriptConfig = Config.all({
  apiKey: Config.redacted("EIA_API_KEY"),
  rootDir: Config.withDefault(
    Config.string("COLD_START_ROOT"),
    "references/cold-start"
  ),
  minIntervalMs: Config.withDefault(Config.int("EIA_MIN_INTERVAL_MS"), 250),
  maxRetries: Config.withDefault(Config.int("EIA_MAX_RETRIES"), 4),
  cacheTtlDays: Config.withDefault(Config.int("EIA_WALK_CACHE_TTL_DAYS"), 30),
  dryRun: Config.withDefault(Config.boolean("EIA_DRY_RUN"), false),
  noCache: Config.withDefault(Config.boolean("EIA_NO_CACHE"), false),
  onlyRoute: Config.option(Config.string("EIA_ONLY_ROUTE"))
});
export type ScriptConfigShape = Config.Success<typeof ScriptConfig>;

// ---------------------------------------------------------------------------
// EIA API v2 response schema
// ---------------------------------------------------------------------------

const EiaRouteRef = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  description: Schema.optionalKey(Schema.String)
});

const EiaFacetDef = Schema.Struct({
  id: Schema.String,
  description: Schema.optionalKey(Schema.String)
});

const EiaFrequencyDef = Schema.Struct({
  id: Schema.String,
  description: Schema.optionalKey(Schema.String),
  format: Schema.optionalKey(Schema.String)
});

export const EiaApiResponse = Schema.Struct({
  response: Schema.Struct({
    id: Schema.String,
    name: Schema.optionalKey(Schema.String),
    description: Schema.optionalKey(Schema.String),
    routes: Schema.optionalKey(Schema.Array(EiaRouteRef)),
    facets: Schema.optionalKey(Schema.Array(EiaFacetDef)),
    frequency: Schema.optionalKey(Schema.Array(EiaFrequencyDef)),
    defaultFrequency: Schema.optionalKey(Schema.String),
    startPeriod: Schema.optionalKey(Schema.String),
    endPeriod: Schema.optionalKey(Schema.String),
    data: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown))
  })
});
export type EiaApiResponse = Schema.Schema.Type<typeof EiaApiResponse>;

// ---------------------------------------------------------------------------
// fetchRoute — single-shot HTTP GET + schema decode
// ---------------------------------------------------------------------------

const EIA_API_BASE = "https://api.eia.gov/v2/";

const getResponseStatus = (cause: unknown): number | undefined => {
  if (typeof cause !== "object" || cause === null) return undefined;
  const maybe = cause as { readonly response?: { readonly status?: unknown } };
  if (
    maybe.response !== undefined &&
    typeof maybe.response.status === "number"
  ) {
    return maybe.response.status;
  }
  return undefined;
};

const isParseError = (cause: unknown): boolean => {
  if (typeof cause !== "object" || cause === null) return false;
  const tag = (cause as { readonly _tag?: unknown })._tag;
  return tag === "ParseError" || tag === "SchemaError";
};

export const fetchRoute = (route: string, apiKey: string) =>
  Effect.gen(function* () {
    const http = yield* HttpClient.HttpClient;
    const trimmed = route.replace(/^\/+|\/+$/gu, "");
    const url = `${EIA_API_BASE}${trimmed}${trimmed.length > 0 ? "/" : ""}`;
    return yield* http
      .get(url, { urlParams: { api_key: apiKey } })
      .pipe(
        Effect.flatMap(HttpClientResponse.filterStatusOk),
        Effect.flatMap(HttpClientResponse.schemaBodyJson(EiaApiResponse)),
        Effect.mapError((cause) =>
          isParseError(cause)
            ? new EiaApiDecodeError({
                route,
                message: stringifyUnknown(cause)
              })
            : new EiaApiFetchError({
                route,
                message: stringifyUnknown(cause),
                ...(getResponseStatus(cause) !== undefined
                  ? { status: getResponseStatus(cause)! }
                  : {})
              })
        )
      );
  });

// ---------------------------------------------------------------------------
// Per-host rate limiter + retry (cloned from BlueskyClient.ts:170-232)
// ---------------------------------------------------------------------------

interface HostGate {
  readonly semaphore: Semaphore.Semaphore;
  readonly lastCompletedAt: SynchronizedRef.SynchronizedRef<number>;
}

const isRetryableEiaError = (
  error: EiaApiFetchError | EiaApiDecodeError
): boolean => {
  if (error._tag !== "EiaApiFetchError") return false;
  // Retry on transport failures (no status) and on 429 / 5xx.
  if (error.status === undefined) return true;
  return error.status === 429 || (error.status >= 500 && error.status < 600);
};

export const makeRateLimitedFetcher = (
  minIntervalMs: number,
  maxRetries: number
) =>
  Effect.gen(function* () {
    const hostGates = yield* Cache.make({
      capacity: 8,
      timeToLive: Duration.infinity,
      lookup: (_host: string) =>
        Effect.all([
          Semaphore.make(1),
          SynchronizedRef.make(-minIntervalMs)
        ]).pipe(
          Effect.map(
            ([semaphore, lastCompletedAt]) =>
              ({
                semaphore,
                lastCompletedAt
              }) satisfies HostGate
          )
        )
    });

    const retrySchedule = Schedule.exponential(Duration.millis(500)).pipe(
      Schedule.jittered,
      Schedule.both(Schedule.recurs(maxRetries))
    );

    return (route: string, apiKey: string) =>
      Effect.gen(function* () {
        const gate = yield* Cache.get(hostGates, "api.eia.gov");
        return yield* gate.semaphore
          .withPermits(1)(
            Effect.gen(function* () {
              const now = yield* Clock.currentTimeMillis;
              const last = yield* SynchronizedRef.get(gate.lastCompletedAt);
              const waitMs = Math.max(0, minIntervalMs - (now - last));
              if (waitMs > 0) {
                yield* Effect.sleep(Duration.millis(waitMs));
              }
              return yield* fetchRoute(route, apiKey);
            }).pipe(
              Effect.ensuring(
                Clock.currentTimeMillis.pipe(
                  Effect.flatMap((t) =>
                    SynchronizedRef.set(gate.lastCompletedAt, t)
                  )
                )
              )
            )
          )
          .pipe(
            Effect.retry({
              schedule: retrySchedule,
              while: isRetryableEiaError
            })
          );
      });
  });

// ---------------------------------------------------------------------------
// Stub main
// ---------------------------------------------------------------------------

const main = Effect.gen(function* () {
  const config = yield* ScriptConfig;
  const apiKey = Redacted.value(config.apiKey);
  yield* Effect.log(
    `SKY-254 EIA ingest stub — root=${config.rootDir} dryRun=${String(config.dryRun)}`
  );

  const fetcher = yield* makeRateLimitedFetcher(
    config.minIntervalMs,
    config.maxRetries
  );
  const root = yield* fetcher("", apiKey);
  yield* Effect.log(
    `Root route returned ${String(root.response.routes?.length ?? 0)} child routes`
  );
});

// Gate the runtime entry so test imports don't trigger `main` (which would
// fail with a missing-EIA_API_KEY ConfigError). Bun sets `import.meta.main`
// to true only when this file is the entry point.
if (import.meta.main) {
  main.pipe(
    Effect.provide(
      Layer.mergeAll(
        BunFileSystem.layer,
        BunPath.layer,
        FetchHttpClient.layer
      )
    ),
    Effect.tapError((error) => Effect.logError(stringifyUnknown(error))),
    BunRuntime.runMain
  );
}
