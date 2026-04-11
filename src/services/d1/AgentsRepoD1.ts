import { Effect, Layer, Option, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/unstable/sql";
import {
  Agent as AgentSchema,
  AgentKind,
  Aliases,
  type Agent
} from "../../domain/data-layer";
import { normalizeDistributionHostname } from "../../resolution/normalize";
import { AgentsRepo } from "../AgentsRepo";
import { decodeWithDbError, withSchemaDbError } from "./schemaDecode";
import {
  insertDataLayerAudit,
  matchesHostname,
  matchesLookupText
} from "./dataLayerHelpers";

const StringArrayJson = Schema.fromJsonString(Schema.Array(Schema.String));

const AgentRowSchema = Schema.Struct({
  id: Schema.String,
  kind: AgentKind,
  name: Schema.String,
  alternate_names_json: Schema.NullOr(StringArrayJson),
  homepage: Schema.NullOr(Schema.String),
  parent_agent_id: Schema.NullOr(Schema.String),
  aliases_json: Schema.fromJsonString(Aliases),
  created_at: Schema.String,
  updated_at: Schema.String
});
type AgentRow = Schema.Schema.Type<typeof AgentRowSchema>;

const AgentUpsertRowSchema = Schema.Struct({
  id: Schema.String,
  kind: AgentKind,
  name: Schema.String,
  alternate_names_json: Schema.NullOr(StringArrayJson),
  homepage: Schema.NullOr(Schema.String),
  homepage_domain: Schema.NullOr(Schema.String),
  parent_agent_id: Schema.NullOr(Schema.String),
  aliases_json: Schema.fromJsonString(Aliases),
  created_at: Schema.String,
  updated_at: Schema.String,
  updated_by: Schema.String,
  deleted_at: Schema.Null
});
type AgentUpsertRow = Schema.Schema.Type<typeof AgentUpsertRowSchema>;

const AgentDeleteRowSchema = Schema.Struct({
  id: Schema.String,
  updated_at: Schema.String,
  updated_by: Schema.String,
  deleted_at: Schema.String
});

const decodeAgentRow = (row: AgentRow) =>
  decodeWithDbError(
    AgentSchema,
    {
      _tag: "Agent",
      id: row.id,
      kind: row.kind,
      name: row.name,
      ...(row.alternate_names_json === null
        ? {}
        : { alternateNames: row.alternate_names_json }),
      ...(row.homepage === null ? {} : { homepage: row.homepage }),
      ...(row.parent_agent_id === null
        ? {}
        : { parentAgentId: row.parent_agent_id }),
      aliases: row.aliases_json,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    },
    `Failed to normalize agent row for ${row.id}`
  );

const toAgentUpsertRow = (
  agent: Agent,
  updatedBy: string
): AgentUpsertRow => ({
  id: agent.id,
  kind: agent.kind,
  name: agent.name,
  alternate_names_json: agent.alternateNames ?? null,
  homepage: agent.homepage ?? null,
  homepage_domain: agent.homepage === undefined
    ? null
    : normalizeDistributionHostname(agent.homepage),
  parent_agent_id: agent.parentAgentId ?? null,
  aliases_json: agent.aliases,
  created_at: agent.createdAt,
  updated_at: agent.updatedAt,
  updated_by: updatedBy,
  deleted_at: null
});

export const AgentsRepoD1 = {
  layer: Layer.effect(AgentsRepo, Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;

    const listAgentRows = SqlSchema.findAll({
      Request: Schema.Void,
      Result: AgentRowSchema,
      execute: () =>
        sql`
          SELECT
            id,
            kind,
            name,
            alternate_names_json,
            homepage,
            parent_agent_id,
            aliases_json,
            created_at,
            updated_at
          FROM agents
          WHERE deleted_at IS NULL
          ORDER BY id ASC
        `
    });

    const findAgentRowByUri = SqlSchema.findOneOption({
      Request: Schema.String,
      Result: AgentRowSchema,
      execute: (id) =>
        sql`
          SELECT
            id,
            kind,
            name,
            alternate_names_json,
            homepage,
            parent_agent_id,
            aliases_json,
            created_at,
            updated_at
          FROM agents
          WHERE id = ${id}
            AND deleted_at IS NULL
          LIMIT 1
        `
    });

    const upsertAgentRow = SqlSchema.void({
      Request: AgentUpsertRowSchema,
      execute: (row) =>
        sql`
          INSERT INTO agents ${sql.insert(row)}
          ON CONFLICT(id) DO UPDATE SET ${sql.update(row, ["id"])}
        `
    });

    const deleteAgentRow = SqlSchema.void({
      Request: AgentDeleteRowSchema,
      execute: ({ id, ...patch }) =>
        sql`
          UPDATE agents
          SET ${sql.update(patch)}
          WHERE id = ${id}
            AND deleted_at IS NULL
        `
    });

    const listAll = () =>
      withSchemaDbError(listAgentRows(void 0), "Failed to decode agents").pipe(
        Effect.flatMap((rows) => Effect.forEach(rows, decodeAgentRow))
      );

    const findByUri = (uri: string) =>
      withSchemaDbError(
        findAgentRowByUri(uri),
        `Failed to decode agent row for ${uri}`
      ).pipe(
        Effect.flatMap(
          Option.match({
            onNone: () => Effect.succeed(null),
            onSome: decodeAgentRow
          })
        )
      );

    const save = (
      agent: Agent,
      updatedBy: string,
      operation: "insert" | "update"
    ) =>
      decodeWithDbError(
        AgentSchema,
        agent,
        `Invalid agent ${operation} input for ${agent.id}`
      ).pipe(
        Effect.flatMap((validated) =>
          sql.withTransaction(
            Effect.gen(function* () {
              const before = yield* findByUri(validated.id);

              yield* withSchemaDbError(
                upsertAgentRow(toAgentUpsertRow(validated, updatedBy)),
                `Failed to persist agent ${validated.id}`
              );

              yield* insertDataLayerAudit(sql, {
                entityId: validated.id,
                entityKind: "Agent",
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

    const insert = (agent: Agent, { updatedBy }: { readonly updatedBy: string }) =>
      save(agent, updatedBy, "insert");

    const update = (agent: Agent, { updatedBy }: { readonly updatedBy: string }) =>
      save(agent, updatedBy, "update");

    const deleteByUri = (uri: string, deletedAt: string, updatedBy: string) =>
      sql.withTransaction(
        Effect.gen(function* () {
          const before = yield* findByUri(uri);

          yield* withSchemaDbError(
            deleteAgentRow({
              id: uri,
              updated_at: deletedAt,
              updated_by: updatedBy,
              deleted_at: deletedAt
            }),
            `Failed to delete agent ${uri}`
          );

          if (before !== null) {
            yield* insertDataLayerAudit(sql, {
              entityId: uri,
              entityKind: "Agent",
              operation: "delete",
              operator: updatedBy,
              beforeRow: before,
              afterRow: null,
              timestamp: deletedAt
            });
          }
        })
      );

    const findByLabel = (label: string) =>
      listAll().pipe(
        Effect.map(
          (items) =>
            items.find(
              (item) =>
                matchesLookupText(item.name, label) ||
                (item.alternateNames ?? []).some((name) =>
                  matchesLookupText(name, label)
                )
            ) ?? null
        )
      );

    const findByHomepageDomain = (domain: string) =>
      listAll().pipe(
        Effect.map(
          (items) =>
            items.find((item) => matchesHostname(item.homepage, domain)) ?? null
        )
      );

    return AgentsRepo.of({
      listAll,
      findByUri,
      insert,
      update,
      delete: deleteByUri,
      findByLabel,
      findByHomepageDomain
    });
  }))
};
