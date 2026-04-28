import { D1Client } from "@effect/sql-d1";
import { SqliteClient } from "@effect/sql-sqlite-node";
import { describe, expect, it } from "@effect/vitest";
import { Effect, Exit, Layer, Schema } from "effect";
import { SqlClient } from "effect/unstable/sql";

import {
  ENTITY_GRAPH_ALL_SCHEMA_STATEMENTS,
  EntityGraphRepo,
  EntityGraphRepoD1,
  LinkId,
  PREDICATES,
  asEntityIri,
  asEntityTag
} from "../../src";

type CapturedStatement = {
  readonly query: string;
  readonly params: ReadonlyArray<unknown>;
  readonly all: () => Promise<{
    readonly results: ReadonlyArray<Record<string, unknown>>;
    readonly success: boolean;
    readonly meta: { readonly duration: number };
  }>;
  readonly raw: () => Promise<ReadonlyArray<ReadonlyArray<unknown>>>;
};
type D1DatabaseBinding = D1Client.D1Client["config"]["db"];

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

const makeLinkRow = (linkId: string, state: "active" | "superseded") => ({
  link_id: linkId,
  triple_hash: "hash-1",
  subject_iri: expertIri,
  predicate_iri: PREDICATES["ei:affiliatedWith"].iri,
  object_iri: orgIri,
  object_value: null,
  object_datatype: null,
  graph_iri: "urn:skygest:graph:default",
  subject_type: "Expert",
  object_type: "Organization",
  state,
  effective_from: state === "active" ? 20 : 10,
  effective_until: null,
  superseded_by: null,
  created_at: 1,
  updated_at: 1
});

const makeEntityGraphD1BatchLayer = (captures: {
  batchStatements: Array<CapturedStatement>;
  batchCalls: number;
  replacementId: string | null;
}) => {
  const resultsFor = (
    query: string,
    params: ReadonlyArray<unknown>
  ): ReadonlyArray<Record<string, unknown>> => {
    if (query.includes("PRAGMA foreign_keys")) return [];
    if (query.includes("FROM entities")) {
      const iri = params[0];
      if (iri === expertIri) {
        return [
          {
            iri: expertIri,
            entity_type: "Expert",
            created_at: 1,
            updated_at: 1
          }
        ];
      }
      if (iri === orgIri) {
        return [
          {
            iri: orgIri,
            entity_type: "Organization",
            created_at: 1,
            updated_at: 1
          }
        ];
      }
    }
    if (query.includes("FROM entity_links")) {
      const linkId = params[0];
      if (linkId === "old-link") return [makeLinkRow("old-link", "active")];
      if (
        typeof linkId === "string" &&
        captures.replacementId !== null &&
        linkId === captures.replacementId
      ) {
        return [makeLinkRow(linkId, "active")];
      }
    }
    return [];
  };
  const db = {
    prepare(query: string) {
      const bind = (...params: ReadonlyArray<unknown>): CapturedStatement => ({
        query,
        params,
        all: async () => ({
          results: resultsFor(query, params),
          success: true,
          meta: { duration: 0 }
        }),
        raw: async () => []
      });
      return {
        query,
        params: [],
        bind,
        all: bind().all,
        raw: bind().raw
      };
    },
    async batch(statements: ReadonlyArray<CapturedStatement>) {
      captures.batchCalls += 1;
      captures.batchStatements.push(...statements);
      const replacementId = statements[0]?.params[0];
      if (typeof replacementId === "string") {
        captures.replacementId = replacementId;
      }
      return statements.map(() => ({
        results: [],
        success: true,
        meta: { duration: 0 }
      }));
    }
  } as unknown as D1DatabaseBinding;

  const d1Layer = D1Client.layer({ db });
  const graphLayer = EntityGraphRepoD1.layer.pipe(Layer.provideMerge(d1Layer));
  return Layer.mergeAll(d1Layer, graphLayer);
};

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

  it.effect("uses D1 batch for supersession when a Worker D1 binding is present", () => {
    const captures = {
      batchStatements: [] as Array<CapturedStatement>,
      batchCalls: 0,
      replacementId: null as string | null
    };
    const layer = makeEntityGraphD1BatchLayer(captures);
    const oldLinkId = Schema.decodeUnknownSync(LinkId)("old-link");

    return Effect.gen(function* () {
      const graph = yield* EntityGraphRepo;

      const replacement = yield* graph.supersede(oldLinkId, {
        predicate: "ei:affiliatedWith",
        subject: { iri: expertIri, type: "Expert" },
        object: { iri: orgIri, type: "Organization" },
        effectiveFrom: 20
      });

      expect(captures.batchCalls).toBe(1);
      expect(captures.batchStatements).toHaveLength(3);
      expect(captures.batchStatements[0]?.query).toContain(
        "INSERT INTO entity_links"
      );
      expect(captures.batchStatements[1]?.query).toContain(
        "SET state = 'superseded'"
      );
      expect(captures.batchStatements[2]?.query).toContain(
        "SET state = 'active'"
      );
      expect(replacement.linkId).toBe(captures.replacementId);
      expect(replacement.state).toBe("active");
    }).pipe(Effect.provide(layer));
  });
});
