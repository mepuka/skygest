import { normalizeDomain } from "../domain/normalize";

export type PublicationLike = {
  readonly hostname: string;
};

const HIDDEN_PUBLICATION_LABEL_HOSTNAMES = new Set([
  "archive.is",
  "arxiv.org",
  "bit.ly",
  "buff.ly",
  "documentcloud.org",
  "doi.org",
  "en.wikipedia.org",
  "goo.gl",
  "link.springer.com",
  "lnkd.in",
  "msn.com",
  "open.spotify.com",
  "ow.ly",
  "sciencedirect.com",
  "soundcloud.com",
  "t.me",
  "tinyurl.com",
  "web.archive.org",
  "wp.me",
  "yahoo.com"
]);

export const publicationDisplayLabel = (hostname: string): string | null => {
  const normalized = normalizeDomain(hostname);

  if (HIDDEN_PUBLICATION_LABEL_HOSTNAMES.has(normalized)) {
    return null;
  }

  switch (normalized) {
    case "reuters.com":
      return "Reuters";
    case "financialtimes.com":
      return "Financial Times";
    case "nytimes.com":
      return "The New York Times";
    case "washingtonpost.com":
      return "The Washington Post";
    default:
      return normalized;
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

const publicationLookupCandidates = (domain: string): ReadonlyArray<string> => {
  const normalized = normalizeDomain(domain);
  const parts = normalized.split(".");

  return parts.map((_, index) => parts.slice(index).join("."));
};

export const resolvePublicationEntry = <A extends PublicationLike>(
  domain: string | null,
  index: ReadonlyMap<string, A>,
  brandShortenerMap: ReadonlyMap<string, string>
): A | null => {
  if (domain === null) return null;

  const normalized = normalizeDomain(domain);
  const expanded = brandShortenerMap.get(normalized) ?? normalized;

  for (const candidate of publicationLookupCandidates(expanded)) {
    const match = index.get(candidate);
    if (match !== undefined) return match;
  }

  return null;
};
