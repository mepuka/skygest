import { it, expect } from "bun:test";
import { Effect } from "effect";
import { SqliteClient } from "@effect/sql-sqlite-bun";
import { SqlClient } from "@effect/sql";
import { JetstreamCursorStore } from "./JetstreamCursorStore";

it("stores cursor", async () => {
  const program = Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`CREATE TABLE IF NOT EXISTS jetstream_state (id TEXT PRIMARY KEY, cursor INTEGER)`;
    const store = yield* JetstreamCursorStore;
    yield* store.setCursor(123);
    return yield* store.getCursor();
  });

  const result = await Effect.runPromise(
    program.pipe(
      Effect.provide(JetstreamCursorStore.layer),
      Effect.provide(SqliteClient.layer({ filename: ":memory:" }))
    )
  );

  expect(result).toBe(123);
});
