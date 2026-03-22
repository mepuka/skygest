import type { PublicationListItem } from "../lib/api.ts";
import { brandShortenerMap } from "../../source/brandShorteners";
import {
  buildPublicationIndex as buildSharedIndex,
  resolvePublicationEntry
} from "../../source/publicationResolver";

export function buildPublicationIndex(
  items: readonly PublicationListItem[]
): ReadonlyMap<string, PublicationListItem> {
  return buildSharedIndex(items);
}

export function resolvePublication(
  domain: string | null,
  index: ReadonlyMap<string, PublicationListItem>
): PublicationListItem | null {
  return resolvePublicationEntry(domain, index, brandShortenerMap);
}

export function formatDomainLabel(domain: string): string {
  return domain.replace(/^www\./i, "");
}
