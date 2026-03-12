# Ontology Test Fixtures

Deterministic copies of the energy-news ontology release artifacts used by `tests/ontology-snapshot.test.ts`.

## Source

- **Ontology version:** 0.3.0
- **Source repo:** `ontology_skill/ontologies/energy-news`
- **Source commit:** `215ea05` (feat(enews): add article fetcher, extraction pipeline, and domain policies)
- **Copied on:** 2026-03-12

## Files

| Fixture | Source path |
|---------|------------|
| `energy-news-reference-individuals.ttl` | `release/energy-news-reference-individuals.ttl` |
| `derived-store-filter.md` | `docs/derived-store-filter.md` |
| `energy-news.json` | `release/energy-news.json` |

## Refresh instructions

When the ontology releases a new version:

1. Copy the three files listed above from the ontology repo into this directory.
2. Run `bunx vitest run tests/ontology-snapshot.test.ts` to verify the snapshot builder still passes.
3. Update this README with the new version, commit, and date.
4. If cardinality checks fail (e.g. concept count changed), update `buildSnapshot.ts` assertions.
