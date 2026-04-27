#!/usr/bin/env bun
/**
 * Generate Effect Schema source from energy-intel TTL modules.
 *
 * Usage: bun packages/ontology-store/scripts/generate-from-ttl.ts <module>
 * Where <module> is one of: agent, media, measurement, data
 *
 * Pipeline:
 *   TTL → JSON Schema 2020-12 → Effect Schema AST →
 *   AST post-processor (brand IRIs, fold owl:equivalentClass) →
 *   TS source via SchemaRepresentation.toCodeDocument
 *
 * Implementation lands across tasks 6-9. This file is the entry-point
 * skeleton: argument validation + log-line + cleanup. The pipeline
 * stages will be filled in subsequent tasks.
 */
import { Effect, Schema } from "effect"
import { BunRuntime, BunServices } from "@effect/platform-bun"

const OntologyModuleSchema = Schema.Literals([
  "agent",
  "media",
  "measurement",
  "data"
])
type OntologyModule = typeof OntologyModuleSchema.Type

class InvalidModuleArg extends Schema.TaggedErrorClass<InvalidModuleArg>()(
  "InvalidModuleArg",
  {
    received: Schema.optionalKey(Schema.String),
    expected: Schema.Array(Schema.String)
  }
) {}

// TODO(SKY-368): replace hard-coded path with an env var (e.g. `ENERGY_INTEL_ROOT`)
// once the codegen pipeline lands and the energy-intel ontology becomes a
// stable input. The path points outside this worktree because the ontology
// lives at /Users/pooks/Dev/ontology_skill/.
const ENERGY_INTEL_ROOT =
  "/Users/pooks/Dev/ontology_skill/ontologies/energy-intel/modules"

const main = Effect.gen(function* () {
  const arg = Bun.argv[2]
  const module: OntologyModule = yield* Schema.decodeUnknownEffect(
    OntologyModuleSchema
  )(arg).pipe(
    Effect.mapError(
      () =>
        new InvalidModuleArg({
          received: arg,
          expected: ["agent", "media", "measurement", "data"]
        })
    )
  )
  yield* Effect.log(`generating from module: ${module}`)
  yield* Effect.log(`energy-intel root: ${ENERGY_INTEL_ROOT}`)
  // Implementation lands in tasks 6-9.
})

BunRuntime.runMain(main.pipe(Effect.provide(BunServices.layer)))
