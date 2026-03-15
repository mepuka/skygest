export function HashtagDisplay({ tags }: { readonly tags: readonly string[] }) {
  if (tags.length === 0) return null;
  return (
    <div className="font-ui text-[11px] font-normal leading-[1.4] text-ghost">
      {tags.map((tag) => `#${tag}`).join(" ")}
    </div>
  );
}
