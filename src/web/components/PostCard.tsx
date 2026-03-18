import type { KnowledgePostResult, KnowledgeLinkResult, PublicationListItem } from "../lib/api.ts";
import type { EditorialPickCategory, ExpertTier, TopicEntry } from "../lib/types.ts";
import type { EmbedPayload, ImageRef } from "../../domain/embed.ts";
import { AttributionRow } from "./AttributionRow.tsx";
import { ChartStrip } from "./ChartStrip.tsx";
import { EditorialBadge } from "./EditorialBadge.tsx";
import { ExpertDiscussion } from "./ExpertDiscussion.tsx";
import { LinkPreview } from "./LinkPreview.tsx";
import { OntologyBreadcrumb } from "./OntologyBreadcrumb.tsx";
import { resolvePublication } from "../lib/publications.ts";

function extractImages(embed: EmbedPayload | null): readonly ImageRef[] {
  if (embed == null) return [];
  if (embed.kind === "img") return embed.images;
  if (embed.kind === "media" && embed.media?.kind === "img") return embed.media.images;
  return [];
}

interface PostCardProps {
  readonly post: KnowledgePostResult;
  readonly link?: KnowledgeLinkResult | null | undefined;
  readonly publicationIndex?: ReadonlyMap<string, PublicationListItem> | undefined;
  readonly topicLabel?: string | null | undefined;
  readonly topicEntries?: readonly TopicEntry[] | undefined;
  readonly borderColor?: string | null | undefined;
  readonly editorialCategory?: EditorialPickCategory | null | undefined;
  readonly active?: boolean | undefined;
  readonly onHover?: ((uri: string | null) => void) | undefined;
}

export function PostCard({
  post,
  link,
  publicationIndex,
  topicLabel,
  topicEntries,
  borderColor,
  editorialCategory,
  active,
  onHover
}: PostCardProps) {
  const pub = link?.domain && publicationIndex
    ? resolvePublication(link.domain, publicationIndex)
    : null;

  const images = extractImages(post.embedContent ?? null);

  return (
    <article
      className={`flex flex-col pt-[14px] pb-[14px] gap-2 border-b border-border transition-colors ${
        active ? "bg-surface" : ""
      }`}
      style={borderColor ? { borderLeft: `2px solid ${borderColor}` } : undefined}
      aria-label={`Post by ${post.handle ?? "unknown"}`}
      onMouseEnter={() => onHover?.(post.uri)}
      onMouseLeave={() => onHover?.(null)}
    >
      <AttributionRow
        handle={post.handle}
        did={post.did}
        avatar={post.avatar}
        tier={post.tier as ExpertTier}
        createdAt={post.createdAt}
        uri={post.uri}
        topicLabel={topicLabel}
      />

      {editorialCategory && (
        <EditorialBadge category={editorialCategory} />
      )}

      <p className="font-body text-[16px] leading-[25px] text-primary">
        {post.text}
      </p>

      {images.length > 0 && (
        <ChartStrip images={images} variant="feed" />
      )}

      {link && (
        <LinkPreview
          url={link.url}
          domain={link.domain}
          title={link.title}
          description={link.description}
          imageUrl={link.imageUrl}
          tier={pub?.tier}
        />
      )}

      {post.replyCount != null && post.replyCount > 0 && (
        <ExpertDiscussion replyCount={post.replyCount} />
      )}

      {topicEntries && topicEntries.length > 0 && (
        <OntologyBreadcrumb topics={topicEntries} />
      )}
    </article>
  );
}
