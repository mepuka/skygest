import { Option } from "effect";
import type { AliasScheme } from "../domain/data-layer/alias";
import { normalizeDomain } from "../domain/normalize";

const collapseWhitespace = (value: string) => value.replace(/\s+/gu, " ").trim();

const EXACT_DISTRIBUTION_QUERY_KEYS = new Set([
  "download",
  "file_format",
  "format",
  "return_format"
]);

export const normalizeLookupText = (value: string) =>
  collapseWhitespace(value.normalize("NFKC").toLowerCase());

export const normalizeAliasLookupValue = (
  scheme: AliasScheme,
  value: string
): string => {
  if (scheme === "url") {
    return normalizeDistributionUrl(value) ?? normalizeLookupText(value);
  }

  return normalizeLookupText(value);
};

const normalizeUrlPath = (pathname: string) => {
  const collapsed = pathname.replace(/\/+/gu, "/");
  if (collapsed === "" || collapsed === "/") {
    return "/";
  }

  return collapsed.endsWith("/") ? collapsed.slice(0, -1) : collapsed;
};

const withUrlFallback = (input: string) => {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return trimmed;
  }

  if (/^[a-z][a-z0-9+.-]*:\/\//iu.test(trimmed)) {
    return trimmed;
  }

  return `https://${trimmed.replace(/^\/+/u, "")}`;
};

export const parseUrlLike = Option.liftThrowable((input: string) =>
  new URL(withUrlFallback(input))
);

export const normalizeDistributionUrl = (input: string): string | null =>
  Option.getOrNull(
    Option.map(parseUrlLike(input), (url) => {
      const hostname = normalizeDomain(url.hostname);
      const pathname = normalizeUrlPath(url.pathname);
      const preservedQueryEntries = [...url.searchParams.entries()]
        .map(([key, value]) => [key.toLowerCase(), value.trim()] as const)
        .filter(([key, value]) =>
          EXACT_DISTRIBUTION_QUERY_KEYS.has(key) && value.length > 0
        )
        .sort(([leftKey, leftValue], [rightKey, rightValue]) =>
          leftKey === rightKey
            ? leftValue.localeCompare(rightValue)
            : leftKey.localeCompare(rightKey)
        );
      const query =
        preservedQueryEntries.length === 0
          ? ""
          : `?${preservedQueryEntries
              .map(
                ([key, value]) =>
                  `${encodeURIComponent(key)}=${encodeURIComponent(value)}`
              )
              .join("&")}`;

      if (pathname === "/") {
        return `${hostname}${query}`;
      }

      return `${hostname}${pathname}${query}`;
    })
  );

export const normalizeDistributionHostname = (input: string): string | null =>
  Option.getOrNull(Option.map(parseUrlLike(input), (url) => normalizeDomain(url.hostname)));

export const buildUrlPrefixes = (normalizedUrl: string): ReadonlyArray<string> => {
  const [hostname, ...segments] = normalizedUrl.split("/").filter((segment) => segment.length > 0);
  if (hostname === undefined) {
    return [];
  }

  if (segments.length === 0) {
    return [];
  }

  const prefixes: Array<string> = [];
  for (let index = 0; index < segments.length; index++) {
    prefixes.push(`${hostname}/${segments.slice(0, index + 1).join("/")}`);
  }
  return prefixes;
};

const URL_PATTERN =
  /(?:https?:\/\/)?[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*\.[a-z]{2,}(?:\/[^\s<>()\]]*)?/giu;

export const extractUrlLikeStrings = (text: string): ReadonlyArray<string> => {
  const matches = text.match(URL_PATTERN);
  return matches === null ? [] : [...new Set(matches)];
};

const STRUCTURED_IDENTIFIER_PATTERN = /\b[A-Z0-9][A-Z0-9_-]{1,}\b/gu;

export const extractStructuredIdentifierCandidates = (
  text: string
): ReadonlyArray<string> => {
  const normalized = text.normalize("NFKC");
  const matches = normalized.match(STRUCTURED_IDENTIFIER_PATTERN) ?? [];
  return [...new Set(matches)];
};
