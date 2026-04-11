import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { SqliteClient } from "@effect/sql-sqlite-bun";
import { Console, Effect, Layer } from "effect";
import { checkedInDataLayerRegistryRoot } from "../src/bootstrap/CheckedInDataLayerRegistry";
import { runMigrations } from "../src/db/migrate";
import {
  formatDataLayerSyncPlan,
  syncCheckedInDataLayer
} from "../src/data-layer/Sync";
import { runScriptMain, scriptPlatformLayer } from "../src/platform/ScriptRuntime";
import { DataLayerReposD1 } from "../src/services/d1/DataLayerReposD1";

type CliOptions = {
  readonly dbFile: string;
  readonly root: string;
  readonly updatedBy: string;
  readonly apply: boolean;
};

const usage = [
  "Usage: bun run scripts/sync-data-layer.ts [options]",
  "",
  "Options:",
  "  --db-file <path>     Local sqlite file to sync into",
  "  --root <path>        Checked-in cold-start root",
  "  --updated-by <name>  Audit operator name",
  "  --apply              Persist inserts and updates",
  "  --help               Show this help"
].join("\n");

if (process.argv.slice(2).includes("--help")) {
  console.log(usage);
  process.exit(0);
}

const parseArgs = (argv: ReadonlyArray<string>): CliOptions => {
  let dbFile = ".data/data-layer-sync.sqlite";
  let root = checkedInDataLayerRegistryRoot;
  let updatedBy = "sync-data-layer";
  let apply = false;

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
      case "--updated-by": {
        const value = argv[index + 1];
        if (value === undefined) {
          throw new Error("--updated-by requires a value");
        }
        updatedBy = value;
        index += 1;
        break;
      }
      case "--apply":
        apply = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}\n\n${usage}`);
    }
  }

  return {
    dbFile: resolve(process.cwd(), dbFile),
    root,
    updatedBy,
    apply
  };
};

const options = parseArgs(process.argv.slice(2));
mkdirSync(dirname(options.dbFile), { recursive: true });

const sqliteLayer = SqliteClient.layer({ filename: options.dbFile });
const liveLayer = Layer.mergeAll(
  scriptPlatformLayer,
  sqliteLayer,
  DataLayerReposD1.layer.pipe(Layer.provideMerge(sqliteLayer))
);

const program = Effect.gen(function* () {
  yield* runMigrations;
  const result = yield* syncCheckedInDataLayer(options);

  yield* Console.log(formatDataLayerSyncPlan(result.plan));

  if (result.applied === null) {
    yield* Console.log(
      `\nDry run only. Re-run with --apply to write ${options.dbFile}.`
    );
    return;
  }

  yield* Console.log(
    `\nApplied ${String(result.applied.inserted)} inserts and ${String(result.applied.updated)} updates to ${options.dbFile}.`
  );

  if (result.applied.missingInSource > 0) {
    yield* Console.log(
      `${String(result.applied.missingInSource)} existing rows are missing from the checked-in source and were left untouched.`
    );
  }
}).pipe(Effect.provide(liveLayer));

runScriptMain("sync-data-layer", program);
