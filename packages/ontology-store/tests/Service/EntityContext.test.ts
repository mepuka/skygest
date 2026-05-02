import { SqliteClient } from "@effect/sql-sqlite-node";
import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer, Schema } from "effect";
import { SqlClient } from "effect/unstable/sql";

import {
  ENTITY_GRAPH_ALL_SCHEMA_STATEMENTS,
  EntityContextService,
  EntityGraphRepo,
  EntityGraphRepoD1,
  EntityRegistry,
  ExpertEntity,
  ExpertProjectionFixture,
  OrganizationEntity,
  OrganizationProjectionFixture,
  PostEntity,
  PostProjectionFixture,
  asEntityIri,
  asEntityTag,
  type AnyEntityDefinition,
  type StorageAdapter
} from "../../src";

const sqliteLayer = SqliteClient.layer({ filename: ":memory:" });
const graphLayer = EntityGraphRepoD1.layer.pipe(Layer.provideMerge(sqliteLayer));

const installSchema = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`${sql.unsafe("PRAGMA foreign_keys = ON")}`.pipe(Effect.asVoid);
  yield* Effect.forEach(
    ENTITY_GRAPH_ALL_SCHEMA_STATEMENTS,
    (statement) => sql`${sql.unsafe(statement)}`.pipe(Effect.asVoid),
    { discard: true }
  );
});

const makeMemoryStorage = <Def extends AnyEntityDefinition>(
  definition: Def,
  initial: ReadonlyArray<Schema.Schema.Type<Def["schema"]>>
): StorageAdapter<Def> => {
  const records = new Map<string, Schema.Schema.Type<Def["schema"]>>();
  for (const entity of initial) {
    records.set(definition.identity.iriOf(entity), entity);
  }
  return {
    definition,
    load: (iri) =>
      Effect.gen(function* () {
        const entity = records.get(iri);
        if (entity === undefined) {
          return yield* Effect.fail({ _tag: "TestStorageMissing", iri });
        }
        return entity;
      }),
    save: (entity) =>
      Effect.sync(() => {
        records.set(definition.identity.iriOf(entity), entity);
      })
  };
};

const makeTestLayer = () => {
  const registryLayer = EntityRegistry.layer([
    {
      definition: ExpertEntity,
      storage: makeMemoryStorage(ExpertEntity, [ExpertProjectionFixture.fixture])
    },
    {
      definition: OrganizationEntity,
      storage: makeMemoryStorage(OrganizationEntity, [
        OrganizationProjectionFixture.fixture
      ])
    },
    {
      definition: PostEntity,
      storage: makeMemoryStorage(PostEntity, [PostProjectionFixture.fixture])
    }
  ]);
  const baseLayer = Layer.mergeAll(
    sqliteLayer,
    graphLayer,
    registryLayer
  );
  return EntityContextService.layer.pipe(Layer.provideMerge(baseLayer));
};

describe("EntityContextService", () => {
  it.effect("hydrates a root entity and linked neighbors through the registry", () =>
    Effect.gen(function* () {
      yield* installSchema;
      const graph = yield* EntityGraphRepo;
      const context = yield* EntityContextService;
      const expertIri = asEntityIri(ExpertProjectionFixture.fixture.iri);
      const orgIri = asEntityIri(OrganizationProjectionFixture.fixture.iri);

      yield* graph.upsertEntity(expertIri, asEntityTag("Expert"));
      yield* graph.upsertEntity(orgIri, asEntityTag("Organization"));
      const link = yield* graph.createLink({
        predicate: "ei:affiliatedWith",
        subject: { iri: expertIri, type: "Expert" },
        object: { iri: orgIri, type: "Organization" },
        effectiveFrom: 10
      });
      yield* graph.recordEvidence(link.linkId, {
        assertedBy: "agent:test",
        assertionKind: "curated",
        confidence: 0.95
      });

      const assembled = yield* context.assemble(expertIri, {
        minConfidence: 0.9
      });

      expect(assembled.entity.summary).toBe(
        "Fixture Expert, core on grid"
      );
      expect(assembled.linksOut).toHaveLength(1);
      expect(assembled.linksIn).toHaveLength(0);
      expect(assembled.neighbors).toHaveLength(1);
      expect(assembled.unhydratedNeighbors).toHaveLength(0);
      expect(assembled.neighbors[0]?.entityType).toBe("Organization");
      expect(assembled.neighbors[0]?.summary).toBe(
        "Fixture Organization, research on grid"
      );
    }).pipe(Effect.provide(makeTestLayer()))
  );

  it.effect("can return only the root entity without traversing neighbors", () =>
    Effect.gen(function* () {
      yield* installSchema;
      const graph = yield* EntityGraphRepo;
      const context = yield* EntityContextService;
      const expertIri = asEntityIri(ExpertProjectionFixture.fixture.iri);

      yield* graph.upsertEntity(expertIri, asEntityTag("Expert"));

      const assembled = yield* context.assemble(expertIri, {
        includeOutbound: false,
        includeInbound: false
      });

      expect(assembled.entity.fulltext).toContain("# Fixture Expert");
      expect(assembled.linksOut).toHaveLength(0);
      expect(assembled.linksIn).toHaveLength(0);
      expect(assembled.neighbors).toHaveLength(0);
      expect(assembled.unhydratedNeighbors).toHaveLength(0);
    }).pipe(Effect.provide(makeTestLayer()))
  );

  it.effect("keeps graph edges when a concept neighbor is not snapshot-backed", () =>
    Effect.gen(function* () {
      yield* installSchema;
      const graph = yield* EntityGraphRepo;
      const context = yield* EntityContextService;
      const postIri = asEntityIri(PostProjectionFixture.fixture.iri);
      const topicIri = asEntityIri(
        "http://example.org/ontology/energy-news#SolarPV"
      );

      yield* graph.upsertEntity(postIri, asEntityTag("Post"));
      yield* graph.upsertEntity(topicIri, asEntityTag("EnergyTopic"));
      const link = yield* graph.createLink({
        predicate: "ei:aboutTechnology",
        subject: { iri: postIri, type: "Post" },
        object: { iri: topicIri, type: "EnergyTopic" },
        effectiveFrom: 10
      });
      yield* graph.recordEvidence(link.linkId, {
        assertedBy: "agent:test",
        assertionKind: "curated",
        confidence: 0.95
      });

      const assembled = yield* context.assemble(postIri, {
        minConfidence: 0.9
      });

      expect(assembled.linksOut).toHaveLength(1);
      expect(assembled.neighbors).toHaveLength(0);
      expect(assembled.unhydratedNeighbors).toHaveLength(1);
      expect(assembled.unhydratedNeighbors[0]?.entityType).toBe("EnergyTopic");
      expect(assembled.unhydratedNeighbors[0]?.iri).toBe(topicIri);
    }).pipe(Effect.provide(makeTestLayer()))
  );
});
