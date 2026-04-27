/**
 * Drift gate: re-run the codegen pipeline in-memory against the same
 * upstream `agent.ttl` and assert the output matches the committed
 * `packages/ontology-store/src/generated/agent.ts` and
 * `packages/ontology-store/src/iris.ts` byte-for-byte.
 *
 * If this test fails, regenerate the committed files via:
 *   bun packages/ontology-store/scripts/generate-from-ttl.ts agent
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
import { parseTtlToClassTable } from "../../scripts/codegen/parseTtl";
import { buildJsonSchema } from "../../scripts/codegen/buildJsonSchema";
import { postProcessAst } from "../../scripts/codegen/postProcessAst";
import { emitIrisModule } from "../../scripts/codegen/emitIrisModule";
import { renderSchemaSource } from "../../scripts/codegen/renderSchemaSource";

const fsLayer = Layer.mergeAll(BunFileSystem.layer, BunPath.layer);

// Mirrors the constant in scripts/generate-from-ttl.ts. Kept inline so
// the test doesn't need to import a script (which would pull in
// BunRuntime side-effects).
const ENERGY_INTEL_ROOT =
  "/Users/pooks/Dev/ontology_skill/ontologies/energy-intel/modules";
const COMMITTED_AGENT = "packages/ontology-store/src/generated/agent.ts";
const COMMITTED_IRIS = "packages/ontology-store/src/iris.ts";

describe("codegen drift gate", () => {
  it.effect("regenerated agent.ts matches committed", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;

      const ttl = yield* fs.readFileString(
        path.join(ENERGY_INTEL_ROOT, "agent.ttl")
      );
      const table = yield* parseTtlToClassTable(ttl);
      const jsonSchema = buildJsonSchema(table);
      const processed = yield* postProcessAst(jsonSchema, table);
      const regenerated = renderSchemaSource(processed, table);

      const committed = yield* fs.readFileString(COMMITTED_AGENT);
      expect(regenerated).toBe(committed);
    }).pipe(Effect.provide(fsLayer))
  );

  it.effect("regenerated iris.ts matches committed", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;

      const ttl = yield* fs.readFileString(
        path.join(ENERGY_INTEL_ROOT, "agent.ttl")
      );
      const table = yield* parseTtlToClassTable(ttl);
      const regenerated = emitIrisModule(table);

      const committed = yield* fs.readFileString(COMMITTED_IRIS);
      expect(regenerated).toBe(committed);
    }).pipe(Effect.provide(fsLayer))
  );
});
