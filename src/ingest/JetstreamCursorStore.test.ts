import { it, expect } from "bun:test";
import { Effect, Layer } from "effect";
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

  const baseLayer = SqliteClient.layer({ filename: ":memory:" });
  const appLayer = JetstreamCursorStore.layer.pipe(Layer.provideMerge(baseLayer));

  const result = await Effect.runPromise(
    program.pipe(Effect.provide(appLayer))
  );

  expect(result).toBe(123);
});
