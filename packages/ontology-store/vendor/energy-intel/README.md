# Vendored energy-intel TTLs

This directory pins copies of the `energy-intel` ontology TTL modules
and SKOS concept-scheme TTLs that the codegen pipeline reads from.
Vendoring makes codegen and the drift gate independent of any
developer-laptop checkout of the upstream repo, so CI runs the gate
unconditionally.

## Source

Upstream: `ontology_skill` repo, path
`ontologies/energy-intel/modules/`.

Flat OWL modules live directly in this directory. SKOS concept-scheme
modules live under `concept-schemes/`, mirroring the upstream layout.

## Pin

The current upstream commit SHA is recorded in `.upstream-commit`.
Anything in this directory must be byte-identical to the upstream file
at that SHA.

## Manual update procedure

1. Pull the upstream repo to the desired commit.
2. Copy the modified TTL into this directory. Example for `agent.ttl`:

   ```bash
   cp /path/to/ontology_skill/ontologies/energy-intel/modules/agent.ttl \
      packages/ontology-store/vendor/energy-intel/agent.ttl
   ```

3. Update `.upstream-commit` with the new SHA:

   ```bash
   git -C /path/to/ontology_skill rev-parse HEAD \
     > packages/ontology-store/vendor/energy-intel/.upstream-commit
   ```

4. Re-run codegen for each vendored flat module and the concept-scheme
   generator, then verify there is no drift in `src/generated/`:

   ```bash
   bun packages/ontology-store/scripts/generate-from-ttl.ts agent
   bun packages/ontology-store/scripts/generate-from-ttl.ts media
   bun packages/ontology-store/scripts/generate-from-ttl.ts measurement
   bun packages/ontology-store/scripts/generate-from-ttl.ts data
   bun packages/ontology-store/scripts/generate-concepts-from-ttl.ts
   git diff packages/ontology-store/src/generated/  # should be empty
   ```

5. Commit the vendored TTL change, the new `.upstream-commit`, and any
   regenerated source under `src/generated/` together so the drift
   gate passes.

## Override for development

The codegen script defaults to reading from this directory. To run
codegen against a working copy of the upstream repo (e.g. when
iterating on TTL changes that have not yet been pushed), set
`ENERGY_INTEL_ROOT` to the upstream modules directory; the script
will read from that path instead.

```bash
ENERGY_INTEL_ROOT=/path/to/ontology_skill/ontologies/energy-intel/modules \
  bun packages/ontology-store/scripts/generate-from-ttl.ts agent
```

## Future automation

This is a manual sync today. A follow-up ticket will add a script
that reads the upstream commit SHA, fetches the corresponding
the flat TTL modules, updates `.upstream-commit`, and
emits a diff for review. Until then, the manual procedure above is
the contract.
