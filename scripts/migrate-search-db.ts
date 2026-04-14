import { Console, Effect } from "effect";
import { Command } from "effect/unstable/cli";
import { entitySearchMigrations } from "../src/search/migrations";
import { renderSearchMigrationSql } from "../src/search/migrationSql";
import { runScriptMain, scriptPlatformLayer } from "../src/platform/ScriptRuntime";
import {
  executeWranglerD1CommandJson,
  executeWranglerD1TempSqlFile
} from "../src/platform/WranglerD1";
import {
  SearchDbScriptConfig,
  resolveSearchDbName,
  searchDbNameFlag
} from "./support/entity-search";

const migrateSearchDbCommand = Command.make(
  "migrate-search-db",
  {
    searchDbName: searchDbNameFlag
  },
  ({ searchDbName }) =>
    Effect.gen(function* () {
      const configured = yield* SearchDbScriptConfig;
      const databaseName = resolveSearchDbName(configured, searchDbName);
      const sql = renderSearchMigrationSql(entitySearchMigrations);

      yield* executeWranglerD1TempSqlFile({
        databaseName,
        sql,
        label: "entity-search-migrations"
      });

      const applied = yield* executeWranglerD1CommandJson({
        databaseName,
        sql: `SELECT id, name
              FROM _migrations
              ORDER BY id ASC`
      });

      const rows = applied[0]?.results ?? [];

      yield* Console.log(
        `Applied ${String(rows.length)} search migrations to ${databaseName}`
      );

      for (const row of rows) {
        yield* Console.log(
          `${String(row.id)}: ${String(row.name)}`
        );
      }
    })
);

const cli = Command.runWith(migrateSearchDbCommand, {
  version: "0.1.0"
});

if (import.meta.main) {
  runScriptMain(
    "MigrateSearchDb",
    Effect.suspend(() => cli(Array.from(process.argv).slice(2))).pipe(
      Effect.provide(scriptPlatformLayer)
    )
  );
}
