interface TopicTagProps {
  readonly label: string;
  readonly active?: boolean;
  readonly size?: "default" | "small";
  readonly onClick?: () => void;
}

export function TopicTag({ label, active, size = "default", onClick }: TopicTagProps) {
  const isSmall = size === "small";

  const base = "font-ui rounded-[2px] transition-colors cursor-pointer select-none tracking-[0.02em] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent";
  const sizeClass = isSmall
    ? "text-[10px] leading-[14px] px-1.5 py-0.5"
    : "text-[11px] leading-[14px] px-2 py-0.5";
  const stateClass = active
    ? "bg-accent text-white font-medium hover:bg-accent/90"
    : "bg-transparent text-secondary font-medium hover:bg-accent-tint";

  return (
    <button
      type="button"
      className={`${base} ${sizeClass} ${stateClass}`}
      onClick={onClick}
    >
      {label}
    </button>
  );
}
