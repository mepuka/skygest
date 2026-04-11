import { Effect, Layer, Option, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/unstable/sql";
import {
  Aliases,
  Catalog as CatalogSchema,
  type Catalog
} from "../../domain/data-layer";
import { CatalogsRepo } from "../CatalogsRepo";
import { decodeWithDbError, withSchemaDbError } from "./schemaDecode";
import { insertDataLayerAudit } from "./dataLayerHelpers";

const CatalogRowSchema = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  description: Schema.NullOr(Schema.String),
  publisher_agent_id: Schema.String,
  homepage: Schema.NullOr(Schema.String),
  aliases_json: Schema.fromJsonString(Aliases),
  created_at: Schema.String,
  updated_at: Schema.String
});
type CatalogRow = Schema.Schema.Type<typeof CatalogRowSchema>;

const CatalogUpsertRowSchema = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  description: Schema.NullOr(Schema.String),
  publisher_agent_id: Schema.String,
  homepage: Schema.NullOr(Schema.String),
  aliases_json: Schema.fromJsonString(Aliases),
  created_at: Schema.String,
  updated_at: Schema.String,
  updated_by: Schema.String,
  deleted_at: Schema.Null
});
type CatalogUpsertRow = Schema.Schema.Type<typeof CatalogUpsertRowSchema>;

const CatalogDeleteRowSchema = Schema.Struct({
  id: Schema.String,
  updated_at: Schema.String,
  updated_by: Schema.String,
  deleted_at: Schema.String
});

const decodeCatalogRow = (row: CatalogRow) =>
  decodeWithDbError(
    CatalogSchema,
    {
      _tag: "Catalog",
      id: row.id,
      title: row.title,
      ...(row.description === null ? {} : { description: row.description }),
      publisherAgentId: row.publisher_agent_id,
      ...(row.homepage === null ? {} : { homepage: row.homepage }),
      aliases: row.aliases_json,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    },
    `Failed to normalize catalog row for ${row.id}`
  );

const toCatalogUpsertRow = (
  catalog: Catalog,
  updatedBy: string
): CatalogUpsertRow => ({
  id: catalog.id,
  title: catalog.title,
  description: catalog.description ?? null,
  publisher_agent_id: catalog.publisherAgentId,
  homepage: catalog.homepage ?? null,
  aliases_json: catalog.aliases,
  created_at: catalog.createdAt,
  updated_at: catalog.updatedAt,
  updated_by: updatedBy,
  deleted_at: null
});

export const CatalogsRepoD1 = {
  layer: Layer.effect(CatalogsRepo, Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;

    const listCatalogRows = SqlSchema.findAll({
      Request: Schema.Void,
      Result: CatalogRowSchema,
      execute: () =>
        sql`
          SELECT
            id,
            title,
            description,
            publisher_agent_id,
            homepage,
            aliases_json,
            created_at,
            updated_at
          FROM catalogs
          WHERE deleted_at IS NULL
          ORDER BY id ASC
        `
    });

    const findCatalogRowByUri = SqlSchema.findOneOption({
      Request: Schema.String,
      Result: CatalogRowSchema,
      execute: (id) =>
        sql`
          SELECT
            id,
            title,
            description,
            publisher_agent_id,
            homepage,
            aliases_json,
            created_at,
            updated_at
          FROM catalogs
          WHERE id = ${id}
            AND deleted_at IS NULL
          LIMIT 1
        `
    });

    const upsertCatalogRow = SqlSchema.void({
      Request: CatalogUpsertRowSchema,
      execute: (row) =>
        sql`
          INSERT INTO catalogs ${sql.insert(row)}
          ON CONFLICT(id) DO UPDATE SET ${sql.update(row, ["id"])}
        `
    });

    const deleteCatalogRow = SqlSchema.void({
      Request: CatalogDeleteRowSchema,
      execute: ({ id, ...patch }) =>
        sql`
          UPDATE catalogs
          SET ${sql.update(patch)}
          WHERE id = ${id}
            AND deleted_at IS NULL
        `
    });

    const listAll = () =>
      withSchemaDbError(
        listCatalogRows(void 0),
        "Failed to decode catalogs"
      ).pipe(
        Effect.flatMap((rows) => Effect.forEach(rows, decodeCatalogRow))
      );

    const findByUri = (uri: string) =>
      withSchemaDbError(
        findCatalogRowByUri(uri),
        `Failed to decode catalog row for ${uri}`
      ).pipe(
        Effect.flatMap(
          Option.match({
            onNone: () => Effect.succeed(null),
            onSome: decodeCatalogRow
          })
        )
      );

    const save = (
      catalog: Catalog,
      updatedBy: string,
      operation: "insert" | "update"
    ) =>
      decodeWithDbError(
        CatalogSchema,
        catalog,
        `Invalid catalog ${operation} input for ${catalog.id}`
      ).pipe(
        Effect.flatMap((validated) =>
          Effect.gen(function* () {
            const before = yield* findByUri(validated.id);

            yield* withSchemaDbError(
              upsertCatalogRow(toCatalogUpsertRow(validated, updatedBy)),
              `Failed to persist catalog ${validated.id}`
            );

            yield* insertDataLayerAudit(sql, {
              entityId: validated.id,
              entityKind: "Catalog",
              operation,
              operator: updatedBy,
              beforeRow: before,
              afterRow: validated,
              timestamp: validated.updatedAt
            });
          })
        )
      );

    const insert = (catalog: Catalog, { updatedBy }: { readonly updatedBy: string }) =>
      save(catalog, updatedBy, "insert");

    const update = (catalog: Catalog, { updatedBy }: { readonly updatedBy: string }) =>
      save(catalog, updatedBy, "update");

    const deleteByUri = (uri: string, deletedAt: string, updatedBy: string) =>
      Effect.gen(function* () {
        const before = yield* findByUri(uri);

        yield* withSchemaDbError(
          deleteCatalogRow({
            id: uri,
            updated_at: deletedAt,
            updated_by: updatedBy,
            deleted_at: deletedAt
          }),
          `Failed to delete catalog ${uri}`
        );

        if (before !== null) {
          yield* insertDataLayerAudit(sql, {
            entityId: uri,
            entityKind: "Catalog",
            operation: "delete",
            operator: updatedBy,
            beforeRow: before,
            afterRow: null,
            timestamp: deletedAt
          });
        }
      });

    return CatalogsRepo.of({
      listAll,
      findByUri,
      insert,
      update,
      delete: deleteByUri
    });
  }))
};
