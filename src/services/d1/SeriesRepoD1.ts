import { Effect, Layer, Option, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/unstable/sql";
import {
  Aliases,
  FixedDims,
  Series as SeriesSchema,
  type Series
} from "../../domain/data-layer";
import { SeriesRepo } from "../SeriesRepo";
import { decodeWithDbError, withSchemaDbError } from "./schemaDecode";
import { insertDataLayerAudit } from "./dataLayerHelpers";

const SeriesRowSchema = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
  variable_id: Schema.String,
  dataset_id: Schema.NullOr(Schema.String),
  fixed_dims_json: Schema.fromJsonString(FixedDims),
  aliases_json: Schema.fromJsonString(Aliases),
  created_at: Schema.String,
  updated_at: Schema.String
});
type SeriesRow = Schema.Schema.Type<typeof SeriesRowSchema>;

const SeriesUpsertRowSchema = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
  variable_id: Schema.String,
  dataset_id: Schema.NullOr(Schema.String),
  fixed_dims_json: Schema.fromJsonString(FixedDims),
  aliases_json: Schema.fromJsonString(Aliases),
  created_at: Schema.String,
  updated_at: Schema.String,
  updated_by: Schema.String,
  deleted_at: Schema.Null
});
type SeriesUpsertRow = Schema.Schema.Type<typeof SeriesUpsertRowSchema>;

const SeriesDeleteRowSchema = Schema.Struct({
  id: Schema.String,
  updated_at: Schema.String,
  updated_by: Schema.String,
  deleted_at: Schema.String
});

const decodeSeriesRow = (row: SeriesRow) =>
  decodeWithDbError(
    SeriesSchema,
    {
      _tag: "Series",
      id: row.id,
      label: row.label,
      variableId: row.variable_id,
      ...(row.dataset_id === null ? {} : { datasetId: row.dataset_id }),
      fixedDims: row.fixed_dims_json,
      aliases: row.aliases_json,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    },
    `Failed to normalize series row for ${row.id}`
  );

const toSeriesUpsertRow = (
  series: Series,
  updatedBy: string
): SeriesUpsertRow => ({
  id: series.id,
  label: series.label,
  variable_id: series.variableId,
  dataset_id: series.datasetId ?? null,
  fixed_dims_json: series.fixedDims,
  aliases_json: series.aliases,
  created_at: series.createdAt,
  updated_at: series.updatedAt,
  updated_by: updatedBy,
  deleted_at: null
});

export const SeriesRepoD1 = {
  layer: Layer.effect(SeriesRepo, Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;

    const listSeriesRows = SqlSchema.findAll({
      Request: Schema.Void,
      Result: SeriesRowSchema,
      execute: () =>
        sql`
          SELECT
            id,
            label,
            variable_id,
            dataset_id,
            fixed_dims_json,
            aliases_json,
            created_at,
            updated_at
          FROM series
          WHERE deleted_at IS NULL
          ORDER BY id ASC
        `
    });

    const findSeriesRowByUri = SqlSchema.findOneOption({
      Request: Schema.String,
      Result: SeriesRowSchema,
      execute: (id) =>
        sql`
          SELECT
            id,
            label,
            variable_id,
            dataset_id,
            fixed_dims_json,
            aliases_json,
            created_at,
            updated_at
          FROM series
          WHERE id = ${id}
            AND deleted_at IS NULL
          LIMIT 1
        `
    });

    const upsertSeriesRow = SqlSchema.void({
      Request: SeriesUpsertRowSchema,
      execute: (row) =>
        sql`
          INSERT INTO series ${sql.insert(row)}
          ON CONFLICT(id) DO UPDATE SET ${sql.update(row, ["id"])}
        `
    });

    const deleteSeriesRow = SqlSchema.void({
      Request: SeriesDeleteRowSchema,
      execute: ({ id, ...patch }) =>
        sql`
          UPDATE series
          SET ${sql.update(patch)}
          WHERE id = ${id}
            AND deleted_at IS NULL
        `
    });

    const listAll = () =>
      withSchemaDbError(listSeriesRows(void 0), "Failed to decode series").pipe(
        Effect.flatMap((rows) => Effect.forEach(rows, decodeSeriesRow))
      );

    const findByUri = (uri: string) =>
      withSchemaDbError(
        findSeriesRowByUri(uri),
        `Failed to decode series row for ${uri}`
      ).pipe(
        Effect.flatMap(
          Option.match({
            onNone: () => Effect.succeed(null),
            onSome: decodeSeriesRow
          })
        )
      );

    const save = (
      series: Series,
      updatedBy: string,
      operation: "insert" | "update"
    ) =>
      decodeWithDbError(
        SeriesSchema,
        series,
        `Invalid series ${operation} input for ${series.id}`
      ).pipe(
        Effect.flatMap((validated) =>
          sql.withTransaction(
            Effect.gen(function* () {
              const before = yield* findByUri(validated.id);

              yield* withSchemaDbError(
                upsertSeriesRow(toSeriesUpsertRow(validated, updatedBy)),
                `Failed to persist series ${validated.id}`
              );

              yield* insertDataLayerAudit(sql, {
                entityId: validated.id,
                entityKind: "Series",
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

    const insert = (series: Series, { updatedBy }: { readonly updatedBy: string }) =>
      save(series, updatedBy, "insert");

    const update = (series: Series, { updatedBy }: { readonly updatedBy: string }) =>
      save(series, updatedBy, "update");

    const deleteByUri = (uri: string, deletedAt: string, updatedBy: string) =>
      sql.withTransaction(
        Effect.gen(function* () {
          const before = yield* findByUri(uri);

          yield* withSchemaDbError(
            deleteSeriesRow({
              id: uri,
              updated_at: deletedAt,
              updated_by: updatedBy,
              deleted_at: deletedAt
            }),
            `Failed to delete series ${uri}`
          );

          if (before !== null) {
            yield* insertDataLayerAudit(sql, {
              entityId: uri,
              entityKind: "Series",
              operation: "delete",
              operator: updatedBy,
              beforeRow: before,
              afterRow: null,
              timestamp: deletedAt
            });
          }
        })
      );

    return SeriesRepo.of({
      listAll,
      findByUri,
      insert,
      update,
      delete: deleteByUri
    });
  }))
};
