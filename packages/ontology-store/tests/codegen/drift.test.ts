/**
 * Drift gate: re-run the codegen pipeline in-memory against the same
 * upstream `agent.ttl` and assert the output matches the committed
 * `packages/ontology-store/src/generated/agent.ts` and
 * `packages/ontology-store/src/iris.ts` byte-for-byte.
 *
 * If this test fails, regenerate the committed files via:
 *   ENERGY_INTEL_ROOT=/path/to/ontology_skill/ontologies/energy-intel/modules \
 *     bun packages/ontology-store/scripts/generate-from-ttl.ts agent
 *
 * Gating: the codegen pipeline depends on the upstream ontology_skill
 * repo, which is not vendored. When `ENERGY_INTEL_ROOT` is unset (e.g.
 * default CI), this suite is skipped — the rest of the test suite still
 * runs. See packages/ontology-store/README.md for setup. SKY-368 tracks
 * making this unconditional via vendored or submoduled upstream.
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

// Resolved once at module load. Mirrors the resolution in
// scripts/generate-from-ttl.ts so the test and the script stay in sync.
const ENERGY_INTEL_ROOT = process.env.ENERGY_INTEL_ROOT;
const COMMITTED_AGENT = "packages/ontology-store/src/generated/agent.ts";
const COMMITTED_IRIS = "packages/ontology-store/src/iris.ts";

describe.skipIf(!ENERGY_INTEL_ROOT)("codegen drift gate", () => {
  it.effect("regenerated agent.ts matches committed", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;

      const ttl = yield* fs.readFileString(
        path.join(ENERGY_INTEL_ROOT!, "agent.ttl")
      );
      const table = yield* parseTtlToClassTable(ttl);
      const jsonSchema = yield* buildJsonSchema(table);
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
        path.join(ENERGY_INTEL_ROOT!, "agent.ttl")
      );
      const table = yield* parseTtlToClassTable(ttl);
      const regenerated = emitIrisModule(table);

      const committed = yield* fs.readFileString(COMMITTED_IRIS);
      expect(regenerated).toBe(committed);
    }).pipe(Effect.provide(fsLayer))
  );
});
