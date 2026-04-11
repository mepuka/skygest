import { Effect, Schema } from "effect";
import { SqlClient } from "effect/unstable/sql";
import { SqlError } from "effect/unstable/sql/SqlError";
import type {
  AliasScheme,
  DataLayerRegistryEntity,
  ExternalIdentifier
} from "../../domain/data-layer";
import type { DbError } from "../../domain/errors";
import {
  normalizeAliasLookupValue,
  normalizeDistributionHostname,
  normalizeLookupText
} from "../../resolution/normalize";
import { encodeJsonColumnWithDbError } from "./jsonColumns";

export const BooleanInt = Schema.Union([Schema.Literal(0), Schema.Literal(1)]);

export const resolveWriteTimestamp = (
  timestamp: string | undefined,
  fallback: string
) => timestamp ?? fallback;

export const matchesAlias = (
  aliases: ReadonlyArray<ExternalIdentifier>,
  scheme: AliasScheme,
  value: string
) => {
  const normalized = normalizeAliasLookupValue(scheme, value);
  return aliases.some(
    (alias) =>
      alias.scheme === scheme &&
      normalizeAliasLookupValue(alias.scheme, alias.value) === normalized
  );
};

export const matchesLookupText = (left: string, right: string) =>
  normalizeLookupText(left) === normalizeLookupText(right);

export const matchesHostname = (candidate: string | undefined, domain: string) =>
  candidate !== undefined &&
  normalizeDistributionHostname(candidate) === normalizeDistributionHostname(domain);

type DataLayerAuditInsert = {
  readonly entityId: string;
  readonly entityKind: DataLayerRegistryEntity["_tag"];
  readonly operation: "insert" | "update" | "delete";
  readonly operator: string;
  readonly beforeRow: DataLayerRegistryEntity | null;
  readonly afterRow: DataLayerRegistryEntity | null;
  readonly timestamp: string;
};

export const insertDataLayerAudit = (
  sql: SqlClient.SqlClient,
  entry: DataLayerAuditInsert
): Effect.Effect<void, DbError | SqlError> =>
  Effect.all({
    beforeRow: encodeJsonColumnWithDbError(entry.beforeRow, "data layer audit before_row"),
    afterRow: encodeJsonColumnWithDbError(entry.afterRow, "data layer audit after_row")
  }).pipe(
    Effect.flatMap(({ beforeRow, afterRow }) =>
      sql`
        INSERT INTO data_layer_audit (
          entity_id,
          entity_kind,
          operation,
          operator,
          before_row,
          after_row,
          timestamp
        ) VALUES (
          ${entry.entityId},
          ${entry.entityKind},
          ${entry.operation},
          ${entry.operator},
          ${beforeRow},
          ${afterRow},
          ${entry.timestamp}
        )
      `.pipe(Effect.asVoid)
    )
  );
