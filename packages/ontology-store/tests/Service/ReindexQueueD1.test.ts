import { SqliteClient } from "@effect/sql-sqlite-node";
import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { SqlClient } from "effect/unstable/sql";

import {
  ENTITY_GRAPH_ALL_SCHEMA_STATEMENTS,
  ReindexQueueD1,
  ReindexQueueService,
  asEntityIri,
  asEntityTag
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

const expertTag = asEntityTag("Expert");
const expertIri = asEntityIri(
  "https://w3id.org/energy-intel/expert/MarkZJacobson"
);
const orgIri = asEntityIri(
  "https://w3id.org/energy-intel/organization/Stanford"
);

const provideLayer = <A, E>(
  effect: Effect.Effect<A, E, ReindexQueueService | SqlClient.SqlClient>
) => effect.pipe(Effect.provide(ReindexQueueD1.layer), Effect.provide(sqliteLayer));

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
});
