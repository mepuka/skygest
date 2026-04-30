import { SqliteClient } from "@effect/sql-sqlite-node";
import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { SqlClient } from "effect/unstable/sql";

import {
  AiSearchClient,
  ENTITY_GRAPH_ALL_SCHEMA_STATEMENTS,
  EntityProjectionDrainService,
  EntityProjectionRegistry,
  EntitySnapshotStore,
  EntitySnapshotStoreD1,
  ExpertEntity,
  ExpertProjectionFixture,
  ExpertUnifiedProjection,
  OrganizationEntity,
  OrganizationProjectionFixture,
  OrganizationUnifiedProjection,
  ReindexQueueD1,
  ReindexQueueService,
  asEntityIri,
  asEntityTag,
  type AiSearchInstanceBinding,
  type AiSearchItemInfo,
  type AiSearchNamespaceBinding
} from "../../src";

const sqliteLayer = SqliteClient.layer({ filename: ":memory:" });

const installSchema = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* Effect.forEach(
    ENTITY_GRAPH_ALL_SCHEMA_STATEMENTS,
    (statement) => sql`${sql.unsafe(statement)}`.pipe(Effect.asVoid),
    { discard: true }
  );
});

const makeFakeNamespace = () => {
  const uploads: Array<{
    readonly name: string;
    readonly content: string;
    readonly metadata: Readonly<Record<string, unknown>> | undefined;
  }> = [];
  const instance: AiSearchInstanceBinding = {
    items: {
      list: () => Promise.resolve({ result: [] }),
      upload: (name, content, options) => {
        uploads.push({ name, content, metadata: options?.metadata });
        const item: AiSearchItemInfo = {
          id: `item-${uploads.length}`,
          key: name,
          status: "completed",
          ...(options?.metadata === undefined
            ? {}
            : { metadata: options.metadata })
        };
        return Promise.resolve(item);
      },
      delete: () => Promise.resolve()
    },
    search: () => Promise.reject(new Error("not used"))
  };
  const namespace: AiSearchNamespaceBinding = {
    get: (name) => {
      expect(name).toBe("entity-search");
      return instance;
    }
  };
  return { namespace, uploads };
};

const projectionSpecs = [
  {
    definition: ExpertEntity,
    projection: ExpertUnifiedProjection
  },
  {
    definition: OrganizationEntity,
    projection: OrganizationUnifiedProjection
  }
] as const;

const makeServiceLayer = (namespace: AiSearchNamespaceBinding) => {
  const snapshotLayer = EntitySnapshotStoreD1.layer.pipe(
    Layer.provideMerge(sqliteLayer)
  );
  const queueLayer = ReindexQueueD1.layer.pipe(
    Layer.provideMerge(sqliteLayer)
  );
  const registryLayer = EntityProjectionRegistry.snapshotLayer(
    projectionSpecs
  ).pipe(Layer.provideMerge(snapshotLayer));
  const searchLayer = AiSearchClient.layer(namespace);
  const drainLayer = EntityProjectionDrainService.layer.pipe(
    Layer.provideMerge(Layer.mergeAll(queueLayer, registryLayer, searchLayer))
  );

  return Layer.mergeAll(
    sqliteLayer,
    snapshotLayer,
    queueLayer,
    registryLayer,
    searchLayer,
    drainLayer
  );
};

describe("EntityProjectionDrainService", () => {
  it.effect("stores an entity snapshot and drains it into AI Search", () => {
    const fake = makeFakeNamespace();

    return Effect.gen(function* () {
      yield* installSchema;
      const snapshots = yield* EntitySnapshotStore;
      const queue = yield* ReindexQueueService;
      const drain = yield* EntityProjectionDrainService;
      const fixture = ExpertProjectionFixture.fixture;
      const iri = asEntityIri(fixture.iri);

      yield* snapshots.save(ExpertEntity, fixture);
      yield* queue.schedule({
        targetEntityType: asEntityTag("Expert"),
        targetIri: iri,
        originIri: iri,
        cause: "entity-changed",
        causePriority: 0,
        propagationDepth: 0,
        nextAttemptAt: 0
      });

      const result = yield* drain.drainNext(10);

      expect(result).toEqual({ pulled: 1, rendered: 1, failed: 0 });
      expect(fake.uploads).toHaveLength(1);
      expect(fake.uploads[0]?.name).toBe("entities/expert/did_plc_fixture.md");
      expect(fake.uploads[0]?.content).toContain("# Fixture Expert");
      expect(fake.uploads[0]?.metadata).toEqual({
        entity_type: "Expert",
        iri: fixture.iri,
        topic: "grid",
        authority: "core",
        time_bucket: "unknown"
      });

      const remaining = yield* queue.nextBatch(0, 10);
      expect(remaining).toHaveLength(0);
    }).pipe(Effect.provide(makeServiceLayer(fake.namespace)));
  });

  it.effect("marks unknown entity types as failed without aborting the batch", () => {
    const fake = makeFakeNamespace();

    return Effect.gen(function* () {
      yield* installSchema;
      const queue = yield* ReindexQueueService;
      const drain = yield* EntityProjectionDrainService;
      const sql = yield* SqlClient.SqlClient;
      const iri = asEntityIri("https://w3id.org/energy-intel/post/missing");

      yield* queue.schedule({
        targetEntityType: asEntityTag("Post"),
        targetIri: iri,
        originIri: iri,
        cause: "entity-changed",
        causePriority: 0,
        propagationDepth: 0,
        nextAttemptAt: 0
      });

      const result = yield* drain.drainNext(10);

      expect(result).toEqual({ pulled: 1, rendered: 0, failed: 1 });
      expect(fake.uploads).toHaveLength(0);

      const rows = yield* sql<{ attempts: number }>`
        SELECT attempts as attempts
        FROM reindex_queue
      `;
      expect(rows).toEqual([{ attempts: 1 }]);
    }).pipe(Effect.provide(makeServiceLayer(fake.namespace)));
  });

  it.effect("drains multiple queued snapshots with bounded concurrency", () => {
    const fake = makeFakeNamespace();

    return Effect.gen(function* () {
      yield* installSchema;
      const snapshots = yield* EntitySnapshotStore;
      const queue = yield* ReindexQueueService;
      const drain = yield* EntityProjectionDrainService;
      const expert = ExpertProjectionFixture.fixture;
      const organization = OrganizationProjectionFixture.fixture;
      const expertIri = asEntityIri(expert.iri);
      const organizationIri = asEntityIri(organization.iri);

      yield* snapshots.save(ExpertEntity, expert);
      yield* snapshots.save(OrganizationEntity, organization);
      yield* queue.schedule({
        targetEntityType: asEntityTag("Expert"),
        targetIri: expertIri,
        originIri: expertIri,
        cause: "entity-changed",
        causePriority: 0,
        propagationDepth: 0,
        nextAttemptAt: 0
      });
      yield* queue.schedule({
        targetEntityType: asEntityTag("Organization"),
        targetIri: organizationIri,
        originIri: organizationIri,
        cause: "entity-changed",
        causePriority: 0,
        propagationDepth: 0,
        nextAttemptAt: 0
      });

      const result = yield* drain.drainNext(10, { concurrency: 2 });

      expect(result).toEqual({ pulled: 2, rendered: 2, failed: 0 });
      expect(fake.uploads.map((upload) => upload.name).sort()).toEqual([
        "entities/expert/did_plc_fixture.md",
        `entities/organization/${organization.iri.replace(/[^A-Za-z0-9_-]+/g, "_")}.md`
      ]);
    }).pipe(Effect.provide(makeServiceLayer(fake.namespace)));
  });
});
