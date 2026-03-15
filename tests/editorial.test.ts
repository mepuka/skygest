import { Effect } from "effect";
import { describe, expect, it } from "@effect/vitest";
import { makeBiLayer, seedKnowledgeBase, withTempSqliteFile } from "./support/runtime";
import { SqlClient } from "@effect/sql";

describe("editorial_picks migration", () => {
  it.live("creates the editorial_picks table with post_uri as PK", () =>
    Effect.promise(() =>
      withTempSqliteFile(async (filename) => {
        const layer = makeBiLayer({ filename });
        await Effect.runPromise(
          seedKnowledgeBase().pipe(Effect.provide(layer))
        );
        await Effect.runPromise(
          Effect.gen(function* () {
            const sql = yield* SqlClient.SqlClient;
            const tables = yield* sql`
              SELECT name FROM sqlite_master
              WHERE type='table' AND name='editorial_picks'
            `;
            expect(tables).toHaveLength(1);
            const info = yield* sql`PRAGMA table_info(editorial_picks)`;
            const pkCol = (info as any[]).find((c: any) => c.pk === 1);
            expect(pkCol?.name).toBe("post_uri");
          }).pipe(Effect.provide(layer))
        );
      })
    )
  );
});
