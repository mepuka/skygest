import type { PublicationTier } from "../lib/types.ts";
import { TierDot } from "./TierDot.tsx";
import { formatDomainLabel } from "../lib/publications.ts";

interface LinkPreviewProps {
  readonly url: string;
  readonly domain: string | null;
  readonly title: string | null;
  readonly description?: string | null | undefined;
  readonly imageUrl: string | null;
  readonly tier?: PublicationTier | null | undefined;
}

export function LinkPreview({
  url,
  domain,
  title,
  description,
  imageUrl,
  tier
}: LinkPreviewProps) {
  const domainDisplay = domain ? formatDomainLabel(domain) : null;

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center rounded-[3px] py-2 px-2.5 gap-[6px] bg-recessed border border-border hover:border-border-hover transition-colors no-underline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
    >
      <div className="flex flex-col grow gap-0.5 min-w-0">
        {domainDisplay && (
          <div className="flex items-center gap-1">
            {tier && tier !== "unknown" && (
              <TierDot tier={tier === "energy-focused" ? "energy-focused" : "general-outlet"} />
            )}
            <span className="font-ui text-[11px] leading-[14px] font-medium text-accent truncate">
              {domainDisplay}
            </span>
          </div>
        )}
        {title && (
          <span className="font-ui text-[12px] leading-4 font-medium text-heading line-clamp-2">
            {title}
          </span>
        )}
        {description && (
          <span className="font-ui text-[12px] leading-4 text-secondary line-clamp-2">
            {description}
          </span>
        )}
      </div>
      {imageUrl && (
        <img
          src={imageUrl}
          alt=""
          loading="lazy"
          className="w-20 h-[60px] rounded-[3px] object-cover shrink-0"
        />
      )}
    </a>
  );
}
