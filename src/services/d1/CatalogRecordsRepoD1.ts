import { Effect, Layer, Option, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/unstable/sql";
import {
  CatalogRecord as CatalogRecordSchema,
  type CatalogRecord
} from "../../domain/data-layer";
import { CatalogRecordsRepo } from "../CatalogRecordsRepo";
import { decodeWithDbError, withSchemaDbError } from "./schemaDecode";
import {
  BooleanInt,
  insertDataLayerAudit,
  resolveWriteTimestamp
} from "./dataLayerHelpers";

const PrimaryTopicType = Schema.Literals(["dataset", "dataService"]);

const CatalogRecordRowSchema = Schema.Struct({
  id: Schema.String,
  catalog_id: Schema.String,
  primary_topic_type: PrimaryTopicType,
  primary_topic_id: Schema.String,
  source_record_id: Schema.NullOr(Schema.String),
  harvested_from: Schema.NullOr(Schema.String),
  first_seen: Schema.NullOr(Schema.String),
  last_seen: Schema.NullOr(Schema.String),
  source_modified: Schema.NullOr(Schema.String),
  is_authoritative: Schema.NullOr(BooleanInt),
  duplicate_of: Schema.NullOr(Schema.String),
  created_at: Schema.String,
  updated_at: Schema.String
});
type CatalogRecordRow = Schema.Schema.Type<typeof CatalogRecordRowSchema>;

const CatalogRecordUpsertRowSchema = Schema.Struct({
  id: Schema.String,
  catalog_id: Schema.String,
  primary_topic_type: PrimaryTopicType,
  primary_topic_id: Schema.String,
  source_record_id: Schema.NullOr(Schema.String),
  harvested_from: Schema.NullOr(Schema.String),
  first_seen: Schema.NullOr(Schema.String),
  last_seen: Schema.NullOr(Schema.String),
  source_modified: Schema.NullOr(Schema.String),
  is_authoritative: Schema.NullOr(BooleanInt),
  duplicate_of: Schema.NullOr(Schema.String),
  created_at: Schema.String,
  updated_at: Schema.String,
  updated_by: Schema.String,
  deleted_at: Schema.Null
});
type CatalogRecordUpsertRow = Schema.Schema.Type<typeof CatalogRecordUpsertRowSchema>;

const CatalogRecordDeleteRowSchema = Schema.Struct({
  id: Schema.String,
  updated_at: Schema.String,
  updated_by: Schema.String,
  deleted_at: Schema.String
});

const decodeCatalogRecordRow = (row: CatalogRecordRow) =>
  decodeWithDbError(
    CatalogRecordSchema,
    {
      _tag: "CatalogRecord",
      id: row.id,
      catalogId: row.catalog_id,
      primaryTopicType: row.primary_topic_type,
      primaryTopicId: row.primary_topic_id,
      ...(row.source_record_id === null ? {} : { sourceRecordId: row.source_record_id }),
      ...(row.harvested_from === null ? {} : { harvestedFrom: row.harvested_from }),
      ...(row.first_seen === null ? {} : { firstSeen: row.first_seen }),
      ...(row.last_seen === null ? {} : { lastSeen: row.last_seen }),
      ...(row.source_modified === null ? {} : { sourceModified: row.source_modified }),
      ...(row.is_authoritative === null
        ? {}
        : { isAuthoritative: row.is_authoritative === 1 }),
      ...(row.duplicate_of === null ? {} : { duplicateOf: row.duplicate_of })
    },
    `Failed to normalize catalog record row for ${row.id}`
  );

const toCatalogRecordUpsertRow = (
  record: CatalogRecord,
  updatedBy: string,
  createdAt: string,
  updatedAt: string
): CatalogRecordUpsertRow => ({
  id: record.id,
  catalog_id: record.catalogId,
  primary_topic_type: record.primaryTopicType,
  primary_topic_id: record.primaryTopicId,
  source_record_id: record.sourceRecordId ?? null,
  harvested_from: record.harvestedFrom ?? null,
  first_seen: record.firstSeen ?? null,
  last_seen: record.lastSeen ?? null,
  source_modified: record.sourceModified ?? null,
  is_authoritative: record.isAuthoritative === undefined
    ? null
    : record.isAuthoritative
      ? 1
      : 0,
  duplicate_of: record.duplicateOf ?? null,
  created_at: createdAt,
  updated_at: updatedAt,
  updated_by: updatedBy,
  deleted_at: null
});

const defaultCatalogRecordWriteTimestamp = (
  record: CatalogRecord,
  timestamp: string | undefined
) =>
  resolveWriteTimestamp(
    timestamp,
    record.lastSeen ?? record.firstSeen ?? "1970-01-01T00:00:00.000Z"
  );

export const CatalogRecordsRepoD1 = {
  layer: Layer.effect(CatalogRecordsRepo, Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;

    const listCatalogRecordRows = SqlSchema.findAll({
      Request: Schema.Void,
      Result: CatalogRecordRowSchema,
      execute: () =>
        sql`
          SELECT
            id,
            catalog_id,
            primary_topic_type,
            primary_topic_id,
            source_record_id,
            harvested_from,
            first_seen,
            last_seen,
            source_modified,
            is_authoritative,
            duplicate_of,
            created_at,
            updated_at
          FROM catalog_records
          WHERE deleted_at IS NULL
          ORDER BY id ASC
        `
    });

    const findCatalogRecordRowByUri = SqlSchema.findOneOption({
      Request: Schema.String,
      Result: CatalogRecordRowSchema,
      execute: (id) =>
        sql`
          SELECT
            id,
            catalog_id,
            primary_topic_type,
            primary_topic_id,
            source_record_id,
            harvested_from,
            first_seen,
            last_seen,
            source_modified,
            is_authoritative,
            duplicate_of,
            created_at,
            updated_at
          FROM catalog_records
          WHERE id = ${id}
            AND deleted_at IS NULL
          LIMIT 1
        `
    });

    const upsertCatalogRecordRow = SqlSchema.void({
      Request: CatalogRecordUpsertRowSchema,
      execute: (row) =>
        sql`
          INSERT INTO catalog_records ${sql.insert(row)}
          ON CONFLICT(id) DO UPDATE SET
            catalog_id = excluded.catalog_id,
            primary_topic_type = excluded.primary_topic_type,
            primary_topic_id = excluded.primary_topic_id,
            source_record_id = excluded.source_record_id,
            harvested_from = excluded.harvested_from,
            first_seen = excluded.first_seen,
            last_seen = excluded.last_seen,
            source_modified = excluded.source_modified,
            is_authoritative = excluded.is_authoritative,
            duplicate_of = excluded.duplicate_of,
            updated_at = excluded.updated_at,
            updated_by = excluded.updated_by,
            deleted_at = NULL
        `
    });

    const deleteCatalogRecordRow = SqlSchema.void({
      Request: CatalogRecordDeleteRowSchema,
      execute: ({ id, ...patch }) =>
        sql`
          UPDATE catalog_records
          SET ${sql.update(patch)}
          WHERE id = ${id}
            AND deleted_at IS NULL
        `
    });

    const listAll = () =>
      withSchemaDbError(
        listCatalogRecordRows(void 0),
        "Failed to decode catalog records"
      ).pipe(
        Effect.flatMap((rows) => Effect.forEach(rows, decodeCatalogRecordRow))
      );

    const findByUri = (uri: string) =>
      withSchemaDbError(
        findCatalogRecordRowByUri(uri),
        `Failed to decode catalog record row for ${uri}`
      ).pipe(
        Effect.flatMap(
          Option.match({
            onNone: () => Effect.succeed(null),
            onSome: decodeCatalogRecordRow
          })
        )
      );

    const save = (
      record: CatalogRecord,
      updatedBy: string,
      timestamp: string | undefined,
      operation: "insert" | "update"
    ) =>
      decodeWithDbError(
        CatalogRecordSchema,
        record,
        `Invalid catalog record ${operation} input for ${record.id}`
      ).pipe(
        Effect.flatMap((validated) =>
          Effect.gen(function* () {
            const beforeRow = yield* withSchemaDbError(
              findCatalogRecordRowByUri(validated.id),
              `Failed to decode catalog record row for ${validated.id}`
            );
            const before = yield* Option.match(beforeRow, {
              onNone: () => Effect.succeed<CatalogRecord | null>(null),
              onSome: (row) => decodeCatalogRecordRow(row)
            });

            const writeTimestamp = defaultCatalogRecordWriteTimestamp(
              validated,
              timestamp
            );
            const createdAt = Option.match(beforeRow, {
              onNone: () => writeTimestamp,
              onSome: (row) => row.created_at
            });

            yield* withSchemaDbError(
              upsertCatalogRecordRow(
                toCatalogRecordUpsertRow(
                  validated,
                  updatedBy,
                  createdAt,
                  writeTimestamp
                )
              ),
              `Failed to persist catalog record ${validated.id}`
            );

            yield* insertDataLayerAudit(sql, {
              entityId: validated.id,
              entityKind: "CatalogRecord",
              operation,
              operator: updatedBy,
              beforeRow: before,
              afterRow: validated,
              timestamp: writeTimestamp
            });
          })
        )
      );

    const insert = (
      record: CatalogRecord,
      options: { readonly updatedBy: string; readonly timestamp?: string }
    ) => save(record, options.updatedBy, options.timestamp, "insert");

    const update = (
      record: CatalogRecord,
      options: { readonly updatedBy: string; readonly timestamp?: string }
    ) => save(record, options.updatedBy, options.timestamp, "update");

    const deleteByUri = (uri: string, deletedAt: string, updatedBy: string) =>
      Effect.gen(function* () {
        const before = yield* findByUri(uri);

        yield* withSchemaDbError(
          deleteCatalogRecordRow({
            id: uri,
            updated_at: deletedAt,
            updated_by: updatedBy,
            deleted_at: deletedAt
          }),
          `Failed to delete catalog record ${uri}`
        );

        if (before !== null) {
          yield* insertDataLayerAudit(sql, {
            entityId: uri,
            entityKind: "CatalogRecord",
            operation: "delete",
            operator: updatedBy,
            beforeRow: before,
            afterRow: null,
            timestamp: deletedAt
          });
        }
      });

    return CatalogRecordsRepo.of({
      listAll,
      findByUri,
      insert,
      update,
      delete: deleteByUri
    });
  }))
};
