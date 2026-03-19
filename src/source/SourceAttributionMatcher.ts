/**
 * Source Attribution Matcher — Phase 1 (text/link signals).
 *
 * Deterministic matching service that assigns a canonical data originator,
 * a referenced external page, and social provenance to a post.
 *
 * Phase 1 signals (this file):
 *   - Signal 4: link-domain — match link URL domains against registry
 *   - Signal 5: embed-link-domain — match embed link card domains
 *   - Signal 7: post-text-mention — scan post text for provider aliases
 *
 * Phase 2 signals (deferred until SKY-49 ships vision contract):
 *   - Signals 1-3, 6 require VisionEnrichment data
 *
 * See docs/plans/2026-03-19-sky-46-source-attribution-matching-design.md
 * for the authoritative specification.
 */

import { Context, Effect, Layer } from "effect";
import type { LinkRecord } from "../domain/bi";
import type { EnrichmentPlannedLinkCardContext } from "../domain/enrichmentPlan";
import { normalizeDomain } from "../domain/normalize";
import type {
  MatchEvidence,
  MatchResolution,
  MatchResult,
  MatchSignalType,
  ProviderMatch,
  ProviderReference,
  ProviderRegistryEntry,
  SocialProvenance
} from "../domain/source";
import type { Did } from "../domain/types";
import { ProviderRegistry } from "../services/ProviderRegistry";
import { choosePrimaryContentSource } from "./contentSource";
import { isWholeWordMatch } from "./normalize";

// ---------------------------------------------------------------------------
// Signal rank mapping (lower number = stronger signal)
// ---------------------------------------------------------------------------

const SIGNAL_RANK: Record<MatchSignalType, number> = {
  "source-line-alias": 1,
  "source-line-domain": 2,
  "chart-title-alias": 3,
  "link-domain": 4,
  "embed-link-domain": 5,
  "visible-url-domain": 6,
  "post-text-mention": 7
};

// ---------------------------------------------------------------------------
// Input types
// ---------------------------------------------------------------------------

export interface MatcherInput {
  readonly post: {
    readonly did: string;
    readonly text: string;
    readonly handle?: string | null;
  };
  readonly links: ReadonlyArray<
    Pick<LinkRecord, "url" | "domain" | "title" | "description" | "imageUrl" | "extractedAt">
  >;
  readonly linkCards: ReadonlyArray<
    Pick<EnrichmentPlannedLinkCardContext, "source" | "uri" | "title" | "description" | "thumb">
  >;
  readonly vision: null; // Phase 2 will accept VisionEnrichment
}

// ---------------------------------------------------------------------------
// Internal accumulator
// ---------------------------------------------------------------------------

type MatchAccumulator = Map<
  string, // providerId
  {
    entry: ProviderRegistryEntry;
    signals: MatchEvidence[];
    sourceFamily: string | null;
  }
>;

const addMatch = (
  matches: MatchAccumulator,
  entry: ProviderRegistryEntry,
  signal: MatchSignalType,
  raw: Record<string, string>
): void => {
  const existing = matches.get(entry.providerId);
  const evidence: MatchEvidence = { signal, raw };
  if (existing) {
    existing.signals.push(evidence);
  } else {
    matches.set(entry.providerId, {
      entry,
      signals: [evidence],
      sourceFamily: null
    });
  }
};

// ---------------------------------------------------------------------------
// Provider resolution
// ---------------------------------------------------------------------------

/**
 * Determine the best rank (lowest number) across all signals for a match.
 */
const bestRank = (signals: ReadonlyArray<MatchEvidence>): number =>
  Math.min(...signals.map((s) => SIGNAL_RANK[s.signal]));

/**
 * Resolve the winning provider from the accumulated matches.
 *
 * Rules:
 *   - No matches => resolution "none", selectedProvider null
 *   - One provider with uniquely strongest signal => "matched"
 *   - Multiple providers tied at the same best rank => "ambiguous"
 */
const resolveProvider = (
  matches: MatchAccumulator
): {
  resolution: MatchResolution;
  selectedProvider: ProviderReference | null;
  providerMatches: ProviderMatch[];
} => {
  const providerMatches: ProviderMatch[] = [];
  for (const [, m] of matches) {
    providerMatches.push({
      providerId: m.entry.providerId,
      providerLabel: m.entry.providerLabel,
      sourceFamily: m.sourceFamily,
      signals: m.signals
    });
  }

  if (providerMatches.length === 0) {
    return {
      resolution: "none",
      selectedProvider: null,
      providerMatches
    };
  }

  // Find the best (lowest) rank across all providers
  const ranked = providerMatches.map((pm) => ({
    pm,
    rank: bestRank(pm.signals)
  }));
  ranked.sort((a, b) => a.rank - b.rank);

  const topRank = ranked[0]!.rank;
  const topProviders = ranked.filter((r) => r.rank === topRank);

  if (topProviders.length === 1) {
    const winner = topProviders[0]!.pm;
    return {
      resolution: "matched",
      selectedProvider: {
        providerId: winner.providerId,
        providerLabel: winner.providerLabel,
        sourceFamily: winner.sourceFamily
      },
      providerMatches
    };
  }

  // Multiple providers tied at the same best rank => ambiguous
  return {
    resolution: "ambiguous",
    selectedProvider: null,
    providerMatches
  };
};

// ---------------------------------------------------------------------------
// Parse hostname helper
// ---------------------------------------------------------------------------

const parseHostname = (url: string): string | null => {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
};

// ---------------------------------------------------------------------------
// Service tag + live layer
// ---------------------------------------------------------------------------

export class SourceAttributionMatcher extends Context.Tag(
  "@skygest/SourceAttributionMatcher"
)<
  SourceAttributionMatcher,
  {
    readonly match: (
      input: MatcherInput
    ) => Effect.Effect<MatchResult>;
  }
>() {
  static readonly live = Layer.effect(
    SourceAttributionMatcher,
    Effect.gen(function* () {
      const registry = yield* ProviderRegistry;

      const match = Effect.fn("SourceAttributionMatcher.match")(function* (
        input: MatcherInput
      ) {
        const matches: MatchAccumulator = new Map();

        // ---------------------------------------------------------------
        // Assemble non-provider outputs first
        // ---------------------------------------------------------------
        const contentSource = choosePrimaryContentSource({
          linkCards: input.linkCards,
          links: input.links
        });

        const socialProvenance: SocialProvenance = {
          did: input.post.did as Did,
          handle: input.post.handle ?? null
        };

        // ---------------------------------------------------------------
        // PHASE 1 — Link-domain provider signals (rank 4)
        // ---------------------------------------------------------------
        for (const link of input.links) {
          const hostname = link.domain ?? parseHostname(link.url);
          if (!hostname) continue;
          const domain = normalizeDomain(hostname);
          const entry = yield* registry.findByDomain(domain);
          if (entry) {
            addMatch(matches, entry, "link-domain", {
              url: link.url,
              domain
            });
          }
        }

        // ---------------------------------------------------------------
        // PHASE 2 — Embed-link-domain provider signals (rank 5)
        // ---------------------------------------------------------------
        for (const linkCard of input.linkCards) {
          const hostname = parseHostname(linkCard.uri);
          if (!hostname) continue;
          const domain = normalizeDomain(hostname);
          const entry = yield* registry.findByDomain(domain);
          if (entry) {
            addMatch(matches, entry, "embed-link-domain", {
              url: linkCard.uri,
              domain
            });
          }
        }

        // ---------------------------------------------------------------
        // PHASE 3 — Post-text mention provider signals (rank 7)
        // ---------------------------------------------------------------
        for (const provider of registry.providers) {
          const allAliases = [provider.providerLabel, ...provider.aliases];
          for (const alias of allAliases) {
            if (alias.length < 3) continue;
            if (isWholeWordMatch(input.post.text, alias)) {
              addMatch(matches, provider, "post-text-mention", {
                matchedAlias: alias
              });
              break; // Only one match per provider from text
            }
          }
        }

        // ---------------------------------------------------------------
        // PHASE 4 — Vision provider signals (deferred)
        // ---------------------------------------------------------------
        // When input.vision is non-null (Phase 2), process:
        //   - source-line-alias (rank 1)
        //   - source-line-domain (rank 2)
        //   - chart-title-alias (rank 3)
        //   - visible-url-domain (rank 6)

        // ---------------------------------------------------------------
        // Resolve provider
        // ---------------------------------------------------------------
        const { resolution, selectedProvider, providerMatches } =
          resolveProvider(matches);

        const result: MatchResult = {
          providerMatches,
          selectedProvider,
          resolution,
          contentSource,
          socialProvenance
        };
        return result;
      });

      return SourceAttributionMatcher.of({ match });
    })
  );
}
