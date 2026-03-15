import { relativeTime, isoTimestamp, atUriToBlueskyUrl } from "../lib/time.ts";

interface TimeLinkProps {
  readonly uri: string;
  readonly handle: string | null;
  readonly createdAt: number;
}

export function TimeLink({ uri, handle, createdAt }: TimeLinkProps) {
  const href = atUriToBlueskyUrl(uri, handle);
  const rel = relativeTime(createdAt);
  const iso = isoTimestamp(createdAt);

  if (href) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="font-ui text-[11px] leading-[14px] text-whisper hover:text-ghost hover:underline transition-colors no-underline focus-visible:outline-1 focus-visible:outline-accent rounded-sm"
      >
        <time dateTime={iso}>{rel}</time>
      </a>
    );
  }

  return (
    <time
      dateTime={iso}
      className="font-ui text-[11px] leading-[14px] text-whisper"
    >
      {rel}
    </time>
  );
}
