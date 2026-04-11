import * as HttpApi from "effect/unstable/httpapi/HttpApi";
import * as HttpApiBuilder from "effect/unstable/httpapi/HttpApiBuilder";
import * as HttpApiEndpoint from "effect/unstable/httpapi/HttpApiEndpoint";
import * as HttpApiGroup from "effect/unstable/httpapi/HttpApiGroup";
import * as HttpApiSchema from "effect/unstable/httpapi/HttpApiSchema";
import { Clock, DateTime, Effect, Layer } from "effect";
import { SqlClient } from "effect/unstable/sql";
import type { AccessIdentity } from "../auth/AuthService";
import {
  type Agent,
  type Catalog,
  type CatalogRecord,
  type DataLayerRegistryEntity,
  type DataService,
  type Dataset,
  type DatasetSeries,
  type Distribution,
  type Series,
  type Variable
} from "../domain/data-layer";
import {
  AdminRequestSchemas,
  AdminResponseSchemas,
  ApiErrorSchemas,
  badRequestError,
  conflictError,
  notFoundError,
  DataLayerEntityTag,
  type DataLayerKind as ApiDataLayerKind
} from "../domain/api";
import { makeAdminWorkerLayer } from "../edge/Layer";
import { handleWithApiLayer, makeCachedApiHandler } from "../http/ApiSupport";
import { withHttpErrorMapping } from "../http/ErrorMapping";
import { OperatorIdentity, operatorIdentityContext } from "../http/Identity";
import type { EnvBindings } from "../platform/Env";
import { clampLimit } from "../platform/Limit";
import { AgentsRepo } from "../services/AgentsRepo";
import { CatalogRecordsRepo } from "../services/CatalogRecordsRepo";
import { CatalogsRepo } from "../services/CatalogsRepo";
import { DataServicesRepo } from "../services/DataServicesRepo";
import { DatasetSeriesRepo } from "../services/DatasetSeriesRepo";
import { DatasetsRepo } from "../services/DatasetsRepo";
import { DistributionsRepo } from "../services/DistributionsRepo";
import { SeriesRepo } from "../services/SeriesRepo";
import { VariablesRepo } from "../services/VariablesRepo";
import { decodeJsonColumnWithDbError } from "../services/d1/jsonColumns";
import { decodeWithDbError } from "../services/d1/schemaDecode";

const DEFAULT_LIST_LIMIT = 50;
const MAX_LIST_LIMIT = 250;

const dataLayerKindToTag = {
  agents: "Agent",
  catalogs: "Catalog",
  "catalog-records": "CatalogRecord",
  datasets: "Dataset",
  distributions: "Distribution",
  "data-services": "DataService",
  "dataset-series": "DatasetSeries",
  variables: "Variable",
  series: "Series"
} as const satisfies Record<ApiDataLayerKind, DataLayerRegistryEntity["_tag"]>;

type DataLayerRepoEntry = {
  readonly tag: DataLayerRegistryEntity["_tag"];
  readonly listAll: () => Effect.Effect<ReadonlyArray<DataLayerRegistryEntity>, unknown>;
  readonly findByUri: (
    uri: string
  ) => Effect.Effect<DataLayerRegistryEntity | null, unknown>;
  readonly insert: (
    entity: DataLayerRegistryEntity,
    updatedBy: string
  ) => Effect.Effect<void, unknown>;
  readonly update: (
    entity: DataLayerRegistryEntity,
    updatedBy: string
  ) => Effect.Effect<void, unknown>;
  readonly delete: (
    uri: string,
    deletedAt: string,
    updatedBy: string
  ) => Effect.Effect<void, unknown>;
};

type DataLayerAuditRow = {
  readonly id: number;
  readonly entity_id: string;
  readonly entity_kind: string;
  readonly operation: "insert" | "update" | "delete";
  readonly operator: string;
  readonly before_row: string | null;
  readonly after_row: string | null;
  readonly timestamp: string;
};

const toUpdatedBy = (identity: AccessIdentity) =>
  identity.email ?? identity.subject ?? "unknown-operator";

const clampDataLayerLimit = (limit: number | undefined) =>
  clampLimit(limit, DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT);

const getEntityWriteTimestamp = (entity: DataLayerRegistryEntity) =>
  "updatedAt" in entity ? entity.updatedAt : undefined;

const toWriteOptions = (
  updatedBy: string,
  entity: DataLayerRegistryEntity
) => {
  const timestamp = getEntityWriteTimestamp(entity);
  return timestamp === undefined
    ? { updatedBy }
    : { updatedBy, timestamp };
};

const decodeAuditEntity = (value: string | null, field: string) =>
  decodeJsonColumnWithDbError(value, field).pipe(
    Effect.flatMap((json) =>
      json === null
        ? Effect.succeed(null)
        : decodeWithDbError(
            AdminResponseSchemas.dataLayerEntity,
            json,
            `Failed to decode ${field}`
          )
    )
  );

const getDeleteTimestamp = Effect.gen(function* () {
  const now = yield* Clock.currentTimeMillis;
  const dateTime = yield* Effect.fromOption(DateTime.make(now)).pipe(
    Effect.orDie
  );
  return DateTime.formatIso(dateTime);
});

const getRepoEntry = (kind: ApiDataLayerKind) =>
  Effect.gen(function* () {
    const agents = yield* AgentsRepo;
    const catalogs = yield* CatalogsRepo;
    const catalogRecords = yield* CatalogRecordsRepo;
    const datasets = yield* DatasetsRepo;
    const distributions = yield* DistributionsRepo;
    const dataServices = yield* DataServicesRepo;
    const datasetSeries = yield* DatasetSeriesRepo;
    const variables = yield* VariablesRepo;
    const series = yield* SeriesRepo;

    const entries: Record<ApiDataLayerKind, DataLayerRepoEntry> = {
      agents: {
        tag: "Agent",
        listAll: () => agents.listAll(),
        findByUri: (uri) => agents.findByUri(uri),
        insert: (entity, updatedBy) =>
          agents.insert(entity as Agent, toWriteOptions(updatedBy, entity)),
        update: (entity, updatedBy) =>
          agents.update(entity as Agent, toWriteOptions(updatedBy, entity)),
        delete: (uri, deletedAt, updatedBy) =>
          agents.delete(uri, deletedAt, updatedBy)
      },
      catalogs: {
        tag: "Catalog",
        listAll: () => catalogs.listAll(),
        findByUri: (uri) => catalogs.findByUri(uri),
        insert: (entity, updatedBy) =>
          catalogs.insert(entity as Catalog, toWriteOptions(updatedBy, entity)),
        update: (entity, updatedBy) =>
          catalogs.update(entity as Catalog, toWriteOptions(updatedBy, entity)),
        delete: (uri, deletedAt, updatedBy) =>
          catalogs.delete(uri, deletedAt, updatedBy)
      },
      "catalog-records": {
        tag: "CatalogRecord",
        listAll: () => catalogRecords.listAll(),
        findByUri: (uri) => catalogRecords.findByUri(uri),
        insert: (entity, updatedBy) =>
          catalogRecords.insert(
            entity as CatalogRecord,
            toWriteOptions(updatedBy, entity)
          ),
        update: (entity, updatedBy) =>
          catalogRecords.update(
            entity as CatalogRecord,
            toWriteOptions(updatedBy, entity)
          ),
        delete: (uri, deletedAt, updatedBy) =>
          catalogRecords.delete(uri, deletedAt, updatedBy)
      },
      datasets: {
        tag: "Dataset",
        listAll: () => datasets.listAll(),
        findByUri: (uri) => datasets.findByUri(uri),
        insert: (entity, updatedBy) =>
          datasets.insert(entity as Dataset, toWriteOptions(updatedBy, entity)),
        update: (entity, updatedBy) =>
          datasets.update(entity as Dataset, toWriteOptions(updatedBy, entity)),
        delete: (uri, deletedAt, updatedBy) =>
          datasets.delete(uri, deletedAt, updatedBy)
      },
      distributions: {
        tag: "Distribution",
        listAll: () => distributions.listAll(),
        findByUri: (uri) => distributions.findByUri(uri),
        insert: (entity, updatedBy) =>
          distributions.insert(
            entity as Distribution,
            toWriteOptions(updatedBy, entity)
          ),
        update: (entity, updatedBy) =>
          distributions.update(
            entity as Distribution,
            toWriteOptions(updatedBy, entity)
          ),
        delete: (uri, deletedAt, updatedBy) =>
          distributions.delete(uri, deletedAt, updatedBy)
      },
      "data-services": {
        tag: "DataService",
        listAll: () => dataServices.listAll(),
        findByUri: (uri) => dataServices.findByUri(uri),
        insert: (entity, updatedBy) =>
          dataServices.insert(
            entity as DataService,
            toWriteOptions(updatedBy, entity)
          ),
        update: (entity, updatedBy) =>
          dataServices.update(
            entity as DataService,
            toWriteOptions(updatedBy, entity)
          ),
        delete: (uri, deletedAt, updatedBy) =>
          dataServices.delete(uri, deletedAt, updatedBy)
      },
      "dataset-series": {
        tag: "DatasetSeries",
        listAll: () => datasetSeries.listAll(),
        findByUri: (uri) => datasetSeries.findByUri(uri),
        insert: (entity, updatedBy) =>
          datasetSeries.insert(
            entity as DatasetSeries,
            toWriteOptions(updatedBy, entity)
          ),
        update: (entity, updatedBy) =>
          datasetSeries.update(
            entity as DatasetSeries,
            toWriteOptions(updatedBy, entity)
          ),
        delete: (uri, deletedAt, updatedBy) =>
          datasetSeries.delete(uri, deletedAt, updatedBy)
      },
      variables: {
        tag: "Variable",
        listAll: () => variables.listAll(),
        findByUri: (uri) => variables.findByUri(uri),
        insert: (entity, updatedBy) =>
          variables.insert(entity as Variable, toWriteOptions(updatedBy, entity)),
        update: (entity, updatedBy) =>
          variables.update(entity as Variable, toWriteOptions(updatedBy, entity)),
        delete: (uri, deletedAt, updatedBy) =>
          variables.delete(uri, deletedAt, updatedBy)
      },
      series: {
        tag: "Series",
        listAll: () => series.listAll(),
        findByUri: (uri) => series.findByUri(uri),
        insert: (entity, updatedBy) =>
          series.insert(entity as Series, toWriteOptions(updatedBy, entity)),
        update: (entity, updatedBy) =>
          series.update(entity as Series, toWriteOptions(updatedBy, entity)),
        delete: (uri, deletedAt, updatedBy) =>
          series.delete(uri, deletedAt, updatedBy)
      }
    };

    return entries[kind];
  });

const ensureMatchingKind = (
  kind: ApiDataLayerKind,
  entity: DataLayerRegistryEntity
) =>
  entity._tag === dataLayerKindToTag[kind]
    ? Effect.void
    : Effect.fail(
        badRequestError(
          `payload _tag ${entity._tag} does not match kind ${kind}`
        )
      );

const DataLayerApi = HttpApi.make("dataLayer")
  .add(
    HttpApiGroup.make("entities")
      .add(
        HttpApiEndpoint.post("create", "/admin/data-layer/:kind", {
          disableCodecs: true,
          params: AdminRequestSchemas.dataLayerKindPath,
          payload: AdminRequestSchemas.dataLayerEntity,
          success: AdminResponseSchemas.dataLayerEntity.pipe(
            HttpApiSchema.status(201)
          ),
          error: ApiErrorSchemas
        })
      )
      .add(
        HttpApiEndpoint.patch("update", "/admin/data-layer/:kind/:id", {
          disableCodecs: true,
          params: AdminRequestSchemas.dataLayerEntityPath,
          payload: AdminRequestSchemas.dataLayerEntity,
          success: AdminResponseSchemas.dataLayerEntity,
          error: ApiErrorSchemas
        })
      )
      .add(
        HttpApiEndpoint.delete("delete", "/admin/data-layer/:kind/:id", {
          disableCodecs: true,
          params: AdminRequestSchemas.dataLayerEntityPath,
          success: AdminResponseSchemas.dataLayerDelete,
          error: ApiErrorSchemas
        })
      )
      .add(
        HttpApiEndpoint.get("list", "/admin/data-layer/:kind", {
          disableCodecs: true,
          params: AdminRequestSchemas.dataLayerKindPath,
          query: AdminRequestSchemas.dataLayerList,
          success: AdminResponseSchemas.dataLayerEntitiesPage,
          error: ApiErrorSchemas
        })
      )
      .add(
        HttpApiEndpoint.get("get", "/admin/data-layer/:kind/:id", {
          disableCodecs: true,
          params: AdminRequestSchemas.dataLayerEntityPath,
          success: AdminResponseSchemas.dataLayerEntity,
          error: ApiErrorSchemas
        })
      )
  )
  .add(
    HttpApiGroup.make("audit")
      .add(
        HttpApiEndpoint.post("list", "/admin/data-layer/audit/:id", {
          disableCodecs: true,
          params: AdminRequestSchemas.dataLayerAuditPath,
          success: AdminResponseSchemas.dataLayerAudit,
          error: ApiErrorSchemas
        })
      )
  );

const withDataLayerErrors = <A, R>(
  route: string,
  effect: Effect.Effect<A, unknown, R>
) =>
  withHttpErrorMapping(effect, {
    route
  });

const DataLayerHandlers = Layer.mergeAll(
  HttpApiBuilder.group(DataLayerApi, "entities", (handlers) =>
    handlers
      .handle("create", ({ params: path, payload }) =>
        withDataLayerErrors("/admin/data-layer/:kind", Effect.gen(function* () {
          yield* ensureMatchingKind(path.kind, payload);
          const actor = yield* OperatorIdentity;
          const repo = yield* getRepoEntry(path.kind);
          const existing = yield* repo.findByUri(payload.id);

          if (existing !== null) {
            return yield* Effect.fail(
              conflictError(`entity already exists: ${payload.id}`)
            );
          }

          yield* repo.insert(payload, toUpdatedBy(actor));
          return payload;
        }))
      )
      .handle("update", ({ params: path, payload }) =>
        withDataLayerErrors(
          "/admin/data-layer/:kind/:id",
          Effect.gen(function* () {
            yield* ensureMatchingKind(path.kind, payload);

            if (payload.id !== path.id) {
              return yield* Effect.fail(
                badRequestError(
                  `payload id ${payload.id} does not match path id ${path.id}`
                )
              );
            }

            const actor = yield* OperatorIdentity;
            const repo = yield* getRepoEntry(path.kind);
            const existing = yield* repo.findByUri(path.id);

            if (existing === null) {
              return yield* Effect.fail(
                notFoundError(`entity not found: ${path.id}`)
              );
            }

            yield* repo.update(payload, toUpdatedBy(actor));
            return payload;
          })
        )
      )
      .handle("delete", ({ params: path }) =>
        withDataLayerErrors(
          "/admin/data-layer/:kind/:id",
          Effect.gen(function* () {
            const actor = yield* OperatorIdentity;
            const repo = yield* getRepoEntry(path.kind);
            const existing = yield* repo.findByUri(path.id);
            const deletedAt = yield* getDeleteTimestamp;

            if (existing === null) {
              return yield* Effect.fail(
                notFoundError(`entity not found: ${path.id}`)
              );
            }

            yield* repo.delete(path.id, deletedAt, toUpdatedBy(actor));
            return { ok: true as const };
          })
        )
      )
      .handle("list", ({ params: path, query }) =>
        withDataLayerErrors("/admin/data-layer/:kind", Effect.gen(function* () {
          const repo = yield* getRepoEntry(path.kind);
          const items = yield* repo.listAll();
          const offset = query.offset ?? 0;
          const limit = clampDataLayerLimit(query.limit);
          return {
            items: items.slice(offset, offset + limit),
            page: {
              offset,
              limit,
              total: items.length
            }
          };
        }))
      )
      .handle("get", ({ params: path }) =>
        withDataLayerErrors(
          "/admin/data-layer/:kind/:id",
          Effect.gen(function* () {
            const repo = yield* getRepoEntry(path.kind);
            const item = yield* repo.findByUri(path.id);

            if (item === null) {
              return yield* Effect.fail(
                notFoundError(`entity not found: ${path.id}`)
              );
            }

            return item;
          })
        )
      )
  ),
  HttpApiBuilder.group(DataLayerApi, "audit", (handlers) =>
    handlers.handle("list", ({ params: path }) =>
      withDataLayerErrors(
        "/admin/data-layer/audit/:id",
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          const rows = yield* sql<DataLayerAuditRow>`
            SELECT
              id,
              entity_id,
              entity_kind,
              operation,
              operator,
              before_row,
              after_row,
              timestamp
            FROM data_layer_audit
            WHERE entity_id = ${path.id}
            ORDER BY timestamp DESC, id DESC
          `;

          const items = yield* Effect.forEach(rows, (row) =>
            Effect.all({
              id: Effect.succeed(row.id),
              entityId: Effect.succeed(row.entity_id),
              entityKind: decodeWithDbError(
                DataLayerEntityTag,
                row.entity_kind,
                `Failed to decode audit entity kind for ${row.entity_id}`
              ),
              operation: Effect.succeed(row.operation),
              operator: Effect.succeed(row.operator),
              beforeRow: decodeAuditEntity(
                row.before_row,
                `audit before_row for ${row.entity_id}`
              ),
              afterRow: decodeAuditEntity(
                row.after_row,
                `audit after_row for ${row.entity_id}`
              ),
              timestamp: Effect.succeed(row.timestamp)
            })
          );

          return { items };
        })
      )
    )
  )
);

const makeDataLayerApiLayer = (serviceLayer: Layer.Layer<any, any, never>) =>
  (() => {
    const handlersLayer = DataLayerHandlers.pipe(
      Layer.provideMerge(serviceLayer)
    );

    return HttpApiBuilder.layer(DataLayerApi).pipe(
      Layer.provideMerge(handlersLayer)
    );
  })();

const handleCachedDataLayerRequest = makeCachedApiHandler(
  (env: EnvBindings) =>
    makeDataLayerApiLayer(makeAdminWorkerLayer(env))
);

export const handleDataLayerRequestWithLayer = (
  request: Request,
  identity: AccessIdentity,
  layer: Layer.Layer<any, any, never>
) =>
  handleWithApiLayer(
    request,
    makeDataLayerApiLayer(layer),
    operatorIdentityContext(identity)
  );

export const handleDataLayerRequest = (
  request: Request,
  env: EnvBindings,
  identity: AccessIdentity
) =>
  handleCachedDataLayerRequest(
    request,
    env,
    operatorIdentityContext(identity)
  );
