import { Effect, Layer, Option, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/unstable/sql";
import {
  AccessRights,
  Aliases,
  DataService as DataServiceSchema,
  DatasetId,
  type DataService
} from "../../domain/data-layer";
import { DataServicesRepo } from "../DataServicesRepo";
import { decodeWithDbError, withSchemaDbError } from "./schemaDecode";
import { insertDataLayerAudit } from "./dataLayerHelpers";

const WebUrlArrayJson = Schema.fromJsonString(Schema.Array(Schema.String));
const DatasetIdArrayJson = Schema.fromJsonString(Schema.Array(DatasetId));

const DataServiceRowSchema = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  description: Schema.NullOr(Schema.String),
  publisher_agent_id: Schema.NullOr(Schema.String),
  endpoint_urls_json: WebUrlArrayJson,
  endpoint_description: Schema.NullOr(Schema.String),
  conforms_to: Schema.NullOr(Schema.String),
  serves_dataset_ids_json: DatasetIdArrayJson,
  access_rights: Schema.NullOr(AccessRights),
  license: Schema.NullOr(Schema.String),
  aliases_json: Schema.fromJsonString(Aliases),
  created_at: Schema.String,
  updated_at: Schema.String
});
type DataServiceRow = Schema.Schema.Type<typeof DataServiceRowSchema>;

const DataServiceUpsertRowSchema = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  description: Schema.NullOr(Schema.String),
  publisher_agent_id: Schema.NullOr(Schema.String),
  endpoint_urls_json: WebUrlArrayJson,
  endpoint_description: Schema.NullOr(Schema.String),
  conforms_to: Schema.NullOr(Schema.String),
  serves_dataset_ids_json: DatasetIdArrayJson,
  access_rights: Schema.NullOr(AccessRights),
  license: Schema.NullOr(Schema.String),
  aliases_json: Schema.fromJsonString(Aliases),
  created_at: Schema.String,
  updated_at: Schema.String,
  updated_by: Schema.String,
  deleted_at: Schema.Null
});
type DataServiceUpsertRow = Schema.Schema.Type<typeof DataServiceUpsertRowSchema>;

const DataServiceDeleteRowSchema = Schema.Struct({
  id: Schema.String,
  updated_at: Schema.String,
  updated_by: Schema.String,
  deleted_at: Schema.String
});

const decodeDataServiceRow = (row: DataServiceRow) =>
  decodeWithDbError(
    DataServiceSchema,
    {
      _tag: "DataService",
      id: row.id,
      title: row.title,
      ...(row.description === null ? {} : { description: row.description }),
      ...(row.publisher_agent_id === null
        ? {}
        : { publisherAgentId: row.publisher_agent_id }),
      endpointURLs: row.endpoint_urls_json,
      ...(row.endpoint_description === null
        ? {}
        : { endpointDescription: row.endpoint_description }),
      ...(row.conforms_to === null ? {} : { conformsTo: row.conforms_to }),
      servesDatasetIds: row.serves_dataset_ids_json,
      ...(row.access_rights === null ? {} : { accessRights: row.access_rights }),
      ...(row.license === null ? {} : { license: row.license }),
      aliases: row.aliases_json,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    },
    `Failed to normalize data service row for ${row.id}`
  );

const toDataServiceUpsertRow = (
  service: DataService,
  updatedBy: string
): DataServiceUpsertRow => ({
  id: service.id,
  title: service.title,
  description: service.description ?? null,
  publisher_agent_id: service.publisherAgentId ?? null,
  endpoint_urls_json: service.endpointURLs,
  endpoint_description: service.endpointDescription ?? null,
  conforms_to: service.conformsTo ?? null,
  serves_dataset_ids_json: service.servesDatasetIds,
  access_rights: service.accessRights ?? null,
  license: service.license ?? null,
  aliases_json: service.aliases,
  created_at: service.createdAt,
  updated_at: service.updatedAt,
  updated_by: updatedBy,
  deleted_at: null
});

export const DataServicesRepoD1 = {
  layer: Layer.effect(DataServicesRepo, Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;

    const listDataServiceRows = SqlSchema.findAll({
      Request: Schema.Void,
      Result: DataServiceRowSchema,
      execute: () =>
        sql`
          SELECT
            id,
            title,
            description,
            publisher_agent_id,
            endpoint_urls_json,
            endpoint_description,
            conforms_to,
            serves_dataset_ids_json,
            access_rights,
            license,
            aliases_json,
            created_at,
            updated_at
          FROM data_services
          WHERE deleted_at IS NULL
          ORDER BY id ASC
        `
    });

    const findDataServiceRowByUri = SqlSchema.findOneOption({
      Request: Schema.String,
      Result: DataServiceRowSchema,
      execute: (id) =>
        sql`
          SELECT
            id,
            title,
            description,
            publisher_agent_id,
            endpoint_urls_json,
            endpoint_description,
            conforms_to,
            serves_dataset_ids_json,
            access_rights,
            license,
            aliases_json,
            created_at,
            updated_at
          FROM data_services
          WHERE id = ${id}
            AND deleted_at IS NULL
          LIMIT 1
        `
    });

    const upsertDataServiceRow = SqlSchema.void({
      Request: DataServiceUpsertRowSchema,
      execute: (row) =>
        sql`
          INSERT INTO data_services ${sql.insert(row)}
          ON CONFLICT(id) DO UPDATE SET ${sql.update(row, ["id"])}
        `
    });

    const deleteDataServiceRow = SqlSchema.void({
      Request: DataServiceDeleteRowSchema,
      execute: ({ id, ...patch }) =>
        sql`
          UPDATE data_services
          SET ${sql.update(patch)}
          WHERE id = ${id}
            AND deleted_at IS NULL
        `
    });

    const listAll = () =>
      withSchemaDbError(
        listDataServiceRows(void 0),
        "Failed to decode data services"
      ).pipe(
        Effect.flatMap((rows) => Effect.forEach(rows, decodeDataServiceRow))
      );

    const findByUri = (uri: string) =>
      withSchemaDbError(
        findDataServiceRowByUri(uri),
        `Failed to decode data service row for ${uri}`
      ).pipe(
        Effect.flatMap(
          Option.match({
            onNone: () => Effect.succeed(null),
            onSome: decodeDataServiceRow
          })
        )
      );

    const save = (
      service: DataService,
      updatedBy: string,
      operation: "insert" | "update"
    ) =>
      decodeWithDbError(
        DataServiceSchema,
        service,
        `Invalid data service ${operation} input for ${service.id}`
      ).pipe(
        Effect.flatMap((validated) =>
          Effect.gen(function* () {
            const before = yield* findByUri(validated.id);

            yield* withSchemaDbError(
              upsertDataServiceRow(toDataServiceUpsertRow(validated, updatedBy)),
              `Failed to persist data service ${validated.id}`
            );

            yield* insertDataLayerAudit(sql, {
              entityId: validated.id,
              entityKind: "DataService",
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
      service: DataService,
      { updatedBy }: { readonly updatedBy: string }
    ) => save(service, updatedBy, "insert");

    const update = (
      service: DataService,
      { updatedBy }: { readonly updatedBy: string }
    ) => save(service, updatedBy, "update");

    const deleteByUri = (uri: string, deletedAt: string, updatedBy: string) =>
      Effect.gen(function* () {
        const before = yield* findByUri(uri);

        yield* withSchemaDbError(
          deleteDataServiceRow({
            id: uri,
            updated_at: deletedAt,
            updated_by: updatedBy,
            deleted_at: deletedAt
          }),
          `Failed to delete data service ${uri}`
        );

        if (before !== null) {
          yield* insertDataLayerAudit(sql, {
            entityId: uri,
            entityKind: "DataService",
            operation: "delete",
            operator: updatedBy,
            beforeRow: before,
            afterRow: null,
            timestamp: deletedAt
          });
        }
      });

    return DataServicesRepo.of({
      listAll,
      findByUri,
      insert,
      update,
      delete: deleteByUri
    });
  }))
};
