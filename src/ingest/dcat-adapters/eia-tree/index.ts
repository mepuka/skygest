/**
 * SKY-254 — EIA DCAT ingestion (Workstream A)
 *
 * Effect-native, schema-validated, idempotent ingestion of the EIA API v2
 * catalog tree into the cold-start registry under references/cold-start/.
 * The script walks api.eia.gov/v2/, builds an IngestGraph of typed nodes
 * (Agent | Catalog | DataService | DatasetSeries | Dataset | Distribution | CatalogRecord),
 * validates every candidate via Effect.partition, and emits files in
 * topological order so dependencies are written before dependents.
 *
 * See docs/plans/2026-04-10-sky-254-eia-dcat-ingestion.md for the full plan.
 */

import {
  Cache,
  Clock,
  Config,
  DateTime,
  Duration,
  Effect,
  Exit,
  FileSystem,
  Graph,
  MutableHashMap,
  MutableRef,
  Option,
  Path,
  Redacted,
  Result,
  Schedule,
  Schema,
  Semaphore,
  SynchronizedRef
} from "effect";
import {
  HttpClient,
  HttpClientResponse
} from "effect/unstable/http";
import {
  Persistable,
  Persistence
} from "effect/unstable/persistence";
import {
  Agent,
  AliasSchemeValues,
  Catalog,
  CatalogRecord,
  DataService,
  Dataset,
  DatasetSeries,
  Distribution,
  mintCatalogRecordId,
  mintDatasetId,
  mintDatasetSeriesId,
  mintDistributionId,
  type ExternalIdentifier
} from "../../../domain/data-layer";
import {
  buildIngestGraphs,
  buildIngestGraph,
  assertNodeOwnsWriteTargetWith,
  type CatalogIndex as HarnessCatalogIndex,
  encodeNodeData as encodeHarnessNodeData,
  entityFilePathForNode as entityFilePathForHarnessNode,
  EntityIdLedger,
  IngestFsError,
  IngestHarnessError,
  IngestLedgerError,
  IngestSchemaError,
  ledgerKeyForNode as harnessLedgerKeyForNode,
  loadLedgerWith,
  loadCatalogIndexWith,
  runDcatIngest,
  saveLedgerWith,
  stableSlug,
  unionAliases,
  validateCandidatesWith,
  validateNodeWith,
  writeEntityFileWith,
  type IngestEdge,
  type IngestGraph,
  type IngestNode
} from "../../dcat-harness";
import {
  decodeJsonStringWith,
  encodeJsonStringPrettyWith,
  formatSchemaParseError,
  stripUndefinedAndDecodeWith,
  stringifyUnknown
} from "../../../platform/Json";
import { EiaIngestKeys } from "../../../platform/ConfigShapes";
import { localPersistenceLayer } from "../../../platform/LocalPersistence";
import { Logging } from "../../../platform/Logging";
import { getResponseStatus, isDecodeError } from "../../../platform/HttpErrors";
import {
  runScriptMain,
  scriptPlatformLayer
} from "../../../platform/ScriptRuntime";

export { buildIngestGraph, buildIngestGraphs, stableSlug, unionAliases, EntityIdLedger };
export type { IngestEdge, IngestGraph, IngestNode };

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

// Shared cold-start flags use COLD_START_* names. EIA_DRY_RUN and
// EIA_NO_CACHE still work as legacy fallbacks while the cluster scripts
// converge on the common convention.
export const ScriptConfig = Config.all(EiaIngestKeys);
export type ScriptConfigShape = Config.Success<typeof ScriptConfig>;

// ---------------------------------------------------------------------------
// EIA API v2 response schema
// ---------------------------------------------------------------------------

// EIA returns `null` (not an absent field) for missing strings, so optional
// string fields must accept `string | null | undefined`. Schema.NullOr +
// optionalKey gives us that shape; downstream code treats null and undefined
// equivalently via Option-style guards.
const NullableString = Schema.optionalKey(Schema.NullOr(Schema.String));

const EiaRouteRef = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  description: NullableString
});

const EiaFacetDef = Schema.Struct({
  id: Schema.String,
  description: NullableString
});

const EiaFrequencyDef = Schema.Struct({
  id: Schema.String,
  description: NullableString,
  format: NullableString
});

export const EiaApiResponse = Schema.Struct({
  response: Schema.Struct({
    id: Schema.String,
    name: NullableString,
    description: NullableString,
    routes: Schema.optionalKey(Schema.Array(EiaRouteRef)),
    facets: Schema.optionalKey(Schema.Array(EiaFacetDef)),
    frequency: Schema.optionalKey(Schema.Array(EiaFrequencyDef)),
    defaultFrequency: NullableString,
    startPeriod: NullableString,
    endPeriod: NullableString,
    data: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown))
  })
});
export type EiaApiResponse = Schema.Schema.Type<typeof EiaApiResponse>;

// ---------------------------------------------------------------------------
// fetchRoute — single-shot HTTP GET + schema decode
// ---------------------------------------------------------------------------

const EIA_API_BASE = "https://api.eia.gov/v2/";

export const fetchRoute = Effect.fn("EiaIngest.fetchRoute")(function* (
  route: string,
  apiKey: string
) {
    const http = yield* HttpClient.HttpClient;
    const trimmed = route.replace(/^\/+|\/+$/gu, "");
    const url = `${EIA_API_BASE}${trimmed}${trimmed.length > 0 ? "/" : ""}`;
    return yield* http
      .get(url, { urlParams: { api_key: apiKey } })
      .pipe(
        Effect.flatMap(HttpClientResponse.filterStatusOk),
        Effect.flatMap(HttpClientResponse.schemaBodyJson(EiaApiResponse)),
        Effect.mapError((cause) =>
          isDecodeError(cause)
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

export const makeRateLimitedFetcher = Effect.fn("EiaIngest.makeRateLimitedFetcher")(function* (
  minIntervalMs: number,
  maxRetries: number
) {
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

    return (route: string, apiKey: string) => {
      let attempt = 0;
      let retryStatus: number | undefined = undefined;

      const retrySchedule = Schedule.exponential(Duration.millis(500)).pipe(
        Schedule.jittered,
        Schedule.both(Schedule.recurs(maxRetries)),
        Schedule.tapInput((error: EiaApiFetchError | EiaApiDecodeError) =>
          Effect.sync(() => {
            retryStatus =
              error._tag === "EiaApiFetchError" ? error.status : undefined;
          })
        ),
        Schedule.tapOutput(([delay]) =>
          Logging.logWarning("eia route fetch retried", {
            route,
            attempt: attempt + 1,
            waitMs: Duration.toMillis(delay),
            ...statusAnnotations(retryStatus)
          })
        )
      );

      return Effect.gen(function* () {
        const gate = yield* Cache.get(hostGates, "api.eia.gov");
        attempt += 1;
        const startedAt = yield* Clock.currentTimeMillis;
        yield* Logging.logSummary("eia route fetch attempted", {
          route,
          attempt,
          cacheState: "network"
        });

        const response = yield* gate.semaphore
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
          );

        const completedAt = yield* Clock.currentTimeMillis;
        yield* Logging.logSummary("eia route fetch succeeded", {
          route,
          attempt,
          status: 200,
          durationMs: completedAt - startedAt,
          subRouteCount: response.response.routes?.length ?? 0,
          facetCount: response.response.facets?.length ?? 0
        });

        return response;
      }).pipe(
        Effect.retry({
          schedule: retrySchedule,
          while: isRetryableEiaError
        }),
        Effect.tapError((error) =>
          Logging.logFailure("eia route fetch failed", error, {
            route,
            attempt,
            ...statusAnnotations(
              error._tag === "EiaApiFetchError" ? error.status : undefined
            )
          })
        )
      );
    };
  });

// ---------------------------------------------------------------------------
// Walk cache schema + lazy whileLoop walk
// ---------------------------------------------------------------------------

const WalkCache = Schema.Struct({
  fetchedAt: Schema.String,
  routes: Schema.Record(Schema.String, EiaApiResponse)
});
type WalkCache = Schema.Schema.Type<typeof WalkCache>;

const encodeWalkCache = encodeJsonStringPrettyWith(WalkCache);
const walkArtifactRelativePath = "reports/harvest/eia-api-v2-walk.json";
const hiddenWalkCacheStoreId = "eia-api-v2-walk";

const routeCount = (snapshot: WalkCache): number =>
  Object.keys(snapshot.routes).length;

const statusAnnotations = (status: number | undefined) =>
  status === undefined ? {} : { status };

class EiaFullWalkCacheRequest extends Persistable.Class()(
  "EiaFullWalkCacheRequest",
  {
    primaryKey: () => "full-root",
    success: WalkCache
  }
) {}

const fullWalkCacheRequest = new EiaFullWalkCacheRequest();

/**
 * Lazy walk of the EIA API v2 route tree. Uses Effect.whileLoop over a
 * MutableRef-backed queue so the body stays Effect-typed (no `for ... of`,
 * no raw `while`). The `fetch` parameter is parameterized so tests can
 * stub it without spinning up the full rate-limited fetcher.
 *
 * Returns a MutableHashMap<route, EiaApiResponse>; iterating it inside an
 * Effect.sync block produces a snapshot suitable for caching to disk.
 */
export const walkRoutes = Effect.fn("EiaIngest.walkRoutes")(
  function* <R>(
    fetch: (
      route: string
    ) => Effect.Effect<EiaApiResponse, EiaApiFetchError | EiaApiDecodeError, R>,
    startRoute = ""
  ) {
    const queue = MutableRef.make<ReadonlyArray<string>>([startRoute]);
    const seen = MutableHashMap.empty<string, true>();
    const results = MutableHashMap.empty<string, EiaApiResponse>();

    yield* Effect.whileLoop({
      while: () => MutableRef.get(queue).length > 0,
      body: () =>
        Effect.gen(function* () {
          const current = MutableRef.get(queue);
          const next = current[0]!;
          MutableRef.set(queue, current.slice(1));

          if (MutableHashMap.has(seen, next)) return;
          MutableHashMap.set(seen, next, true);

          const resp = yield* fetch(next);
          MutableHashMap.set(results, next, resp);

          const childRoutes = resp.response.routes ?? [];
          const childPaths = childRoutes.map((c) =>
            next === "" ? c.id : `${next}/${c.id}`
          );
          if (childPaths.length > 0) {
            MutableRef.set(queue, [...MutableRef.get(queue), ...childPaths]);
          }
        }),
      step: () => {}
    });

    return results;
  }
);

const snapshotToWalkData = (snapshot: WalkCache): Map<string, EiaApiResponse> =>
  new Map(Object.entries(snapshot.routes));

const logWalkedSnapshot = (snapshot: WalkCache, fromCache: boolean) =>
  Logging.logSummary("eia walk loaded", {
    routeCount: routeCount(snapshot),
    fromCache
  });

const warnHiddenWalkCacheIssue = (message: string, cause: unknown) =>
  Logging.logWarning("eia walk cache issue", {
    issue: message,
    message: stringifyUnknown(cause)
  });

const buildWalkSnapshot = Effect.fn("EiaIngest.buildWalkSnapshot")(
  function* <R>(
    fetch: (
      route: string
    ) => Effect.Effect<EiaApiResponse, EiaApiFetchError | EiaApiDecodeError, R>,
    startRoute = ""
  ) {
    const results = yield* walkRoutes(fetch, startRoute);
    const fetchedAt = DateTime.formatIso(yield* DateTime.now);

    const routes = yield* Effect.sync(() => {
      const out: Record<string, EiaApiResponse> = {};
      for (const [route, response] of results) {
        out[route] = response;
      }
      return out;
    });

    return {
      fetchedAt,
      routes
    } satisfies WalkCache;
  }
);

const writeWalkSnapshotArtifact = (rootDir: string, snapshot: WalkCache) =>
  Effect.gen(function* () {
    const path_ = yield* Path.Path;
    const cachePath = path_.resolve(rootDir, walkArtifactRelativePath);
    yield* writeEntityFile(cachePath, `${encodeWalkCache(snapshot)}\n`);
  });

const clearHiddenWalkCacheBestEffort = (
  store: Persistence.PersistenceStore
) =>
  Effect.gen(function* () {
    const exit = yield* Effect.exit(store.remove(fullWalkCacheRequest));
    if (Exit.isFailure(exit)) {
      yield* warnHiddenWalkCacheIssue(
        "Unable to clear hidden EIA walk cache entry",
        exit.cause
      );
    }
  });

const writeHiddenWalkCacheBestEffort = (
  store: Persistence.PersistenceStore,
  snapshot: WalkCache
) =>
  Effect.gen(function* () {
    const exit = yield* Effect.exit(
      store.set(fullWalkCacheRequest, Exit.succeed(snapshot))
    );
    if (Exit.isFailure(exit)) {
      yield* warnHiddenWalkCacheIssue(
        "Unable to write hidden EIA walk cache",
        exit.cause
      );
    }
  });

type WalkDataConfig = Pick<
  ScriptConfigShape,
  "cacheTtlDays" | "noCache" | "onlyRoute" | "rootDir"
>;

interface GetWalkDataWithOptions<R> {
  readonly fetch: (
    route: string
  ) => Effect.Effect<EiaApiResponse, EiaApiFetchError | EiaApiDecodeError, R>;
}

const runFreshWalk = Effect.fn("EiaIngest.runFreshWalk")(
  function* <R>(
    config: WalkDataConfig,
    options: GetWalkDataWithOptions<R>,
    behavior: {
      readonly writeArtifact: boolean;
      readonly hiddenStore?: Persistence.PersistenceStore;
    }
  ) {
    const startRoute = Option.getOrElse(config.onlyRoute, () => "");
    const snapshot = yield* buildWalkSnapshot(options.fetch, startRoute);

    if (behavior.hiddenStore !== undefined) {
      yield* writeHiddenWalkCacheBestEffort(behavior.hiddenStore, snapshot);
    }
    if (behavior.writeArtifact) {
      yield* writeWalkSnapshotArtifact(config.rootDir, snapshot);
    }

    yield* logWalkedSnapshot(snapshot, false);
    return snapshotToWalkData(snapshot);
  }
);

/**
 * Cache-aware test seam for walk loading. Full-root runs use provided
 * Persistence as the hidden cache source of truth. `--no-cache` and scoped
 * walks bypass hidden cache reads/writes. The readable JSON artifact is
 * always refreshed for full-root runs, even when `--no-cache` is set.
 */
export const getWalkDataWith = Effect.fn("EiaIngest.getWalkDataWith")(
  function* <R>(
    config: WalkDataConfig,
    options: GetWalkDataWithOptions<R>
  ) {
    const startRoute = Option.getOrElse(config.onlyRoute, () => "");
    const scoped = startRoute !== "";

    if (config.noCache) {
      yield* Logging.logSummary("eia walk cache bypassed", {
        reason: "noCache",
        scoped
      });
      if (scoped) {
        return yield* runFreshWalk(config, options, {
          writeArtifact: false
        });
      }

      return yield* Effect.scoped(
        Effect.gen(function* () {
          const persistence = yield* Persistence.Persistence;
          const store = yield* persistence.make({
            storeId: hiddenWalkCacheStoreId,
            timeToLive: () => Duration.days(config.cacheTtlDays)
          });

          yield* clearHiddenWalkCacheBestEffort(store);
          return yield* runFreshWalk(config, options, {
            writeArtifact: true,
            hiddenStore: store
          });
        })
      );
    }

    if (scoped) {
      yield* Logging.logSummary("eia walk cache bypassed", {
        reason: "scopedRoute",
        route: startRoute
      });
      return yield* runFreshWalk(config, options, {
        writeArtifact: false
      });
    }

    return yield* Effect.scoped(
      Effect.gen(function* () {
        const persistence = yield* Persistence.Persistence;
        const store = yield* persistence.make({
          storeId: hiddenWalkCacheStoreId,
          timeToLive: () => Duration.days(config.cacheTtlDays)
        });

        const cachedExit = yield* Effect.exit(store.get(fullWalkCacheRequest));
        const cached =
          Exit.isFailure(cachedExit)
            ? yield* warnHiddenWalkCacheIssue(
                "Hidden EIA walk cache is unreadable; refetching",
                cachedExit.cause
              ).pipe(
                Effect.flatMap(() => clearHiddenWalkCacheBestEffort(store)),
                Effect.as(undefined)
              )
            : cachedExit.value;

        if (cached !== undefined) {
          if (Exit.isSuccess(cached)) {
            yield* writeWalkSnapshotArtifact(config.rootDir, cached.value);
            yield* logWalkedSnapshot(cached.value, true);
            return snapshotToWalkData(cached.value);
          }

          yield* Logging.logWarning("eia walk cache issue", {
            issue: "invalidFailureEntry"
          });
          yield* clearHiddenWalkCacheBestEffort(store);
        }

        return yield* runFreshWalk(config, options, {
          writeArtifact: true,
          hiddenStore: store
        });
      })
    );
  }
);

export const getWalkData = Effect.fn("EiaIngest.getWalkData")(
  function* (config: ScriptConfigShape, apiKey: string) {
    const fetcher = yield* makeRateLimitedFetcher(
      config.minIntervalMs,
      config.maxRetries
    );
    const effect = getWalkDataWith(config, {
      fetch: (route) => fetcher(route, apiKey)
    });

    if (Option.isSome(config.onlyRoute)) {
      return yield* effect.pipe(Effect.provide(Persistence.layerMemory));
    }

    const path_ = yield* Path.Path;
    const hiddenCacheDirectory = path_.resolve(
      import.meta.dirname,
      "..",
      ".cache",
      hiddenWalkCacheStoreId
    );

    return yield* effect.pipe(
      Effect.provide(localPersistenceLayer(hiddenCacheDirectory)),
      Effect.catchTag("PlatformError", (error) =>
        warnHiddenWalkCacheIssue(
          "Local EIA walk cache is unavailable; continuing without hidden cache",
          error
        ).pipe(
          Effect.flatMap(() =>
            effect.pipe(Effect.provide(Persistence.layerMemory))
          )
        )
      )
    );
  }
);

// ---------------------------------------------------------------------------
// IngestGraph — typed Graph.DirectedGraph<IngestNode, IngestEdge>
// ---------------------------------------------------------------------------
//
// Edge-direction rule (Effect's Graph.topo is Kahn's algorithm; verified at
// .reference/effect/packages/effect/src/Graph.ts:3878-3917): edges encode
// dependencies — `A → B` means *A must be emitted before B*. For our
// pipeline:
//
//   agent → catalog          (Catalog.publisherAgentId → Agent.id)
//   agent → dataset          (Dataset.publisherAgentId → Agent.id)
//   agent → data-service     (DataService.publisherAgentId → Agent.id)
//   catalog → catalog-record (CatalogRecord.catalogId → Catalog.id)
//   dataset → distribution   (Distribution.datasetId → Dataset.id)
//   dataset → catalog-record (CatalogRecord.primaryTopicId → Dataset.id)
//   dataset → data-service   (DataService.servesDatasetIds[] → Dataset.id)
//
// Topological emission: Agent → {Catalog, Dataset} → {Distribution,
// CatalogRecord, DataService}.

// ---------------------------------------------------------------------------
// Existing-entity catalog index (Task 6)
// ---------------------------------------------------------------------------
//
// Walks `<rootDir>/catalog/{datasets,distributions,catalog-records,
// data-services,catalogs,agents}/` once at ingest start, decodes each JSON
// file through the matching domain Schema, and builds lookup maps keyed
// by alias scheme (not internal ID) so Task 7's candidate builders can
// merge against existing entries deterministically.
//
// Merge keys:
//   Dataset            → eia-route alias with a "/" in the value. Legacy
//                        bulk-manifest codes live on eia-bulk-id and are
//                        intentionally invisible to this index (Task 0.5
//                        migrated them off eia-route).
//   Distribution       → `${dist.datasetId}::${dist.kind}` (the script
//                        always writes one api-access + one landing-page
//                        per dataset, so this compound key is total).
//   CatalogRecord      → `${cr.catalogId}::${cr.primaryTopicId}`. Multiple
//                        catalogs (EIA, Data.gov) can publish CRs for the
//                        same dataset; only CRs from the EIA catalog are
//                        ever merged downstream. Compound key ensures the
//                        Data.gov duplicate CR is read-only.
//   Agent (general)    → name (lookup table for any agent that needs it).
//   Agent (EIA)        → URL-alias lookup (`{scheme: "url", value:
//                        EIA_AGENT_HOMEPAGE}`) with a `homepage`-field
//                        fallback. The dedicated `catalog`/`dataService`
//                        fields are filtered by this resolved EIA agent's
//                        publisherAgentId.

export interface CatalogIndex extends HarnessCatalogIndex {
  readonly datasetsByRoute: HarnessCatalogIndex["datasetsByMergeKey"];
  readonly catalog: Catalog | null;
  readonly dataService: DataService | null;
}

const EIA_AGENT_HOMEPAGE = "https://www.eia.gov/";

/**
 * On-disk locations for the harvest run report + mermaid graph. Hoisted to
 * module scope so the path that lands in `IngestReport.mermaidPath` and the
 * one passed to `writeEntityFile` cannot drift independently if the report
 * directory ever moves.
 */
const HARVEST_REPORT_DIR = "reports/harvest";
const INGEST_MERMAID_FILE = "eia-ingest-graph.mermaid";
const INGEST_REPORT_FILE = "eia-ingest-report.json";

/**
 * Load-bearing provenance attached to every IngestReport. Lifted out of
 * `main` so each note is grep-able from the top of the file rather than
 * buried inside the orchestration body.
 */
const REPORT_PROVENANCE_NOTES: ReadonlyArray<string> = [
  "Wikidata QID for EIA: Q1133499 (correct). Ticket SKY-254 listed Q466438 in error — that QID belongs to American President Lines and was not added.",
  "landingPage values for new datasets are intentionally omitted; existing hand-curated topic-page URLs (e.g. eia.gov/electricity/gridmonitor/) are preserved on merge.",
  "Legacy bulk-manifest codes (EBA, ELEC, ...) were migrated from `eia-route` to `eia-bulk-id` in Task 0.5 prior to this run."
];

/** API v2 route paths may be single-segment (`steo`), multi-segment
 *  (`electricity/retail-sales`), contain digits (`aeo/2014`), or have
 *  mixed case within a segment (`petroleum/move/railNA`). Legacy
 *  bulk-manifest codes (EBA, ELEC, NG, COAL, ...) are all-uppercase
 *  identifiers matching `^[A-Z][A-Z0-9_]*$` — they live on the
 *  `eia-bulk-id` scheme post-Task 0.5, but this guard is the second line
 *  of defence. An earlier "must contain /" heuristic (committed in
 *  Task 6) caused single-segment routes like `steo` to be re-minted on
 *  every ingest run, breaking idempotency — Task 10's end-to-end live
 *  run surfaced the bug. The current check accepts any value that is
 *  NOT an all-uppercase bulk-code identifier. */
const LEGACY_BULK_CODE_RE = /^[A-Z][A-Z0-9_]*$/;
export const isApiV2RouteValue = (value: string): boolean =>
  value.length > 0 && !LEGACY_BULK_CODE_RE.test(value);

const resolveAgentById = (
  idx: HarnessCatalogIndex,
  agentId: Agent["id"]
): Agent | null =>
  idx.agentsById.get(agentId) ??
  Array.from(idx.agentsByName.values()).find((agent) => agent.id === agentId) ??
  idx.allAgents.find((agent) => agent.id === agentId) ??
  null;

const resolveEiaRoots = (idx: HarnessCatalogIndex | CatalogIndex) => {
  const sharedEiaAgent =
    idx.allAgents.find((agent) =>
      agent.aliases.some(
        (alias) =>
          alias.scheme === AliasSchemeValues.url &&
          alias.value === EIA_AGENT_HOMEPAGE
      )
    ) ??
    idx.allAgents.find((agent) => agent.homepage === EIA_AGENT_HOMEPAGE) ??
    null;
  const sharedCatalog =
    sharedEiaAgent === null
      ? null
      : (idx.allCatalogs.find(
          (candidate) => candidate.publisherAgentId === sharedEiaAgent.id
        ) ?? null);
  const sharedDataService =
    sharedEiaAgent === null
      ? null
      : (idx.allDataServices.find(
          (candidate) => candidate.publisherAgentId === sharedEiaAgent.id
        ) ?? null);

  const compatibilityCatalog = "catalog" in idx ? idx.catalog : null;
  const compatibilityDataService = "dataService" in idx ? idx.dataService : null;
  const catalog = compatibilityCatalog ?? sharedCatalog;
  const dataService = compatibilityDataService ?? sharedDataService;
  const eiaAgent =
    catalog === null
      ? sharedEiaAgent
      : resolveAgentById(idx, catalog.publisherAgentId);

  return { eiaAgent, catalog, dataService } as const;
};

const eiaSkipReason = (
  reason: "missingMergeAlias" | "unmergeableAlias"
): "missingApiRouteAlias" | "legacyBulkAlias" =>
  reason === "missingMergeAlias" ? "missingApiRouteAlias" : "legacyBulkAlias";

/**
 * Loads the on-disk cold-start catalog into alias-keyed lookup maps.
 * Every one of the seven subdirectories must exist — missing directories
 * surface as `EiaIngestFsError { operation: "readDirectory" }` rather
 * than silently producing an empty index, which would let a stale run
 * mis-report "no existing Datasets" and duplicate-create everything.
 */
export const loadCatalogIndex = Effect.fn("EiaIngest.loadCatalogIndex")(
  function* (rootDir: string) {
    const { index, skippedDatasets } = yield* loadCatalogIndexWith({
      rootDir,
      mergeAliasScheme: AliasSchemeValues.eiaRoute,
      isMergeableDatasetAlias: (alias) => isApiV2RouteValue(alias.value),
      mapFsError: ({ operation, path, message }) =>
        new EiaIngestFsError({ operation, path, message }),
      mapSchemaError: ({ kind, slug, message }) =>
        new EiaIngestSchemaError({ kind, slug, message })
    });

    yield* Effect.forEach(
      skippedDatasets.filter((dataset) => dataset.slug.startsWith("eia-")),
      (dataset) =>
        Logging.logWarning("eia dataset skipped from route index", {
          slug: dataset.slug,
          datasetId: dataset.datasetId,
          reason: eiaSkipReason(dataset.reason),
          ...(dataset.mergeAliasValue === null
            ? {}
            : { routeAlias: dataset.mergeAliasValue })
        }),
      { discard: true }
    );

    const { catalog, dataService } = resolveEiaRoots(index);
    return {
      ...index,
      datasetsByRoute: index.datasetsByMergeKey,
      catalog,
      dataService
    } satisfies CatalogIndex;
  }
);

// ---------------------------------------------------------------------------
// Task 7 — Pure record builders
// ---------------------------------------------------------------------------
//
// These are pure synchronous transformations from EIA API v2 walk data +
// the already-loaded catalog index into unvalidated candidate records
// ready for Phase A validation in Task 8. Validation happens later; the
// builders intentionally cast their return values through `unknown` to the
// branded Dataset/Distribution/CatalogRecord types. Every cast is narrow
// and load-bearing — the branded URI + alias shapes are structurally
// correct, and Task 8's Schema.decodeUnknownEffect call will do the real
// brand enforcement.
//
// Merge contract (see Task 7 spec for the full rationale):
//   - title:              always overwrite (API v2 is canonical)
//   - description:        preserve existing (API v2 descriptions are terse)
//   - publisherAgentId:   always overwrite (structural)
//   - dataServiceIds:     always overwrite (structural)
//   - landingPage:        preserve existing; never synthesize
//   - accessRights:       preserve existing
//   - license:            preserve existing; default to EIA copyright page
//   - temporal:           preserve existing (API v2 dates are coarser)
//   - keywords:           UNION(existing, facet ids, defaultFrequency)
//   - themes:             preserve existing if non-empty, else parents
//   - inSeries:           preserve existing curated link, else synthesize from frequency-split parent routes
//   - aliases:            union by (scheme, value); only ever mint eia-route
//   - distributionIds:    re-stitched after distributions are minted
//
// Distribution merge contract:
//   - api-access is always present: mint or merge. Preserve existing
//     accessURL, format, mediaType, title, createdAt.
//   - landing-page / download / archive / documentation distributions
//     are never synthesized here — they are hand-curated. If an existing
//     distribution of one of those kinds is already linked to the
//     dataset, preserve it unchanged in the result set.

interface LeafRoute {
  readonly path: string;
  readonly parents: ReadonlyArray<string>;
  readonly response: EiaApiResponse["response"];
}

export interface BuildContext {
  readonly nowIso: string;
  readonly eiaAgent: Agent;
  readonly eiaCatalog: Catalog;
  readonly eiaDataService: DataService;
}

const decodeDatasetCandidate = stripUndefinedAndDecodeWith(Dataset);
const decodeDatasetSeriesCandidate = stripUndefinedAndDecodeWith(DatasetSeries);
const decodeDistributionCandidate = stripUndefinedAndDecodeWith(Distribution);
const decodeCatalogRecordCandidate = stripUndefinedAndDecodeWith(CatalogRecord);

// EIA's public reuse policy URL. Applied as a default license for minted
// candidates when the existing record doesn't carry one.
const EIA_LICENSE_URL = "https://www.eia.gov/about/copyrights_reuse.php";

/** Turn an API v2 route path into a dataset slug ("electricity/retail-sales"
 *  → "eia-electricity-retail-sales"). Used for filenames and node slugs. */
export const slugifyRoute = (route: string): string =>
  `eia-${route.replace(/\//gu, "-")}`;

export const slugifySeriesRoute = (route: string): string =>
  `${slugifyRoute(route)}-series`;

const datasetIdFromUlid = () => mintDatasetId();
const datasetSeriesIdFromUlid = () => mintDatasetSeriesId();
const distIdFromUlid = () => mintDistributionId();
const crIdFromUlid = () => mintCatalogRecordId();

const titleCaseSegment = (value: string): string =>
  value
    .split(/[-_]+/u)
    .filter((token) => token.length > 0)
    .map((token) => token[0]!.toUpperCase() + token.slice(1))
    .join(" ");

/**
 * EIA's v2 API returns `response.id` = the top-level route segment (and
 * `response.name === null`) for many deep leaf routes — e.g. for
 * `natural-gas/sum/sndm` the response echoes `id: "natural-gas"`. Detect that
 * case and synthesize a human-readable title from the URL path segments
 * instead, preserving disambiguation via the leaf segment.
 *
 * Pure. Never used when a real `response.name` is available or when the API
 * returns a distinctive `id` like `AEO2026`.
 */
const synthesizeLeafTitleFromPath = (leaf: LeafRoute): string => {
  const segments = leaf.path.split("/").filter((s) => s.length > 0);
  if (segments.length === 0) return leaf.response.id;
  return segments.map(titleCaseSegment).join(" \u00B7 ");
};

/**
 * True when the API response is returning the stale top-level route id
 * instead of a real leaf identifier. Used to decide whether to fall back
 * to synthesized titles.
 */
const isStaleTopLevelId = (leaf: LeafRoute): boolean => {
  if (leaf.response.name != null && leaf.response.name.length > 0) return false;
  const topSegment =
    leaf.parents.length > 0 ? leaf.parents[0]! : leaf.path.split("/")[0]!;
  return (
    leaf.parents.length > 0 &&
    leaf.response.id != null &&
    leaf.response.id === topSegment
  );
};

const cadenceFromFrequencyValue = (
  value: string | null | undefined
): DatasetSeries["cadence"] | undefined => {
  const normalized = value?.trim().toLowerCase();
  if (normalized === undefined || normalized.length === 0) {
    return undefined;
  }

  if (normalized.includes("annual") || normalized.includes("year")) {
    return "annual";
  }
  if (normalized.includes("quarter")) {
    return "quarterly";
  }
  if (normalized.includes("month")) {
    return "monthly";
  }
  if (normalized.includes("week")) {
    return "weekly";
  }
  if (normalized.includes("day")) {
    return "daily";
  }
  return undefined;
};

// Year-indexed child-route IDs like `2014`, `2023`, or `2014-er`. Used to
// detect legitimate EIA publication series (e.g. Annual Energy Outlook,
// International Energy Outlook) whose direct children are annual editions
// rather than structurally distinct datasets on a shared topic.
const YEAR_INDEXED_CHILD_ID = /^(?:19|20)\d{2}(?:-[a-z0-9]+)?$/u;

const isYearIndexedChildId = (value: string): boolean =>
  YEAR_INDEXED_CHILD_ID.test(value.trim().toLowerCase());

interface DatasetSeriesSpec {
  readonly parentPath: string;
  readonly parentResponse: EiaApiResponse["response"];
  readonly childPaths: ReadonlyArray<string>;
  readonly cadence: DatasetSeries["cadence"];
}

const childPathFromParent = (parentPath: string, childId: string): string =>
  parentPath.length === 0 ? childId : `${parentPath}/${childId}`;

const collectDatasetSeriesSpecs = (
  walkData: ReadonlyMap<string, EiaApiResponse>
): ReadonlyArray<DatasetSeriesSpec> => {
  const specs: Array<DatasetSeriesSpec> = [];

  // Strict rule: emit a DatasetSeries only when ALL direct children are
  // year-indexed leaf routes (e.g. `2022`, `2023`, `2023-er`). This matches
  // the EIA convention for publication series like AEO and IEO, while
  // rejecting topical groupings (e.g. natural-gas/*, petroleum/*,
  // densified-biomass, etc.) where children are structurally distinct
  // datasets rather than editions of the same publication. Year-indexed
  // EIA publications are annual by definition, so the cadence is fixed.
  for (const [path, response] of walkData) {
    if (path.length === 0) {
      continue;
    }

    const childRoutes = response.response.routes ?? [];
    if (childRoutes.length < 2) {
      continue;
    }

    const childPaths: Array<string> = [];
    let allYearIndexedLeaves = true;
    for (const child of childRoutes) {
      if (!isYearIndexedChildId(child.id)) {
        allYearIndexedLeaves = false;
        break;
      }
      const childPath = childPathFromParent(path, child.id);
      const childResponse = walkData.get(childPath)?.response;
      if (childResponse === undefined || (childResponse.routes ?? []).length > 0) {
        allYearIndexedLeaves = false;
        break;
      }
      childPaths.push(childPath);
    }

    if (!allYearIndexedLeaves || childPaths.length < 2) {
      continue;
    }

    specs.push({
      parentPath: path,
      parentResponse: response.response,
      childPaths,
      cadence: "annual"
    });
  }

  return specs;
};

/**
 * Copy the listed optional keys from `source` to `target` when the value
 * is set (not `undefined`). Deduplicates the repetitive
 * `if (existing?.X !== undefined) base.X = existing.X;` pattern in the
 * candidate builders below.
 *
 * Only for the pure-preservation case ("if existing, take it; else
 * don't include"). Fields with custom merge logic (e.g. `themes`,
 * `keywords`) must not use this helper.
 *
 * The `for ... of` is permitted here because this is a non-Effect-typed
 * pure synchronous function over a small known-length array.
 */
const preserveOptionalKeys = <T extends object, K extends keyof T>(
  target: Record<string, unknown>,
  source: T | null | undefined,
  keys: ReadonlyArray<K>
): void => {
  if (source === null || source === undefined) return;
  for (const key of keys) {
    const value = source[key];
    if (value !== undefined) {
      target[key as string] = value;
    }
  }
};

/**
 * Resolve the EIA agent/catalog/dataService triple from a loaded catalog
 * index. Fails loudly when any piece is missing — the ingest pipeline has
 * no sensible way to mint candidates without all three scope records.
 */
export const buildContextFromIndex = Effect.fn(
  "EiaIngest.buildContextFromIndex"
)(
  function* (idx: CatalogIndex, nowIso: string) {
    const { eiaAgent, catalog, dataService } = resolveEiaRoots(idx);
    if (catalog === null || dataService === null) {
      return yield* new EiaIngestLedgerError({
        message:
          "EIA Catalog or DataService missing from cold-start registry — run Task 6 loader against a seeded tree"
      });
    }
    if (eiaAgent === null) {
      return yield* new EiaIngestLedgerError({
        message:
          "EIA Agent missing from registry — catalog.publisherAgentId did not resolve to any loaded agent"
      });
    }
    return {
      nowIso,
      eiaAgent,
      eiaCatalog: catalog,
      eiaDataService: dataService
    } satisfies BuildContext;
  }
);

/**
 * Build a Dataset candidate from an EIA leaf-route response. Pure. When
 * `existing` is non-null, merges according to the Task 7 contract above.
 * The returned object is cast through `unknown` because branded IDs and
 * alias literals are validated later in Task 8.
 */
export const buildDatasetCandidate = (
  leaf: LeafRoute,
  ctx: BuildContext,
  existing: Dataset | null,
  datasetSeriesId: DatasetSeries["id"] | undefined
): Dataset => {
  const id = existing?.id ?? datasetIdFromUlid();
  const createdAt = existing?.createdAt ?? (ctx.nowIso as Dataset["createdAt"]);
  const updatedAt = ctx.nowIso as Dataset["updatedAt"];

  // The only alias ingestion ever mints is the API v2 route. Every other
  // scheme (eia-bulk-id, eia-series, ror, wikidata, doi, ...) is
  // hand-curated and preserved through unionAliases.
  const freshAliases: ReadonlyArray<ExternalIdentifier> = [
    {
      scheme: AliasSchemeValues.eiaRoute,
      value: leaf.path,
      relation: "exactMatch"
    } as ExternalIdentifier
  ];
  const aliases = unionAliases(existing?.aliases ?? [], freshAliases);

  // Keywords: UNION(existing, facet ids, defaultFrequency), sorted for
  // deterministic on-disk ordering (matters when Task 9 serializes the
  // merged record — stable sort means stable file diffs). defaultFrequency
  // belongs in keywords per the spec, not in aliases.
  const facetIds = (leaf.response.facets ?? []).map((f) => f.id);
  const freqKw =
    leaf.response.defaultFrequency != null ? [leaf.response.defaultFrequency] : [];
  const mergedKeywords = Array.from(
    new Set<string>([...(existing?.keywords ?? []), ...facetIds, ...freqKw])
  ).sort();

  // Themes: preserve curated list if non-empty, else fall back to the
  // parent route segments (the structural derivation).
  const mergedThemes =
    existing?.themes !== undefined && existing.themes.length > 0
      ? existing.themes
      : leaf.parents;

  // Title selection precedence:
  //   1. `response.name` when the API actually provides one (canonical
  //      structural source — a merged refresh rewrites curated titles to
  //      match API).
  //   2. Existing curated title (preserves human-curated titles when the
  //      API returns `name: null`).
  //   3. For deep leaf routes where the EIA v2 API echoes the top-level
  //      route id (e.g. `natural-gas/sum/sndm` → `id: "natural-gas"`,
  //      `name: null`), synthesize a title from the URL path segments.
  //      Detected via `isStaleTopLevelId` — never triggered for shallow
  //      routes like `aeo/2026` (id=`AEO2026`) or `electricity/retail-sales`
  //      (name=`Electricity Sales to Ultimate Customers`).
  //   4. Raw `response.id` as an absolute last resort.
  const title =
    leaf.response.name ??
    existing?.title ??
    (isStaleTopLevelId(leaf) ? synthesizeLeafTitleFromPath(leaf) : leaf.response.id);

  const base: Record<string, unknown> = {
    _tag: "Dataset",
    id,
    title,
    publisherAgentId: ctx.eiaAgent.id,
    accessRights: existing?.accessRights ?? "public",
    license: existing?.license ?? EIA_LICENSE_URL,
    keywords: mergedKeywords,
    themes: mergedThemes,
    aliases,
    createdAt,
    updatedAt,
    dataServiceIds: [ctx.eiaDataService.id],
    distributionIds: [] // re-stitched after distribution candidates are built
  };

  // description has a fresh-value fallback (API description) when no
  // existing record exists, so it can't use preserveOptionalKeys directly.
  const description =
    existing?.description ?? leaf.response.description ?? undefined;
  if (description !== undefined) base.description = description;

  // Pure-preservation fields: keep existing value if set, otherwise leave
  // the key off entirely. No fresh-value merge logic, so the helper
  // applies cleanly.
  preserveOptionalKeys(base, existing, ["landingPage"] as const);
  if (existing?.inSeries !== undefined) {
    base.inSeries = existing.inSeries;
  } else if (datasetSeriesId !== undefined) {
    base.inSeries = datasetSeriesId;
  }

  // Temporal: preserve curated value; only synthesize from start/end
  // period when neither existing record nor API response has it.
  const mergedTemporal =
    existing?.temporal ??
    (leaf.response.startPeriod != null && leaf.response.endPeriod != null
      ? `${leaf.response.startPeriod}/${leaf.response.endPeriod}`
      : undefined);
  if (mergedTemporal !== undefined) base.temporal = mergedTemporal;

  return decodeDatasetCandidate(base);
};

const resolveExistingDatasetSeries = (
  idx: CatalogIndex,
  ctx: BuildContext,
  spec: DatasetSeriesSpec
): DatasetSeries | null => {
  const title =
    spec.parentResponse.name ?? titleCaseSegment(spec.parentResponse.id);

  return idx.allDatasetSeries.find((series) =>
    series.aliases.some(
      (alias) =>
        alias.scheme === AliasSchemeValues.eiaRoute &&
        alias.value === spec.parentPath
    )
  ) ??
    idx.allDatasetSeries.find(
      (series) =>
        series.title === title &&
        (series.publisherAgentId ?? ctx.eiaAgent.id) === ctx.eiaAgent.id
    ) ??
    null;
};

const buildDatasetSeriesCandidate = (
  spec: DatasetSeriesSpec,
  ctx: BuildContext,
  existing: DatasetSeries | null
): DatasetSeries => {
  const title =
    existing?.title ??
    spec.parentResponse.name ??
    titleCaseSegment(spec.parentResponse.id);
  const description =
    existing?.description ??
    spec.parentResponse.description ??
    `Collection of EIA datasets grouped under ${title}.`;

  return decodeDatasetSeriesCandidate({
    _tag: "DatasetSeries",
    id: existing?.id ?? datasetSeriesIdFromUlid(),
    title,
    description,
    publisherAgentId: existing?.publisherAgentId ?? ctx.eiaAgent.id,
    cadence: existing?.cadence ?? spec.cadence,
    aliases: unionAliases(existing?.aliases ?? [], [
      {
        scheme: AliasSchemeValues.eiaRoute,
        value: spec.parentPath,
        relation: "exactMatch"
      } as ExternalIdentifier
    ]),
    createdAt:
      existing?.createdAt ?? (ctx.nowIso as DatasetSeries["createdAt"]),
    updatedAt: ctx.nowIso as DatasetSeries["updatedAt"]
  });
};

/**
 * Build Distribution candidates for a leaf. Always produces (at minimum)
 * an `api-access` distribution whose accessURL is the EIA v2 URL for the
 * leaf. Preserves every other hand-curated distribution attached to the
 * same dataset (landing-page, download, archive, documentation, ...).
 */
export const buildDistributionCandidates = (
  leaf: LeafRoute,
  datasetId: Dataset["id"],
  ctx: BuildContext,
  idx: CatalogIndex
): ReadonlyArray<Distribution> => {
  const apiAccessUrl = `${EIA_API_BASE}${leaf.path}/`;
  const existingApi = idx.distributionsByDatasetIdKind.get(
    `${datasetId}::api-access`
  );

  // Build the api-access distribution. Preserve every curated field when
  // merging; only bump `updatedAt`. accessURL is preserved if already set.
  const apiBase: Record<string, unknown> = {
    _tag: "Distribution",
    id: existingApi?.id ?? distIdFromUlid(),
    datasetId,
    kind: "api-access",
    accessURL: existingApi?.accessURL ?? apiAccessUrl,
    aliases: existingApi?.aliases ?? [],
    createdAt:
      existingApi?.createdAt ?? (ctx.nowIso as Distribution["createdAt"]),
    updatedAt: ctx.nowIso as Distribution["updatedAt"]
  };
  // Pure-preservation pass over every optional Distribution key. If a
  // new optional field is added to the Distribution schema and should be
  // preserved, add it here — do NOT drop any key without confirming it
  // has a different merge rule.
  preserveOptionalKeys(apiBase, existingApi, [
    "title",
    "description",
    "format",
    "mediaType",
    "downloadURL",
    "byteSize",
    "checksum",
    "accessRights",
    "license",
    "accessServiceId"
  ] as const);

  const apiAccess = decodeDistributionCandidate(apiBase);

  // Preserve all non-api-access distributions for the same dataset. These
  // are hand-curated (landing-page, download, archive, documentation);
  // ingestion never synthesizes them.
  const preserved = idx.allDistributions.filter(
    (d) => d.datasetId === datasetId && d.kind !== "api-access"
  );

  return [apiAccess, ...preserved];
};

/**
 * Build a CatalogRecord candidate for a dataset. CatalogRecord has no
 * `aliases`/`createdAt`/`updatedAt` — it carries `firstSeen`/`lastSeen`
 * catalog-tracking dates instead. Preserves existing firstSeen /
 * sourceRecordId / harvestedFrom / isAuthoritative / duplicateOf.
 */
export const buildCatalogRecord = (
  dataset: Dataset,
  ctx: BuildContext,
  existing: CatalogRecord | null,
  leafPath: string
): CatalogRecord => {
  const base: Record<string, unknown> = {
    _tag: "CatalogRecord",
    id: existing?.id ?? crIdFromUlid(),
    catalogId: ctx.eiaCatalog.id,
    primaryTopicType: "dataset",
    primaryTopicId: dataset.id,
    firstSeen: existing?.firstSeen ?? ctx.nowIso,
    lastSeen: ctx.nowIso,
    harvestedFrom: existing?.harvestedFrom ?? `${EIA_API_BASE}${leafPath}/`,
    isAuthoritative: existing?.isAuthoritative ?? true
  };
  if (existing?.sourceRecordId !== undefined)
    base.sourceRecordId = existing.sourceRecordId;
  if (existing?.sourceModified !== undefined)
    base.sourceModified = existing.sourceModified;
  if (existing?.duplicateOf !== undefined) base.duplicateOf = existing.duplicateOf;
  return decodeCatalogRecordCandidate(base);
};

/**
 * Walk the EIA response map, pick out the leaves, and produce an array of
 * IngestNode candidates ready for Phase A validation.
 *
 * NOT Effect-typed — this is a pure synchronous transformation over
 * already-fetched data, equivalent to the `Effect.sync` block exception
 * in CLAUDE.md's rules. Follows the same pattern as the Graph.directed
 * mutate callback in buildIngestGraph above.
 *
 * Emission shape:
 *   - 1 Agent (the EIA agent, with bumped updatedAt)
 *   - 1 Catalog (EIA catalog, bumped updatedAt)
 *   - 1 DataService (EIA API v2, bumped updatedAt, servesDatasetIds
 *     unioned with every dataset id we're about to mint/merge)
 *   - S DatasetSeries nodes (one per frequency-split parent route)
 *   - N Dataset nodes (one per leaf route)
 *   - M Distribution nodes (api-access + preserved curated)
 *   - N CatalogRecord nodes (one per dataset)
 */
export const buildCandidateNodes = (
  walkData: ReadonlyMap<string, EiaApiResponse>,
  idx: CatalogIndex,
  ctx: BuildContext
): ReadonlyArray<IngestNode> => {
  interface LeafCandidate {
    readonly datasetSlug: string;
    readonly existingDataset: Dataset | null;
    readonly datasetCandidate: Dataset;
    readonly distNodes: ReadonlyArray<Extract<IngestNode, { readonly _tag: "distribution" }>>;
    readonly crSlug: string;
    readonly crCandidate: CatalogRecord;
  }

  // Pure sync loop over already-fetched walk data. `for ... of` is
  // permitted here by the same CLAUDE.md carve-out used in loadCatalogIndex.
  const datasetSeriesSpecs = collectDatasetSeriesSpecs(walkData);
  const datasetSeriesNodes: Array<
    Extract<IngestNode, { readonly _tag: "dataset-series" }>
  > = [];
  const datasetSeriesIdByLeafPath = new Map<string, DatasetSeries["id"]>();

  for (const spec of datasetSeriesSpecs) {
    const existingDatasetSeries = resolveExistingDatasetSeries(idx, ctx, spec);
    const datasetSeries = buildDatasetSeriesCandidate(
      spec,
      ctx,
      existingDatasetSeries
    );

    for (const childPath of spec.childPaths) {
      datasetSeriesIdByLeafPath.set(childPath, datasetSeries.id);
    }

    datasetSeriesNodes.push({
      _tag: "dataset-series",
      slug: stableSlug(
        idx.datasetSeriesFileSlugById.get(datasetSeries.id),
        () => slugifySeriesRoute(spec.parentPath)
      ),
      data: datasetSeries,
      merged: existingDatasetSeries !== null
    });
  }

  const leafCandidates: Array<LeafCandidate> = [];
  for (const [path, resp] of walkData) {
    if (path === "") continue; // skip the root (no dataset)
    const childRoutes = resp.response.routes ?? [];
    if (childRoutes.length > 0) continue; // not a leaf — parent categories only

    const parents = path.split("/").slice(0, -1);
    const existingDataset = idx.datasetsByRoute.get(path) ?? null;

    const datasetCandidate = buildDatasetCandidate(
      { path, parents, response: resp.response },
      ctx,
      existingDataset,
      datasetSeriesIdByLeafPath.get(path)
    );
    const distCandidates = buildDistributionCandidates(
      { path, parents, response: resp.response },
      datasetCandidate.id,
      ctx,
      idx
    );
    const datasetSlug = stableSlug(
      idx.datasetFileSlugById.get(datasetCandidate.id),
      () => slugifyRoute(path)
    );
    // Re-stitch the freshly-minted distribution ids back onto the dataset
    // candidate. The initial build leaves distributionIds empty because
    // distributions are minted afterwards.
    const datasetWithDists = {
      ...datasetCandidate,
      distributionIds: distCandidates.map((d) => d.id)
    } as Dataset;

    const existingCr =
      idx.catalogRecordsByCatalogAndPrimaryTopic.get(
        `${ctx.eiaCatalog.id}::${datasetWithDists.id}`
      ) ?? null;
    const crCandidate = buildCatalogRecord(
      datasetWithDists,
      ctx,
      existingCr,
      path
    );
    const distNodes = distCandidates.map((d) => ({
      _tag: "distribution" as const,
      slug: stableSlug(
        idx.distributionFileSlugById.get(d.id),
        () => `${datasetSlug}-${d.kind}`
      ),
      data: d,
      merged: idx.distributionFileSlugById.has(d.id)
    }));
    const crSlug = stableSlug(
      idx.catalogRecordFileSlugById.get(crCandidate.id),
      () => `${datasetSlug}-cr`
    );

    leafCandidates.push({
      datasetSlug,
      existingDataset,
      datasetCandidate: datasetWithDists,
      distNodes,
      crSlug,
      crCandidate
    });
  }

  // Top-level scope nodes. The DataService node carries the union of its
  // existing servesDatasetIds with every Dataset id we just minted/merged.
  const allDatasetIds = Array.from(
    new Set<Dataset["id"]>([
      ...ctx.eiaDataService.servesDatasetIds,
      ...leafCandidates.map((l) => l.datasetCandidate.id)
    ])
  );

  const agentNode: IngestNode = {
    _tag: "agent",
    slug: "eia",
    data: { ...ctx.eiaAgent, updatedAt: ctx.nowIso as Agent["updatedAt"] },
    merged: true
  };
  const catalogNode: IngestNode = {
    _tag: "catalog",
    slug: "eia",
    data: { ...ctx.eiaCatalog, updatedAt: ctx.nowIso as Catalog["updatedAt"] },
    merged: true
  };
  const dataServiceNode: IngestNode = {
    _tag: "data-service",
    slug: "eia-api",
    data: {
      ...ctx.eiaDataService,
      servesDatasetIds: allDatasetIds,
      updatedAt: ctx.nowIso as DataService["updatedAt"]
    },
    merged: true
  };

  const datasetNodes: Array<IngestNode> = leafCandidates.map((l) => ({
    _tag: "dataset" as const,
    slug: l.datasetSlug,
    data: l.datasetCandidate,
    merged: l.existingDataset !== null
  }));
  const distNodes: Array<IngestNode> = leafCandidates.flatMap((l) => l.distNodes);
  const crNodes: Array<IngestNode> = leafCandidates.map((l) => ({
    _tag: "catalog-record" as const,
    slug: l.crSlug,
    data: l.crCandidate,
    merged: idx.catalogRecordFileSlugById.has(l.crCandidate.id)
  }));

  return [
    agentNode,
    catalogNode,
    dataServiceNode,
    ...datasetSeriesNodes,
    ...datasetNodes,
    ...distNodes,
    ...crNodes
  ];
};

// ---------------------------------------------------------------------------
// Phase A — validation gate (Task 8)
// ---------------------------------------------------------------------------
//
// Every candidate node is re-decoded through its matching domain schema
// before it is ever allowed onto the ingest graph. Two design notes:
//
//   1. The validation operates on the *candidate array*, not on the graph.
//      Phase A (validate) → Phase B (write) is gated on an all-clean
//      partition so that the bytes Phase B writes are byte-identical to
//      the bytes Phase A blessed.
//
//   2. `Effect.partition` runs every candidate in one parallel pass so a
//      fix-and-rerun cycle catches every Phase A problem at once instead
//      of failing fast on the first bad node. The tuple order is
//      `[excluded, satisfying]` = `[failures, successes]` (verified at
//      .reference/effect/packages/effect/src/Effect.ts:782).
//
// `validateNode` returns a NEW IngestNode whose `data` field is the
// *post-decode* value — Schema decoding may canonicalize or transform
// values, and the caller must use the returned successes (not the
// inputs) to construct the IngestGraph so Phase B writes what Phase A
// validated.

export const validateNode = Effect.fn("EiaIngest.validateNode")(
  function* (node: IngestNode) {
    const mapErr = (candidate: IngestNode, error: Schema.SchemaError) =>
      new EiaIngestSchemaError({
        kind: candidate._tag,
        slug: candidate.slug,
        message: formatSchemaParseError(error)
      });
    return yield* validateNodeWith(node, mapErr);
  }
);

export const validateCandidates = Effect.fn("EiaIngest.validateCandidates")(
  function* (candidates: ReadonlyArray<IngestNode>) {
    return yield* validateCandidatesWith(candidates, validateNode);
  }
);

// ---------------------------------------------------------------------------
// Atomic write helpers + entity-id ledger (Task 9)
// ---------------------------------------------------------------------------
//
// `writeEntityFile` is the single source of truth for all on-disk writes.
// It routes every write through a temp-and-rename so a partially-written
// file never appears at the final path. Parent directories are created
// recursively on demand.
//
// The entity-id ledger (`.entity-ids.json`) maps a stable "kind:slug"
// key to the minted entity id and is the rerun-safety backbone of the
// ingest: on the second run, slugs that already have an id skip the
// ULID mint and the original id is preserved. `loadLedger` deliberately
// distinguishes the missing-file case (a normal first-run condition,
// `{}` is returned) from any other read/decode failure, which must
// abort the run rather than silently re-mint every id on disk trouble.

export const writeEntityFile = Effect.fn("EiaIngest.writeEntityFile")(
  function* (filePath: string, content: string) {
    yield* writeEntityFileWith(filePath, content, (input) =>
      new EiaIngestFsError(input)
    );
  }
);

export const loadLedger = Effect.fn("EiaIngest.loadLedger")(
  function* (rootDir: string) {
    return yield* loadLedgerWith(
      rootDir,
      (message) => new EiaIngestLedgerError({ message })
    );
  }
);

export const saveLedger = Effect.fn("EiaIngest.saveLedger")(
  function* (rootDir: string, ledger: EntityIdLedger) {
    yield* saveLedgerWith(rootDir, ledger, writeEntityFile);
  }
);

// ---------------------------------------------------------------------------
// Phase B helpers: per-node disk layout + ledger keying + report shape (Task 10)
// ---------------------------------------------------------------------------
//
// `entityFilePath` deterministically routes each validated IngestNode to its
// subdirectory under `<rootDir>/catalog/` so the topological Phase B writer
// doesn't need any runtime mapping. `Path.Path` is passed explicitly (rather
// than fetched via `yield*`) to keep the function pure and cheap to call in
// a tight loop — main resolves the service once and threads it through.
//
// `encodeNodeData` dispatches on the node tag so each variant is encoded
// through its own schema and the result is pretty-printed (2-space indent)
// to keep on-disk diffs human-reviewable. We deliberately never call
// `JSON.stringify` or `encodeJsonString` (the minified encoder) on entity
// data here — see src/platform/Json.ts for the helper contract.
//
// `ledgerKeyForNode` mirrors the key scheme used by the Task 7 builders
// (`BuildContext.entityId`) so the ledger is the exact inverse map of the
// id-minting pipeline: the same "Kind:slug" key you looked up in
// `buildDatasetCandidate` is the one written back on Phase B completion.

export const assertNodeOwnsWriteTarget = Effect.fn(
  "EiaIngest.assertNodeOwnsWriteTarget"
)(
  function* (path_: Path.Path, rootDir: string, node: IngestNode) {
    return yield* assertNodeOwnsWriteTargetWith(
      path_,
      rootDir,
      node,
      (message) => new EiaIngestLedgerError({ message })
    );
  }
);

const writeNode = (
  path_: Path.Path,
  rootDir: string,
  node: IngestNode
): Effect.Effect<
  void,
  EiaIngestFsError | EiaIngestLedgerError,
  FileSystem.FileSystem | Path.Path
> =>
  Effect.gen(function* () {
    const filePath = yield* assertNodeOwnsWriteTarget(path_, rootDir, node);
    yield* writeEntityFile(filePath, `${encodeHarnessNodeData(node)}\n`);
  });
export const ledgerKeyForNode = harnessLedgerKeyForNode;

// Pure alias for test reuse. `entityFilePath` is internal and takes a
// Path.Path so tests don't need to wire the service just to hit it.
export const entityFilePathForNode = (
  path_: Path.Path,
  rootDir: string,
  node: IngestNode
): string => entityFilePathForHarnessNode(path_, rootDir, node);

// Test hook — round-trips at least one variant of each IngestNode tag
// through its schema-derived pretty encoder. Also used by the report
// writer below (which hand-encodes its own schema for the same reason).
export const encodeIngestNodeData = (node: IngestNode): string =>
  encodeHarnessNodeData(node);

export const IngestReport = Schema.Struct({
  fetchedAt: Schema.String,
  routesWalked: Schema.Number,
  nodeCount: Schema.Number,
  edgeCount: Schema.Number,
  datasets: Schema.Struct({
    created: Schema.Array(Schema.String),
    merged: Schema.Array(Schema.String)
  }),
  datasetSeries: Schema.Struct({
    created: Schema.Array(Schema.String),
    merged: Schema.Array(Schema.String)
  }),
  distributions: Schema.Struct({ count: Schema.Number }),
  catalogRecords: Schema.Struct({ count: Schema.Number }),
  mermaidPath: Schema.String,
  notes: Schema.Array(Schema.String),
  validationFailures: Schema.optionalKey(
    Schema.Array(
      Schema.Struct({
        kind: Schema.String,
        slug: Schema.String,
        message: Schema.String
      })
    )
  )
});
export type IngestReport = Schema.Schema.Type<typeof IngestReport>;

const encodeIngestReportPretty = encodeJsonStringPrettyWith(IngestReport);

const buildIngestReport = (input: {
  readonly fetchedAt: string;
  readonly routesWalked: number;
  readonly nodeCount: number;
  readonly edgeCount: number;
  readonly datasetsCreated: ReadonlyArray<string>;
  readonly datasetsMerged: ReadonlyArray<string>;
  readonly datasetSeriesCreated: ReadonlyArray<string>;
  readonly datasetSeriesMerged: ReadonlyArray<string>;
  readonly distributionCount: number;
  readonly catalogRecordCount: number;
  readonly validationFailures?: ReadonlyArray<EiaIngestSchemaError>;
}): IngestReport => ({
  fetchedAt: input.fetchedAt,
  routesWalked: input.routesWalked,
  nodeCount: input.nodeCount,
  edgeCount: input.edgeCount,
  datasets: {
    created: [...input.datasetsCreated],
    merged: [...input.datasetsMerged]
  },
  datasetSeries: {
    created: [...input.datasetSeriesCreated],
    merged: [...input.datasetSeriesMerged]
  },
  distributions: { count: input.distributionCount },
  catalogRecords: { count: input.catalogRecordCount },
  mermaidPath: `${HARVEST_REPORT_DIR}/${INGEST_MERMAID_FILE}`,
  notes: REPORT_PROVENANCE_NOTES,
  ...(input.validationFailures === undefined ||
  input.validationFailures.length === 0
    ? {}
    : {
        validationFailures: input.validationFailures.map((failure) => ({
          kind: failure.kind,
          slug: failure.slug,
          message: failure.message
        }))
      })
});

const writeIngestReport = Effect.fn("EiaIngest.writeIngestReport")(
  function* (path_: Path.Path, rootDir: string, report: IngestReport) {
    const reportsDir = path_.resolve(rootDir, HARVEST_REPORT_DIR);
    yield* writeEntityFile(
      path_.resolve(reportsDir, INGEST_REPORT_FILE),
      `${encodeIngestReportPretty(report)}\n`
    );
  }
);

const catalogIndexCounts = (idx: CatalogIndex) => ({
  agentCount: idx.agentsByName.size,
  datasetCount: idx.allDatasets.length,
  datasetSeriesCount: idx.allDatasetSeries.length,
  distributionCount: idx.allDistributions.length,
  catalogRecordCount: idx.allCatalogRecords.length
});

const candidateCountsByKind = (candidates: ReadonlyArray<IngestNode>) => {
  const byKind = {
    agent: 0,
    catalog: 0,
    dataService: 0,
    datasetSeries: 0,
    dataset: 0,
    distribution: 0,
    catalogRecord: 0
  };

  for (const candidate of candidates) {
    switch (candidate._tag) {
      case "agent":
        byKind.agent += 1;
        break;
      case "catalog":
        byKind.catalog += 1;
        break;
      case "data-service":
        byKind.dataService += 1;
        break;
      case "dataset-series":
        byKind.datasetSeries += 1;
        break;
      case "dataset":
        byKind.dataset += 1;
        break;
      case "distribution":
        byKind.distribution += 1;
        break;
      case "catalog-record":
        byKind.catalogRecord += 1;
        break;
    }
  }

  return byKind;
};

const nodeWriteOutcome = (node: IngestNode): "created" | "merged" => {
  switch (node._tag) {
    case "dataset-series":
      return node.merged ? "merged" : "created";
    case "dataset":
      return node.merged ? "merged" : "created";
    case "distribution":
      return node.data.createdAt === node.data.updatedAt ? "created" : "merged";
    case "catalog-record":
      return node.data.firstSeen === node.data.lastSeen ? "created" : "merged";
    default:
      return "merged";
  }
};

// ---------------------------------------------------------------------------
// End-to-end orchestration (Task 10)
// ---------------------------------------------------------------------------
//
// Five stages, strict order, disk untouched until Phase A signs off:
//
//   Stage 1      — fetch: walk EIA API v2 (from cache or fresh) into a
//                  Map<route, EiaApiResponse>.
//   Stage 2a     — build candidates: load the catalog index, resolve the
//                  BuildContext, and assemble Array<IngestNode>.
//   Phase A      — validate candidates: Effect.partition through
//                  validateNode. Any failure logs every error and aborts
//                  with the first one. DISK STILL UNTOUCHED.
//   Stage 2b     — build the IngestGraph from the validated successes.
//                  isAcyclic() asserts the edge directions are right.
//   Phase B      — write: topological emission via Graph.topo feeds
//                  Effect.forEach with concurrency 1 so the git diff
//                  order is stable across runs. Ledger + Mermaid +
//                  report artifacts are written last.
//
// COLD_START_DRY_RUN=true short-circuits after Stage 2b, before Phase B, so
// smoke tests exercise the full validation pipeline without touching the
// on-disk fixture tree. Legacy EIA_DRY_RUN=true is still accepted too.
export const runEiaIngest = Effect.fn("EiaIngest.main")(function* () {
  const startedAt = yield* Clock.currentTimeMillis;
  const config = yield* ScriptConfig;
  const apiKey = Redacted.value(config.apiKey);
  const path_ = yield* Path.Path;
  const nowIso = DateTime.formatIso(yield* DateTime.now);

  yield* Logging.logSummary("eia ingest started", {
    rootDir: config.rootDir,
    dryRun: config.dryRun,
    noCache: config.noCache
  });

  // ---------- Stage 1: fetch ----------
  const walkData = yield* getWalkData(config, apiKey);

  // ---------- Stage 2a: build candidates ----------
  const idx = yield* loadCatalogIndex(config.rootDir);
  yield* Logging.logSummary(
    "eia catalog index loaded",
    catalogIndexCounts(idx)
  );
  const ctx = yield* buildContextFromIndex(idx, nowIso);
  const candidates = buildCandidateNodes(walkData, idx, ctx);
  yield* Logging.logSummary("eia candidate nodes built", {
    total: candidates.length,
    byKind: candidateCountsByKind(candidates)
  });
  const candidateDatasetNodes = candidates.filter(
    (n): n is Extract<IngestNode, { _tag: "dataset" }> => n._tag === "dataset"
  );
  const candidateDatasetSeriesNodes = candidates.filter(
    (
      n
    ): n is Extract<IngestNode, { _tag: "dataset-series" }> =>
      n._tag === "dataset-series"
  );
  const candidateDistributionCount = candidates.filter(
    (n) => n._tag === "distribution"
  ).length;
  const candidateCatalogRecordCount = candidates.filter(
    (n) => n._tag === "catalog-record"
  ).length;
  const candidateDatasetsCreated = candidateDatasetNodes
    .filter((n) => !n.merged)
    .map((n) => n.slug);
  const candidateDatasetsMerged = candidateDatasetNodes
    .filter((n) => n.merged)
    .map((n) => n.slug);
  const candidateDatasetSeriesCreated = candidateDatasetSeriesNodes
    .filter((n) => !n.merged)
    .map((n) => n.slug);
  const candidateDatasetSeriesMerged = candidateDatasetSeriesNodes
    .filter((n) => n.merged)
    .map((n) => n.slug);

  // ---------- Phase A: validate candidates ----------
  const { failures, successes } = yield* validateCandidates(candidates);
  const [firstFailure] = failures;
  if (firstFailure !== undefined) {
    yield* Effect.forEach(
      failures,
      (error) =>
        Logging.logFailure("eia validation failure", error, {
          kind: error.kind,
          slug: error.slug
      }),
      { discard: true }
    );
    yield* writeIngestReport(
      path_,
      config.rootDir,
      buildIngestReport({
        fetchedAt: nowIso,
        routesWalked: walkData.size,
        nodeCount: candidates.length,
        edgeCount: 0,
        datasetsCreated: candidateDatasetsCreated,
        datasetsMerged: candidateDatasetsMerged,
        datasetSeriesCreated: candidateDatasetSeriesCreated,
        datasetSeriesMerged: candidateDatasetSeriesMerged,
        distributionCount: candidateDistributionCount,
        catalogRecordCount: candidateCatalogRecordCount,
        validationFailures: failures
      })
    );
  }
  yield* Logging.logSummary("eia validation summary", {
    valid: successes.length,
    failed: failures.length,
    total: candidates.length
  });
  if (firstFailure !== undefined) {
    // firstFailure is a Schema.TaggedErrorClass instance; yielding it aborts
    // main with the first error after all have been logged. Destructuring
    // narrows away `undefined` so we don't need a non-null assertion.
    return yield* firstFailure;
  }

  // ---------- Stage 2b: build the IngestGraph from validated nodes ----------
  const graphResult = buildIngestGraph(successes);
  if (Result.isFailure(graphResult)) {
    return yield* graphResult.failure;
  }

  const graph = graphResult.success;
  const nodeCount = Graph.nodeCount(graph);
  const edgeCount = Graph.edgeCount(graph);
  const acyclic = Graph.isAcyclic(graph);
  yield* Logging.logSummary("eia graph built", {
    nodeCount,
    edgeCount,
    acyclic
  });
  if (!acyclic) {
    return yield* new EiaIngestLedgerError({
      message:
        "IngestGraph contains a cycle — programmer error in buildIngestGraph (edge directions flipped?)"
    });
  }

  // Graph.topo returns a NodeWalker; Graph.values yields the node data.
  // `Array.from` on the iterable materializes the topo order for both the
  // write pass and the report-building pass below.
  const topoOrder = Array.from(Graph.values(Graph.topo(graph)));

  // Build the ingest report + mermaid diagram. `datasetNodes` uses a
  // type-narrowing predicate so `.merged` is visible to TS below.
  const datasetNodes = topoOrder.filter(
    (n): n is Extract<IngestNode, { _tag: "dataset" }> => n._tag === "dataset"
  );
  const datasetSeriesNodes = topoOrder.filter(
    (
      n
    ): n is Extract<IngestNode, { _tag: "dataset-series" }> =>
      n._tag === "dataset-series"
  );
  const distributionCount = topoOrder.filter(
    (n) => n._tag === "distribution"
  ).length;
  const catalogRecordCount = topoOrder.filter(
    (n) => n._tag === "catalog-record"
  ).length;
  const datasetsCreated = datasetNodes.filter((n) => !n.merged).map((n) => n.slug);
  const datasetsMerged = datasetNodes.filter((n) => n.merged).map((n) => n.slug);
  const datasetSeriesCreated = datasetSeriesNodes
    .filter((n) => !n.merged)
    .map((n) => n.slug);
  const datasetSeriesMerged = datasetSeriesNodes
    .filter((n) => n.merged)
    .map((n) => n.slug);

  if (config.dryRun) {
    const completedAt = yield* Clock.currentTimeMillis;
    yield* Logging.logSummary("eia ingest completed", {
      routesWalked: walkData.size,
      nodeCount,
      edgeCount,
      datasetSeriesCreated: datasetSeriesCreated.length,
      datasetSeriesMerged: datasetSeriesMerged.length,
      datasetsCreated: datasetsCreated.length,
      datasetsMerged: datasetsMerged.length,
      distributionCount,
      catalogRecordCount,
      durationMs: completedAt - startedAt,
      dryRun: true
    });
    return;
  }

  // ---------- Phase B: write via topological traversal ----------
  // Concurrency 1 keeps Phase B failure attribution and log ordering
  // deterministic. Distinct paths mean the on-disk result is identical
  // regardless of concurrency, but a parallel pass would scramble which
  // node we blame for an EiaIngestFsError. Raise after Task 11 if the
  // sequential write becomes the bottleneck on real ingests.
  yield* Effect.forEach(
    topoOrder,
    (node) =>
      writeNode(path_, config.rootDir, node).pipe(
        Effect.tap(() =>
          Logging.logSummary("eia node written", {
            kind: node._tag,
            slug: node.slug,
            outcome: nodeWriteOutcome(node)
          })
        )
      ),
    { concurrency: 1 }
  );

  // Append each written node's slug → id to the ledger (Task 9). A fresh
  // copy is taken so the load/save round-trip is transactional at the
  // JSON-file level. `ledger` is mutated inside a single Effect.sync over
  // already-materialized data, which is the only pattern CLAUDE.md allows
  // for plain JS `for` loops.
  const loaded = yield* loadLedger(config.rootDir);
  const ledger: Record<string, string> = { ...loaded };
  yield* Effect.sync(() => {
    for (const node of topoOrder) {
      ledger[ledgerKeyForNode(node)] = node.data.id;
    }
  });
  yield* saveLedger(config.rootDir, ledger);
  yield* Logging.logSummary("eia ledger updated", {
    entries: Object.keys(ledger).length
  });

  const report = buildIngestReport({
    fetchedAt: nowIso,
    routesWalked: walkData.size,
    nodeCount,
    edgeCount,
    datasetsCreated,
    datasetsMerged,
    datasetSeriesCreated,
    datasetSeriesMerged,
    distributionCount,
    catalogRecordCount
  });

  const mermaid = Graph.toMermaid(graph, {
    nodeLabel: (node) => `${node._tag}: ${node.slug}`,
    edgeLabel: (edge) => edge,
    diagramType: "flowchart",
    direction: "LR"
  });
  const reportsDir = path_.resolve(config.rootDir, HARVEST_REPORT_DIR);
  const mermaidPath = path_.resolve(reportsDir, INGEST_MERMAID_FILE);
  yield* writeEntityFile(mermaidPath, `${mermaid}\n`);
  yield* Logging.logSummary("eia mermaid emitted", {
    path: `${HARVEST_REPORT_DIR}/${INGEST_MERMAID_FILE}`,
    nodeCount
  });
  yield* writeIngestReport(path_, config.rootDir, report);

  const completedAt = yield* Clock.currentTimeMillis;
  yield* Logging.logSummary("eia ingest completed", {
    routesWalked: walkData.size,
    nodeCount,
    edgeCount,
    datasetSeriesCreated: datasetSeriesCreated.length,
    datasetSeriesMerged: datasetSeriesMerged.length,
    datasetsCreated: datasetsCreated.length,
    datasetsMerged: datasetsMerged.length,
    distributionCount,
    catalogRecordCount,
    durationMs: completedAt - startedAt,
    dryRun: false
  });
});

export const mainEffect = runEiaIngest().pipe(
  Effect.tapError((error) => Logging.logFailure("eia ingest failed", error))
);

// Gate the runtime entry so test imports don't trigger `main` (which would
// fail with a missing-EIA_API_KEY ConfigError). Bun sets `import.meta.main`
// to true only when this file is the entry point.
if (import.meta.main) {
  runScriptMain(
    "EiaIngest",
    mainEffect.pipe(Effect.provide(scriptPlatformLayer))
  );
}
