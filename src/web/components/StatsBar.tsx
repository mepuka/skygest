/**
 * M7 sub-component: Stats bar below topic filter pills.
 *
 * "247 threads · 89 experts · Last 24h · Trending: hydro trade, EV subsidies"
 */

interface StatsBarProps {
  readonly threadCount: number;
  readonly expertCount: number;
}

export function StatsBar({ threadCount, expertCount }: StatsBarProps) {
  return (
    <div className="font-ui text-[11px] text-ghost leading-3.5">
      {threadCount} threads · {expertCount} experts · Last 24h
    </div>
  );
}
