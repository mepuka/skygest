/**
 * Drift gate: re-run the codegen pipeline in-memory against the
 * vendored TTL modules and assert the output matches the committed
 * `packages/ontology-store/src/generated/*.ts` files and
 * `packages/ontology-store/src/iris.ts` byte-for-byte.
 *
 * If this test fails, regenerate the committed files via:
 *   bun packages/ontology-store/scripts/generate-from-ttl.ts <module>
 *
 * Source-of-truth path: vendored TTLs under
 * `packages/ontology-store/vendor/energy-intel/`. The vendored copy is
 * pinned to a specific upstream commit (see `.upstream-commit` and the
 * directory's README). The drift gate's contract is "do the committed
 * generated files match the pinned vendored TTLs?" — environment-
 * independent, so this gate runs unconditionally in CI and ignores
 * `ENERGY_INTEL_ROOT` (the env var only affects the codegen *script*,
 * for iterating against a working copy of the upstream repo).
 *
 * iris.ts comparison: the script emits iris.ts from the *union* of
 * every vendored TTL; the drift gate mirrors that union for both
 * `iris.ts` and cross-module range validation.
 *
 * The test is intentionally pure (no `execSync`, no `bun` subprocess) — it
 * imports the same pipeline functions the script uses and lets the
 * `BunServices.layer` provide the FS so the assertions live entirely
 * inside Effect.
 */
import { describe, expect, it } from "@effect/vitest";
import { Effect, FileSystem, Layer, Path } from "effect";
import * as BunFileSystem from "@effect/platform-bun/BunFileSystem";
import * as BunPath from "@effect/platform-bun/BunPath";
import { fileURLToPath } from "node:url";
import {
  mergeClassTables,
  parseTtlToClassTable
} from "../../scripts/codegen/parseTtl";
import {
  mergeConceptSchemeTables,
  parseConceptSchemeTtl
} from "../../scripts/codegen/parseConceptSchemes";
import { buildJsonSchema } from "../../scripts/codegen/buildJsonSchema";
import { postProcessAst } from "../../scripts/codegen/postProcessAst";
import { emitIrisModule } from "../../scripts/codegen/emitIrisModule";
import { emitConceptSchemeModule } from "../../scripts/codegen/emitConceptSchemeModule";
import { renderSchemaSource } from "../../scripts/codegen/renderSchemaSource";

const fsLayer = Layer.mergeAll(BunFileSystem.layer, BunPath.layer);

const TTL_ROOT = fileURLToPath(
  new URL("../../vendor/energy-intel", import.meta.url)
);
const GENERATED_ROOT = fileURLToPath(
  new URL("../../src/generated", import.meta.url)
);
const COMMITTED_IRIS = fileURLToPath(
  new URL("../../src/iris.ts", import.meta.url)
);
const CONCEPT_SCHEME_ROOT = fileURLToPath(
  new URL("../../vendor/energy-intel/concept-schemes", import.meta.url)
);
const COMMITTED_CONCEPTS = fileURLToPath(
  new URL("../../src/generated/concepts.ts", import.meta.url)
);

describe("codegen drift gate", () => {
  it.effect("regenerated generated modules match committed", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;

      const entries = yield* fs.readDirectory(TTL_ROOT);
      const ttlNames = entries
        .filter((name) => name.endsWith(".ttl"))
        .map((name) => name.slice(0, -".ttl".length))
        .sort();
      const tables = yield* Effect.forEach(ttlNames, (name) =>
        Effect.gen(function* () {
          const ttl = yield* fs.readFileString(path.join(TTL_ROOT, `${name}.ttl`));
          const table = yield* parseTtlToClassTable(ttl);
          return { name, table };
        })
      );
      const merged = mergeClassTables(tables.map((entry) => entry.table));

      for (const { name, table } of tables) {
        const jsonSchema = yield* buildJsonSchema(table, {
          rangeTable: merged
        });
        const processed = yield* postProcessAst(jsonSchema, table);
        const regenerated = renderSchemaSource(processed, table);

        const committed = yield* fs.readFileString(
          path.join(GENERATED_ROOT, `${name}.ts`)
        );
        expect(regenerated).toBe(committed);
      }
    }).pipe(Effect.provide(fsLayer))
  );

  it.effect("regenerated iris.ts matches committed", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;

      // Walk every vendored .ttl, parse to ClassTable, merge, emit
      // iris.ts. Mirrors `scripts/generate-from-ttl.ts` so the drift
      // gate stays aligned with the script as more modules land.
      const entries = yield* fs.readDirectory(TTL_ROOT);
      const ttlNames = entries
        .filter((name) => name.endsWith(".ttl"))
        .map((name) => name.slice(0, -".ttl".length))
        .sort();
      const tables = yield* Effect.forEach(ttlNames, (name) =>
        Effect.gen(function* () {
          const ttl = yield* fs.readFileString(path.join(TTL_ROOT, `${name}.ttl`));
          return yield* parseTtlToClassTable(ttl);
        })
      );
      const merged = mergeClassTables(tables);
      const regenerated = emitIrisModule(merged);

      const committed = yield* fs.readFileString(COMMITTED_IRIS);
      expect(regenerated).toBe(committed);
    }).pipe(Effect.provide(fsLayer))
  );

  it.effect("regenerated concept constants match committed", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;

      const entries = yield* fs.readDirectory(CONCEPT_SCHEME_ROOT);
      const ttlNames = entries
        .filter((name) => name.endsWith(".ttl"))
        .sort();
      const tables = yield* Effect.forEach(ttlNames, (name) =>
        Effect.gen(function* () {
          const ttl = yield* fs.readFileString(
            path.join(CONCEPT_SCHEME_ROOT, name)
          );
          return yield* parseConceptSchemeTtl(ttl);
        })
      );
      const regenerated = emitConceptSchemeModule(
        mergeConceptSchemeTables(tables)
      );

      const committed = yield* fs.readFileString(COMMITTED_CONCEPTS);
      expect(regenerated).toBe(committed);
    }).pipe(Effect.provide(fsLayer))
  );
});
