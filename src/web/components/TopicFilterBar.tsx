import type { TopicEntry } from "../lib/types.ts";
import { TopicTag } from "./TopicTag.tsx";

interface TopicFilterBarProps {
  readonly topics: readonly TopicEntry[];
  readonly selectedSlug: string | null;
  readonly onSelect: (slug: string | null) => void;
}

export function TopicFilterBar({ topics, selectedSlug, onSelect }: TopicFilterBarProps) {
  return (
    <div className="flex flex-wrap gap-1 px-4 py-2">
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
    </div>
  );
}
