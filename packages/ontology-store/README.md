# @skygest/ontology-store

Application-profile graph seam for the energy-intel ontology. Generates
Effect Schema sources from upstream TTL modules, ships SHACL shapes,
and exposes per-entity ontology modules (forward/reverse RDF mappings
plus AI Search projections).

## Codegen and the upstream ontology

The Effect Schema sources under `src/generated/` are produced from the
upstream `energy-intel` ontology, which lives in a sibling repo:

  https://github.com/<owner>/ontology_skill (or local clone, e.g.
  `/Users/<you>/Dev/ontology_skill`)

The codegen pipeline reads `<repo>/ontologies/energy-intel/modules/<module>.ttl`
and writes the generated TS into this package. Because the upstream
repo is not vendored here, codegen is gated on an env var.

### Setup

Set `ENERGY_INTEL_ROOT` to the absolute path of the upstream modules
directory:

```bash
export ENERGY_INTEL_ROOT=/path/to/ontology_skill/ontologies/energy-intel/modules
```

### Running codegen

```bash
ENERGY_INTEL_ROOT=/path/to/ontology_skill/ontologies/energy-intel/modules \
  bun packages/ontology-store/scripts/generate-from-ttl.ts agent
```

Modules: `agent`, `media`, `measurement`, `data`. Re-running with the
same input produces byte-identical output (the drift gate test asserts
this).

### Drift gate

`tests/codegen/drift.test.ts` re-runs the pipeline in-memory and asserts
the regenerated output matches the committed `src/generated/agent.ts`
and `src/iris.ts`.

The test is gated on `ENERGY_INTEL_ROOT`. CI environments where the
upstream repo isn't available (default) skip the gate; the rest of the
suite still runs.

A future ticket (SKY-368) tracks lifting this to a vendored or
git-submodule pattern so the drift gate can run unconditionally.

## Layout

- `src/Domain/` — schemas, branded types, errors, contracts
- `src/Service/` — RDF store and SHACL services
- `src/agent/` — hand-written per-entity ontology modules (e.g. `Expert`)
- `src/generated/` — codegen output (do not edit by hand)
- `scripts/codegen/` — codegen pipeline stages
- `shapes/` — SHACL shapes (build-time only, never runtime)
- `tests/` — unit and integration tests
