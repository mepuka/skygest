import { Effect, Layer } from "effect";
import { SqliteClient } from "@effect/sql-sqlite-bun";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { energySeedManifest } from "../bootstrap/CheckedInExpertSeeds";
import { bootstrapExperts } from "../bootstrap/ExpertSeeds";
import { runMigrations } from "../db/migrate";
import { ExpertsRepoD1 } from "../services/d1/ExpertsRepoD1";

const filename = process.env.EXPERTS_DB_PATH ?? ".data/skygest-bi.sqlite";
const shardCount = Number(process.env.INGEST_SHARD_COUNT ?? "1");
mkdirSync(dirname(filename), { recursive: true });

const sqliteLayer = SqliteClient.layer({ filename });
const layer = Layer.mergeAll(
  sqliteLayer,
  ExpertsRepoD1.layer.pipe(Layer.provideMerge(sqliteLayer))
);

const program = Effect.gen(function* () {
  yield* runMigrations;
  const result = yield* bootstrapExperts(energySeedManifest, shardCount);
  yield* Effect.logInfo("expert seed bootstrap complete").pipe(
    Effect.annotateLogs({
      domain: result.domain,
      count: result.count,
      filename
    })
  );
});

await Effect.runPromise(program.pipe(Effect.provide(layer)));
