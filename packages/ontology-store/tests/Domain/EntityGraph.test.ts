import { SqliteClient } from "@effect/sql-sqlite-node";
import { describe, expect, it } from "@effect/vitest";
import { Effect, Exit, Layer } from "effect";
import { SqlClient } from "effect/unstable/sql";

import {
  ENTITY_GRAPH_ALL_SCHEMA_STATEMENTS,
  PREDICATES,
  REINDEX_QUEUE_UPSERT_SET_CLAUSE
} from "../../src";

const sqliteLayer = SqliteClient.layer({ filename: ":memory:" });

const installSchema = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`${sql.unsafe("PRAGMA foreign_keys = ON")}`.pipe(Effect.asVoid);
  yield* Effect.forEach(
    ENTITY_GRAPH_ALL_SCHEMA_STATEMENTS,
    (statement) => sql`${sql.unsafe(statement)}`.pipe(Effect.asVoid),
    { discard: true }
  );
});

const testLayer = Layer.mergeAll(sqliteLayer);

const insertEntity = (
  sql: SqlClient.SqlClient,
  iri: string,
  entityType: string
) =>
  sql`
    INSERT INTO entities (iri, entity_type, created_at, updated_at)
    VALUES (${iri}, ${entityType}, 1, 1)
  `.pipe(Effect.asVoid);

const insertLink = (
  sql: SqlClient.SqlClient,
  input: {
    readonly linkId: string;
    readonly tripleHash: string;
    readonly subjectIri: string;
    readonly subjectType: string;
    readonly objectIri: string;
    readonly objectType: string;
    readonly state?: string;
    readonly supersededBy?: string | null;
  }
) =>
  sql`
    INSERT INTO entity_links (
      link_id,
      triple_hash,
      subject_iri,
      predicate_iri,
      object_iri,
      object_value,
      object_datatype,
      graph_iri,
      subject_type,
      object_type,
      state,
      effective_from,
      effective_until,
      superseded_by,
      created_at,
      updated_at
    ) VALUES (
      ${input.linkId},
      ${input.tripleHash},
      ${input.subjectIri},
      ${PREDICATES["ei:affiliatedWith"].iri},
      ${input.objectIri},
      NULL,
      NULL,
      'urn:skygest:graph:default',
      ${input.subjectType},
      ${input.objectType},
      ${input.state ?? "active"},
      1,
      NULL,
      ${input.supersededBy ?? null},
      1,
      1
    )
  `.pipe(Effect.asVoid);

describe("entity graph schema", () => {
  it.effect("rejects links whose endpoints are not in the entity registry", () =>
    Effect.gen(function* () {
      yield* installSchema;
      const sql = yield* SqlClient.SqlClient;
      yield* insertEntity(
        sql,
        "https://w3id.org/energy-intel/expert/MarkZJacobson",
        "Expert"
      );

      const exit = yield* Effect.exit(
        insertLink(sql, {
          linkId: "link-1",
          tripleHash: "triple-1",
          subjectIri: "https://w3id.org/energy-intel/expert/MarkZJacobson",
          subjectType: "Expert",
          objectIri: "https://w3id.org/energy-intel/organization/Missing",
          objectType: "Organization"
        })
      );

      expect(Exit.isFailure(exit)).toBe(true);
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("allows supersession history for the same triple hash", () =>
    Effect.gen(function* () {
      yield* installSchema;
      const sql = yield* SqlClient.SqlClient;
      const expertIri = "https://w3id.org/energy-intel/expert/MarkZJacobson";
      const orgIri = "https://w3id.org/energy-intel/organization/Stanford";
      yield* insertEntity(sql, expertIri, "Expert");
      yield* insertEntity(sql, orgIri, "Organization");
      yield* insertLink(sql, {
        linkId: "old",
        tripleHash: "same-triple",
        subjectIri: expertIri,
        subjectType: "Expert",
        objectIri: orgIri,
        objectType: "Organization"
      });
      yield* insertLink(sql, {
        linkId: "new",
        tripleHash: "same-triple",
        subjectIri: expertIri,
        subjectType: "Expert",
        objectIri: orgIri,
        objectType: "Organization",
        state: "draft"
      });
      yield* sql`
        UPDATE entity_links
        SET state = 'superseded', effective_until = 2, superseded_by = 'new'
        WHERE link_id = 'old'
      `.pipe(Effect.asVoid);
      yield* sql`
        UPDATE entity_links
        SET state = 'active', updated_at = 2
        WHERE link_id = 'new'
      `.pipe(Effect.asVoid);

      const rows = yield* sql<{ linkId: string; state: string; supersededBy: string | null }>`
        SELECT
          link_id as linkId,
          state as state,
          superseded_by as supersededBy
        FROM entity_links
        ORDER BY link_id ASC
      `;
      expect(rows).toEqual([
        { linkId: "new", state: "active", supersededBy: null },
        { linkId: "old", state: "superseded", supersededBy: "new" }
      ]);
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("merges stronger reindex work into an existing coalesced row", () =>
    Effect.gen(function* () {
      yield* installSchema;
      const sql = yield* SqlClient.SqlClient;

      yield* sql`${sql.unsafe(`
        INSERT INTO reindex_queue (
          queue_id,
          coalesce_key,
          target_entity_type,
          target_iri,
          origin_iri,
          cause,
          cause_priority,
          propagation_depth,
          attempts,
          next_attempt_at,
          enqueued_at,
          updated_at
        ) VALUES (
          'q1',
          'Expert:https://w3id.org/energy-intel/expert/MarkZJacobson:1',
          'Expert',
          'https://w3id.org/energy-intel/expert/MarkZJacobson',
          'https://w3id.org/energy-intel/expert/MarkZJacobson',
          'entity-changed',
          0,
          0,
          1,
          100,
          1,
          1
        )
        ON CONFLICT(coalesce_key) DO UPDATE SET
        ${REINDEX_QUEUE_UPSERT_SET_CLAUSE}
      `)}`.pipe(Effect.asVoid);

      yield* sql`${sql.unsafe(`
        INSERT INTO reindex_queue (
          queue_id,
          coalesce_key,
          target_entity_type,
          target_iri,
          origin_iri,
          cause,
          cause_priority,
          propagation_depth,
          attempts,
          next_attempt_at,
          enqueued_at,
          updated_at
        ) VALUES (
          'q2',
          'Expert:https://w3id.org/energy-intel/expert/MarkZJacobson:1',
          'Expert',
          'https://w3id.org/energy-intel/expert/MarkZJacobson',
          'https://w3id.org/energy-intel/organization/Stanford',
          'edge-changed',
          10,
          1,
          0,
          50,
          2,
          2
        )
        ON CONFLICT(coalesce_key) DO UPDATE SET
        ${REINDEX_QUEUE_UPSERT_SET_CLAUSE}
      `)}`.pipe(Effect.asVoid);

      const rows = yield* sql<{
        cause: string;
        causePriority: number;
        propagationDepth: number;
        attempts: number;
        nextAttemptAt: number;
      }>`
        SELECT
          cause as cause,
          cause_priority as causePriority,
          propagation_depth as propagationDepth,
          attempts as attempts,
          next_attempt_at as nextAttemptAt
        FROM reindex_queue
      `;

      expect(rows).toEqual([
        {
          cause: "edge-changed",
          causePriority: 10,
          propagationDepth: 1,
          attempts: 0,
          nextAttemptAt: 50
        }
      ]);
    }).pipe(Effect.provide(testLayer))
  );
});
