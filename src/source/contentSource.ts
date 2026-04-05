/**
 * Content source assembly — 3-rule cascade.
 *
 * Determines the external page explicitly shared by a post.
 * This is independent of provider matching: `contentSource` can
 * be a platform or publication even when the provider is a
 * different organization.
 *
 * See docs/plans/2026-03-19-sky-46-source-attribution-matching-design.md
 * § Content Source Assembly for the authoritative specification.
 *
 * Rules:
 *   1. Prefer the explicit external embed/link-card URL if present.
 *   2. Otherwise, if exactly one unique external link URL exists
 *      in stored links, use that.
 *   3. Otherwise, leave contentSource = null.
 */

import { Option } from "effect";
import type { ContentSourceReference } from "../domain/source";
import type { EnrichmentPlannedLinkCardContext } from "../domain/enrichmentPlan";
import type { LinkRecord, PublicationSeed } from "../domain/bi";
import { parseNormalizedDomain } from "./normalize";
import { resolvePublicationEntry, publicationDisplayLabel } from "./publicationResolver";

// ---------------------------------------------------------------------------
// Publication context (optional, enables publication resolution)
// ---------------------------------------------------------------------------

export interface PublicationContext {
  readonly publicationIndex: ReadonlyMap<string, PublicationSeed>;
  readonly brandShortenerMap: ReadonlyMap<string, string>;
}

// ---------------------------------------------------------------------------
// Input type
// ---------------------------------------------------------------------------

/**
 * Input for content source assembly.
 *
 * Structurally compatible with the enrichment plan's `linkCards`
 * (EnrichmentPlannedLinkCardContext) and `links` (LinkRecord).
 */
export interface ContentSourceInput {
  readonly linkCards: ReadonlyArray<
    Pick<EnrichmentPlannedLinkCardContext, "source" | "uri" | "title" | "description" | "thumb">
  >;
  readonly links: ReadonlyArray<
    Pick<LinkRecord, "url" | "domain" | "title" | "description" | "imageUrl" | "extractedAt">
  >;
}

// ---------------------------------------------------------------------------
// Domain helper
// ---------------------------------------------------------------------------

const parseDomain = (url: string): string | null =>
  Option.getOrNull(parseNormalizedDomain(url));

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Choose the primary content source for a post using the 3-rule cascade.
 *
 * Pure function — takes enrichment plan data, returns a
 * `ContentSourceReference` or null.
 */
export const choosePrimaryContentSource = (
  input: ContentSourceInput,
  publicationContext?: PublicationContext
): ContentSourceReference | null => {
  // Rule 1: prefer explicit embed link card
  if (input.linkCards.length > 0) {
    const card = input.linkCards[0]!;
    const domain = parseDomain(card.uri);
    const publication = publicationContext === undefined
        ? null
      : (() => {
          const entry = resolvePublicationEntry(
            domain,
            publicationContext.publicationIndex,
            publicationContext.brandShortenerMap
          );
          return entry === null || entry.hostname === null
            ? null
            : publicationDisplayLabel(entry.hostname);
        })();
    return {
      url: card.uri,
      title: card.title ?? null,
      domain,
      publication
    };
  }

  // Rule 2: single unique external link URL
  const uniqueUrls = new Set(input.links.map((l) => l.url));
  if (uniqueUrls.size === 1) {
    const link = input.links[0]!;
    const domain = link.domain ?? parseDomain(link.url);
    const publication = publicationContext === undefined
        ? null
      : (() => {
          const entry = resolvePublicationEntry(
            domain,
            publicationContext.publicationIndex,
            publicationContext.brandShortenerMap
          );
          return entry === null || entry.hostname === null
            ? null
            : publicationDisplayLabel(entry.hostname);
        })();
    return {
      url: link.url,
      title: link.title ?? null,
      domain,
      publication
    };
  }

  // Rule 3: multiple links or none — do not guess
  return null;
};
