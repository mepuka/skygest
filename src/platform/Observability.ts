import { Effect, Layer, ServiceMap } from "effect";
import { CloudflareEnv } from "./Env";
import { Logging } from "./Logging";

export type SearchEntitiesMetricInput = {
  readonly durationMs: number;
  readonly aiSearchLatencyMs: number;
  readonly hydrationLatencyMs: number;
  readonly exactProbeHitCounts: {
    readonly iri: number;
    readonly url: number;
    readonly hostname: number;
    readonly alias: number;
  };
  readonly hydrationMissTotal: number;
  readonly failClosedTotal: number;
  readonly hitCount: number;
  readonly status: "ok" | "error";
  readonly errorType?: string;
};

const workerVersion = (metadata: WorkerVersionMetadata | undefined) => ({
  id: metadata?.id ?? "local",
  tag: metadata?.tag ?? "local"
});

export class RequestMetrics extends ServiceMap.Service<
  RequestMetrics,
  {
    readonly recordSearchEntities: (
      input: SearchEntitiesMetricInput
    ) => Effect.Effect<void>;
  }
>()("@skygest/RequestMetrics") {
  static readonly noopLayer = Layer.succeed(
    RequestMetrics,
    RequestMetrics.of({
      recordSearchEntities: () => Effect.void
    })
  );

  static readonly layer = Layer.effect(
    RequestMetrics,
    Effect.gen(function* () {
      const env = yield* CloudflareEnv;

      const recordSearchEntities = (input: SearchEntitiesMetricInput) =>
        Effect.sync(() => {
          const version = workerVersion(env.CF_VERSION_METADATA);
          env.REQUEST_METRICS?.writeDataPoint({
            indexes: [version.id],
            blobs: [
              "search_entities",
              input.status,
              input.errorType ?? "",
              "v1",
              "entity-search",
              version.tag
            ],
            doubles: [
              input.durationMs,
              input.aiSearchLatencyMs,
              input.hydrationLatencyMs,
              input.exactProbeHitCounts.iri,
              input.exactProbeHitCounts.url,
              input.exactProbeHitCounts.hostname,
              input.exactProbeHitCounts.alias,
              input.hydrationMissTotal,
              input.failClosedTotal,
              input.hitCount
            ]
          });
        }).pipe(
          Effect.tap(() =>
            Logging.logSummary("search_entities completed", {
              searchContractVersion: "v1",
              projectionCatalogVersion: "entity-search",
              aiSearchInstance: "entity-search",
              workerVersion: workerVersion(env.CF_VERSION_METADATA).tag,
              status: input.status,
              hitCount: input.hitCount,
              durationMs: input.durationMs,
              hydrationMissTotal: input.hydrationMissTotal,
              failClosedTotal: input.failClosedTotal
            })
          )
        );

      return RequestMetrics.of({
        recordSearchEntities
      });
    })
  );
}
