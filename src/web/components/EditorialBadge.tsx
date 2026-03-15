import type { EditorialPickCategory } from "../lib/types.ts";

interface EditorialBadgeProps {
  readonly category: EditorialPickCategory | null;
}

const CATEGORY_LABELS: Record<EditorialPickCategory, string> = {
  breaking: "Breaking",
  analysis: "Analysis",
  discussion: "Discussion",
  data: "Data",
  opinion: "Opinion"
};

export function EditorialBadge({ category }: EditorialBadgeProps) {
  if (!category) return null;
  return (
    <span className="font-ui text-[10px] font-semibold tracking-[0.05em] uppercase text-accent bg-accent-tint px-[6px] py-[2px] rounded-sm">
      {CATEGORY_LABELS[category]}
    </span>
  );
}
