import { Effect, Layer, Option, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/unstable/sql";
import {
  AccessRights,
  AgentId,
  Aliases,
  DataServiceId,
  Dataset as DatasetSchema,
  DatasetSeriesId,
  DistributionId,
  type AliasScheme,
  type Dataset
} from "../../domain/data-layer";
import { DatasetsRepo } from "../DatasetsRepo";
import { decodeWithDbError, withSchemaDbError } from "./schemaDecode";
import {
  insertDataLayerAudit,
  matchesAlias,
  matchesLookupText
} from "./dataLayerHelpers";

const AgentIdArrayJson = Schema.fromJsonString(Schema.Array(AgentId));
const StringArrayJson = Schema.fromJsonString(Schema.Array(Schema.String));
const DistributionIdArrayJson = Schema.fromJsonString(Schema.Array(DistributionId));
const DataServiceIdArrayJson = Schema.fromJsonString(Schema.Array(DataServiceId));

const DatasetRowSchema = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  description: Schema.NullOr(Schema.String),
  creator_agent_id: Schema.NullOr(Schema.String),
  was_derived_from_json: Schema.NullOr(AgentIdArrayJson),
  publisher_agent_id: Schema.NullOr(Schema.String),
  landing_page: Schema.NullOr(Schema.String),
  access_rights: Schema.NullOr(AccessRights),
  license: Schema.NullOr(Schema.String),
  temporal_coverage_json: Schema.NullOr(Schema.String),
  keywords_json: Schema.NullOr(StringArrayJson),
  themes_json: Schema.NullOr(StringArrayJson),
  distribution_ids_json: Schema.NullOr(DistributionIdArrayJson),
  data_service_ids_json: Schema.NullOr(DataServiceIdArrayJson),
  in_series: Schema.NullOr(Schema.String),
  aliases_json: Schema.fromJsonString(Aliases),
  created_at: Schema.String,
  updated_at: Schema.String
});
type DatasetRow = Schema.Schema.Type<typeof DatasetRowSchema>;

const DatasetUpsertRowSchema = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  description: Schema.NullOr(Schema.String),
  creator_agent_id: Schema.NullOr(Schema.String),
  was_derived_from_json: Schema.NullOr(AgentIdArrayJson),
  publisher_agent_id: Schema.NullOr(Schema.String),
  landing_page: Schema.NullOr(Schema.String),
  access_rights: Schema.NullOr(AccessRights),
  license: Schema.NullOr(Schema.String),
  temporal_coverage_json: Schema.NullOr(Schema.String),
  keywords_json: Schema.NullOr(StringArrayJson),
  themes_json: Schema.NullOr(StringArrayJson),
  distribution_ids_json: Schema.NullOr(DistributionIdArrayJson),
  data_service_ids_json: Schema.NullOr(DataServiceIdArrayJson),
  in_series: Schema.NullOr(Schema.String),
  aliases_json: Schema.fromJsonString(Aliases),
  created_at: Schema.String,
  updated_at: Schema.String,
  updated_by: Schema.String,
  deleted_at: Schema.Null
});
type DatasetUpsertRow = Schema.Schema.Type<typeof DatasetUpsertRowSchema>;

const DatasetDeleteRowSchema = Schema.Struct({
  id: Schema.String,
  updated_at: Schema.String,
  updated_by: Schema.String,
  deleted_at: Schema.String
});

const decodeDatasetRow = (row: DatasetRow) =>
  decodeWithDbError(
    DatasetSchema,
    {
      _tag: "Dataset",
      id: row.id,
      title: row.title,
      ...(row.description === null ? {} : { description: row.description }),
      ...(row.creator_agent_id === null ? {} : { creatorAgentId: row.creator_agent_id }),
      ...(row.was_derived_from_json === null ? {} : { wasDerivedFrom: row.was_derived_from_json }),
      ...(row.publisher_agent_id === null
        ? {}
        : { publisherAgentId: row.publisher_agent_id }),
      ...(row.landing_page === null ? {} : { landingPage: row.landing_page }),
      ...(row.access_rights === null ? {} : { accessRights: row.access_rights }),
      ...(row.license === null ? {} : { license: row.license }),
      ...(row.temporal_coverage_json === null ? {} : { temporal: row.temporal_coverage_json }),
      ...(row.keywords_json === null ? {} : { keywords: row.keywords_json }),
      ...(row.themes_json === null ? {} : { themes: row.themes_json }),
      ...(row.distribution_ids_json === null
        ? {}
        : { distributionIds: row.distribution_ids_json }),
      ...(row.data_service_ids_json === null
        ? {}
        : { dataServiceIds: row.data_service_ids_json }),
      ...(row.in_series === null ? {} : { inSeries: row.in_series }),
      aliases: row.aliases_json,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    },
    `Failed to normalize dataset row for ${row.id}`
  );

const toDatasetUpsertRow = (
  dataset: Dataset,
  updatedBy: string
): DatasetUpsertRow => ({
  id: dataset.id,
  title: dataset.title,
  description: dataset.description ?? null,
  creator_agent_id: dataset.creatorAgentId ?? null,
  was_derived_from_json: dataset.wasDerivedFrom ?? null,
  publisher_agent_id: dataset.publisherAgentId ?? null,
  landing_page: dataset.landingPage ?? null,
  access_rights: dataset.accessRights ?? null,
  license: dataset.license ?? null,
  temporal_coverage_json: dataset.temporal ?? null,
  keywords_json: dataset.keywords ?? null,
  themes_json: dataset.themes ?? null,
  distribution_ids_json: dataset.distributionIds ?? null,
  data_service_ids_json: dataset.dataServiceIds ?? null,
  in_series: dataset.inSeries ?? null,
  aliases_json: dataset.aliases,
  created_at: dataset.createdAt,
  updated_at: dataset.updatedAt,
  updated_by: updatedBy,
  deleted_at: null
});

export const DatasetsRepoD1 = {
  layer: Layer.effect(DatasetsRepo, Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;

    const listDatasetRows = SqlSchema.findAll({
      Request: Schema.Void,
      Result: DatasetRowSchema,
      execute: () =>
        sql`
          SELECT
            id,
            title,
            description,
            creator_agent_id,
            was_derived_from_json,
            publisher_agent_id,
            landing_page,
            access_rights,
            license,
            temporal_coverage_json,
            keywords_json,
            themes_json,
            distribution_ids_json,
            data_service_ids_json,
            in_series,
            aliases_json,
            created_at,
            updated_at
          FROM datasets
          WHERE deleted_at IS NULL
          ORDER BY id ASC
        `
    });

    const findDatasetRowByUri = SqlSchema.findOneOption({
      Request: Schema.String,
      Result: DatasetRowSchema,
      execute: (id) =>
        sql`
          SELECT
            id,
            title,
            description,
            creator_agent_id,
            was_derived_from_json,
            publisher_agent_id,
            landing_page,
            access_rights,
            license,
            temporal_coverage_json,
            keywords_json,
            themes_json,
            distribution_ids_json,
            data_service_ids_json,
            in_series,
            aliases_json,
            created_at,
            updated_at
          FROM datasets
          WHERE id = ${id}
            AND deleted_at IS NULL
          LIMIT 1
        `
    });

    const upsertDatasetRow = SqlSchema.void({
      Request: DatasetUpsertRowSchema,
      execute: (row) =>
        sql`
          INSERT INTO datasets ${sql.insert(row)}
          ON CONFLICT(id) DO UPDATE SET ${sql.update(row, ["id"])}
        `
    });

    const deleteDatasetRow = SqlSchema.void({
      Request: DatasetDeleteRowSchema,
      execute: ({ id, ...patch }) =>
        sql`
          UPDATE datasets
          SET ${sql.update(patch)}
          WHERE id = ${id}
            AND deleted_at IS NULL
        `
    });

    const listAll = () =>
      withSchemaDbError(
        listDatasetRows(void 0),
        "Failed to decode datasets"
      ).pipe(
        Effect.flatMap((rows) => Effect.forEach(rows, decodeDatasetRow))
      );

    const findByUri = (uri: string) =>
      withSchemaDbError(
        findDatasetRowByUri(uri),
        `Failed to decode dataset row for ${uri}`
      ).pipe(
        Effect.flatMap(
          Option.match({
            onNone: () => Effect.succeed(null),
            onSome: decodeDatasetRow
          })
        )
      );

    const save = (
      dataset: Dataset,
      updatedBy: string,
      operation: "insert" | "update"
    ) =>
      decodeWithDbError(
        DatasetSchema,
        dataset,
        `Invalid dataset ${operation} input for ${dataset.id}`
      ).pipe(
        Effect.flatMap((validated) =>
          sql.withTransaction(
            Effect.gen(function* () {
              const before = yield* findByUri(validated.id);

              yield* withSchemaDbError(
                upsertDatasetRow(toDatasetUpsertRow(validated, updatedBy)),
                `Failed to persist dataset ${validated.id}`
              );

              yield* insertDataLayerAudit(sql, {
                entityId: validated.id,
                entityKind: "Dataset",
                operation,
                operator: updatedBy,
                beforeRow: before,
                afterRow: validated,
                timestamp: validated.updatedAt
              });
            })
          )
        )
      );

    const insert = (dataset: Dataset, { updatedBy }: { readonly updatedBy: string }) =>
      save(dataset, updatedBy, "insert");

    const update = (dataset: Dataset, { updatedBy }: { readonly updatedBy: string }) =>
      save(dataset, updatedBy, "update");

    const deleteByUri = (uri: string, deletedAt: string, updatedBy: string) =>
      sql.withTransaction(
        Effect.gen(function* () {
          const before = yield* findByUri(uri);

          yield* withSchemaDbError(
            deleteDatasetRow({
              id: uri,
              updated_at: deletedAt,
              updated_by: updatedBy,
              deleted_at: deletedAt
            }),
            `Failed to delete dataset ${uri}`
          );

          if (before !== null) {
            yield* insertDataLayerAudit(sql, {
              entityId: uri,
              entityKind: "Dataset",
              operation: "delete",
              operator: updatedBy,
              beforeRow: before,
              afterRow: null,
              timestamp: deletedAt
            });
          }
        })
      );

    const findByTitle = (title: string) =>
      listAll().pipe(
        Effect.map(
          (items) =>
            items.find((item) => matchesLookupText(item.title, title)) ?? null
        )
      );

    const findByAlias = (scheme: AliasScheme, value: string) =>
      listAll().pipe(
        Effect.map(
          (items) => items.find((item) => matchesAlias(item.aliases, scheme, value)) ?? null
        )
      );

    return DatasetsRepo.of({
      listAll,
      findByUri,
      insert,
      update,
      delete: deleteByUri,
      findByTitle,
      findByAlias
    });
  }))
};
