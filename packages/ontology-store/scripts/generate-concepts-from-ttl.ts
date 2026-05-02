#!/usr/bin/env bun
/**
 * Generate src/generated/concepts.ts from vendored ontology_skill SKOS
 * concept-scheme TTLs.
 */
import { Effect, FileSystem, Path, Schema } from "effect";
import { BunRuntime, BunServices } from "@effect/platform-bun";
import {
  mergeConceptSchemeTables,
  parseConceptSchemeTtl
} from "./codegen/parseConceptSchemes.ts";
import { emitConceptSchemeModule } from "./codegen/emitConceptSchemeModule.ts";

class ConceptSchemeDirectoryMissingError extends Schema.TaggedErrorClass<ConceptSchemeDirectoryMissingError>()(
  "ConceptSchemeDirectoryMissingError",
  {
    path: Schema.String,
    message: Schema.String
  }
) {}

const resolveEnergyIntelRoot = (): Effect.Effect<string> =>
  Effect.sync(() => {
    const fromEnv = process.env.ENERGY_INTEL_ROOT;
    if (fromEnv) return fromEnv;
    return `${import.meta.dir}/../vendor/energy-intel`;
  });

const GENERATED_PATH = "packages/ontology-store/src/generated/concepts.ts";

const main = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const energyIntelRoot = yield* resolveEnergyIntelRoot();
  const conceptSchemeRoot = path.join(energyIntelRoot, "concept-schemes");

  const exists = yield* fs.exists(conceptSchemeRoot);
  if (!exists) {
    yield* new ConceptSchemeDirectoryMissingError({
      path: conceptSchemeRoot,
      message:
        `Concept-scheme TTLs not found at ${conceptSchemeRoot}. Vendored ` +
        `concept schemes live under packages/ontology-store/vendor/energy-intel/concept-schemes.`
    });
  }

  const entries = yield* fs.readDirectory(conceptSchemeRoot);
  const ttlNames = entries.filter((name) => name.endsWith(".ttl")).sort();
  const tables = yield* Effect.forEach(ttlNames, (name) =>
    Effect.gen(function* () {
      const ttl = yield* fs.readFileString(path.join(conceptSchemeRoot, name));
      return yield* parseConceptSchemeTtl(ttl);
    })
  );
  const merged = mergeConceptSchemeTables(tables);

  yield* fs.writeFileString(GENERATED_PATH, emitConceptSchemeModule(merged));
  yield* Effect.log(`generated: concepts.ts (${merged.concepts.length} concepts)`);
});

BunRuntime.runMain(main.pipe(Effect.provide(BunServices.layer)));
