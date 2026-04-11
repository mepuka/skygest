# DCAT Harness

This module holds the shared parts of the cold-start DCAT ingest flow.

What belongs here:

- Alias merging and slug stability helpers
- Catalog loading and merge-key indexing
- Schema validation of candidate nodes
- Graph construction and duplicate-node checks
- Atomic file writes and id-ledger persistence
- The shared ingest runner used by adapter scripts
- Small HTTP helpers that every adapter can reuse

What does not belong here:

- Provider-specific fetch logic
- Provider-specific root resolution rules
- Provider-specific dataset naming
- Provider-specific reports or post-run artifacts

Adapter shape:

1. Fetch the provider source material.
2. Build adapter context from the loaded catalog index.
3. Build candidate `IngestNode` values.
4. Let the harness validate, graph, write, and update the ledger.
5. Use adapter hooks only for provider-specific side effects such as reports.

Current adapters:

- `src/ingest/dcat-adapters/eia-tree`
- `src/ingest/dcat-adapters/energy-charts`

The main design rule is to keep the harness generic enough to support a second adapter, but not so abstract that provider rules get hidden or smeared across the shared layer.
