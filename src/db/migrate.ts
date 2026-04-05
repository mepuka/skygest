import { SqlClient } from "effect/unstable/sql";
import { SqlError } from "effect/unstable/sql/SqlError";
import { Effect } from "effect";
import { migrations } from "./migrations";

/**
 * D1-compatible migration runner — runs DDL directly without transactions
 * since D1 does not support BEGIN/COMMIT/ROLLBACK.
 */
const migrationsTableStatement = `
  CREATE TABLE IF NOT EXISTS _migrations (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at INTEGER NOT NULL
  )
`;

const executeStatement = (sql: SqlClient.SqlClient, statement: string) =>
  sql`${sql.unsafe(statement)}`.pipe(Effect.asVoid);

export const runMigrations: Effect.Effect<void, SqlError, SqlClient.SqlClient> = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* executeStatement(sql, migrationsTableStatement);

  const appliedRows = yield* sql<{ id: number }>`
    SELECT id as id
    FROM _migrations
    ORDER BY id ASC
  `;
  const appliedIds = new Set(appliedRows.map((row) => row.id));

  yield* Effect.forEach(
    migrations,
    (migration) =>
      appliedIds.has(migration.id)
        ? Effect.void
        : Effect.gen(function* () {
          const appliedAt = yield* Effect.sync(() => Date.now());
          if (migration.run !== undefined) {
            yield* migration.run(sql);
          } else {
            yield* Effect.forEach(
              migration.statements ?? [],
              (statement) => executeStatement(sql, statement),
              { discard: true }
            );
          }
          yield* sql`
            INSERT INTO _migrations (id, name, applied_at)
            VALUES (${migration.id}, ${migration.name}, ${appliedAt})
          `.pipe(Effect.asVoid);
        }),
    { discard: true }
  );
});
