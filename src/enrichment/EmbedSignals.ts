import type { EmbedPayload } from "../domain/embed";
import type { GapEnrichmentType } from "../domain/enrichment";

export const hasVisualEmbedPayload = (
  embedPayload: EmbedPayload | null
): boolean => {
  if (embedPayload === null) {
    return false;
  }

  switch (embedPayload.kind) {
    case "img":
    case "video":
      return true;
    case "media":
      return embedPayload.media !== null && hasVisualEmbedPayload(embedPayload.media);
    default:
      return false;
  }
};

export const hasLinkCardSignal = (
  embedPayload: EmbedPayload | null
): boolean => {
  if (embedPayload === null) {
    return false;
  }

  switch (embedPayload.kind) {
    case "link":
      return true;
    case "media":
      return embedPayload.media?.kind === "link";
    default:
      return false;
  }
};

export const hasQuoteSignal = (
  embedPayload: EmbedPayload | null
): boolean => {
  if (embedPayload === null) {
    return false;
  }

  switch (embedPayload.kind) {
    case "quote":
      return (
        embedPayload.uri !== null ||
        embedPayload.text !== null ||
        embedPayload.author !== null
      );
    case "media":
      return embedPayload.record !== null && (
        embedPayload.record.uri !== null ||
        embedPayload.record.text !== null ||
        embedPayload.record.author !== null
      );
    default:
      return false;
  }
};

export const inferPrimaryEnrichmentType = (
  embedPayload: EmbedPayload | null
): GapEnrichmentType =>
  hasVisualEmbedPayload(embedPayload)
    ? "vision"
    : "source-attribution";

export const hasSourceSignals = (input: {
  readonly embedPayload: EmbedPayload | null;
  readonly hasStoredLinks: boolean;
  readonly hasExistingEnrichments: boolean;
}): boolean =>
  hasVisualEmbedPayload(input.embedPayload) ||
  input.hasStoredLinks ||
  hasLinkCardSignal(input.embedPayload) ||
  hasQuoteSignal(input.embedPayload) ||
  input.hasExistingEnrichments;
