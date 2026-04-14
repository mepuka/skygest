// src/ops/BlueskyNormalizer.ts
import { Option } from "effect";
import type { GetPostThreadResponse } from "../bluesky/ThreadTypes";
import type { ImportPostInput, ImportExpertInput } from "../domain/api";
import type { PostUri, Did } from "../domain/types";
import { normalizeLinkedHostname } from "../platform/Normalize";
import { flattenThread } from "../bluesky/ThreadFlatten";
import { buildTypedEmbed, extractEmbedKind } from "../bluesky/EmbedExtract";

/**
 * Normalize a Bluesky thread response into import-ready shapes.
 * Uses flattenThread to safely decode the Schema.Unknown thread,
 * matching the pattern in CurationService.ts.
 * Returns Option.none() if the thread is missing the focus post.
 */
export const normalizeBlueskyThread = (
  thread: GetPostThreadResponse,
  tierDefault: string = "energy-focused"
): Option.Option<{ post: ImportPostInput; expert: ImportExpertInput }> => {
  const flat = flattenThread(thread.thread);
  const focusPost = flat?.focus?.post;

  if (!focusPost) {
    return Option.none();
  }

  const author = focusPost.author;
  const record = focusPost.record as Record<string, unknown>;

  const text = typeof record.text === "string" ? record.text : "";
  const createdAtStr = typeof record.createdAt === "string" ? record.createdAt : new Date().toISOString();
  const createdAt = new Date(createdAtStr).getTime();

  // Extract links from facets
  const facets = Array.isArray(record.facets) ? record.facets : [];
  const links: Array<{ url: string; domain?: string }> = [];
  const hashtags: string[] = [];

  for (const facet of facets) {
    const features = Array.isArray(facet?.features) ? facet.features : [];
    for (const feature of features) {
      if (feature?.$type === "app.bsky.richtext.facet#link" && typeof feature.uri === "string") {
        const domain = normalizeLinkedHostname(feature.uri) ?? undefined;
        links.push(
          domain === undefined
            ? { url: feature.uri }
            : { url: feature.uri, domain }
        );
      }
      if (feature?.$type === "app.bsky.richtext.facet#tag" && typeof feature.tag === "string") {
        hashtags.push(feature.tag);
      }
    }
  }

  // Add external link card URL to links array if embed is external
  const embed = focusPost.embed as Record<string, unknown> | undefined;
  if (embed && typeof embed.$type === "string" && embed.$type.includes("external")) {
    const external = embed.external as Record<string, unknown> | undefined;
    if (external && typeof external.uri === "string") {
      const alreadyInLinks = links.some((l) => l.url === external.uri);
      if (!alreadyInLinks) {
        const domain = normalizeLinkedHostname(external.uri) ?? undefined;
        links.push(
          domain === undefined
            ? { url: external.uri as string }
            : { url: external.uri as string, domain }
        );
      }
    }
  }

  const embedType = extractEmbedKind(focusPost.embed as any);
  const embedPayload = buildTypedEmbed(focusPost.embed);

  return Option.some({
    post: {
      uri: focusPost.uri as PostUri,
      did: author.did as Did,
      text,
      createdAt,
      hashtags: hashtags.length > 0 ? hashtags : undefined,
      embedType: embedType as any,
      embedPayload: embedPayload as any,
      links
    } as ImportPostInput,
    expert: {
      did: author.did as Did,
      handle: author.handle && author.handle !== "handle.invalid" ? author.handle : `did:${author.did}`,
      domain: "energy",
      source: "bluesky-import" as const,
      tier: tierDefault as any,
      displayName: author.displayName,
      avatar: author.avatar
    } as ImportExpertInput
  });
};
