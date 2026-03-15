import type { ExpertTier } from "../lib/types.ts";

const config: Record<ExpertTier, { className: string; label: string } | null> = {
  "energy-focused": { className: "bg-accent", label: "Energy-focused source" },
  "general-outlet": { className: "bg-secondary", label: "General news outlet" },
  independent: null
};

export function TierDot({ tier }: { readonly tier: ExpertTier }) {
  const c = config[tier];
  if (!c) return null;
  return (
    <span
      className={`inline-block size-1 rounded-full ${c.className} shrink-0`}
      role="img"
      aria-label={c.label}
      title={c.label}
    />
  );
}
