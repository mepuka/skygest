/**
 * One-shot migration: rewrite legacy `eia-route` aliases that hold
 * bulk-manifest top-level codes (e.g. `EBA`, `ELEC`, `NG`) to the new
 * `eia-bulk-id` scheme. This frees up `eia-route` for API v2 path-style
 * identifiers used by SKY-254 cold-start ingest.
 *
 * Scope: dataset files only. Existing EIA distribution files have empty
 * `aliases` arrays — verified by reading every distribution file and
 * asserting no slashless `eia-route` alias exists. The script aborts
 * loudly if a future contributor ever adds one.
 */

import * as BunFileSystem from "@effect/platform-bun/BunFileSystem";
import * as BunPath from "@effect/platform-bun/BunPath";
import * as BunRuntime from "@effect/platform-bun/BunRuntime";
import { Effect, FileSystem, Layer, Path, Schema } from "effect";
import { Dataset, Distribution } from "../src/domain/data-layer";
import {
  decodeJsonStringWith,
  encodeJsonStringPrettyWith,
  stringifyUnknown
} from "../src/platform/Json";

// ---------------------------------------------------------------------------
// Tagged error
// ---------------------------------------------------------------------------

class MigrationError extends Schema.TaggedErrorClass<MigrationError>()(
  "MigrationError",
  {
    operation: Schema.String,
    path: Schema.String,
    message: Schema.String
  }
) {}

// ---------------------------------------------------------------------------
// Migration core
// ---------------------------------------------------------------------------

interface RawAlias {
  readonly scheme: string;
  readonly value: string;
  readonly relation: string;
  readonly uri?: string;
}

const migrateAliases = (
  aliases: ReadonlyArray<RawAlias>
): { readonly aliases: ReadonlyArray<RawAlias>; readonly changed: boolean } => {
  let changed = false;
  const next = aliases.map((alias) => {
    if (alias.scheme === "eia-route" && !alias.value.includes("/")) {
      changed = true;
      return { ...alias, scheme: "eia-bulk-id" };
    }
    return alias;
  });
  return { aliases: next, changed };
};

const encodeDataset = encodeJsonStringPrettyWith(Dataset);

const migrateDatasetFile = (datasetDir: string, file: string) =>
  Effect.gen(function* () {
    const fs_ = yield* FileSystem.FileSystem;
    const path_ = yield* Path.Path;
    const filePath = path_.resolve(datasetDir, file);

    const text = yield* fs_.readFileString(filePath).pipe(
      Effect.mapError(
        (cause) =>
          new MigrationError({
            operation: "readFileString",
            path: filePath,
            message: stringifyUnknown(cause)
          })
      )
    );

    // Decode through the Dataset schema first to enforce a clean baseline
    const decoded = yield* Effect.try({
      try: () => decodeJsonStringWith(Dataset)(text),
      catch: (cause) =>
        new MigrationError({
          operation: "decode",
          path: filePath,
          message: stringifyUnknown(cause)
        })
    });

    const { aliases: nextAliases, changed } = migrateAliases(
      decoded.aliases as ReadonlyArray<RawAlias>
    );
    if (!changed) {
      return { file, changed: false };
    }

    const nextEntity = { ...decoded, aliases: nextAliases };

    // Re-validate via the schema to confirm the rewritten record still
    // passes — guards against any drift between in-memory mutation and
    // the schema's invariants (e.g. duplicate-alias check).
    const validated = yield* Schema.decodeUnknownEffect(Dataset)(
      nextEntity
    ).pipe(
      Effect.mapError(
        (cause) =>
          new MigrationError({
            operation: "re-decode",
            path: filePath,
            message: stringifyUnknown(cause)
          })
      )
    );

    // Pretty-printed serialization preserves the on-disk hand-edited
    // formatting; minified output would explode the diff.
    const encoded = `${encodeDataset(validated)}\n`;

    const tmp = `${filePath}.tmp-${Date.now()}`;
    yield* fs_.writeFileString(tmp, encoded).pipe(
      Effect.mapError(
        (cause) =>
          new MigrationError({
            operation: "writeFileString",
            path: tmp,
            message: stringifyUnknown(cause)
          })
      )
    );
    yield* fs_.rename(tmp, filePath).pipe(
      Effect.mapError(
        (cause) =>
          new MigrationError({
            operation: "rename",
            path: `${tmp} -> ${filePath}`,
            message: stringifyUnknown(cause)
          })
      )
    );
    return { file, changed: true };
  });

// Defensive distribution check: assert no distribution carries a slashless
// eia-route alias. If one ever appears, this script must be extended.
const verifyDistributionAssumption = (distDir: string, file: string) =>
  Effect.gen(function* () {
    const fs_ = yield* FileSystem.FileSystem;
    const path_ = yield* Path.Path;
    const filePath = path_.resolve(distDir, file);
    const text = yield* fs_.readFileString(filePath).pipe(
      Effect.mapError(
        (cause) =>
          new MigrationError({
            operation: "readFileString",
            path: filePath,
            message: stringifyUnknown(cause)
          })
      )
    );
    const decoded = yield* Effect.try({
      try: () => decodeJsonStringWith(Distribution)(text),
      catch: (cause) =>
        new MigrationError({
          operation: "decode",
          path: filePath,
          message: stringifyUnknown(cause)
        })
    });
    const aliases = decoded.aliases as ReadonlyArray<RawAlias>;
    const offending = aliases.find(
      (alias) => alias.scheme === "eia-route" && !alias.value.includes("/")
    );
    if (offending !== undefined) {
      return yield* new MigrationError({
        operation: "verify-distribution",
        path: filePath,
        message: `Distribution has a slashless eia-route alias (${offending.value}); extend cold-start-migrate-eia-bulk-id.ts to handle distributions.`
      });
    }
  });

const main = Effect.gen(function* () {
  const fs_ = yield* FileSystem.FileSystem;
  const path_ = yield* Path.Path;

  const root = path_.resolve(import.meta.dirname, "..", "references", "cold-start");
  const datasetDir = path_.resolve(root, "catalog", "datasets");
  const distDir = path_.resolve(root, "catalog", "distributions");

  const datasetFiles = (yield* fs_.readDirectory(datasetDir)).filter(
    (file) => file.startsWith("eia-") && file.endsWith(".json")
  );
  const distFiles = (yield* fs_.readDirectory(distDir)).filter(
    (file) => file.startsWith("eia-") && file.endsWith(".json")
  );

  const datasetResults = yield* Effect.forEach(
    datasetFiles,
    (file) => migrateDatasetFile(datasetDir, file),
    { concurrency: 10 }
  );

  yield* Effect.forEach(
    distFiles,
    (file) => verifyDistributionAssumption(distDir, file),
    { concurrency: 10, discard: true }
  );

  const datasetChanged = datasetResults.filter((r) => r.changed).length;
  yield* Effect.log(
    `Migrated ${String(datasetChanged)}/${String(datasetFiles.length)} EIA dataset files.`
  );
  yield* Effect.log(
    `Verified ${String(distFiles.length)} EIA distribution files need no migration.`
  );

  yield* Effect.forEach(
    datasetResults.filter((r) => r.changed),
    (r) => Effect.log(`  changed: ${r.file}`),
    { discard: true }
  );
});

main.pipe(
  Effect.provide(Layer.mergeAll(BunFileSystem.layer, BunPath.layer)),
  Effect.tapError((error) => Effect.logError(stringifyUnknown(error))),
  BunRuntime.runMain
);
