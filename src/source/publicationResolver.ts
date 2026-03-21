import { normalizeDomain } from "../domain/normalize";

export type PublicationLike = {
  readonly hostname: string;
};

export const publicationDisplayLabel = (hostname: string): string => {
  switch (hostname) {
    case "reuters.com":
      return "Reuters";
    case "financialtimes.com":
      return "Financial Times";
    case "nytimes.com":
      return "The New York Times";
    case "washingtonpost.com":
      return "The Washington Post";
    default:
      return hostname;
  }
};

export const extractRootDomain = (domain: string): string => {
  const parts = normalizeDomain(domain).split(".");
  if (parts.length <= 2) return normalizeDomain(domain);
  return parts.slice(-2).join(".");
};

export const buildPublicationIndex = <A extends PublicationLike>(
  items: ReadonlyArray<A>
): ReadonlyMap<string, A> => {
  const map = new Map<string, A>();
  for (const item of items) {
    map.set(normalizeDomain(item.hostname), item);
  }
  return map;
};

export const resolvePublicationEntry = <A extends PublicationLike>(
  domain: string | null,
  index: ReadonlyMap<string, A>,
  brandShortenerMap: ReadonlyMap<string, string>
): A | null => {
  if (domain === null) return null;

  const normalized = normalizeDomain(domain);
  const expanded = brandShortenerMap.get(normalized) ?? normalized;

  const exact = index.get(expanded);
  if (exact !== undefined) return exact;

  const root = extractRootDomain(expanded);
  return index.get(root) ?? null;
};
