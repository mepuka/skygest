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
and writes the generated TS into this package.

### Source of truth: the vendored TTL copy

To make codegen and the drift gate independent of any developer-laptop
checkout, the upstream TTLs are vendored under
`packages/ontology-store/vendor/energy-intel/`. The vendored copy is
pinned to a specific upstream commit recorded in `.upstream-commit`
inside that directory. Codegen reads from there by default — no
setup is required for users who only need to regenerate against the
pinned ontology.

See `packages/ontology-store/vendor/energy-intel/README.md` for the
manual update procedure (copy modified TTL → update `.upstream-commit`
→ run codegen → commit). A future ticket tracks automating that
procedure with an upstream-sync script.

### Running codegen

Default (reads vendored TTLs):

```bash
bun packages/ontology-store/scripts/generate-from-ttl.ts agent
```

Override (reads from a working copy of the upstream repo, useful when
iterating on TTL changes that have not yet been vendored):

```bash
ENERGY_INTEL_ROOT=/path/to/ontology_skill/ontologies/energy-intel/modules \
  bun packages/ontology-store/scripts/generate-from-ttl.ts agent
```

Modules: `agent`, `media`, `measurement`, `data`. Re-running with the
same input produces byte-identical output (the drift gate test asserts
this). `iris.ts` is always emitted from the union of every vendored
TTL — regenerating one module never drops terms from another.

### Drift gate

`tests/codegen/drift.test.ts` re-runs the pipeline in-memory against
the vendored TTL copy and asserts the regenerated output matches the
committed `src/generated/agent.ts` and `src/iris.ts` byte-for-byte.

The gate runs unconditionally — there is no env-var skip — because
its question ("does committed generated code match the pinned
vendored TTL?") is environment-independent.

## Layout

- `src/Domain/` — schemas, branded types, errors, contracts
- `src/Service/` — RDF store and SHACL services
- `src/agent/` — hand-written per-entity ontology modules (e.g. `Expert`)
- `src/generated/` — codegen output (do not edit by hand)
- `scripts/codegen/` — codegen pipeline stages
- `shapes/` — SHACL shapes (build-time only, never runtime)
- `vendor/energy-intel/` — pinned copy of upstream TTL modules
- `tests/` — unit and integration tests
