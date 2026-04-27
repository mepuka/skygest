import { SqliteClient } from "@effect/sql-sqlite-node";
import { describe, expect, it } from "@effect/vitest";
import { Effect, Exit, Layer } from "effect";
import { SqlClient } from "effect/unstable/sql";

import {
  ENTITY_GRAPH_ALL_SCHEMA_STATEMENTS,
  EntityGraphRepo,
  EntityGraphRepoD1,
  PREDICATES,
  asEntityIri,
  asEntityTag
} from "../../src";

const sqliteLayer = SqliteClient.layer({ filename: ":memory:" });
const graphLayer = EntityGraphRepoD1.layer.pipe(Layer.provideMerge(sqliteLayer));
const testLayer = Layer.mergeAll(sqliteLayer, graphLayer);

const installSchema = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`${sql.unsafe("PRAGMA foreign_keys = ON")}`.pipe(Effect.asVoid);
  yield* Effect.forEach(
    ENTITY_GRAPH_ALL_SCHEMA_STATEMENTS,
    (statement) => sql`${sql.unsafe(statement)}`.pipe(Effect.asVoid),
    { discard: true }
  );
});

const expertIri = asEntityIri(
  "https://w3id.org/energy-intel/expert/MarkZJacobson"
);
const orgIri = asEntityIri(
  "https://w3id.org/energy-intel/organization/Stanford"
);
const expertTag = asEntityTag("Expert");
const orgTag = asEntityTag("Organization");

describe("EntityGraphRepoD1", () => {
  it.effect("upserts registry rows, creates typed links, and reads both directions", () =>
    Effect.gen(function* () {
      yield* installSchema;
      const graph = yield* EntityGraphRepo;

      yield* graph.upsertEntity(expertIri, expertTag);
      yield* graph.upsertEntity(orgIri, orgTag);

      const link = yield* graph.createLink({
        predicate: "ei:affiliatedWith",
        subject: { iri: expertIri, type: "Expert" },
        object: { iri: orgIri, type: "Organization" },
        effectiveFrom: 10
      });
      yield* graph.recordEvidence(link.linkId, {
        assertedBy: "agent:test",
        assertionKind: "curated",
        confidence: 0.9
      });

      const out = yield* graph.linksOut(expertIri, { minConfidence: 0.8 });
      const inbound = yield* graph.linksIn(orgIri);
      expect(out).toHaveLength(1);
      expect(inbound).toHaveLength(1);
      expect(out[0]?.link.predicateIri).toBe(PREDICATES["ei:affiliatedWith"].iri);
      expect(out[0]?.evidence[0]?.confidence).toBe(0.9);
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("deduplicates repeated active triples through triple_hash", () =>
    Effect.gen(function* () {
      yield* installSchema;
      const graph = yield* EntityGraphRepo;

      yield* graph.upsertEntity(expertIri, expertTag);
      yield* graph.upsertEntity(orgIri, orgTag);

      const input = {
        predicate: "ei:affiliatedWith" as const,
        subject: { iri: expertIri, type: "Expert" as const },
        object: { iri: orgIri, type: "Organization" as const },
        effectiveFrom: 10
      };
      const first = yield* graph.createLink(input);
      const second = yield* graph.createLink(input);

      expect(second.linkId).toBe(first.linkId);
      const out = yield* graph.linksOut(expertIri);
      expect(out).toHaveLength(1);
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("turns invalid endpoint combinations into domain errors", () =>
    Effect.gen(function* () {
      yield* installSchema;
      const graph = yield* EntityGraphRepo;

      yield* graph.upsertEntity(expertIri, expertTag);
      yield* graph.upsertEntity(orgIri, orgTag);

      const exit = yield* Effect.exit(
        graph.createLink({
          predicate: "ei:affiliatedWith",
          subject: { iri: orgIri, type: "Organization" },
          object: { iri: expertIri, type: "Expert" },
          effectiveFrom: 10
        } as any)
      );

      expect(Exit.isFailure(exit)).toBe(true);
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("supersedes an active link without losing history", () =>
    Effect.gen(function* () {
      yield* installSchema;
      const graph = yield* EntityGraphRepo;
      const sql = yield* SqlClient.SqlClient;

      yield* graph.upsertEntity(expertIri, expertTag);
      yield* graph.upsertEntity(orgIri, orgTag);
      const old = yield* graph.createLink({
        predicate: "ei:affiliatedWith",
        subject: { iri: expertIri, type: "Expert" },
        object: { iri: orgIri, type: "Organization" },
        effectiveFrom: 10
      });
      const replacement = yield* graph.supersede(old.linkId, {
        predicate: "ei:affiliatedWith",
        subject: { iri: expertIri, type: "Expert" },
        object: { iri: orgIri, type: "Organization" },
        effectiveFrom: 20
      });

      const rows = yield* sql<{ linkId: string; state: string; supersededBy: string | null }>`
        SELECT
          link_id as linkId,
          state as state,
          superseded_by as supersededBy
        FROM entity_links
        ORDER BY state ASC, link_id ASC
      `;
      expect(replacement.linkId).not.toBe(old.linkId);
      expect(rows).toContainEqual({
        linkId: old.linkId,
        state: "superseded",
        supersededBy: replacement.linkId
      });
      expect(rows).toContainEqual({
        linkId: replacement.linkId,
        state: "active",
        supersededBy: null
      });
    }).pipe(Effect.provide(testLayer))
  );
});
