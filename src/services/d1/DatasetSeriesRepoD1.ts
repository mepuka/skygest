import { Effect, Layer, Option, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/unstable/sql";
import {
  Aliases,
  Cadence,
  DatasetSeries as DatasetSeriesSchema,
  type DatasetSeries
} from "../../domain/data-layer";
import { DatasetSeriesRepo } from "../DatasetSeriesRepo";
import { decodeWithDbError, withSchemaDbError } from "./schemaDecode";
import { insertDataLayerAudit } from "./dataLayerHelpers";

const DatasetSeriesRowSchema = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  description: Schema.NullOr(Schema.String),
  publisher_agent_id: Schema.NullOr(Schema.String),
  cadence: Cadence,
  aliases_json: Schema.fromJsonString(Aliases),
  created_at: Schema.String,
  updated_at: Schema.String
});
type DatasetSeriesRow = Schema.Schema.Type<typeof DatasetSeriesRowSchema>;

const DatasetSeriesUpsertRowSchema = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  description: Schema.NullOr(Schema.String),
  publisher_agent_id: Schema.NullOr(Schema.String),
  cadence: Cadence,
  aliases_json: Schema.fromJsonString(Aliases),
  created_at: Schema.String,
  updated_at: Schema.String,
  updated_by: Schema.String,
  deleted_at: Schema.Null
});
type DatasetSeriesUpsertRow = Schema.Schema.Type<typeof DatasetSeriesUpsertRowSchema>;

const DatasetSeriesDeleteRowSchema = Schema.Struct({
  id: Schema.String,
  updated_at: Schema.String,
  updated_by: Schema.String,
  deleted_at: Schema.String
});

const decodeDatasetSeriesRow = (row: DatasetSeriesRow) =>
  decodeWithDbError(
    DatasetSeriesSchema,
    {
      _tag: "DatasetSeries",
      id: row.id,
      title: row.title,
      ...(row.description === null ? {} : { description: row.description }),
      ...(row.publisher_agent_id === null
        ? {}
        : { publisherAgentId: row.publisher_agent_id }),
      cadence: row.cadence,
      aliases: row.aliases_json,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    },
    `Failed to normalize dataset series row for ${row.id}`
  );

const toDatasetSeriesUpsertRow = (
  series: DatasetSeries,
  updatedBy: string
): DatasetSeriesUpsertRow => ({
  id: series.id,
  title: series.title,
  description: series.description ?? null,
  publisher_agent_id: series.publisherAgentId ?? null,
  cadence: series.cadence,
  aliases_json: series.aliases,
  created_at: series.createdAt,
  updated_at: series.updatedAt,
  updated_by: updatedBy,
  deleted_at: null
});

export const DatasetSeriesRepoD1 = {
  layer: Layer.effect(DatasetSeriesRepo, Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;

    const listDatasetSeriesRows = SqlSchema.findAll({
      Request: Schema.Void,
      Result: DatasetSeriesRowSchema,
      execute: () =>
        sql`
          SELECT
            id,
            title,
            description,
            publisher_agent_id,
            cadence,
            aliases_json,
            created_at,
            updated_at
          FROM dataset_series
          WHERE deleted_at IS NULL
          ORDER BY id ASC
        `
    });

    const findDatasetSeriesRowByUri = SqlSchema.findOneOption({
      Request: Schema.String,
      Result: DatasetSeriesRowSchema,
      execute: (id) =>
        sql`
          SELECT
            id,
            title,
            description,
            publisher_agent_id,
            cadence,
            aliases_json,
            created_at,
            updated_at
          FROM dataset_series
          WHERE id = ${id}
            AND deleted_at IS NULL
          LIMIT 1
        `
    });

    const upsertDatasetSeriesRow = SqlSchema.void({
      Request: DatasetSeriesUpsertRowSchema,
      execute: (row) =>
        sql`
          INSERT INTO dataset_series ${sql.insert(row)}
          ON CONFLICT(id) DO UPDATE SET ${sql.update(row, ["id"])}
        `
    });

    const deleteDatasetSeriesRow = SqlSchema.void({
      Request: DatasetSeriesDeleteRowSchema,
      execute: ({ id, ...patch }) =>
        sql`
          UPDATE dataset_series
          SET ${sql.update(patch)}
          WHERE id = ${id}
            AND deleted_at IS NULL
        `
    });

    const listAll = () =>
      withSchemaDbError(
        listDatasetSeriesRows(void 0),
        "Failed to decode dataset series"
      ).pipe(
        Effect.flatMap((rows) => Effect.forEach(rows, decodeDatasetSeriesRow))
      );

    const findByUri = (uri: string) =>
      withSchemaDbError(
        findDatasetSeriesRowByUri(uri),
        `Failed to decode dataset series row for ${uri}`
      ).pipe(
        Effect.flatMap(
          Option.match({
            onNone: () => Effect.succeed(null),
            onSome: decodeDatasetSeriesRow
          })
        )
      );

    const save = (
      series: DatasetSeries,
      updatedBy: string,
      operation: "insert" | "update"
    ) =>
      decodeWithDbError(
        DatasetSeriesSchema,
        series,
        `Invalid dataset series ${operation} input for ${series.id}`
      ).pipe(
        Effect.flatMap((validated) =>
          sql.withTransaction(
            Effect.gen(function* () {
              const before = yield* findByUri(validated.id);

              yield* withSchemaDbError(
                upsertDatasetSeriesRow(
                  toDatasetSeriesUpsertRow(validated, updatedBy)
                ),
                `Failed to persist dataset series ${validated.id}`
              );

              yield* insertDataLayerAudit(sql, {
                entityId: validated.id,
                entityKind: "DatasetSeries",
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

    const insert = (
      series: DatasetSeries,
      { updatedBy }: { readonly updatedBy: string }
    ) => save(series, updatedBy, "insert");

    const update = (
      series: DatasetSeries,
      { updatedBy }: { readonly updatedBy: string }
    ) => save(series, updatedBy, "update");

    const deleteByUri = (uri: string, deletedAt: string, updatedBy: string) =>
      sql.withTransaction(
        Effect.gen(function* () {
          const before = yield* findByUri(uri);

          yield* withSchemaDbError(
            deleteDatasetSeriesRow({
              id: uri,
              updated_at: deletedAt,
              updated_by: updatedBy,
              deleted_at: deletedAt
            }),
            `Failed to delete dataset series ${uri}`
          );

          if (before !== null) {
            yield* insertDataLayerAudit(sql, {
              entityId: uri,
              entityKind: "DatasetSeries",
              operation: "delete",
              operator: updatedBy,
              beforeRow: before,
              afterRow: null,
              timestamp: deletedAt
            });
          }
        })
      );

    return DatasetSeriesRepo.of({
      listAll,
      findByUri,
      insert,
      update,
      delete: deleteByUri
    });
  }))
};
