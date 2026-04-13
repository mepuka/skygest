const HTML_ENTITIES: ReadonlyArray<readonly [pattern: RegExp, replacement: string]> =
  [
    [/&nbsp;/giu, " "],
    [/&amp;/giu, "&"],
    [/&quot;/giu, "\""],
    [/&#0?39;/giu, "'"],
    [/&lt;/giu, "<"],
    [/&gt;/giu, ">"]
  ];

export const decodeHtmlEntities = (value: string): string =>
  HTML_ENTITIES.reduce(
    (current, [pattern, replacement]) =>
      current.replace(pattern, replacement),
    value
  );

export const cleanHtmlishText = (
  value: string | null | undefined
): string | undefined => {
  if (value === null || value === undefined) {
    return undefined;
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return undefined;
  }

  const withoutTags = trimmed
    .replace(/<br\s*\/?>/giu, "\n")
    .replace(/<\/p>/giu, "\n")
    .replace(/<[^>]+>/gu, " ");
  const decoded = decodeHtmlEntities(withoutTags);
  const collapsed = decoded.replace(/\s+/gu, " ").trim();
  return collapsed.length > 0 ? collapsed : undefined;
};
