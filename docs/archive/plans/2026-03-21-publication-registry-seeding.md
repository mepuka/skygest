# Publication Lookup for Source Attribution

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Populate `contentSource.publication` without changing provider matching. Extend the existing publication seed so it contains curated publication hostnames plus filtered ABox hostnames. Curated hosts keep their current tiers. ABox-only hosts use the existing `unknown` tier and are seeded into D1 as `source: "seed"`. Domains outside the ontology seed still enter later as `source: "discovered"` through runtime ingest.

**Architecture:** Reuse the single existing publication model (`PublicationTier`, `PublicationSource`, `PublicationSeedManifest`, `PublicationRecord`, `publications` table). Keep `config/ontology/publications-seed.json` as the only publication seed artifact. Add one shared resolver that both the web layer and source attribution use: normalize hostname, expand brand shorteners, try exact match, then try root-domain fallback. Keep one small checked-in shortener config, but only for aliases whose target hostnames already exist in the seed. Filter obvious infrastructure/CDN hosts out of ABox imports before they ever enter the seed.

**Tech Stack:** Effect Schema, existing `PublicationSeedManifest`, Bun build script, RDF regex extraction, shared pure resolver

---

## Why This Revision Is Aligned

This revision intentionally fixes the gaps from the prior review:

1. **ABox-only domains become matchable.** They are no longer logged and discarded. They are added to the existing publication seed as `tier: "unknown"`.
2. **The resolver is actually shared.** The web layer and source attribution both call the same `resolvePublicationEntry()` helper and use the same shortener map.
3. **Shorteners are aligned to real canonical hostnames.** Every shortener target must already exist in the publication seed, and a test enforces that.
4. **There is still only one publication model and one pipeline.** No second manifest, no second registry, no second JSON publication artifact.
5. **Provider matching semantics stay unchanged.** `resolution` remains provider-only.

---

## Runtime Semantics

| Case | Tier | Source | How it gets there |
|------|------|--------|-------------------|
| Curated publication from `derived-store-filter.md` | `energy-focused` or `general-outlet` | `seed` | build-time seed |
| ABox-only hostname that passes quality filter | `unknown` | `seed` | build-time seed |
| Hostname absent from ontology seed but seen during ingest | `unknown` | `discovered` | `ensureDomains()` at runtime |

Important consequences:

- `SourceAttributionResolution` does not change.
- `contentSource.publication` is additional metadata, not a provider signal.
- Curation still only treats `energy-focused` as tier-1, so adding `unknown` seed entries does not change the scoring rules.
- Source attribution does not need a matcher-time D1 query if the seed already includes the ABox-backed hostnames.

---

## Current Behavior

Today, source attribution can correctly leave provider resolution as unmatched while still failing to recognize the linked publication:

```json
{
  "resolution": "unmatched",
  "provider": null,
  "contentSource": {
    "url": "https://www.carbonbrief.org/analysis-when-...",
    "domain": "carbonbrief.org",
    "publication": null
  }
}
```

After this work:

```json
{
  "resolution": "unmatched",
  "provider": null,
  "contentSource": {
    "url": "https://www.carbonbrief.org/analysis-when-...",
    "domain": "carbonbrief.org",
    "publication": "carbonbrief.org"
  }
}
```

The provider result is unchanged. Only publication recognition improves.

---

## Existing Code Reference

| File | Role | Key Lines |
|------|------|-----------|
| `src/domain/bi.ts` | `PublicationTier`, `PublicationSource`, `PublicationSeedManifest`, `PublicationRecord` | 517-542 |
| `src/domain/source.ts` | `ContentSourceReference` (`publication: NullOr(String)`) | 17-25 |
| `src/domain/sourceMatching.ts` | `SourceAttributionResolution`, `SourceAttributionMatchResult` | 11-231 |
| `src/bootstrap/CheckedInPublications.ts` | Loads `publications-seed.json` | 1-53 |
| `src/ontology/buildSnapshot.ts` | `buildPublicationSeed()` | 270-298 |
| `src/scripts/build-ontology-snapshot.ts` | Writes `publications-seed.json` | 1-42 |
| `src/services/PublicationsRepo.ts` | `seedCurated()`, `ensureDomains()`, `getByHostnames()` | 1-31 |
| `src/services/d1/PublicationsRepoD1.ts` | D1 implementation of publication storage | 29-215 |
| `src/source/contentSource.ts` | Primary content-source assembly | 61-89 |
| `src/source/SourceAttributionRules.ts` | Calls `choosePrimaryContentSource()` | 387-455 |
| `src/source/SourceAttributionMatcher.ts` | Source-attribution service | 1-43 |
| `src/web/lib/publications.ts` | Current web-only publication resolution | 1-30 |

---

## Design Rules

1. **Use the existing publication model as-is.**
   Curated and ABox-derived hostnames all flow through `PublicationSeedManifest`.

2. **Keep provider logic separate.**
   Publication resolution must not influence `provider`, `providerCandidates`, or `resolution`.

3. **Treat the checked-in seed as the matcher's runtime catalog.**
   If a hostname should be matchable during source attribution, it must exist in `publications-seed.json`.

4. **Filter ABox noise before seeding it.**
   Do not rely on `contentSource.publication = null` as the quality gate. Keep junk hosts out of the catalog.

5. **Resolve with one shared algorithm everywhere.**
   Web and matcher use the same shortener expansion, exact-match, and root-domain fallback logic.

6. **Validate shortener targets against the seed.**
   Shortener aliases are only allowed when their target hostname already exists in the seeded publication catalog.

---

## Tasks

### Task 1: Align Seed Bootstrap With the Existing Domain Schema

**Files:**
- Modify: `src/bootstrap/CheckedInPublications.ts`

The current bootstrap module manually narrows publication seed tiers to only `energy-focused` and `general-outlet`. That was fine for the old 50-entry curated seed, but it will reject the expanded seed once ABox-only entries start using the already-existing `unknown` tier.

**Step 1:** Replace the bespoke validator with the existing schema from `src/domain/bi.ts`:

```typescript
import { Schema } from "effect";
import publicationsSeedJson from "../../config/ontology/publications-seed.json";
import { PublicationSeedManifest } from "../domain/bi";

export const publicationsSeedManifest = Schema.decodeUnknownSync(
  PublicationSeedManifest
)(publicationsSeedJson);
```

**Step 2:** Run `bunx tsc --noEmit` — expect clean.

**Step 3:** Run `bun run test` — expect all PASS.

**Step 4:** Commit: `refactor(publications): decode seed with shared PublicationSeedManifest`

---

### Task 2: Extend the Single Publication Seed Pipeline With Filtered ABox Hostnames

**Files:**
- Modify: `src/ontology/buildSnapshot.ts`
- Modify: `src/scripts/build-ontology-snapshot.ts`
- Regenerate: `config/ontology/publications-seed.json`

This is the core change. The ABox hostnames must enter the same checked-in seed artifact the rest of the system already uses.

**Target behavior:**

- Curated hostnames from `derived-store-filter.md` stay exactly as they are today.
- ABox-only hostnames that pass the quality filter are added as `tier: "unknown"`.
- Obvious infrastructure/CDN hosts are excluded before writing the seed.
- Runtime discovery still handles hostnames that are missing from the seed entirely.

**Step 1:** Extend the builder input to accept optional ABox TTL:

```typescript
type BuildOntologySnapshotInput = {
  readonly ttl: string;
  readonly derivedStoreFilter: string;
  readonly owlJson?: string;
  readonly aboxTtl?: string;
};
```

**Step 2:** Add ABox hostname parsing:

```typescript
const parseAboxPublicationDomains = (aboxTtl: string): ReadonlyArray<string> =>
  sortStrings(
    Array.from(
      aboxTtl.matchAll(/enews:siteDomain\s+"([^"]+)"/g),
      (match) => normalizeDomain(match[1] ?? "")
    ).filter((hostname) => hostname.length > 0)
  );
```

**Step 3:** Add a conservative quality filter for ABox-only hostnames.

Use an explicit suffix denylist for obvious non-publication infrastructure domains observed in the ontology output:

```typescript
const INFRASTRUCTURE_SUFFIX_DENYLIST = [
  "hubspotusercontent-na1.net",
  "hubspotusercontent-eu1.net",
  "cloudfront.net",
  "amazonaws.com",
  "azureedge.net"
] as const;

const isLikelyPublicationHostname = (hostname: string): boolean =>
  !INFRASTRUCTURE_SUFFIX_DENYLIST.some(
    (suffix) => hostname === suffix || hostname.endsWith(`.${suffix}`)
  );
```

Curated hostnames always win and are always retained. The filter only applies to ABox-only additions.

**Step 4:** Change `buildPublicationSeed()` so it merges curated and filtered ABox hostnames into one output list:

```typescript
const buildPublicationSeed = (
  derivedStoreFilter: string,
  ontologyVersion: string,
  snapshotVersion: string,
  aboxTtl?: string
): PublicationSeedManifest => {
  const energyFocusedDomains = parseDomains(derivedStoreFilter);
  const generalOutletDomains = parseGeneralOutletDomains(derivedStoreFilter);

  const tierByHostname = new Map<string, PublicationTier>();

  for (const hostname of energyFocusedDomains) {
    tierByHostname.set(hostname, "energy-focused");
  }

  for (const hostname of generalOutletDomains) {
    if (!tierByHostname.has(hostname)) {
      tierByHostname.set(hostname, "general-outlet");
    }
  }

  const aboxDomains = aboxTtl === undefined
    ? []
    : parseAboxPublicationDomains(aboxTtl);

  for (const hostname of aboxDomains) {
    if (!tierByHostname.has(hostname) && isLikelyPublicationHostname(hostname)) {
      tierByHostname.set(hostname, "unknown");
    }
  }

  const publications = Array.from(tierByHostname.entries(), ([hostname, tier]) => ({
    hostname,
    tier
  })).sort((a, b) => a.hostname.localeCompare(b.hostname));

  return {
    ontologyVersion,
    snapshotVersion,
    publications
  };
};
```

**Step 5:** Add build logging so the output is explainable:

- curated total
- raw ABox total
- accepted ABox additions
- rejected ABox additions
- final seed total

This is important because the final total should be "ABox-sized after filtering", not just the old 50-entry curated list.

**Step 6:** Update `src/scripts/build-ontology-snapshot.ts` to read `data/abox-snapshot.ttl` when present and pass it through to `buildOntologyArtifacts()`.

**Step 7:** Run `bun run build:ontology-snapshot`.

**Expected output:** `config/ontology/publications-seed.json` grows from the old curated-only set to a much larger mixed catalog with:

- curated entries still tiered as `energy-focused` / `general-outlet`
- many additional ABox-derived entries tiered as `unknown`
- obvious infrastructure hosts excluded

**Step 8:** Run `bun run test` — expect all PASS.

**Step 9:** Commit: `feat(ontology): seed filtered ABox publication hostnames`

---

### Task 3: Add a Shared Brand-Shortener Catalog and Validate It Against the Seed

**Files:**
- Create: `config/source-registry/brand-shorteners.json`
- Create: `src/source/brandShorteners.ts`
- Modify: `src/domain/source.ts`
- Create: `tests/brand-shorteners.test.ts`

The shortener list must align to real canonical hostnames that already exist in the publication seed. Do not include aliases whose targets are not seeded.

**Step 1:** Add schema types in `src/domain/source.ts`:

```typescript
export const BrandShortenerEntry = Schema.Struct({
  shortDomain: Schema.String.pipe(Schema.minLength(1)),
  resolvedDomain: Schema.String.pipe(Schema.minLength(1))
});
export type BrandShortenerEntry = Schema.Schema.Type<typeof BrandShortenerEntry>;

export const BrandShortenerManifest = Schema.Struct({
  version: Schema.String.pipe(Schema.minLength(1)),
  entries: Schema.Array(BrandShortenerEntry)
});
export type BrandShortenerManifest = Schema.Schema.Type<
  typeof BrandShortenerManifest
>;
```

**Step 2:** Create the checked-in shortener config with only canonical targets that already exist in the seed:

```json
{
  "version": "2026-03-21",
  "entries": [
    { "shortDomain": "reut.rs", "resolvedDomain": "reuters.com" },
    { "shortDomain": "nyti.ms", "resolvedDomain": "nytimes.com" },
    { "shortDomain": "wapo.st", "resolvedDomain": "washingtonpost.com" },
    { "shortDomain": "cnb.cx", "resolvedDomain": "cnbc.com" },
    { "shortDomain": "wrd.cm", "resolvedDomain": "wired.com" },
    { "shortDomain": "on.ft.com", "resolvedDomain": "financialtimes.com" },
    { "shortDomain": "econ.st", "resolvedDomain": "economist.com" },
    { "shortDomain": "bloom.bg", "resolvedDomain": "bloomberg.com" },
    { "shortDomain": "politi.co", "resolvedDomain": "politico.com" },
    { "shortDomain": "hill.cm", "resolvedDomain": "thehill.com" }
  ]
}
```

Notably omitted for now:

- `cnn.it`
- `bbc.in`
- `fxn.ws`

Those remain out of scope until their canonical targets are admitted to the publication seed.

**Step 3:** Create a shared module that decodes the config and exports one map for the rest of the app:

```typescript
import { Schema } from "effect";
import { normalizeDomain } from "../domain/normalize";
import shortenerJson from "../../config/source-registry/brand-shorteners.json";
import { BrandShortenerManifest } from "../domain/source";

export const brandShortenerManifest = Schema.decodeUnknownSync(
  BrandShortenerManifest
)(shortenerJson);

export const brandShortenerMap = new Map(
  brandShortenerManifest.entries.map((entry) => [
    normalizeDomain(entry.shortDomain),
    normalizeDomain(entry.resolvedDomain)
  ])
);
```

**Step 4:** Add a test that validates every `resolvedDomain` exists in `publicationsSeedManifest.publications`.

That test is the guardrail against future shortener drift.

**Step 5:** Run `bunx tsc --noEmit` — expect clean.

**Step 6:** Run `bun run test tests/brand-shorteners.test.ts` — expect PASS.

**Step 7:** Commit: `feat(source): add validated brand shortener catalog`

---

### Task 4: Create One Shared Publication Resolver

**Files:**
- Create: `src/source/publicationResolver.ts`
- Create: `tests/publication-resolver.test.ts`

The resolver must return full entries, not just labels, so both the web layer and source attribution can use the same logic.

**Step 1:** Implement a generic entry-based resolver:

```typescript
import { normalizeDomain } from "../domain/normalize";

export type PublicationLike = {
  readonly hostname: string;
};

export const publicationDisplayLabel = (hostname: string): string => {
  switch (hostname) {
    case "reuters.com":
      return "Reuters";
    case "financialtimes.com":
      return "Financial Times";
    case "nytimes.com":
      return "The New York Times";
    case "washingtonpost.com":
      return "The Washington Post";
    default:
      return hostname;
  }
};

export const extractRootDomain = (domain: string): string => {
  const parts = normalizeDomain(domain).split(".");
  if (parts.length <= 2) return normalizeDomain(domain);
  return parts.slice(-2).join(".");
};

export const buildPublicationIndex = <A extends PublicationLike>(
  items: ReadonlyArray<A>
): ReadonlyMap<string, A> => {
  const map = new Map<string, A>();
  for (const item of items) {
    map.set(normalizeDomain(item.hostname), item);
  }
  return map;
};

export const resolvePublicationEntry = <A extends PublicationLike>(
  domain: string | null,
  index: ReadonlyMap<string, A>,
  brandShortenerMap: ReadonlyMap<string, string>
): A | null => {
  if (domain === null) return null;

  const normalized = normalizeDomain(domain);
  const expanded = brandShortenerMap.get(normalized) ?? normalized;

  const exact = index.get(expanded);
  if (exact !== undefined) return exact;

  const root = extractRootDomain(expanded);
  return index.get(root) ?? null;
};
```

**Step 2:** Add tests using real canonical hostnames from the seed:

- exact hostname
- `www.` normalization
- subdomain fallback
- shortener expansion
- `financialtimes.com` target rather than synthetic `ft.com`
- unknown domain returns `null`

Use the shared `brandShortenerMap` in the test so the real config is exercised.

**Step 3:** Run `bun run test tests/publication-resolver.test.ts` — expect PASS.

**Step 4:** Commit: `feat(source): add shared publication resolver`

---

### Task 5: Wire Shared Publication Resolution Into Content Source Assembly

**Files:**
- Modify: `src/source/contentSource.ts`
- Modify: `src/source/SourceAttributionRules.ts`
- Modify: `src/source/SourceAttributionMatcher.ts`
- Create: `tests/content-source.test.ts`
- Update: `tests/source-attribution-matcher.test.ts`

**Step 1:** Add an optional `PublicationContext` to `contentSource.ts`:

```typescript
import type { PublicationSeed } from "../domain/bi";
import {
  buildPublicationIndex,
  publicationDisplayLabel,
  resolvePublicationEntry
} from "./publicationResolver";

export interface PublicationContext {
  readonly publicationIndex: ReadonlyMap<string, PublicationSeed>;
  readonly brandShortenerMap: ReadonlyMap<string, string>;
}
```

**Step 2:** Change `choosePrimaryContentSource()` so it uses the shared resolver when context is provided:

```typescript
const publication = publicationContext === undefined
  ? null
  : (() => {
      const entry = resolvePublicationEntry(
        domain,
        publicationContext.publicationIndex,
        publicationContext.brandShortenerMap
      );
      return entry === null ? null : publicationDisplayLabel(entry.hostname);
    })();
```

The function stays backward-compatible when no publication context is passed.

**Step 3:** In `SourceAttributionMatcher.ts`, build one publication context from the expanded seed and the shared shortener map:

```typescript
import { publicationsSeedManifest } from "../bootstrap/CheckedInPublications";
import { brandShortenerMap } from "./brandShorteners";
import { buildPublicationIndex } from "./publicationResolver";

const publicationContext: PublicationContext = {
  publicationIndex: buildPublicationIndex(publicationsSeedManifest.publications),
  brandShortenerMap
};
```

Pass that context through `matchSourceAttribution()` and into `choosePrimaryContentSource()`.

**Step 4:** Add or update tests for the matcher itself:

- `carbonbrief.org` produces `resolution: "unmatched"` but `contentSource.publication = "carbonbrief.org"`
- `https://reut.rs/...` resolves to `Reuters`
- `https://news.reuters.com/...` resolves to `Reuters`
- existing provider tests remain unchanged

**Step 5:** Run `bun run test tests/content-source.test.ts`.

**Step 6:** Run `bun run test tests/source-attribution-matcher.test.ts`.

**Step 7:** Run `bun run test` — expect all PASS.

**Step 8:** Commit: `feat(source): populate contentSource publication from shared seed catalog`

---

### Task 6: Migrate the Web Layer to the Same Shared Resolver

**Files:**
- Modify: `src/web/lib/publications.ts`

This is where the resolver truly becomes shared end to end.

**Step 1:** Replace the local resolver with the generic shared one:

```typescript
import type { PublicationListItem } from "../lib/api.ts";
import { brandShortenerMap } from "../../source/brandShorteners";
import {
  buildPublicationIndex as buildSharedIndex,
  resolvePublicationEntry
} from "../../source/publicationResolver";

export function buildPublicationIndex(
  items: readonly PublicationListItem[]
): ReadonlyMap<string, PublicationListItem> {
  return buildSharedIndex(items);
}

export function resolvePublication(
  domain: string | null,
  index: ReadonlyMap<string, PublicationListItem>
): PublicationListItem | null {
  return resolvePublicationEntry(domain, index, brandShortenerMap);
}

export function formatDomainLabel(domain: string): string {
  return domain.replace(/^www\./i, "");
}
```

This preserves the web layer's existing return shape (`PublicationListItem | null`) while using the exact same resolution logic as source attribution.

**Step 2:** Remove the now-duplicated local `extractRootDomain()` implementation.

**Step 3:** Run `bunx tsc --noEmit` — expect clean.

**Step 4:** Run `bun run test` — expect all PASS.

**Step 5:** Commit: `refactor(web): use shared publication resolver`

---

### Task 7: Verify the Expanded Catalog End to End

This is a mix of local and staging verification. Do both.

#### Local verification

**Step 1:** Rebuild the ontology seed:

```bash
bun run build:ontology-snapshot
```

**Step 2:** Inspect the output and confirm:

- curated entries such as `carbonbrief.org` still have their curated tier
- ABox-only legitimate publication hostnames now appear with `tier: "unknown"`
- obvious infrastructure hosts such as `*.hubspotusercontent-na1.net` are absent

**Step 3:** Run the focused tests:

```bash
bun run test tests/brand-shorteners.test.ts
bun run test tests/publication-resolver.test.ts
bun run test tests/content-source.test.ts
bun run test tests/source-attribution-matcher.test.ts
```

#### Staging verification

**Step 4:** Deploy staging:

```bash
bunx wrangler deploy --env staging
bunx wrangler deploy --config wrangler.agent.toml --env staging
```

**Step 5:** Seed publications so the expanded seed is loaded into D1:

```bash
export $(grep -v '^#' .env.staging | xargs)
bun run ops -- stage seed-publications --base-url "$SKYGEST_STAGING_BASE_URL"
```

**Step 6:** Re-run source attribution for a known linked-publication post:

```bash
curl -s -X POST "$SKYGEST_STAGING_INGEST_URL/admin/enrichment/start" \
  -H "content-type: application/json" \
  -H "x-skygest-operator-secret: $SKYGEST_OPERATOR_SECRET" \
  -d '{"postUri": "at://did:plc:r5ofoghdcbtjqiujqpvja4uh/app.bsky.feed.post/3mhizmc3k4k2r", "enrichmentType": "source-attribution"}'
```

**Step 7:** Verify `contentSource`:

```bash
curl -s "$SKYGEST_STAGING_BASE_URL/api/posts/at%3A%2F%2Fdid%3Aplc%3Ar5ofoghdcbtjqiujqpvja4uh%2Fapp.bsky.feed.post%2F3mhizmc3k4k2r/enrichments" | jq '.enrichments[0].payload.contentSource'
```

**Expected:**

```json
{
  "url": "https://www.carbonbrief.org/analysis-when-...",
  "domain": "carbonbrief.org",
  "publication": "carbonbrief.org"
}
```

**Step 8:** Verify provider resolution is unchanged:

```bash
curl -s "$SKYGEST_STAGING_BASE_URL/api/posts/at%3A%2F%2Fdid%3Aplc%3Ar5ofoghdcbtjqiujqpvja4uh%2Fapp.bsky.feed.post%2F3mhizmc3k4k2r/enrichments" | jq '.enrichments[0].payload.resolution'
```

**Expected:** `"unmatched"`

**Step 9:** Verify at least one shortener-backed case and one subdomain-backed case in tests or staging samples before considering the work complete.

---

## File Change Summary

| Action | File | Description |
|--------|------|-------------|
| Modify | `src/bootstrap/CheckedInPublications.ts` | Decode seed with shared `PublicationSeedManifest` |
| Modify | `src/ontology/buildSnapshot.ts` | Parse ABox hostnames, filter noise, merge ABox-only hosts into seed as `unknown` |
| Modify | `src/scripts/build-ontology-snapshot.ts` | Read optional ABox TTL and pass it through |
| Regenerate | `config/ontology/publications-seed.json` | Expanded single publication seed artifact |
| Modify | `src/domain/source.ts` | Add `BrandShortenerEntry` and `BrandShortenerManifest` |
| Create | `config/source-registry/brand-shorteners.json` | Checked-in shortener aliases aligned to canonical hostnames |
| Create | `src/source/brandShorteners.ts` | Shared decoded shortener manifest and map |
| Create | `tests/brand-shorteners.test.ts` | Enforce that shortener targets exist in the publication seed |
| Create | `src/source/publicationResolver.ts` | Shared generic publication resolver |
| Create | `tests/publication-resolver.test.ts` | Resolver tests with real canonical hostnames |
| Modify | `src/source/contentSource.ts` | Populate `publication` using shared resolver |
| Modify | `src/source/SourceAttributionRules.ts` | Pass `PublicationContext` through |
| Modify | `src/source/SourceAttributionMatcher.ts` | Build publication context from expanded seed + shared shortener map |
| Create | `tests/content-source.test.ts` | Content-source publication tests |
| Modify | `tests/source-attribution-matcher.test.ts` | Assert publication recognition without changing provider resolution |
| Modify | `src/web/lib/publications.ts` | Use the same shared resolver as the matcher |

**Not modified:**

- `src/domain/sourceMatching.ts` — provider resolution schema stays unchanged
- `src/services/d1/PublicationsRepoD1.ts` — runtime `ensureDomains()` remains the fallback for hostnames absent from the seed
- `config/source-registry/energy.json` — provider registry untouched
- `src/enrichment/Layer.ts` — no new service tag required

---

## Finishing Criteria

This work is only done when all of the following are true:

1. `publications-seed.json` contains curated entries plus filtered ABox-only entries using the existing schema.
2. ABox-only hostnames are matchable during source attribution because they exist in the seed catalog used by the matcher.
3. Shortener targets are validated against real canonical seed hostnames.
4. Web and source attribution both call the same resolver with the same shortener map.
5. `contentSource.publication` is populated for known publication links while provider `resolution` remains unchanged.
6. Obvious infrastructure/CDN hostnames are not present in the seeded publication catalog.
7. Local tests and staging verification both pass.
