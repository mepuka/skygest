import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { SqliteClient } from "@effect/sql-sqlite-bun";
import { Console, Effect, Layer } from "effect";
import {
  checkedInDataLayerRegistryRoot,
  loadCheckedInDataLayerRegistry
} from "../src/bootstrap/CheckedInDataLayerRegistry";
import { runScriptMain, scriptPlatformLayer } from "../src/platform/ScriptRuntime";
import { runEntitySearchMigrations } from "../src/search/migrate";
import { entitySearchSqlLayer } from "../src/search/Layer";
import { projectEntitySearchDocs } from "../src/search/projectEntitySearchDocs";
import { EntitySearchRepo } from "../src/services/EntitySearchRepo";
import { EntitySearchRepoD1 } from "../src/services/d1/EntitySearchRepoD1";

type CliOptions = {
  readonly dbFile: string;
  readonly root: string;
};

const usage = [
  "Usage: bun run scripts/rebuild-entity-search-index.ts [options]",
  "",
  "Options:",
  "  --db-file <path>   Local sqlite file for the search index",
  "  --root <path>      Checked-in cold-start root",
  "  --help             Show this help"
].join("\n");

if (process.argv.slice(2).includes("--help")) {
  console.log(usage);
  process.exit(0);
}

const parseArgs = (argv: ReadonlyArray<string>): CliOptions => {
  let dbFile = ".data/entity-search.sqlite";
  let root = checkedInDataLayerRegistryRoot;

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];

    switch (arg) {
      case "--db-file": {
        const value = argv[index + 1];
        if (value === undefined) {
          throw new Error("--db-file requires a value");
        }
        dbFile = value;
        index += 1;
        break;
      }
      case "--root": {
        const value = argv[index + 1];
        if (value === undefined) {
          throw new Error("--root requires a value");
        }
        root = value;
        index += 1;
        break;
      }
      default:
        throw new Error(`Unknown argument: ${arg}\n\n${usage}`);
    }
  }

  return {
    dbFile: resolve(process.cwd(), dbFile),
    root
  };
};

const options = parseArgs(process.argv.slice(2));
mkdirSync(dirname(options.dbFile), { recursive: true });

const sqliteLayer = SqliteClient.layer({ filename: options.dbFile });
const searchSqlLayer = entitySearchSqlLayer(sqliteLayer);
const liveLayer = Layer.mergeAll(
  scriptPlatformLayer,
  sqliteLayer,
  searchSqlLayer,
  EntitySearchRepoD1.layer.pipe(Layer.provideMerge(searchSqlLayer))
);

const program = Effect.gen(function* () {
  yield* runEntitySearchMigrations;

  const prepared = yield* loadCheckedInDataLayerRegistry(options.root);
  const docs = projectEntitySearchDocs(prepared);
  const repo = yield* EntitySearchRepo;

  yield* repo.replaceAllDocuments(docs);
  yield* repo.optimizeFts();

  const counts = Object.entries(
    docs.reduce<Record<string, number>>((acc, doc) => {
      acc[doc.entityType] = (acc[doc.entityType] ?? 0) + 1;
      return acc;
    }, {})
  )
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([entityType, count]) => `${entityType}: ${String(count)}`)
    .join(", ");

  yield* Console.log(
    `Rebuilt ${String(docs.length)} entity-search documents into ${options.dbFile}`
  );
  yield* Console.log(counts);
}).pipe(Effect.provide(liveLayer));

runScriptMain("rebuild-entity-search-index", program);
