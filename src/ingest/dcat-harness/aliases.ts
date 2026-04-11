import type { ExternalIdentifier } from "../../domain/data-layer";

export const unionAliases = (
  existing: ReadonlyArray<ExternalIdentifier>,
  fresh: ReadonlyArray<ExternalIdentifier>
): ReadonlyArray<ExternalIdentifier> => {
  const seen = new Set<string>();
  const out: Array<ExternalIdentifier> = [];

  for (const alias of existing) {
    const key = `${alias.scheme}::${alias.value}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(alias);
  }

  for (const alias of fresh) {
    const key = `${alias.scheme}::${alias.value}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(alias);
  }

  return out;
};
