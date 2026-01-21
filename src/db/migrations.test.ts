import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
import { SqlClient } from "@effect/sql";
import { SqliteClient } from "@effect/sql-sqlite-bun";
import { runMigrations } from "./migrate";

describe("migrations", () => {
  it("creates core tables", async () => {
    const program = Effect.gen(function* () {
      yield* runMigrations;
      const sql = yield* SqlClient.SqlClient;
      const rows = yield* sql<{ name: string }>`
        SELECT name FROM sqlite_master
        WHERE type='table' AND name IN ('posts','users','interactions','user_access_log')`;
      return rows.length;
    });

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(SqliteClient.layer({ filename: ":memory:" })))
    );

    expect(result).toBe(4);
  });
});
