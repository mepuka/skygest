#!/usr/bin/env bun
/**
 * Generate Effect Schema source from energy-intel TTL modules.
 *
 * Usage: bun packages/ontology-store/scripts/generate-from-ttl.ts <module>
 * Where <module> is one of: agent, media, measurement, data
 *
 * Pipeline:
 *   TTL → ClassTable (parseTtl)
 *      → JSON Schema 2020-12 (buildJsonSchema)
 *      → ProcessedAst with branded-IRI metadata + topo emit order (postProcessAst)
 *      → Effect Schema TS source (renderSchemaSource)
 *      → file write under packages/ontology-store/src/generated/<module>.ts
 *      + iris.ts namespace constants (emitIrisModule) under
 *        packages/ontology-store/src/iris.ts
 *
 * Idempotent: re-running with the same TTL input produces byte-identical
 * output. The drift gate test
 * (packages/ontology-store/tests/codegen/drift.test.ts) re-runs the
 * pipeline in-memory and asserts it matches the committed files.
 */
import { Effect, FileSystem, Path, Schema } from "effect";
import { BunRuntime, BunServices } from "@effect/platform-bun";
import { parseTtlToClassTable } from "./codegen/parseTtl.ts";
import { buildJsonSchema } from "./codegen/buildJsonSchema.ts";
import { postProcessAst } from "./codegen/postProcessAst.ts";
import { emitIrisModule } from "./codegen/emitIrisModule.ts";
import { renderSchemaSource } from "./codegen/renderSchemaSource.ts";

const OntologyModuleSchema = Schema.Literals([
  "agent",
  "media",
  "measurement",
  "data"
]);
type OntologyModule = typeof OntologyModuleSchema.Type;

class InvalidModuleArg extends Schema.TaggedErrorClass<InvalidModuleArg>()(
  "InvalidModuleArg",
  {
    received: Schema.optionalKey(Schema.String),
    expected: Schema.Array(Schema.String)
  }
) {}

class MissingEnergyIntelRootError extends Schema.TaggedErrorClass<MissingEnergyIntelRootError>()(
  "MissingEnergyIntelRootError",
  {
    message: Schema.String
  }
) {}

// Resolution order:
//   1. process.env.ENERGY_INTEL_ROOT — wins when set.
//   2. Otherwise, fail with MissingEnergyIntelRootError; the codegen
//      pipeline depends on the upstream ontology_skill repo and we
//      refuse to silently fall back to a developer-laptop path.
//
// TODO(SKY-368): lift to a git submodule or `.generated/upstream/...`
// checkout (similar to the cold-start data fetch precedent) so CI can
// run the drift gate unconditionally.
const resolveEnergyIntelRoot = (): Effect.Effect<
  string,
  MissingEnergyIntelRootError
> =>
  Effect.gen(function* () {
    const fromEnv = process.env.ENERGY_INTEL_ROOT;
    if (!fromEnv) {
      yield* new MissingEnergyIntelRootError({
        message:
          "ENERGY_INTEL_ROOT env var must point to the energy-intel modules directory " +
          "(e.g. ENERGY_INTEL_ROOT=/path/to/ontology_skill/ontologies/energy-intel/modules). " +
          "See packages/ontology-store/README.md for the upstream repo location."
      });
    }
    return fromEnv;
  });

const GENERATED_DIR = "packages/ontology-store/src/generated";
const IRIS_PATH = "packages/ontology-store/src/iris.ts";

const main = Effect.gen(function* () {
  const arg = Bun.argv[2];
  const moduleName: OntologyModule = yield* Schema.decodeUnknownEffect(
    OntologyModuleSchema
  )(arg).pipe(
    Effect.mapError(
      () =>
        new InvalidModuleArg({
          received: arg,
          expected: ["agent", "media", "measurement", "data"]
        })
    )
  );

  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  const energyIntelRoot = yield* resolveEnergyIntelRoot();
  const ttlPath = path.join(energyIntelRoot, `${moduleName}.ttl`);
  yield* Effect.log(`generating from module: ${moduleName}`);
  yield* Effect.log(`reading TTL: ${ttlPath}`);

  const ttl = yield* fs.readFileString(ttlPath);
  const table = yield* parseTtlToClassTable(ttl);
  const jsonSchema = buildJsonSchema(table);
  const processed = yield* postProcessAst(jsonSchema, table);

  const generatedSource = renderSchemaSource(processed, table);
  const irisSource = emitIrisModule(table);

  yield* fs.makeDirectory(GENERATED_DIR, { recursive: true });
  yield* fs.writeFileString(
    path.join(GENERATED_DIR, `${moduleName}.ts`),
    generatedSource
  );
  yield* fs.writeFileString(IRIS_PATH, irisSource);

  yield* Effect.log(`generated: ${moduleName}.ts and iris.ts`);
});

BunRuntime.runMain(main.pipe(Effect.provide(BunServices.layer)));
