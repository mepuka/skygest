/**
 * D3: Source Card — for link threads without charts.
 *
 * Left border: 3px secondary gray. Shows linked source
 * with favicon, title, domain, and description.
 */

import type { ExpertTier } from "../lib/types.ts";
import { TierDot } from "./TierDot.tsx";

interface SourceCardProps {
  readonly title: string;
  readonly domain: string;
  readonly description?: string | null;
  readonly tier?: ExpertTier | null;
}

export function SourceCard({ title, domain, description, tier }: SourceCardProps) {
  return (
    <div className="flex flex-col gap-2 bg-surface border border-data-border border-l-[3px] border-l-secondary rounded-r-[--radius-data-card] p-3.5">
      <span className="font-data-mono text-[10px] font-medium text-data-secondary uppercase tracking-[0.06em]">
        Linked Source
      </span>

      <div className="flex items-center gap-1.5">
        <div className="size-4 rounded-sm bg-data-surface shrink-0" />
        <div className="flex flex-col gap-px min-w-0">
          <span className="font-ui text-[13px] font-medium text-data-text truncate">
            {title}
          </span>
          <div className="flex items-center gap-1">
            <span className="font-data-mono text-[10px] text-data-secondary">
              {domain}
            </span>
            {tier && <TierDot tier={tier} />}
          </div>
        </div>
      </div>

      {description && (
        <p className="font-ui text-[12px] text-data-text leading-[1.4] line-clamp-2">
          {description}
        </p>
      )}
    </div>
  );
}
