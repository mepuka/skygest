import { Effect, Layer, Option, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/unstable/sql";
import {
  Aggregation,
  Aliases,
  StatisticType,
  UnitFamily,
  Variable as VariableSchema,
  type AliasScheme,
  type Variable
} from "../../domain/data-layer";
import { VariablesRepo } from "../VariablesRepo";
import { decodeWithDbError, withSchemaDbError } from "./schemaDecode";
import {
  insertDataLayerAudit,
  matchesAlias
} from "./dataLayerHelpers";

const VariableRowSchema = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
  definition: Schema.NullOr(Schema.String),
  measured_property: Schema.NullOr(Schema.String),
  domain_object: Schema.NullOr(Schema.String),
  technology_or_fuel: Schema.NullOr(Schema.String),
  statistic_type: Schema.NullOr(StatisticType),
  aggregation: Schema.NullOr(Aggregation),
  unit_family: Schema.NullOr(UnitFamily),
  policy_instrument: Schema.NullOr(Schema.String),
  aliases_json: Schema.fromJsonString(Aliases),
  created_at: Schema.String,
  updated_at: Schema.String
});
type VariableRow = Schema.Schema.Type<typeof VariableRowSchema>;

const VariableFacetsSchema = Schema.Struct({
  measuredProperty: Schema.NullOr(Schema.String),
  domainObject: Schema.NullOr(Schema.String),
  technologyOrFuel: Schema.NullOr(Schema.String),
  statisticType: Schema.NullOr(StatisticType),
  aggregation: Schema.NullOr(Aggregation),
  unitFamily: Schema.NullOr(UnitFamily),
  policyInstrument: Schema.NullOr(Schema.String)
});

const VariableUpsertRowSchema = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
  definition: Schema.NullOr(Schema.String),
  measured_property: Schema.NullOr(Schema.String),
  domain_object: Schema.NullOr(Schema.String),
  technology_or_fuel: Schema.NullOr(Schema.String),
  statistic_type: Schema.NullOr(StatisticType),
  aggregation: Schema.NullOr(Aggregation),
  unit_family: Schema.NullOr(UnitFamily),
  policy_instrument: Schema.NullOr(Schema.String),
  aliases_json: Schema.fromJsonString(Aliases),
  facets_json: Schema.fromJsonString(VariableFacetsSchema),
  created_at: Schema.String,
  updated_at: Schema.String,
  updated_by: Schema.String,
  deleted_at: Schema.Null
});
type VariableUpsertRow = Schema.Schema.Type<typeof VariableUpsertRowSchema>;

const VariableDeleteRowSchema = Schema.Struct({
  id: Schema.String,
  updated_at: Schema.String,
  updated_by: Schema.String,
  deleted_at: Schema.String
});

const decodeVariableRow = (row: VariableRow) =>
  decodeWithDbError(
    VariableSchema,
    {
      _tag: "Variable",
      id: row.id,
      label: row.label,
      ...(row.definition === null ? {} : { definition: row.definition }),
      ...(row.measured_property === null
        ? {}
        : { measuredProperty: row.measured_property }),
      ...(row.domain_object === null ? {} : { domainObject: row.domain_object }),
      ...(row.technology_or_fuel === null
        ? {}
        : { technologyOrFuel: row.technology_or_fuel }),
      ...(row.statistic_type === null ? {} : { statisticType: row.statistic_type }),
      ...(row.aggregation === null ? {} : { aggregation: row.aggregation }),
      ...(row.unit_family === null ? {} : { unitFamily: row.unit_family }),
      ...(row.policy_instrument === null
        ? {}
        : { policyInstrument: row.policy_instrument }),
      aliases: row.aliases_json,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    },
    `Failed to normalize variable row for ${row.id}`
  );

const toVariableUpsertRow = (
  variable: Variable,
  updatedBy: string
): VariableUpsertRow => ({
  id: variable.id,
  label: variable.label,
  definition: variable.definition ?? null,
  measured_property: variable.measuredProperty ?? null,
  domain_object: variable.domainObject ?? null,
  technology_or_fuel: variable.technologyOrFuel ?? null,
  statistic_type: variable.statisticType ?? null,
  aggregation: variable.aggregation ?? null,
  unit_family: variable.unitFamily ?? null,
  policy_instrument: variable.policyInstrument ?? null,
  aliases_json: variable.aliases,
  facets_json: {
    measuredProperty: variable.measuredProperty ?? null,
    domainObject: variable.domainObject ?? null,
    technologyOrFuel: variable.technologyOrFuel ?? null,
    statisticType: variable.statisticType ?? null,
    aggregation: variable.aggregation ?? null,
    unitFamily: variable.unitFamily ?? null,
    policyInstrument: variable.policyInstrument ?? null
  },
  created_at: variable.createdAt,
  updated_at: variable.updatedAt,
  updated_by: updatedBy,
  deleted_at: null
});

export const VariablesRepoD1 = {
  layer: Layer.effect(VariablesRepo, Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;

    const listVariableRows = SqlSchema.findAll({
      Request: Schema.Void,
      Result: VariableRowSchema,
      execute: () =>
        sql`
          SELECT
            id,
            label,
            definition,
            measured_property,
            domain_object,
            technology_or_fuel,
            statistic_type,
            aggregation,
            unit_family,
            policy_instrument,
            aliases_json,
            created_at,
            updated_at
          FROM variables
          WHERE deleted_at IS NULL
          ORDER BY id ASC
        `
    });

    const findVariableRowByUri = SqlSchema.findOneOption({
      Request: Schema.String,
      Result: VariableRowSchema,
      execute: (id) =>
        sql`
          SELECT
            id,
            label,
            definition,
            measured_property,
            domain_object,
            technology_or_fuel,
            statistic_type,
            aggregation,
            unit_family,
            policy_instrument,
            aliases_json,
            created_at,
            updated_at
          FROM variables
          WHERE id = ${id}
            AND deleted_at IS NULL
          LIMIT 1
        `
    });

    const upsertVariableRow = SqlSchema.void({
      Request: VariableUpsertRowSchema,
      execute: (row) =>
        sql`
          INSERT INTO variables ${sql.insert(row)}
          ON CONFLICT(id) DO UPDATE SET ${sql.update(row, ["id"])}
        `
    });

    const deleteVariableRow = SqlSchema.void({
      Request: VariableDeleteRowSchema,
      execute: ({ id, ...patch }) =>
        sql`
          UPDATE variables
          SET ${sql.update(patch)}
          WHERE id = ${id}
            AND deleted_at IS NULL
        `
    });

    const listAll = () =>
      withSchemaDbError(
        listVariableRows(void 0),
        "Failed to decode variables"
      ).pipe(
        Effect.flatMap((rows) => Effect.forEach(rows, decodeVariableRow))
      );

    const findByUri = (uri: string) =>
      withSchemaDbError(
        findVariableRowByUri(uri),
        `Failed to decode variable row for ${uri}`
      ).pipe(
        Effect.flatMap(
          Option.match({
            onNone: () => Effect.succeed(null),
            onSome: decodeVariableRow
          })
        )
      );

    const save = (
      variable: Variable,
      updatedBy: string,
      operation: "insert" | "update"
    ) =>
      decodeWithDbError(
        VariableSchema,
        variable,
        `Invalid variable ${operation} input for ${variable.id}`
      ).pipe(
        Effect.flatMap((validated) =>
          sql.withTransaction(
            Effect.gen(function* () {
              const before = yield* findByUri(validated.id);

              yield* withSchemaDbError(
                upsertVariableRow(toVariableUpsertRow(validated, updatedBy)),
                `Failed to persist variable ${validated.id}`
              );

              yield* insertDataLayerAudit(sql, {
                entityId: validated.id,
                entityKind: "Variable",
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

    const insert = (variable: Variable, { updatedBy }: { readonly updatedBy: string }) =>
      save(variable, updatedBy, "insert");

    const update = (variable: Variable, { updatedBy }: { readonly updatedBy: string }) =>
      save(variable, updatedBy, "update");

    const deleteByUri = (uri: string, deletedAt: string, updatedBy: string) =>
      sql.withTransaction(
        Effect.gen(function* () {
          const before = yield* findByUri(uri);

          yield* withSchemaDbError(
            deleteVariableRow({
              id: uri,
              updated_at: deletedAt,
              updated_by: updatedBy,
              deleted_at: deletedAt
            }),
            `Failed to delete variable ${uri}`
          );

          if (before !== null) {
            yield* insertDataLayerAudit(sql, {
              entityId: uri,
              entityKind: "Variable",
              operation: "delete",
              operator: updatedBy,
              beforeRow: before,
              afterRow: null,
              timestamp: deletedAt
            });
          }
        })
      );

    const findByAlias = (scheme: AliasScheme, value: string) =>
      listAll().pipe(
        Effect.map(
          (items) => items.find((item) => matchesAlias(item.aliases, scheme, value)) ?? null
        )
      );

    return VariablesRepo.of({
      listAll,
      findByUri,
      insert,
      update,
      delete: deleteByUri,
      findByAlias
    });
  }))
};
