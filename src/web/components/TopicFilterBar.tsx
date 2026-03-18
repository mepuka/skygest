import type { TopicEntry } from "../lib/types.ts";
import { TopicTag } from "./TopicTag.tsx";
import { HorizontalScroll } from "../primitives/index.ts";
import { StatsBar } from "./StatsBar.tsx";

interface TopicFilterBarProps {
  readonly topics: readonly TopicEntry[];
  readonly selectedSlug: string | null;
  readonly onSelect: (slug: string | null) => void;
  readonly threadCount?: number;
  readonly expertCount?: number;
}

export function TopicFilterBar({
  topics,
  selectedSlug,
  onSelect,
  threadCount,
  expertCount,
}: TopicFilterBarProps) {
  return (
    <div className="flex flex-col gap-3">
      <HorizontalScroll className="gap-1.5">
        <TopicTag
          label="All"
          active={selectedSlug === null}
          onClick={() => onSelect(null)}
        />
        {topics.map((t) => (
          <TopicTag
            key={t.slug}
            label={t.label}
            active={selectedSlug === t.slug}
            onClick={() => onSelect(t.slug)}
          />
        ))}
      </HorizontalScroll>
      {threadCount != null && expertCount != null && (
        <StatsBar threadCount={threadCount} expertCount={expertCount} />
      )}
    </div>
  );
}
