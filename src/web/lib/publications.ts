import type { PublicationListItem } from "../lib/api.ts";

function extractRootDomain(domain: string): string {
  const parts = domain.toLowerCase().split(".");
  if (parts.length <= 2) return domain.toLowerCase();
  return parts.slice(-2).join(".");
}

export function buildPublicationIndex(
  items: readonly PublicationListItem[]
): ReadonlyMap<string, PublicationListItem> {
  const map = new Map<string, PublicationListItem>();
  for (const item of items) {
    map.set(item.hostname.toLowerCase(), item);
  }
  return map;
}

export function resolvePublication(
  domain: string | null,
  index: ReadonlyMap<string, PublicationListItem>
): PublicationListItem | null {
  if (!domain) return null;
  const root = extractRootDomain(domain);
  return index.get(root) ?? index.get(domain.toLowerCase()) ?? null;
}

export function formatDomainLabel(domain: string): string {
  return domain.replace(/^www\./i, "");
}
