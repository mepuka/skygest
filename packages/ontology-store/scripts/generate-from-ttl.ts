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
import { Effect } from "effect"
import { BunRuntime, BunServices } from "@effect/platform-bun"

const MODULES = ["agent", "media", "measurement", "data"] as const
type Module = (typeof MODULES)[number]

// TODO(SKY-368): replace hard-coded path with an env var (e.g. `ENERGY_INTEL_ROOT`)
// once the codegen pipeline lands and the energy-intel ontology becomes a
// stable input. The path points outside this worktree because the ontology
// lives at /Users/pooks/Dev/ontology_skill/.
const ENERGY_INTEL_ROOT =
  "/Users/pooks/Dev/ontology_skill/ontologies/energy-intel/modules"

const main = Effect.gen(function* () {
  const args = Bun.argv.slice(2)
  const module = args[0] as Module | undefined
  if (!module || !MODULES.includes(module)) {
    yield* Effect.die(`Usage: generate-from-ttl.ts <${MODULES.join("|")}>`)
  }
  yield* Effect.log(`generating from module: ${module}`)
  yield* Effect.log(`energy-intel root: ${ENERGY_INTEL_ROOT}`)
  // Implementation lands in tasks 6-9.
})

BunRuntime.runMain(main.pipe(Effect.provide(BunServices.layer)))
