import type { LinkEmbed, EmbedPayload } from "../domain/embed";
import type { PostLinkCard } from "../domain/postContext";

const toPostLinkCard = (
  source: "embed" | "media",
  link: LinkEmbed
): PostLinkCard => ({
  source,
  uri: link.uri,
  title: link.title,
  description: link.description,
  thumb: link.thumb
});

export const extractPostLinkCards = (
  embedPayload: EmbedPayload | null
): ReadonlyArray<PostLinkCard> => {
  if (embedPayload === null) {
    return [];
  }

  switch (embedPayload.kind) {
    case "link":
      return [toPostLinkCard("embed", embedPayload)];
    case "media":
      return embedPayload.media?.kind === "link"
        ? [toPostLinkCard("media", embedPayload.media)]
        : [];
    default:
      return [];
  }
};
