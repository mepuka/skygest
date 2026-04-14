import type { D1Migration } from "../db/migrations";
import { SearchDbScriptError } from "../domain/errors";

const migrationsTableStatement = `CREATE TABLE IF NOT EXISTS _migrations (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at INTEGER NOT NULL
)`;

const renderMigrationAppliedStatement = (
  migration: D1Migration,
  appliedAt: number
) => `INSERT OR IGNORE INTO _migrations (id, name, applied_at)
VALUES (${String(migration.id)}, '${migration.name.replaceAll("'", "''")}', ${String(appliedAt)})`;

export const renderSearchMigrationSql = (
  migrations: ReadonlyArray<D1Migration>,
  appliedAt = Date.now()
): string => {
  const statements: Array<string> = [migrationsTableStatement];

  for (const migration of migrations) {
    if (migration.run !== undefined) {
      throw new SearchDbScriptError({
        operation: "renderSearchMigrationSql",
        message: `Migration ${String(migration.id)} (${migration.name}) is imperative and cannot be rendered for wrangler d1 execute`
      });
    }

    if (migration.statements === undefined || migration.statements.length === 0) {
      throw new SearchDbScriptError({
        operation: "renderSearchMigrationSql",
        message: `Migration ${String(migration.id)} (${migration.name}) has no SQL statements to render`
      });
    }

    statements.push(...migration.statements);
    statements.push(renderMigrationAppliedStatement(migration, appliedAt));
  }

  return `${statements.join(";\n\n")};\n`;
};
