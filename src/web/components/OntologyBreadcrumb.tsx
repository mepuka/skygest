import type { TopicEntry } from "../lib/types.ts";

export function OntologyBreadcrumb({ topics }: { readonly topics: readonly TopicEntry[] }) {
  if (topics.length === 0) return null;

  return (
    <div className="font-ui text-[10px] leading-[14px] font-normal text-mid">
      {topics.map((topic, i) => (
        <span key={topic.slug}>
          {i > 0 && (
            <span className="text-whisper mx-[3px]">/</span>
          )}
          <span>{topic.label}</span>
        </span>
      ))}
    </div>
  );
}
