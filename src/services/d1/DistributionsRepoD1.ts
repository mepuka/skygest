import { Effect, Layer, Option, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/unstable/sql";
import {
  AccessRights,
  Aliases,
  Distribution as DistributionSchema,
  DistributionKind,
  type Distribution
} from "../../domain/data-layer";
import { normalizeDistributionHostname } from "../../resolution/normalize";
import { DistributionsRepo } from "../DistributionsRepo";
import { decodeWithDbError, withSchemaDbError } from "./schemaDecode";
import { insertDataLayerAudit } from "./dataLayerHelpers";

const DistributionRowSchema = Schema.Struct({
  id: Schema.String,
  dataset_id: Schema.String,
  kind: DistributionKind,
  title: Schema.NullOr(Schema.String),
  description: Schema.NullOr(Schema.String),
  access_url: Schema.NullOr(Schema.String),
  access_url_hostname: Schema.NullOr(Schema.String),
  download_url: Schema.NullOr(Schema.String),
  download_url_hostname: Schema.NullOr(Schema.String),
  media_type: Schema.NullOr(Schema.String),
  format: Schema.NullOr(Schema.String),
  byte_size: Schema.NullOr(Schema.Number),
  checksum: Schema.NullOr(Schema.String),
  access_rights: Schema.NullOr(AccessRights),
  license: Schema.NullOr(Schema.String),
  access_service_id: Schema.NullOr(Schema.String),
  aliases_json: Schema.fromJsonString(Aliases),
  created_at: Schema.String,
  updated_at: Schema.String
});
type DistributionRow = Schema.Schema.Type<typeof DistributionRowSchema>;

const DistributionUpsertRowSchema = Schema.Struct({
  id: Schema.String,
  dataset_id: Schema.String,
  kind: DistributionKind,
  title: Schema.NullOr(Schema.String),
  description: Schema.NullOr(Schema.String),
  access_url: Schema.NullOr(Schema.String),
  access_url_hostname: Schema.NullOr(Schema.String),
  download_url: Schema.NullOr(Schema.String),
  download_url_hostname: Schema.NullOr(Schema.String),
  media_type: Schema.NullOr(Schema.String),
  format: Schema.NullOr(Schema.String),
  byte_size: Schema.NullOr(Schema.Number),
  checksum: Schema.NullOr(Schema.String),
  access_rights: Schema.NullOr(AccessRights),
  license: Schema.NullOr(Schema.String),
  access_service_id: Schema.NullOr(Schema.String),
  aliases_json: Schema.fromJsonString(Aliases),
  created_at: Schema.String,
  updated_at: Schema.String,
  updated_by: Schema.String,
  deleted_at: Schema.Null
});
type DistributionUpsertRow = Schema.Schema.Type<typeof DistributionUpsertRowSchema>;

const DistributionDeleteRowSchema = Schema.Struct({
  id: Schema.String,
  updated_at: Schema.String,
  updated_by: Schema.String,
  deleted_at: Schema.String
});

const decodeDistributionRow = (row: DistributionRow) =>
  decodeWithDbError(
    DistributionSchema,
    {
      _tag: "Distribution",
      id: row.id,
      datasetId: row.dataset_id,
      kind: row.kind,
      ...(row.title === null ? {} : { title: row.title }),
      ...(row.description === null ? {} : { description: row.description }),
      ...(row.access_url === null ? {} : { accessURL: row.access_url }),
      ...(row.download_url === null ? {} : { downloadURL: row.download_url }),
      ...(row.media_type === null ? {} : { mediaType: row.media_type }),
      ...(row.format === null ? {} : { format: row.format }),
      ...(row.byte_size === null ? {} : { byteSize: row.byte_size }),
      ...(row.checksum === null ? {} : { checksum: row.checksum }),
      ...(row.access_rights === null ? {} : { accessRights: row.access_rights }),
      ...(row.license === null ? {} : { license: row.license }),
      ...(row.access_service_id === null ? {} : { accessServiceId: row.access_service_id }),
      aliases: row.aliases_json,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    },
    `Failed to normalize distribution row for ${row.id}`
  );

const toDistributionUpsertRow = (
  distribution: Distribution,
  updatedBy: string
): DistributionUpsertRow => ({
  id: distribution.id,
  dataset_id: distribution.datasetId,
  kind: distribution.kind,
  title: distribution.title ?? null,
  description: distribution.description ?? null,
  access_url: distribution.accessURL ?? null,
  access_url_hostname: distribution.accessURL === undefined
    ? null
    : normalizeDistributionHostname(distribution.accessURL),
  download_url: distribution.downloadURL ?? null,
  download_url_hostname: distribution.downloadURL === undefined
    ? null
    : normalizeDistributionHostname(distribution.downloadURL),
  media_type: distribution.mediaType ?? null,
  format: distribution.format ?? null,
  byte_size: distribution.byteSize ?? null,
  checksum: distribution.checksum ?? null,
  access_rights: distribution.accessRights ?? null,
  license: distribution.license ?? null,
  access_service_id: distribution.accessServiceId ?? null,
  aliases_json: distribution.aliases,
  created_at: distribution.createdAt,
  updated_at: distribution.updatedAt,
  updated_by: updatedBy,
  deleted_at: null
});

export const DistributionsRepoD1 = {
  layer: Layer.effect(DistributionsRepo, Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;

    const listDistributionRows = SqlSchema.findAll({
      Request: Schema.Void,
      Result: DistributionRowSchema,
      execute: () =>
        sql`
          SELECT
            id,
            dataset_id,
            kind,
            title,
            description,
            access_url,
            access_url_hostname,
            download_url,
            download_url_hostname,
            media_type,
            format,
            byte_size,
            checksum,
            access_rights,
            license,
            access_service_id,
            aliases_json,
            created_at,
            updated_at
          FROM distributions
          WHERE deleted_at IS NULL
          ORDER BY id ASC
        `
    });

    const findDistributionRowByUri = SqlSchema.findOneOption({
      Request: Schema.String,
      Result: DistributionRowSchema,
      execute: (id) =>
        sql`
          SELECT
            id,
            dataset_id,
            kind,
            title,
            description,
            access_url,
            access_url_hostname,
            download_url,
            download_url_hostname,
            media_type,
            format,
            byte_size,
            checksum,
            access_rights,
            license,
            access_service_id,
            aliases_json,
            created_at,
            updated_at
          FROM distributions
          WHERE id = ${id}
            AND deleted_at IS NULL
          LIMIT 1
        `
    });

    const listDistributionRowsByHostname = SqlSchema.findAll({
      Request: Schema.String,
      Result: DistributionRowSchema,
      execute: (hostname) =>
        sql`
          SELECT
            id,
            dataset_id,
            kind,
            title,
            description,
            access_url,
            access_url_hostname,
            download_url,
            download_url_hostname,
            media_type,
            format,
            byte_size,
            checksum,
            access_rights,
            license,
            access_service_id,
            aliases_json,
            created_at,
            updated_at
          FROM distributions
          WHERE deleted_at IS NULL
            AND (
              access_url_hostname = ${hostname}
              OR download_url_hostname = ${hostname}
            )
          ORDER BY id ASC
        `
    });

    const upsertDistributionRow = SqlSchema.void({
      Request: DistributionUpsertRowSchema,
      execute: (row) =>
        sql`
          INSERT INTO distributions ${sql.insert(row)}
          ON CONFLICT(id) DO UPDATE SET ${sql.update(row, ["id"])}
        `
    });

    const deleteDistributionRow = SqlSchema.void({
      Request: DistributionDeleteRowSchema,
      execute: ({ id, ...patch }) =>
        sql`
          UPDATE distributions
          SET ${sql.update(patch)}
          WHERE id = ${id}
            AND deleted_at IS NULL
        `
    });

    const listAll = () =>
      withSchemaDbError(
        listDistributionRows(void 0),
        "Failed to decode distributions"
      ).pipe(
        Effect.flatMap((rows) => Effect.forEach(rows, decodeDistributionRow))
      );

    const findByUri = (uri: string) =>
      withSchemaDbError(
        findDistributionRowByUri(uri),
        `Failed to decode distribution row for ${uri}`
      ).pipe(
        Effect.flatMap(
          Option.match({
            onNone: () => Effect.succeed(null),
            onSome: decodeDistributionRow
          })
        )
      );

    const save = (
      distribution: Distribution,
      updatedBy: string,
      operation: "insert" | "update"
    ) =>
      decodeWithDbError(
        DistributionSchema,
        distribution,
        `Invalid distribution ${operation} input for ${distribution.id}`
      ).pipe(
        Effect.flatMap((validated) =>
          Effect.gen(function* () {
            const before = yield* findByUri(validated.id);

            yield* withSchemaDbError(
              upsertDistributionRow(toDistributionUpsertRow(validated, updatedBy)),
              `Failed to persist distribution ${validated.id}`
            );

            yield* insertDataLayerAudit(sql, {
              entityId: validated.id,
              entityKind: "Distribution",
              operation,
              operator: updatedBy,
              beforeRow: before,
              afterRow: validated,
              timestamp: validated.updatedAt
            });
          })
        )
      );

    const insert = (
      distribution: Distribution,
      { updatedBy }: { readonly updatedBy: string }
    ) => save(distribution, updatedBy, "insert");

    const update = (
      distribution: Distribution,
      { updatedBy }: { readonly updatedBy: string }
    ) => save(distribution, updatedBy, "update");

    const deleteByUri = (uri: string, deletedAt: string, updatedBy: string) =>
      Effect.gen(function* () {
        const before = yield* findByUri(uri);

        yield* withSchemaDbError(
          deleteDistributionRow({
            id: uri,
            updated_at: deletedAt,
            updated_by: updatedBy,
            deleted_at: deletedAt
          }),
          `Failed to delete distribution ${uri}`
        );

        if (before !== null) {
          yield* insertDataLayerAudit(sql, {
            entityId: uri,
            entityKind: "Distribution",
            operation: "delete",
            operator: updatedBy,
            beforeRow: before,
            afterRow: null,
            timestamp: deletedAt
          });
        }
      });

    const findByHostname = (hostname: string) => {
      const normalized = normalizeDistributionHostname(hostname);
      if (normalized === null) {
        return Effect.succeed<ReadonlyArray<Distribution>>([]);
      }

      return withSchemaDbError(
        listDistributionRowsByHostname(normalized),
        `Failed to decode distributions for hostname ${hostname}`
      ).pipe(
        Effect.flatMap((rows) => Effect.forEach(rows, decodeDistributionRow))
      );
    };

    return DistributionsRepo.of({
      listAll,
      findByUri,
      insert,
      update,
      delete: deleteByUri,
      findByHostname
    });
  }))
};
