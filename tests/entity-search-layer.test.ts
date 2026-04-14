import { SqliteClient } from "@effect/sql-sqlite-node";
import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import type { EnvBindings } from "../src/platform/Env";
import { CloudflareEnv } from "../src/platform/Env";
import {
  EntitySearchSql,
  entitySearchSqlLayer
} from "../src/search/Layer";

describe("entity search layer", () => {
  it.effect("wraps a dedicated sql client under the search sql tag", () =>
    Effect.gen(function* () {
      const sql = yield* EntitySearchSql;

      yield* sql`
        CREATE TABLE lookup (value TEXT NOT NULL)
      `.pipe(Effect.asVoid);
      yield* sql`
        INSERT INTO lookup (value)
        VALUES ('ok')
      `.pipe(Effect.asVoid);

      const rows = yield* sql<{ value: string }>`
        SELECT value as value
        FROM lookup
      `;

      expect(rows).toEqual([{ value: "ok" }]);
    }).pipe(
      Effect.provide(
        entitySearchSqlLayer(SqliteClient.layer({ filename: ":memory:" }))
      )
    )
  );

  it("requires SEARCH_DB in the env binding contract", async () => {
    const error = await Effect.runPromise(
      Effect.gen(function* () {
        return yield* CloudflareEnv;
      }).pipe(
        Effect.provide(
          CloudflareEnv.layer({ DB: {} as D1Database } as EnvBindings, {
            required: ["SEARCH_DB"]
          })
        ),
        Effect.flip
      )
    );

    expect(error).toMatchObject({
      _tag: "EnvError",
      missing: "SEARCH_DB"
    });
  });
});
