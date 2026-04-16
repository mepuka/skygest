# SKY-45 + SKY-46 Phase 1 — Evidence Contract & Text/Link Matching

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Define the internal evidence contract types (SKY-45) and implement deterministic source attribution matching for non-vision signals (SKY-46 Phase 1: link-domain, embed-link-domain, post-text-mention).

**Architecture:** Pure domain types for evidence in `src/domain/source.ts`, a `SourceAttributionMatcher` Effect service in `src/source/`, and content source / social provenance assembly. Vision signals (source-line-alias, chart-title-alias, visible-url-domain) are deferred to SKY-46 Phase 2 after SKY-49 ships.

**Tech Stack:** Effect Schema, Effect Context.Tag services, ProviderRegistry from SKY-44, existing enrichment plan types.

---

### Task 1: Define evidence contract types

**Files:**
- Modify: `src/domain/source.ts`

**Step 1: Write the failing test**

Create `tests/source-attribution-matcher.test.ts`:

```typescript
import { describe, expect, it } from "@effect/vitest";
import { Schema } from "effect";
import {
  MatchSignalType,
  MatchEvidence,
  ProviderMatch,
  MatchResult
} from "../src/domain/source";

describe("evidence contract types", () => {
  it("MatchSignalType accepts all 7 signal types", () => {
    const signals: Schema.Schema.Type<typeof MatchSignalType>[] = [
      "source-line-alias",
      "source-line-domain",
      "chart-title-alias",
      "link-domain",
      "embed-link-domain",
      "visible-url-domain",
      "post-text-mention"
    ];
    expect(signals).toHaveLength(7);
  });

  it("MatchResult resolution discriminates matched/ambiguous/none", () => {
    const decode = Schema.decodeUnknownSync(MatchResult);
    const result = decode({
      providerMatches: [],
      selectedProvider: null,
      resolution: "none",
      contentSource: null,
      socialProvenance: null
    });
    expect(result.resolution).toBe("none");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/pooks/Dev/skygest-cloudflare && bun run test -- tests/source-attribution-matcher.test.ts`
Expected: FAIL — MatchSignalType, MatchEvidence, ProviderMatch, MatchResult not exported

**Step 3: Add evidence types to source.ts**

Add after the existing `ProviderRegistryManifest` definition (~line 51):

```typescript
// ---------------------------------------------------------------------------
// Match evidence contract (SKY-45)
// ---------------------------------------------------------------------------

export const MatchSignalType = Schema.Literal(
  "source-line-alias",
  "source-line-domain",
  "chart-title-alias",
  "link-domain",
  "embed-link-domain",
  "visible-url-domain",
  "post-text-mention"
);
export type MatchSignalType = Schema.Schema.Type<typeof MatchSignalType>;

export const MatchEvidence = Schema.Struct({
  signal: MatchSignalType,
  raw: Schema.Record({ key: Schema.String, value: Schema.String })
});
export type MatchEvidence = Schema.Schema.Type<typeof MatchEvidence>;

export const ProviderMatch = Schema.Struct({
  providerId: ProviderId,
  providerLabel: Schema.String,
  sourceFamily: Schema.NullOr(Schema.String),
  signals: Schema.Array(MatchEvidence)
});
export type ProviderMatch = Schema.Schema.Type<typeof ProviderMatch>;

export const MatchResolution = Schema.Literal("matched", "ambiguous", "none");
export type MatchResolution = Schema.Schema.Type<typeof MatchResolution>;

export const MatchResult = Schema.Struct({
  providerMatches: Schema.Array(ProviderMatch),
  selectedProvider: Schema.NullOr(ProviderReference),
  resolution: MatchResolution,
  contentSource: Schema.NullOr(ContentSourceReference),
  socialProvenance: Schema.NullOr(SocialProvenance)
});
export type MatchResult = Schema.Schema.Type<typeof MatchResult>;
```

**Step 4: Run test to verify it passes**

Run: `cd /Users/pooks/Dev/skygest-cloudflare && bun run test -- tests/source-attribution-matcher.test.ts`
Expected: PASS

**Step 5: Verify full test suite**

Run: `cd /Users/pooks/Dev/skygest-cloudflare && bunx tsc --noEmit && bun run test`

**Step 6: Commit**

```bash
git add src/domain/source.ts tests/source-attribution-matcher.test.ts
git commit -m "feat(sky-45): add match evidence contract types"
```

---

### Task 2: Implement normalization utilities

**Files:**
- Create: `src/source/normalize.ts`
- Add to: `tests/source-attribution-matcher.test.ts`

**Step 1: Write the failing tests**

Add to `tests/source-attribution-matcher.test.ts`:

```typescript
import {
  stripSourcePrefix,
  isWholeWordMatch,
  extractDomainFromText
} from "../src/source/normalize";

describe("normalization utilities", () => {
  it("stripSourcePrefix removes common prefixes", () => {
    expect(stripSourcePrefix("Source: EIA")).toBe("EIA");
    expect(stripSourcePrefix("Data: AESO")).toBe("AESO");
    expect(stripSourcePrefix("Source data: BC Hydro")).toBe("BC Hydro");
    expect(stripSourcePrefix("via ERCOT")).toBe("ERCOT");
    expect(stripSourcePrefix("EIA")).toBe("EIA");
  });

  it("isWholeWordMatch matches on word boundaries", () => {
    expect(isWholeWordMatch("ERCOT demand is near peak", "ERCOT")).toBe(true);
    expect(isWholeWordMatch("the ercot grid", "ERCOT")).toBe(true);
    expect(isWholeWordMatch("forecast data", "ERCOT")).toBe(false);
    expect(isWholeWordMatch("ISO-NE prices", "ISO-NE")).toBe(true);
  });

  it("isWholeWordMatch skips aliases shorter than 3 chars", () => {
    expect(isWholeWordMatch("BC Hydro report", "BC")).toBe(false);
  });

  it("extractDomainFromText finds domains in text", () => {
    expect(extractDomainFromText("Source: eia.gov")).toBe("eia.gov");
    expect(extractDomainFromText("https://ercot.com/data")).toBe("ercot.com");
    expect(extractDomainFromText("Source: EIA")).toBeNull();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/pooks/Dev/skygest-cloudflare && bun run test -- tests/source-attribution-matcher.test.ts`
Expected: FAIL — module not found

**Step 3: Implement normalize.ts**

Create `src/source/normalize.ts`:

```typescript
const SOURCE_PREFIXES = [
  /^source\s*data\s*:\s*/iu,
  /^source\s*:\s*/iu,
  /^data\s*:\s*/iu,
  /^via\s+/iu
];

export const stripSourcePrefix = (text: string): string => {
  let result = text.trim();
  for (const prefix of SOURCE_PREFIXES) {
    result = result.replace(prefix, "");
  }
  return result.trim();
};

export const isWholeWordMatch = (
  text: string,
  alias: string
): boolean => {
  if (alias.length < 3) return false;
  const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`\\b${escaped}\\b`, "iu");
  return pattern.test(text);
};

const DOMAIN_PATTERN = /(?:https?:\/\/)?([a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+)/iu;

export const extractDomainFromText = (text: string): string | null => {
  const match = DOMAIN_PATTERN.exec(text);
  if (!match?.[1]) return null;
  return match[1].toLowerCase().replace(/^www\./u, "");
};
```

**Step 4: Run test to verify it passes**

Run: `cd /Users/pooks/Dev/skygest-cloudflare && bun run test -- tests/source-attribution-matcher.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/source/normalize.ts tests/source-attribution-matcher.test.ts
git commit -m "feat(sky-46): add source attribution normalization utilities"
```

---

### Task 3: Implement content source assembly

**Files:**
- Create: `src/source/contentSource.ts`
- Add to: `tests/source-attribution-matcher.test.ts`

**Step 1: Write the failing tests**

Add to `tests/source-attribution-matcher.test.ts`:

```typescript
import { choosePrimaryContentSource } from "../src/source/contentSource";

describe("content source assembly", () => {
  it("prefers embed link card URL", () => {
    const result = choosePrimaryContentSource({
      linkCards: [{ source: "embed" as const, uri: "https://utilitydive.com/story/123", title: "Article", description: null, thumb: null }],
      links: [{ url: "https://other.com", domain: "other.com", title: null, description: null, imageUrl: null, extractedAt: 0 }]
    });
    expect(result?.url).toBe("https://utilitydive.com/story/123");
    expect(result?.domain).toBe("utilitydive.com");
  });

  it("falls back to single unique link", () => {
    const result = choosePrimaryContentSource({
      linkCards: [],
      links: [{ url: "https://eia.gov/report", domain: "eia.gov", title: "Report", description: null, imageUrl: null, extractedAt: 0 }]
    });
    expect(result?.url).toBe("https://eia.gov/report");
  });

  it("returns null for multiple unrelated links", () => {
    const result = choosePrimaryContentSource({
      linkCards: [],
      links: [
        { url: "https://a.com", domain: "a.com", title: null, description: null, imageUrl: null, extractedAt: 0 },
        { url: "https://b.com", domain: "b.com", title: null, description: null, imageUrl: null, extractedAt: 0 }
      ]
    });
    expect(result).toBeNull();
  });

  it("returns null when no links exist", () => {
    const result = choosePrimaryContentSource({ linkCards: [], links: [] });
    expect(result).toBeNull();
  });
});
```

**Step 2: Run test to verify it fails**

**Step 3: Implement contentSource.ts**

Create `src/source/contentSource.ts`:

```typescript
import type { ContentSourceReference } from "../domain/source";
import type { LinkRecord } from "../domain/bi";

interface ContentSourceInput {
  readonly linkCards: ReadonlyArray<{
    readonly uri: string;
    readonly title: string | null;
    readonly description: string | null;
  }>;
  readonly links: ReadonlyArray<Pick<LinkRecord, "url" | "domain" | "title">>;
}

const parseDomain = (url: string): string | null => {
  try {
    return new URL(url).hostname.replace(/^www\./u, "").toLowerCase();
  } catch {
    return null;
  }
};

export const choosePrimaryContentSource = (
  input: ContentSourceInput
): ContentSourceReference | null => {
  // Rule 1: prefer explicit embed link card
  if (input.linkCards.length > 0) {
    const card = input.linkCards[0]!;
    return {
      url: card.uri,
      title: card.title ?? null,
      domain: parseDomain(card.uri),
      publication: null
    } as ContentSourceReference;
  }

  // Rule 2: single unique link
  if (input.links.length === 1) {
    const link = input.links[0]!;
    return {
      url: link.url,
      title: link.title ?? null,
      domain: link.domain ?? parseDomain(link.url),
      publication: null
    } as ContentSourceReference;
  }

  // Rule 3: multiple links or none — don't guess
  return null;
};
```

**Step 4: Run test to verify it passes**

**Step 5: Commit**

```bash
git add src/source/contentSource.ts tests/source-attribution-matcher.test.ts
git commit -m "feat(sky-46): add content source assembly"
```

---

### Task 4: Implement SourceAttributionMatcher service

**Files:**
- Create: `src/source/SourceAttributionMatcher.ts`
- Add to: `tests/source-attribution-matcher.test.ts`

This is the core matching service. Phase 1 implements signals 4, 5, 7 (link-domain, embed-link-domain, post-text-mention). Vision signals are stubbed.

**Step 1: Write the failing tests**

Add to `tests/source-attribution-matcher.test.ts`:

```typescript
import { Effect, Layer } from "effect";
import { SourceAttributionMatcher } from "../src/source/SourceAttributionMatcher";
import { ProviderRegistry } from "../src/services/ProviderRegistry";

// Use the real registry layer from the test runtime
// (the provider-registry tests already validate lookup behavior)

describe("SourceAttributionMatcher", () => {
  it("matches provider from link domain", () =>
    Effect.gen(function* () {
      const matcher = yield* SourceAttributionMatcher;
      const result = yield* matcher.match({
        post: { did: "did:plc:test", text: "Check this out" },
        links: [{ url: "https://ercot.com/gridinfo", domain: "ercot.com", title: null, description: null, imageUrl: null, extractedAt: 0 }],
        linkCards: [],
        vision: null
      });
      expect(result.resolution).toBe("matched");
      expect(result.selectedProvider?.providerId).toBe("ercot");
      expect(result.providerMatches[0]?.signals[0]?.signal).toBe("link-domain");
    }));

  it("matches provider from post text mention", () =>
    Effect.gen(function* () {
      const matcher = yield* SourceAttributionMatcher;
      const result = yield* matcher.match({
        post: { did: "did:plc:test", text: "ERCOT demand is near peak today" },
        links: [],
        linkCards: [],
        vision: null
      });
      expect(result.resolution).toBe("matched");
      expect(result.selectedProvider?.providerId).toBe("ercot");
      expect(result.providerMatches[0]?.signals[0]?.signal).toBe("post-text-mention");
    }));

  it("returns ambiguous when multiple providers match at same rank", () =>
    Effect.gen(function* () {
      const matcher = yield* SourceAttributionMatcher;
      const result = yield* matcher.match({
        post: { did: "did:plc:test", text: "Comparing ERCOT and CAISO load data" },
        links: [],
        linkCards: [],
        vision: null
      });
      expect(result.resolution).toBe("ambiguous");
      expect(result.selectedProvider).toBeNull();
      expect(result.providerMatches.length).toBeGreaterThanOrEqual(2);
    }));

  it("returns none when no signals match", () =>
    Effect.gen(function* () {
      const matcher = yield* SourceAttributionMatcher;
      const result = yield* matcher.match({
        post: { did: "did:plc:test", text: "Beautiful sunset today" },
        links: [],
        linkCards: [],
        vision: null
      });
      expect(result.resolution).toBe("none");
      expect(result.selectedProvider).toBeNull();
    }));

  it("assembles socialProvenance from post DID", () =>
    Effect.gen(function* () {
      const matcher = yield* SourceAttributionMatcher;
      const result = yield* matcher.match({
        post: { did: "did:plc:abc123", text: "test" },
        links: [],
        linkCards: [],
        vision: null
      });
      expect(result.socialProvenance?.did).toBe("did:plc:abc123");
    }));

  it("link-domain outranks post-text-mention", () =>
    Effect.gen(function* () {
      const matcher = yield* SourceAttributionMatcher;
      const result = yield* matcher.match({
        post: { did: "did:plc:test", text: "CAISO data looks interesting" },
        links: [{ url: "https://ercot.com/data", domain: "ercot.com", title: null, description: null, imageUrl: null, extractedAt: 0 }],
        linkCards: [],
        vision: null
      });
      // Both ERCOT (link-domain rank 4) and CAISO (post-text-mention rank 7) match
      // ERCOT has stronger signal
      expect(result.resolution).toBe("matched");
      expect(result.selectedProvider?.providerId).toBe("ercot");
    }));

  it("assembles contentSource from link card", () =>
    Effect.gen(function* () {
      const matcher = yield* SourceAttributionMatcher;
      const result = yield* matcher.match({
        post: { did: "did:plc:test", text: "ERCOT report" },
        links: [],
        linkCards: [{ source: "embed" as const, uri: "https://gridstatus.io/live/ercot", title: "ERCOT Dashboard", description: null, thumb: null }],
        vision: null
      });
      expect(result.contentSource?.domain).toBe("gridstatus.io");
      expect(result.selectedProvider?.providerId).toBe("ercot");
    }));
});
```

**Step 2: Run test to verify it fails**

**Step 3: Implement SourceAttributionMatcher.ts**

Create `src/source/SourceAttributionMatcher.ts`. The service takes a simplified input (post context, links, linkCards, optional vision) and runs the matching algorithm from the design doc.

Key implementation points:
- Uses `ProviderRegistry` via Effect dependency
- Implements phases 1-3 (link-domain, embed-link-domain, post-text-mention)
- Phase 4 (vision signals) is a no-op when `vision: null`
- Resolution: unique strongest signal wins, tie = ambiguous, none = none
- Content source and social provenance assembled independently
- Returns `MatchResult` from the evidence contract

The service interface:

```typescript
import { Context, Effect } from "effect";
import type { MatchResult } from "../domain/source";

export interface MatcherInput {
  readonly post: { readonly did: string; readonly text: string; readonly handle?: string | null };
  readonly links: ReadonlyArray<{ readonly url: string; readonly domain: string | null; readonly title: string | null; readonly description: string | null; readonly imageUrl: string | null; readonly extractedAt: number }>;
  readonly linkCards: ReadonlyArray<{ readonly source: string; readonly uri: string; readonly title: string | null; readonly description: string | null; readonly thumb: string | null }>;
  readonly vision: null; // Phase 2 will accept VisionEnrichment here
}

export class SourceAttributionMatcher extends Context.Tag("@skygest/SourceAttributionMatcher")<
  SourceAttributionMatcher,
  {
    readonly match: (input: MatcherInput) => Effect.Effect<MatchResult>;
  }
>() {
  static readonly live: Layer.Layer<SourceAttributionMatcher, never, ProviderRegistry>;
}
```

Implementation follows the algorithm pseudocode from `docs/plans/2026-03-19-sky-46-source-attribution-matching-design.md` § Matching Algorithm, phases 1-3.

**Step 4: Run test to verify it passes**

Run: `cd /Users/pooks/Dev/skygest-cloudflare && bun run test -- tests/source-attribution-matcher.test.ts`
Expected: PASS

**Step 5: Verify full suite**

Run: `cd /Users/pooks/Dev/skygest-cloudflare && bunx tsc --noEmit && bun run test`

**Step 6: Commit**

```bash
git add src/source/SourceAttributionMatcher.ts tests/source-attribution-matcher.test.ts
git commit -m "feat(sky-46): implement source attribution matcher (phase 1: text/link signals)"
```

---

### Task 5: Provider resolution logic tests

**Files:**
- Add to: `tests/source-attribution-matcher.test.ts`

**Step 1: Add edge case tests**

```typescript
describe("provider resolution edge cases", () => {
  it("embed-link-domain matches provider", () =>
    Effect.gen(function* () {
      const matcher = yield* SourceAttributionMatcher;
      const result = yield* matcher.match({
        post: { did: "did:plc:test", text: "Check this report" },
        links: [],
        linkCards: [{ source: "embed" as const, uri: "https://www.eia.gov/petroleum/supply/monthly/", title: "EIA Monthly", description: null, thumb: null }],
        vision: null
      });
      expect(result.resolution).toBe("matched");
      expect(result.selectedProvider?.providerId).toBe("eia");
      expect(result.providerMatches[0]?.signals[0]?.signal).toBe("embed-link-domain");
    }));

  it("non-provider domain does not match (gridstatus.io)", () =>
    Effect.gen(function* () {
      const matcher = yield* SourceAttributionMatcher;
      const result = yield* matcher.match({
        post: { did: "did:plc:test", text: "Nice dashboard" },
        links: [{ url: "https://gridstatus.io/live", domain: "gridstatus.io", title: null, description: null, imageUrl: null, extractedAt: 0 }],
        linkCards: [],
        vision: null
      });
      // gridstatus.io is NOT in provider registry
      expect(result.selectedProvider).toBeNull();
      // But contentSource should still be populated
      expect(result.contentSource?.domain).toBe("gridstatus.io");
    }));

  it("long alias match works (full organization name)", () =>
    Effect.gen(function* () {
      const matcher = yield* SourceAttributionMatcher;
      const result = yield* matcher.match({
        post: { did: "did:plc:test", text: "The Electric Reliability Council of Texas reported record demand" },
        links: [],
        linkCards: [],
        vision: null
      });
      expect(result.resolution).toBe("matched");
      expect(result.selectedProvider?.providerId).toBe("ercot");
    }));
});
```

**Step 2: Run tests**

Run: `cd /Users/pooks/Dev/skygest-cloudflare && bun run test -- tests/source-attribution-matcher.test.ts`
Expected: PASS (if Task 4 implementation is correct; fix if needed)

**Step 3: Verify full suite**

Run: `cd /Users/pooks/Dev/skygest-cloudflare && bunx tsc --noEmit && bun run test`

**Step 4: Commit**

```bash
git add tests/source-attribution-matcher.test.ts
git commit -m "test(sky-46): add provider resolution edge case tests"
```

---

### Task 6: Final verification and type check

**Step 1: Full test suite**

Run: `cd /Users/pooks/Dev/skygest-cloudflare && bunx tsc --noEmit && bun run test`
Expected: All tests pass, no type errors

**Step 2: Verify new exports don't break anything**

Run: `cd /Users/pooks/Dev/skygest-cloudflare && bunx tsc --noEmit`
Expected: Clean

---

## Files Summary

| File | Change |
|------|--------|
| `src/domain/source.ts` | Add MatchSignalType, MatchEvidence, ProviderMatch, MatchResolution, MatchResult |
| `src/source/normalize.ts` | **New** — stripSourcePrefix, isWholeWordMatch, extractDomainFromText |
| `src/source/contentSource.ts` | **New** — choosePrimaryContentSource |
| `src/source/SourceAttributionMatcher.ts` | **New** — matcher service (phases 1-3, vision stubbed) |
| `tests/source-attribution-matcher.test.ts` | **New** — evidence types, normalization, content source, matcher, edge cases |

## Verification

1. `bunx tsc --noEmit` — clean
2. `bun run test` — all pass
3. Matcher correctly resolves: matched, ambiguous, none
4. Content source assembly follows the 3-rule cascade
5. Social provenance populated from post DID
6. Non-provider domains (gridstatus.io) don't match provider but populate contentSource
7. Phase 2 (vision signals) is cleanly stubbed via `vision: null`
