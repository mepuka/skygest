import { Effect, Layer, Option, ServiceMap } from "effect";
import { SqlError } from "effect/unstable/sql/SqlError";
import type {
  FindCandidatesByDataRefCursor,
  FindCandidatesByDataRefInput,
  FindCandidatesByDataRefOutput,
  ResolveDataRefInput,
  ResolveDataRefOutput
} from "../domain/data-layer/query";
import type { DbError, DataLayerRegistryLoadError } from "../domain/errors";
import { AppConfig } from "../platform/Config";
import { stripUndefined } from "../platform/Json";
import {
  formatDataLayerRegistryDiagnostic,
  prepareDataLayerRegistry,
  toDataLayerRegistryLookup
} from "../resolution/dataLayerRegistry";
import { AgentsRepo } from "./AgentsRepo";
import { CatalogRecordsRepo } from "./CatalogRecordsRepo";
import { CatalogsRepo } from "./CatalogsRepo";
import { DataRefCandidateReadRepo } from "./DataRefCandidateReadRepo";
import { DataServicesRepo } from "./DataServicesRepo";
import { DatasetSeriesRepo } from "./DatasetSeriesRepo";
import { DatasetsRepo } from "./DatasetsRepo";
import { DistributionsRepo } from "./DistributionsRepo";
import { SeriesRepo } from "./SeriesRepo";
import { VariablesRepo } from "./VariablesRepo";
import { DataLayerRegistryLoadError as DataLayerRegistryLoadErrorClass } from "../domain/errors";

export class DataRefQueryService extends ServiceMap.Service<
  DataRefQueryService,
  {
    readonly resolveDataRef: (
      input: ResolveDataRefInput
    ) => Effect.Effect<ResolveDataRefOutput, SqlError | DbError | DataLayerRegistryLoadError>;
    readonly findCandidatesByDataRef: (
      input: FindCandidatesByDataRefInput
    ) => Effect.Effect<FindCandidatesByDataRefOutput, SqlError | DbError>;
  }
>()("@skygest/DataRefQueryService") {
  static readonly layer = Layer.effect(
    DataRefQueryService,
    Effect.gen(function* () {
      const config = yield* AppConfig;
      const readRepo = yield* DataRefCandidateReadRepo;
      const agents = yield* AgentsRepo;
      const catalogs = yield* CatalogsRepo;
      const catalogRecords = yield* CatalogRecordsRepo;
      const datasets = yield* DatasetsRepo;
      const distributions = yield* DistributionsRepo;
      const dataServices = yield* DataServicesRepo;
      const datasetSeries = yield* DatasetSeriesRepo;
      const variables = yield* VariablesRepo;
      const series = yield* SeriesRepo;

      const clampLimit = (limit: number | string | undefined) =>
        Math.max(
          1,
          Math.min(
            typeof limit === "string" ? Number(limit) : (limit ?? config.mcpLimitDefault),
            config.mcpLimitMax
          )
        );

      const loadRegistry = Effect.fn("DataRefQueryService.loadRegistry")(function* () {
        const seed = yield* Effect.all(
          {
            agents: agents.listAll(),
            catalogs: catalogs.listAll(),
            catalogRecords: catalogRecords.listAll(),
            datasets: datasets.listAll(),
            distributions: distributions.listAll(),
            dataServices: dataServices.listAll(),
            datasetSeries: datasetSeries.listAll(),
            variables: variables.listAll(),
            series: series.listAll()
          },
          { concurrency: "unbounded" }
        );

        const prepared = prepareDataLayerRegistry(seed, {
          root: "d1://data-layer-registry"
        });

        if (prepared._tag === "Failure") {
          return yield* new DataLayerRegistryLoadErrorClass({
            root: "d1://data-layer-registry",
            diagnostic: prepared.failure,
            message: formatDataLayerRegistryDiagnostic(prepared.failure)
          });
        }

        return prepared.success;
      });

      const resolveDataRef = Effect.fn("DataRefQueryService.resolveDataRef")(
        function* (input: ResolveDataRefInput) {
          const prepared = yield* loadRegistry();
          const lookup = toDataLayerRegistryLookup(prepared);

          const entity =
            "canonicalUri" in input
              ? Option.getOrNull(lookup.findByCanonicalUri(input.canonicalUri))
              : Option.getOrNull(
                  lookup.findVariableByAlias(input.alias.scheme, input.alias.value)
                ) ??
                Option.getOrNull(
                  lookup.findDatasetByAlias(input.alias.scheme, input.alias.value)
                );

          return { entity };
        }
      );

      const findCandidatesByDataRef = Effect.fn(
        "DataRefQueryService.findCandidatesByDataRef"
      )(function* (input: FindCandidatesByDataRefInput) {
        const limit = clampLimit(input.limit);
        const rows = yield* readRepo.listByEntityId(stripUndefined({
          entityId: input.entityId,
          observedSince: input.observedSince,
          observedUntil: input.observedUntil,
          cursor: input.cursor,
          limit: limit + 1
        }));
        const hasMore = rows.length > limit;
        const pageRows = hasMore ? rows.slice(0, limit) : rows;
        const lastRow = pageRows[pageRows.length - 1];

        const nextCursor: FindCandidatesByDataRefCursor | null =
          hasMore && lastRow !== undefined
            ? {
                hasObservationTime: lastRow.hasObservationTime,
                observationSortKey: lastRow.observationSortKey,
                sourcePostUri: lastRow.hit.sourcePostUri,
                rowId: lastRow.rowId
              }
            : null;

        return {
          items: pageRows.map((row) => row.hit),
          nextCursor
        };
      });

      return {
        resolveDataRef,
        findCandidatesByDataRef
      };
    })
  );
}
