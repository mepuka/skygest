import { Chunk, HashMap, Option } from "effect";
import { collectEvidence, resolveUniqueBest, type Evidence } from "../matching/core";
import { normalizeDomain } from "../domain/normalize";
import type {
  ProviderId,
  ProviderRegistryEntry,
  ProviderReference,
  SocialProvenance
} from "../domain/source";
import type {
  SourceAttributionEvidence,
  SourceAttributionMatchResult,
  SourceAttributionMatcherInput,
  SourceAttributionProviderCandidate
} from "../domain/sourceMatching";
import type { ProviderLookup } from "./registry";
import { choosePrimaryContentSource, type PublicationContext } from "./contentSource";
import {
  extractDomainFromText,
  isWholeWordMatch,
  parseNormalizedDomain,
  startsWithWholeAlias,
  stripSourcePrefix
} from "./normalize";

type ProviderEvidence = Evidence<ProviderId, SourceAttributionEvidence>;

const trimToNull = (value: string | null | undefined) => {
  if (value == null) {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
};

const makeSocialProvenance = (
  input: SourceAttributionMatcherInput
): SocialProvenance => ({
  did: input.post.did,
  handle: input.post.handle
});

const pushEvidence = (
  items: Array<ProviderEvidence>,
  provider: ProviderRegistryEntry,
  signal: SourceAttributionEvidence
) => {
  items.push({
    entityId: provider.providerId,
    signal
  });
};

const findGreedyAliasPrefix = (
  text: string,
  lookup: ProviderLookup
): Option.Option<{
  readonly provider: ProviderRegistryEntry;
  readonly matchedAlias: string;
}> => {
  for (const aliasEntry of lookup.aliasEntries) {
    if (startsWithWholeAlias(text, aliasEntry.aliasText)) {
      return Option.some({
        provider: aliasEntry.provider,
        matchedAlias: aliasEntry.aliasText
      });
    }
  }

  return Option.none();
};

const collectWholeWordAliasMatches = (
  text: string,
  lookup: ProviderLookup
): ReadonlyArray<{
  readonly provider: ProviderRegistryEntry;
  readonly matchedAlias: string;
}> => {
  const matches: Array<{
    readonly provider: ProviderRegistryEntry;
    readonly matchedAlias: string;
  }> = [];
  const seenProviders = new Set<string>();

  for (const aliasEntry of lookup.aliasEntries) {
    if (seenProviders.has(aliasEntry.provider.providerId)) {
      continue;
    }

    if (!isWholeWordMatch(text, aliasEntry.aliasText)) {
      continue;
    }

    seenProviders.add(aliasEntry.provider.providerId);
    matches.push({
      provider: aliasEntry.provider,
      matchedAlias: aliasEntry.aliasText
    });
  }

  return matches;
};

const collectLinkDomainEvidence = (
  input: SourceAttributionMatcherInput,
  lookup: ProviderLookup
): ReadonlyArray<ProviderEvidence> => {
  const items: Array<ProviderEvidence> = [];

  for (const link of input.links) {
    const domain = link.domain === null
      ? Option.getOrNull(parseNormalizedDomain(link.url))
      : normalizeDomain(link.domain);

    if (domain === null) {
      continue;
    }

    Option.match(lookup.findByDomain(domain), {
      onNone: () => undefined,
      onSome: (provider) =>
        pushEvidence(items, provider, {
          signal: "link-domain",
          rank: 4,
          url: link.url,
          domain
        })
    });
  }

  return items;
};

const collectEmbedLinkDomainEvidence = (
  input: SourceAttributionMatcherInput,
  lookup: ProviderLookup
): ReadonlyArray<ProviderEvidence> => {
  const items: Array<ProviderEvidence> = [];

  for (const linkCard of input.linkCards) {
    const domain = Option.getOrNull(parseNormalizedDomain(linkCard.uri));
    if (domain === null) {
      continue;
    }

    Option.match(lookup.findByDomain(domain), {
      onNone: () => undefined,
      onSome: (provider) =>
        pushEvidence(items, provider, {
          signal: "embed-link-domain",
          rank: 5,
          url: linkCard.uri,
          domain
        })
    });
  }

  return items;
};

const collectPostTextMentionEvidence = (
  input: SourceAttributionMatcherInput,
  lookup: ProviderLookup
): ReadonlyArray<ProviderEvidence> =>
  collectWholeWordAliasMatches(input.post.text, lookup).map(
    ({ provider, matchedAlias }) => ({
      entityId: provider.providerId,
      signal: {
        signal: "post-text-mention",
        rank: 7,
        matchedAlias
      }
    })
  );

const collectVisionEvidence = (
  input: SourceAttributionMatcherInput,
  lookup: ProviderLookup
): ReadonlyArray<ProviderEvidence> => {
  if (input.vision === null) {
    return [];
  }

  const items: Array<ProviderEvidence> = [];

  for (const asset of input.vision.assets) {
    for (const sourceLine of asset.analysis.sourceLines) {
      const stripped = stripSourcePrefix(sourceLine.sourceText);
      const aliasMatch = Option.orElse(
        lookup.findByAlias(stripped).pipe(
          Option.map((provider) => ({
            provider,
            matchedAlias: stripped
          }))
        ),
        () => findGreedyAliasPrefix(stripped, lookup)
      );

      Option.match(aliasMatch, {
        onNone: () => undefined,
        onSome: ({ provider, matchedAlias }) =>
          pushEvidence(items, provider, {
            signal: "source-line-alias",
            rank: 1,
            assetKey: asset.assetKey,
            sourceText: sourceLine.sourceText,
            matchedAlias
          })
      });

      const domain = extractDomainFromText(sourceLine.sourceText);
      if (domain !== null) {
        Option.match(lookup.findByDomain(domain), {
          onNone: () => undefined,
          onSome: (provider) =>
            pushEvidence(items, provider, {
              signal: "source-line-domain",
              rank: 2,
              assetKey: asset.assetKey,
              sourceText: sourceLine.sourceText,
              domain
            })
        });
      }
    }

    const title = trimToNull(asset.analysis.title);
    if (title !== null) {
      for (const { provider, matchedAlias } of collectWholeWordAliasMatches(
        title,
        lookup
      )) {
        pushEvidence(items, provider, {
          signal: "chart-title-alias",
          rank: 3,
          assetKey: asset.assetKey,
          title,
          matchedAlias
        });
      }
    }

    for (const visibleUrl of asset.analysis.visibleUrls) {
      const domain =
        extractDomainFromText(visibleUrl) ??
        Option.getOrNull(parseNormalizedDomain(visibleUrl));

      if (domain === null) {
        continue;
      }

      Option.match(lookup.findByDomain(domain), {
        onNone: () => undefined,
        onSome: (provider) =>
          pushEvidence(items, provider, {
            signal: "visible-url-domain",
            rank: 6,
            assetKey: asset.assetKey,
            url: visibleUrl,
            domain
          })
      });
    }

    for (const mention of asset.analysis.organizationMentions) {
      const mentionMatch = Option.orElse(
        lookup.findByAlias(mention.name).pipe(
          Option.map((provider) => ({
            provider,
            matchedAlias: mention.name
          }))
        ),
        () => Option.fromNullishOr(collectWholeWordAliasMatches(mention.name, lookup)[0])
      );

      Option.match(mentionMatch, {
        onNone: () => undefined,
        onSome: (match) =>
          pushEvidence(items, match.provider, {
            signal: "organization-mention-alias",
            rank: 8,
            assetKey: asset.assetKey,
            name: mention.name,
            location: mention.location,
            matchedAlias: match.matchedAlias
          })
      });
    }

    for (const logoText of asset.analysis.logoText) {
      const logoMatch = Option.orElse(
        lookup.findByAlias(logoText).pipe(
          Option.map((provider) => ({
            provider,
            matchedAlias: logoText
          }))
        ),
        () => Option.fromNullishOr(collectWholeWordAliasMatches(logoText, lookup)[0])
      );

      Option.match(logoMatch, {
        onNone: () => undefined,
        onSome: (match) =>
          pushEvidence(items, match.provider, {
            signal: "logo-text-alias",
            rank: 9,
            assetKey: asset.assetKey,
            text: logoText,
            matchedAlias: match.matchedAlias
          })
      });
    }
  }

  return items;
};

const collectProviderEvidence = (
  input: SourceAttributionMatcherInput,
  lookup: ProviderLookup
): ReadonlyArray<ProviderEvidence> => [
  ...collectVisionEvidence(input, lookup),
  ...collectLinkDomainEvidence(input, lookup),
  ...collectEmbedLinkDomainEvidence(input, lookup),
  ...collectPostTextMentionEvidence(input, lookup)
];

const sortCandidates = (
  candidates: ReadonlyArray<SourceAttributionProviderCandidate>
): ReadonlyArray<SourceAttributionProviderCandidate> =>
  [...candidates].sort((left, right) => {
    const byRank = left.bestRank - right.bestRank;
    if (byRank !== 0) {
      return byRank;
    }

    return left.providerId.localeCompare(right.providerId);
  });

const matchCanonicalSourceFamily = (
  provider: ProviderRegistryEntry,
  input: SourceAttributionMatcherInput
): string | null => {
  if (input.vision === null) {
    return null;
  }

  const matched = new Set<string>();

  for (const asset of input.vision.assets) {
    for (const sourceLine of asset.analysis.sourceLines) {
      const datasetName = trimToNull(sourceLine.datasetName);
      if (datasetName === null) {
        continue;
      }

      const datasetKey = datasetName.trim().toLowerCase();
      const canonical = provider.sourceFamilies.find(
        (sourceFamily) => sourceFamily.trim().toLowerCase() === datasetKey
      );

      if (canonical !== undefined) {
        matched.add(canonical);
      }
    }
  }

  return matched.size === 1 ? [...matched][0] ?? null : null;
};

const setCandidateSourceFamily = (
  candidates: ReadonlyArray<SourceAttributionProviderCandidate>,
  providerId: ProviderId,
  sourceFamily: string | null
): ReadonlyArray<SourceAttributionProviderCandidate> =>
  candidates.map((candidate) =>
    candidate.providerId === providerId
      ? {
          ...candidate,
          sourceFamily
        }
      : candidate
  );

export const matchSourceAttribution = (
  input: SourceAttributionMatcherInput,
  lookup: ProviderLookup,
  publicationContext?: PublicationContext
): SourceAttributionMatchResult => {
  const contentSource = choosePrimaryContentSource(
    {
      linkCards: input.linkCards,
      links: input.links
    },
    publicationContext
  );
  const socialProvenance = makeSocialProvenance(input);
  const evidence = collectProviderEvidence(input, lookup);
  const index = collectEvidence(evidence);
  const resolution = resolveUniqueBest(index);
  const baseCandidates = sortCandidates(
    Array.from(HashMap.values(index)).map((bucket) => ({
      providerId: bucket.entityId,
      providerLabel: Option.getOrElse(
        Option.map(lookup.findById(bucket.entityId), (entry) => entry.providerLabel),
        () => bucket.entityId
      ),
      sourceFamily: null,
      bestRank: bucket.bestRank,
      evidence: Array.from(bucket.evidence, (item) => item.signal)
    }))
  );

  switch (resolution._tag) {
    case "Unmatched":
      return {
        provider: null,
        resolution: "unmatched",
        providerCandidates: [],
        contentSource,
        socialProvenance
      };
    case "Ambiguous":
      return {
        provider: null,
        resolution: "ambiguous",
        providerCandidates: baseCandidates,
        contentSource,
        socialProvenance
      };
    case "Matched": {
      const providerEntry = Option.getOrUndefined(
        lookup.findById(resolution.winner.entityId)
      );
      const sourceFamily = providerEntry !== undefined
        ? matchCanonicalSourceFamily(providerEntry, input)
        : null;
      const provider: ProviderReference = {
        providerId: resolution.winner.entityId,
        providerLabel: providerEntry?.providerLabel ?? resolution.winner.entityId,
        sourceFamily
      };

      return {
        provider,
        resolution: "matched",
        providerCandidates: setCandidateSourceFamily(
          baseCandidates,
          provider.providerId,
          sourceFamily
        ),
        contentSource,
        socialProvenance
      };
    }
  }
};
