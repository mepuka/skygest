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
import { Config, Effect, Layer, Redacted, Schema } from "effect";
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
// Stub main
// ---------------------------------------------------------------------------

const main = Effect.gen(function* () {
  const config = yield* ScriptConfig;
  // Touch apiKey via Redacted.value so we get a useful "missing key" error
  // immediately rather than later inside the rate-limited fetcher.
  const _apiKey = Redacted.value(config.apiKey);
  yield* Effect.log(
    `SKY-254 EIA ingest stub — root=${config.rootDir} dryRun=${String(config.dryRun)}`
  );
});

main.pipe(
  Effect.provide(Layer.mergeAll(BunFileSystem.layer, BunPath.layer)),
  Effect.tapError((error) => Effect.logError(stringifyUnknown(error))),
  BunRuntime.runMain
);
