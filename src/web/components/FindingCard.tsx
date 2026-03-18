/**
 * D1: Finding Card — chart reference + type + insight + source.
 *
 * Left border: 3px accent. Combines chart badge, type pill,
 * finding text, axis info, and source with tier dot.
 */

interface FindingCardProps {
  readonly chartIndex: number;
  readonly chartType: string;
  readonly temporalRange?: string | null;
  readonly finding: string;
  readonly axisLabel?: string | null;
  readonly sourceDomain?: string | null;
  readonly sourceTier?: "energy-focused" | "general-outlet" | null;
}

export function FindingCard({
  chartIndex,
  chartType,
  temporalRange,
  finding,
  axisLabel,
  sourceDomain,
  sourceTier,
}: FindingCardProps) {
  return (
    <div className="flex flex-col gap-2 bg-surface border border-data-border border-l-[3px] border-l-accent rounded-r-[--radius-data-card] p-3.5">
      <div className="flex items-center gap-1.5">
        <span className="font-data-mono text-[10px] font-semibold text-surface bg-data-text rounded-sm px-1.5 py-px">
          {chartIndex}
        </span>
        <span className="font-data-mono text-[10px] text-data-text bg-data-surface rounded-[3px] px-1.5 py-0.5">
          {chartType}
        </span>
        {temporalRange && (
          <span className="font-data-mono text-[10px] text-data-secondary">
            {temporalRange}
          </span>
        )}
      </div>

      <p className="font-ui text-[13px] text-data-text leading-[1.45]">
        {finding}
      </p>

      {axisLabel && (
        <span className="font-data-mono text-[10px] text-data-secondary">
          {axisLabel}
        </span>
      )}

      {sourceDomain && (
        <div className="flex items-center gap-1.5 pt-1 border-t border-data-surface">
          <div className="size-3 rounded-sm bg-data-surface shrink-0" />
          <span className="font-data-mono text-[10px] text-data-text">
            {sourceDomain}
          </span>
          {sourceTier && (
            <span className={`size-1 rounded-full shrink-0 ${
              sourceTier === "energy-focused" ? "bg-accent" : "bg-secondary"
            }`} />
          )}
        </div>
      )}
    </div>
  );
}
