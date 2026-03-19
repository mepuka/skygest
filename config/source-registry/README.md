# Energy Provider Registry

This checked-in registry is the deliberate seed set for provider matching.

## Curation Rules

- Add only primary data providers, grid operators, agencies, or labs that are likely to appear in early Skygest threads.
- Keep `providerId` stable, lowercase, and kebab-cased. It is the canonical id used by downstream attribution work.
- Keep `providerLabel` to the name a reader would recognize in the UI.
- Add aliases only when they are specific enough for exact matching after lowercasing and whitespace normalization.
- Add only exact hostnames that genuinely belong to the provider. Avoid catch-all domains that could point at multiple organizations.
- Keep `sourceFamilies` lightweight. They are provider-specific hints, not a global taxonomy.
- Prefer durable series or product names over one-off yearly edition titles or vague buckets like `Market Report`.
- If a name is ambiguous across providers, leave it out until the matcher has evidence-based disambiguation.

## Extending The Seed Set

When adding a provider:

1. Add the canonical provider entry to [`energy.json`](./energy.json).
2. Include only the aliases and domains you are comfortable matching exactly.
3. Add a few high-signal source-family labels that commonly appear in charts, reports, or cited pages.
4. Run `bun run test tests/provider-registry.test.ts` and `bun run typecheck`.

## Growth Direction

This checked-in file is only the starting point.

- Prefer growing the registry from real observed sources in captured posts, linked pages, chart source lines, and confirmed operator documents.
- When a new provider shows up, promote it into the registry only after confirming the name, domain, and report labels from primary sources.
- Avoid adding speculative aliases or generic report buckets just to improve coverage.
- If a provider keeps appearing but the exact report family is unclear, add the provider first and wait to add report labels until they are anchored in real source material.
