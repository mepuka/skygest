import type { KnowledgePostResult, KnowledgeLinkResult, PublicationListItem } from "../lib/api.ts";
import type { ExpertTier, TopicEntry } from "../lib/types.ts";
import { AttributionRow } from "./AttributionRow.tsx";
import { EditorialBadge } from "./EditorialBadge.tsx";
import { LinkPreview } from "./LinkPreview.tsx";
import { OntologyBreadcrumb } from "./OntologyBreadcrumb.tsx";
import { resolvePublication } from "../lib/publications.ts";

interface PostCardProps {
  readonly post: KnowledgePostResult;
  readonly link?: KnowledgeLinkResult | null | undefined;
  readonly publicationIndex?: ReadonlyMap<string, PublicationListItem> | undefined;
  readonly topicLabel?: string | null | undefined;
  readonly topicEntries?: readonly TopicEntry[] | undefined;
  readonly borderColor?: string | null | undefined;
  readonly editorialCategory?: string | null | undefined;
}

export function PostCard({
  post,
  link,
  publicationIndex,
  topicLabel,
  topicEntries,
  borderColor,
  editorialCategory
}: PostCardProps) {
  const pub = link?.domain && publicationIndex
    ? resolvePublication(link.domain, publicationIndex)
    : null;

  return (
    <article
      className="flex pt-[10px] pb-[14px] pl-2 border-b border-border"
      style={borderColor ? { borderLeft: `2px solid ${borderColor}` } : undefined}
      aria-label={`Post by ${post.handle ?? "unknown"}`}
    >
      <div className="flex flex-col grow pr-1 gap-[6px] min-w-0">
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
          <EditorialBadge category={editorialCategory as any} />
        )}

        <p className="font-body text-[16px] leading-[25px] text-primary">
          {post.text}
        </p>

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

        {topicEntries && topicEntries.length > 0 && (
          <OntologyBreadcrumb topics={topicEntries} />
        )}
      </div>
    </article>
  );
}
