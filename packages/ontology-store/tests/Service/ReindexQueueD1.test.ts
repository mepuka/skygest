import { D1Client } from "@effect/sql-d1";
import { SqliteClient } from "@effect/sql-sqlite-node";
import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { SqlClient } from "effect/unstable/sql";

import {
  ENTITY_GRAPH_ALL_SCHEMA_STATEMENTS,
  ReindexQueueD1,
  ReindexQueueService,
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

const installSchema = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* Effect.forEach(
    ENTITY_GRAPH_ALL_SCHEMA_STATEMENTS,
    (statement) => sql`${sql.unsafe(statement)}`.pipe(Effect.asVoid),
    { discard: true }
  );
});

const expertTag = asEntityTag("Expert");
const expertIri = asEntityIri(
  "https://w3id.org/energy-intel/expert/MarkZJacobson"
);
const orgIri = asEntityIri(
  "https://w3id.org/energy-intel/organization/Stanford"
);

const provideLayer = <A, E>(
  effect: Effect.Effect<A, E, ReindexQueueService | SqlClient.SqlClient>
) =>
  effect.pipe(
    Effect.provide(ReindexQueueD1.layer),
    Effect.provide(sqliteLayer)
  );

const makeQueueD1BatchLayer = (captures: {
  batchStatements: Array<CapturedStatement>;
  batchCalls: number;
}) => {
  const row = {
    queue_id: "queue-1",
    coalesce_key:
      "Expert:https://w3id.org/energy-intel/expert/MarkZJacobson:0",
    target_entity_type: "Expert",
    target_iri: expertIri,
    origin_iri: expertIri,
    cause: "entity-changed",
    cause_priority: 0,
    propagation_depth: 0,
    attempts: 3,
    next_attempt_at: 10,
    enqueued_at: 1,
    updated_at: 1
  };
  const db = {
    prepare(query: string) {
      const bind = (...params: ReadonlyArray<unknown>): CapturedStatement => ({
        query,
        params,
        all: async () => ({
          results:
            query.includes("UPDATE reindex_queue") &&
            params.includes("queue-1")
              ? [row]
              : [],
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
      return statements.map(() => ({
        results: [],
        success: true,
        meta: { duration: 0 }
      }));
    }
  } as unknown as D1DatabaseBinding;

  const d1Layer = D1Client.layer({ db });
  const queueLayer = ReindexQueueD1.layer.pipe(Layer.provideMerge(d1Layer));
  return Layer.mergeAll(d1Layer, queueLayer);
};

describe("ReindexQueueD1", () => {
  it.effect("merges stronger work into an existing coalesced request", () =>
    provideLayer(
      Effect.gen(function* () {
        yield* installSchema;
        const queue = yield* ReindexQueueService;

        yield* queue.schedule({
          targetEntityType: expertTag,
          targetIri: expertIri,
          originIri: expertIri,
          cause: "entity-changed",
          causePriority: 0,
          propagationDepth: 0,
          nextAttemptAt: 10
        });
        yield* queue.schedule({
          targetEntityType: expertTag,
          targetIri: expertIri,
          originIri: orgIri,
          cause: "edge-changed",
          causePriority: 10,
          propagationDepth: 1,
          nextAttemptAt: 5
        });

        const batch = yield* queue.nextBatch(10, 10);
        expect(batch).toHaveLength(1);
        expect(batch[0]?.cause).toBe("edge-changed");
        expect(batch[0]?.causePriority).toBe(10);
        expect(batch[0]?.propagationDepth).toBe(1);
        expect(batch[0]?.nextAttemptAt).toBe(5);
      })
    )
  );

  it.effect("retries failures and moves the third failure to the dead-letter table", () =>
    provideLayer(
      Effect.gen(function* () {
        yield* installSchema;
        const queue = yield* ReindexQueueService;
        const sql = yield* SqlClient.SqlClient;

        yield* queue.schedule({
          targetEntityType: expertTag,
          targetIri: expertIri,
          originIri: expertIri,
          cause: "entity-changed",
          causePriority: 0,
          propagationDepth: 0,
          nextAttemptAt: 10
        });
        const [item] = yield* queue.nextBatch(10, 1);
        expect(item).toBeDefined();

        yield* queue.markFailed(item!.queueId, 20, "first");
        const retry = yield* queue.nextBatch(2000, 1);
        expect(retry[0]?.attempts).toBe(1);

        yield* queue.markFailed(item!.queueId, 3000, "second");
        yield* queue.markFailed(item!.queueId, 7000, "third");

        const liveRows = yield* sql<{ count: number }>`
          SELECT COUNT(*) as count
          FROM reindex_queue
        `;
        const deadRows = yield* sql<{ queueId: string; failureMessage: string | null }>`
          SELECT queue_id as queueId, failure_message as failureMessage
          FROM reindex_queue_dlq
        `;
        expect(liveRows[0]?.count).toBe(0);
        expect(deadRows).toEqual([
          { queueId: item!.queueId, failureMessage: "third" }
        ]);
      })
    )
  );

  it.effect("uses D1 batch when moving an exhausted item to the dead-letter table", () => {
    const captures = {
      batchStatements: [] as Array<CapturedStatement>,
      batchCalls: 0
    };

    return Effect.gen(function* () {
      const queue = yield* ReindexQueueService;

      yield* queue.markFailed("queue-1", 30, "third");

      expect(captures.batchCalls).toBe(1);
      expect(captures.batchStatements).toHaveLength(2);
      expect(captures.batchStatements[0]?.query).toContain(
        "INSERT OR REPLACE INTO reindex_queue_dlq"
      );
      expect(captures.batchStatements[0]?.params[8]).toBe(3);
      expect(captures.batchStatements[0]?.params[13]).toBe("third");
      expect(captures.batchStatements[1]?.query).toContain(
        "DELETE FROM reindex_queue"
      );
      expect(captures.batchStatements[1]?.params).toEqual(["queue-1"]);
    }).pipe(Effect.provide(makeQueueD1BatchLayer(captures)));
  });
});
