import * as HttpApi from "effect/unstable/httpapi/HttpApi";
import * as HttpApiBuilder from "effect/unstable/httpapi/HttpApiBuilder";
import * as HttpApiEndpoint from "effect/unstable/httpapi/HttpApiEndpoint";
import * as HttpApiGroup from "effect/unstable/httpapi/HttpApiGroup";
import * as HttpApiSchema from "effect/unstable/httpapi/HttpApiSchema";
import { DateTime, Effect, Layer, Result, Schema } from "effect";
import { SqlClient } from "effect/unstable/sql";
import type { AccessIdentity } from "../auth/AuthService";
import {
  type Agent,
  type Catalog,
  type CatalogRecord,
  type DataLayerRegistryEntity,
  dataLayerEntityKindSpecByApiKind,
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
  type DataLayerCreateInput,
  type DataLayerReplaceInput,
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
import { formatSchemaParseError } from "../platform/Json";
import { AgentsRepo } from "../services/AgentsRepo";
import { CatalogRecordsRepo } from "../services/CatalogRecordsRepo";
import { CatalogsRepo } from "../services/CatalogsRepo";
import type { DataLayerWriteOptions } from "../services/DataLayerWriteOptions";
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

type DataLayerRepoEntry = {
  readonly tag: DataLayerRegistryEntity["_tag"];
  readonly listAll: () => Effect.Effect<ReadonlyArray<DataLayerRegistryEntity>, unknown>;
  readonly findByUri: (
    uri: string
  ) => Effect.Effect<DataLayerRegistryEntity | null, unknown>;
  readonly insert: (
    entity: DataLayerRegistryEntity,
    options: DataLayerWriteOptions
  ) => Effect.Effect<void, unknown>;
  readonly update: (
    entity: DataLayerRegistryEntity,
    options: DataLayerWriteOptions
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

const getCurrentTimestamp = DateTime.now.pipe(Effect.map(DateTime.formatIso));

type DataLayerMutationInput = DataLayerCreateInput | DataLayerReplaceInput;

const decodeRequest = <S extends Schema.Decoder<unknown>>(
  schema: S,
  input: unknown,
  message: string
): Effect.Effect<S["Type"], ReturnType<typeof badRequestError>> => {
  const decoded = Schema.decodeUnknownResult(schema)(input);
  return Result.isSuccess(decoded)
    ? Effect.succeed(decoded.success)
    : Effect.fail(
        badRequestError(`${message}: ${formatSchemaParseError(decoded.failure)}`)
      );
};

const validateEntityIdForKind = (
  kind: ApiDataLayerKind,
  id: string
) =>
  decodeRequest(
    dataLayerEntityKindSpecByApiKind[kind].idSchema,
    id,
    `invalid ${kind} entity id`
  );

const toWriteOptions = (
  kind: ApiDataLayerKind,
  updatedBy: string,
  timestamp: string
): DataLayerWriteOptions =>
  kind === "catalog-records"
    ? { updatedBy, timestamp }
    : { updatedBy };

const buildCreateEntityCandidate = (
  kind: ApiDataLayerKind,
  input: DataLayerMutationInput,
  timestamp: string
) => {
  const base = input as Record<string, unknown>;
  const id = dataLayerEntityKindSpecByApiKind[kind].mintId();
  switch (kind) {
    case "catalog-records":
      return { ...base, id };
    default:
      return { ...base, id, createdAt: timestamp, updatedAt: timestamp };
  }
};

const buildReplaceEntityCandidate = (
  input: DataLayerMutationInput,
  existing: DataLayerRegistryEntity,
  timestamp: string
) => {
  const base = input as Record<string, unknown>;
  switch (existing._tag) {
    case "CatalogRecord":
      return { ...base, id: existing.id };
    default:
      return {
        ...base,
        id: existing.id,
        createdAt: existing.createdAt,
        updatedAt: timestamp
      };
  }
};

const materializeCreateEntity = (
  kind: ApiDataLayerKind,
  input: DataLayerMutationInput,
  timestamp: string
) =>
  decodeRequest(
    dataLayerEntityKindSpecByApiKind[kind].schema,
    buildCreateEntityCandidate(kind, input, timestamp),
    `invalid ${kind} create payload`
  );

const materializeReplaceEntity = (
  kind: ApiDataLayerKind,
  input: DataLayerMutationInput,
  existing: DataLayerRegistryEntity,
  timestamp: string
) =>
  decodeRequest(
    dataLayerEntityKindSpecByApiKind[kind].schema,
    buildReplaceEntityCandidate(input, existing, timestamp),
    `invalid ${kind} replacement payload`
  );

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
        tag: dataLayerEntityKindSpecByApiKind.agents.tag,
        listAll: () => agents.listAll(),
        findByUri: (uri) => agents.findByUri(uri),
        insert: (entity, options) =>
          agents.insert(entity as Agent, options),
        update: (entity, options) =>
          agents.update(entity as Agent, options),
        delete: (uri, deletedAt, updatedBy) =>
          agents.delete(uri, deletedAt, updatedBy)
      },
      catalogs: {
        tag: dataLayerEntityKindSpecByApiKind.catalogs.tag,
        listAll: () => catalogs.listAll(),
        findByUri: (uri) => catalogs.findByUri(uri),
        insert: (entity, options) =>
          catalogs.insert(entity as Catalog, options),
        update: (entity, options) =>
          catalogs.update(entity as Catalog, options),
        delete: (uri, deletedAt, updatedBy) =>
          catalogs.delete(uri, deletedAt, updatedBy)
      },
      "catalog-records": {
        tag: dataLayerEntityKindSpecByApiKind["catalog-records"].tag,
        listAll: () => catalogRecords.listAll(),
        findByUri: (uri) => catalogRecords.findByUri(uri),
        insert: (entity, options) =>
          catalogRecords.insert(entity as CatalogRecord, options),
        update: (entity, options) =>
          catalogRecords.update(entity as CatalogRecord, options),
        delete: (uri, deletedAt, updatedBy) =>
          catalogRecords.delete(uri, deletedAt, updatedBy)
      },
      datasets: {
        tag: dataLayerEntityKindSpecByApiKind.datasets.tag,
        listAll: () => datasets.listAll(),
        findByUri: (uri) => datasets.findByUri(uri),
        insert: (entity, options) =>
          datasets.insert(entity as Dataset, options),
        update: (entity, options) =>
          datasets.update(entity as Dataset, options),
        delete: (uri, deletedAt, updatedBy) =>
          datasets.delete(uri, deletedAt, updatedBy)
      },
      distributions: {
        tag: dataLayerEntityKindSpecByApiKind.distributions.tag,
        listAll: () => distributions.listAll(),
        findByUri: (uri) => distributions.findByUri(uri),
        insert: (entity, options) =>
          distributions.insert(entity as Distribution, options),
        update: (entity, options) =>
          distributions.update(entity as Distribution, options),
        delete: (uri, deletedAt, updatedBy) =>
          distributions.delete(uri, deletedAt, updatedBy)
      },
      "data-services": {
        tag: dataLayerEntityKindSpecByApiKind["data-services"].tag,
        listAll: () => dataServices.listAll(),
        findByUri: (uri) => dataServices.findByUri(uri),
        insert: (entity, options) =>
          dataServices.insert(entity as DataService, options),
        update: (entity, options) =>
          dataServices.update(entity as DataService, options),
        delete: (uri, deletedAt, updatedBy) =>
          dataServices.delete(uri, deletedAt, updatedBy)
      },
      "dataset-series": {
        tag: dataLayerEntityKindSpecByApiKind["dataset-series"].tag,
        listAll: () => datasetSeries.listAll(),
        findByUri: (uri) => datasetSeries.findByUri(uri),
        insert: (entity, options) =>
          datasetSeries.insert(entity as DatasetSeries, options),
        update: (entity, options) =>
          datasetSeries.update(entity as DatasetSeries, options),
        delete: (uri, deletedAt, updatedBy) =>
          datasetSeries.delete(uri, deletedAt, updatedBy)
      },
      variables: {
        tag: dataLayerEntityKindSpecByApiKind.variables.tag,
        listAll: () => variables.listAll(),
        findByUri: (uri) => variables.findByUri(uri),
        insert: (entity, options) =>
          variables.insert(entity as Variable, options),
        update: (entity, options) =>
          variables.update(entity as Variable, options),
        delete: (uri, deletedAt, updatedBy) =>
          variables.delete(uri, deletedAt, updatedBy)
      },
      series: {
        tag: dataLayerEntityKindSpecByApiKind.series.tag,
        listAll: () => series.listAll(),
        findByUri: (uri) => series.findByUri(uri),
        insert: (entity, options) =>
          series.insert(entity as Series, options),
        update: (entity, options) =>
          series.update(entity as Series, options),
        delete: (uri, deletedAt, updatedBy) =>
          series.delete(uri, deletedAt, updatedBy)
      }
    };

    return entries[kind];
  });

const ensureMatchingKind = (
  kind: ApiDataLayerKind,
  entity: { readonly _tag: DataLayerRegistryEntity["_tag"] }
) =>
  entity._tag === dataLayerEntityKindSpecByApiKind[kind].tag
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
          payload: AdminRequestSchemas.dataLayerCreateInput,
          success: AdminResponseSchemas.dataLayerEntity.pipe(
            HttpApiSchema.status(201)
          ),
          error: ApiErrorSchemas
        })
      )
      .add(
        HttpApiEndpoint.put("update", "/admin/data-layer/:kind/:id", {
          disableCodecs: true,
          params: AdminRequestSchemas.dataLayerEntityPath,
          payload: AdminRequestSchemas.dataLayerReplaceInput,
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
        HttpApiEndpoint.get("list", "/admin/data-layer/audit/:id", {
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
          const timestamp = yield* getCurrentTimestamp;
          const entity = yield* materializeCreateEntity(path.kind, payload, timestamp);
          const existing = yield* repo.findByUri(entity.id);

          if (existing !== null) {
            return yield* Effect.fail(
              conflictError(`entity already exists: ${entity.id}`)
            );
          }

          yield* repo.insert(
            entity,
            toWriteOptions(path.kind, toUpdatedBy(actor), timestamp)
          );
          return entity;
        }))
      )
      .handle("update", ({ params: path, payload }) =>
        withDataLayerErrors(
          "/admin/data-layer/:kind/:id",
          Effect.gen(function* () {
            yield* ensureMatchingKind(path.kind, payload);
            const id = yield* validateEntityIdForKind(path.kind, path.id);
            const actor = yield* OperatorIdentity;
            const repo = yield* getRepoEntry(path.kind);
            const existing = yield* repo.findByUri(id);

            if (existing === null) {
              return yield* Effect.fail(
                notFoundError(`entity not found: ${id}`)
              );
            }

            const timestamp = yield* getCurrentTimestamp;
            const entity = yield* materializeReplaceEntity(
              path.kind,
              payload,
              existing,
              timestamp
            );

            yield* repo.update(
              entity,
              toWriteOptions(path.kind, toUpdatedBy(actor), timestamp)
            );
            return entity;
          })
        )
      )
      .handle("delete", ({ params: path }) =>
        withDataLayerErrors(
          "/admin/data-layer/:kind/:id",
          Effect.gen(function* () {
            const id = yield* validateEntityIdForKind(path.kind, path.id);
            const actor = yield* OperatorIdentity;
            const repo = yield* getRepoEntry(path.kind);
            const existing = yield* repo.findByUri(id);
            const deletedAt = yield* getCurrentTimestamp;

            if (existing === null) {
              return yield* Effect.fail(
                notFoundError(`entity not found: ${id}`)
              );
            }

            yield* repo.delete(id, deletedAt, toUpdatedBy(actor));
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
            const id = yield* validateEntityIdForKind(path.kind, path.id);
            const repo = yield* getRepoEntry(path.kind);
            const item = yield* repo.findByUri(id);

            if (item === null) {
              return yield* Effect.fail(
                notFoundError(`entity not found: ${id}`)
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

const makeDataLayerApiLayer = (serviceLayer: Layer.Layer<any, any, never>) => {
  const handlersLayer = DataLayerHandlers.pipe(
    Layer.provideMerge(serviceLayer)
  );

  return HttpApiBuilder.layer(DataLayerApi).pipe(
    Layer.provideMerge(handlersLayer)
  ) as Layer.Layer<any, any, never>;
};

const handleCachedDataLayerRequest = makeCachedApiHandler(
  (env: EnvBindings) =>
    makeDataLayerApiLayer(
      makeAdminWorkerLayer(env) as Layer.Layer<any, any, never>
    )
);

export const handleDataLayerRequestWithLayer = (
  request: Request,
  identity: AccessIdentity,
  layer: Layer.Layer<any, any, never>
) =>
  handleWithApiLayer(
    request,
    makeDataLayerApiLayer(layer) as Layer.Layer<any, any, never>,
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
