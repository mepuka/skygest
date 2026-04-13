import { Effect, Layer, Schema } from "effect";
import { SqlClient } from "effect/unstable/sql";
import type { DbError } from "../../domain/errors";
import {
  AssertedTime,
  ResolutionState
} from "../../domain/data-layer/candidate";
import {
  AssertedValue,
  DataRefCitationKey,
  DataRefCitationSource,
  FindCandidatesByDataRefHit as FindCandidatesByDataRefHitSchema
} from "../../domain/data-layer/query";
import { Did, PostUri } from "../../domain/types";
import {
  DataRefCandidateReadRepo,
  type DataRefCandidateReadRow,
  type ListDataRefCandidateRowsRepoInput
} from "../DataRefCandidateReadRepo";
import { decodeJsonColumnWithDbError } from "./jsonColumns";
import { decodeWithDbError } from "./schemaDecode";
import { stripUndefined } from "../../platform/Json";

const isDefined = <A>(value: A | null): value is A => value !== null;

const RawDataRefCandidateRowSchema = Schema.Struct({
  citationKey: DataRefCitationKey,
  sourcePostUri: PostUri,
  did: Did,
  handle: Schema.NullOr(Schema.String),
  displayName: Schema.NullOr(Schema.String),
  citationSource: DataRefCitationSource,
  resolutionState: ResolutionState,
  assertedValueJson: Schema.NullOr(Schema.String),
  assertedUnit: Schema.NullOr(Schema.String),
  observationStart: Schema.NullOr(Schema.String),
  observationEnd: Schema.NullOr(Schema.String),
  observationLabel: Schema.NullOr(Schema.String),
  hasObservationTime: Schema.Number,
  observationSortKey: Schema.String
});
const RawDataRefCandidateRowsSchema = Schema.Array(RawDataRefCandidateRowSchema);
type RawDataRefCandidateRow = Schema.Schema.Type<typeof RawDataRefCandidateRowSchema>;

const toReadRow = (
  row: RawDataRefCandidateRow
): Effect.Effect<DataRefCandidateReadRow, DbError> =>
  Effect.gen(function* () {
    const assertedValue = yield* decodeJsonColumnWithDbError(
      row.assertedValueJson,
      `asserted value for ${row.sourcePostUri}`
    ).pipe(
      Effect.flatMap((decoded) =>
        decodeWithDbError(
          AssertedValue,
          decoded,
          `Failed to normalize asserted value for ${row.sourcePostUri}`
        )
      )
    );

    const observationTime =
      row.hasObservationTime === 0
        ? null
        : yield* decodeWithDbError(
            AssertedTime,
            stripUndefined({
              start: row.observationStart ?? undefined,
              end: row.observationEnd ?? undefined,
              label: row.observationLabel ?? undefined
            }),
            `Failed to normalize observation time for ${row.sourcePostUri}`
          );

    return {
      cursor: {
        hasObservationTime: row.hasObservationTime > 0,
        observationSortKey: row.observationSortKey,
        sourcePostUri: row.sourcePostUri,
        citationKey: row.citationKey
      },
      hit: yield* decodeWithDbError(
        FindCandidatesByDataRefHitSchema,
        {
          sourcePostUri: row.sourcePostUri,
          expert: {
            did: row.did,
            handle: row.handle,
            displayName: row.displayName
          },
          citationSource: row.citationSource,
          resolutionState: row.resolutionState,
          assertedValue,
          assertedUnit: row.assertedUnit,
          observationTime
        },
        `Failed to normalize data-ref candidate row for ${row.sourcePostUri}`
      )
    };
  });

export const DataRefCandidateReadRepoD1 = {
  layer: Layer.effect(DataRefCandidateReadRepo, Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;

    const listByEntityId = (input: ListDataRefCandidateRowsRepoInput) => {
      const observedSince = input.observedSince ?? undefined;
      const observedUntil = input.observedUntil ?? undefined;
      const conditions = [
        sql`c.entity_id = ${input.entityId}`,
        sql`p.status = 'active'`,
        observedSince === undefined
          ? null
          : sql`c.has_observation_time = 1`,
        observedUntil === undefined
          ? null
          : sql`c.has_observation_time = 1`,
        observedSince === undefined
          ? null
          : sql`c.normalized_observation_end >= ${observedSince}`,
        observedUntil === undefined
          ? null
          : sql`c.normalized_observation_start <= ${observedUntil}`,
        input.cursor === undefined
          ? null
          : sql`(
              c.has_observation_time < ${input.cursor.hasObservationTime ? 1 : 0}
              OR (
                c.has_observation_time = ${input.cursor.hasObservationTime ? 1 : 0}
                AND c.observation_sort_key < ${input.cursor.observationSortKey}
              )
              OR (
                c.has_observation_time = ${input.cursor.hasObservationTime ? 1 : 0}
                AND c.observation_sort_key = ${input.cursor.observationSortKey}
                AND c.source_post_uri > ${input.cursor.sourcePostUri}
              )
              OR (
                c.has_observation_time = ${input.cursor.hasObservationTime ? 1 : 0}
                AND c.observation_sort_key = ${input.cursor.observationSortKey}
                AND c.source_post_uri = ${input.cursor.sourcePostUri}
                AND c.citation_key > ${input.cursor.citationKey}
              )
            )`
      ].filter(isDefined);

      return sql`
        SELECT
          c.citation_key as citationKey,
          c.source_post_uri as sourcePostUri,
          p.did as did,
          e.handle as handle,
          e.display_name as displayName,
          c.citation_source as citationSource,
          c.resolution_state as resolutionState,
          c.asserted_value_json as assertedValueJson,
          c.asserted_unit as assertedUnit,
          c.observation_start as observationStart,
          c.observation_end as observationEnd,
          c.observation_label as observationLabel,
          c.has_observation_time as hasObservationTime,
          c.observation_sort_key as observationSortKey
        FROM data_ref_candidate_citations c
        JOIN posts p ON p.uri = c.source_post_uri
        LEFT JOIN experts e ON e.did = p.did
        WHERE ${sql.join(" AND ", false)(conditions)}
        ORDER BY
          c.has_observation_time DESC,
          c.observation_sort_key DESC,
          c.source_post_uri ASC,
          c.citation_key ASC
        LIMIT ${input.limit}
      `.pipe(
        Effect.flatMap((rows) =>
          decodeWithDbError(
            RawDataRefCandidateRowsSchema,
            rows,
            `Failed to decode data-ref candidate rows for ${input.entityId}`
          )
        ),
        Effect.flatMap((rows) => Effect.forEach(rows, toReadRow))
      );
    };

    return DataRefCandidateReadRepo.of({
      listByEntityId
    });
  }))
};
