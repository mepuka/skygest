import type { KnowledgePostResult } from "../lib/api.ts";

type Post = KnowledgePostResult;

function relativeTime(epochMs: number): string {
  const delta = Date.now() - epochMs;
  const minutes = Math.floor(delta / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

function isoTimestamp(epochMs: number): string {
  return new Date(epochMs).toISOString();
}

const tierLabel: Record<string, string | null> = {
  "energy-focused": "Energy-focused source",
  "general-outlet": "General news outlet",
  independent: null
};

const tierDotColor: Record<string, string | null> = {
  "energy-focused": "bg-accent",
  "general-outlet": "bg-secondary",
  independent: null
};

export function PostCard({ post }: { readonly post: Post }) {
  const dotClass = tierDotColor[post.tier] ?? null;
  const dotLabel = tierLabel[post.tier] ?? null;

  return (
    <article className="px-4 pt-[10px] pb-[14px]" aria-label={`Post by ${post.handle ?? "unknown"}`}>
      {/* Attribution row */}
      <div className="flex items-center gap-[7px]">
        {post.avatar ? (
          <img
            src={post.avatar}
            alt=""
            className="size-[22px] rounded-full object-cover"
          />
        ) : (
          <div className="size-[22px] rounded-full bg-border" aria-hidden="true" />
        )}
        <span className="text-[13px] font-semibold text-heading tracking-[-0.01em]">
          {post.handle ?? post.did}
        </span>
        {dotClass && (
          <span
            className={`size-1 rounded-full ${dotClass} shrink-0`}
            role="img"
            aria-label={dotLabel ?? ""}
          />
        )}
        <time
          dateTime={isoTimestamp(post.createdAt)}
          className="text-[11px] text-whisper"
        >
          {relativeTime(post.createdAt)}
        </time>
      </div>

      {/* Body */}
      <p className="mt-[6px] font-body text-[16px] leading-[25px] text-primary">
        {post.text}
      </p>
    </article>
  );
}
