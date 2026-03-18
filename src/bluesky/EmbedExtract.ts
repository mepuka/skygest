/**
 * Shared embed extraction from raw Bluesky API responses.
 *
 * Produces typed EmbedPayload values from the untyped embed objects
 * returned by the Bluesky getPostThread API. Used by both:
 * - Toolkit.ts (live MCP thread output)
 * - CurationService.ts (stored payload capture)
 */

import type { EmbedKind, EmbedPayload } from "../domain/embed";

// ---------------------------------------------------------------------------
// extractEmbedKind — classify embed $type into EmbedKind
// ---------------------------------------------------------------------------

export const extractEmbedKind = (
  embed: { $type?: string | undefined } | undefined | null
): EmbedKind | null => {
  if (!embed?.$type) return null;
  const t = embed.$type;
  if (t.includes("record") && t.includes("Media")) return "media";
  if (t.includes("record")) return "quote";
  if (t.includes("external")) return "link";
  if (t.includes("images")) return "img";
  if (t.includes("video")) return "video";
  return null;
};

// ---------------------------------------------------------------------------
// buildTypedEmbed — construct typed EmbedPayload from raw Bluesky embed
// ---------------------------------------------------------------------------

const extractRecordText = (value: unknown): string | null => {
  if (typeof value === "object" && value !== null && "text" in value) {
    return typeof (value as any).text === "string" ? (value as any).text : null;
  }
  return null;
};

export const buildTypedEmbed = (embed: any): EmbedPayload | null => {
  if (!embed?.$type) return null;
  const t = embed.$type as string;

  if (t.includes("images") && embed.images) {
    return {
      kind: "img",
      images: (embed.images as any[]).map((img: any) => ({
        thumb: img.thumb ?? "",
        fullsize: img.fullsize ?? "",
        alt: img.alt ?? null
      }))
    };
  }

  if (t.includes("external") && embed.external) {
    return {
      kind: "link",
      uri: embed.external.uri ?? "",
      title: embed.external.title ?? null,
      description: embed.external.description ?? null,
      thumb: embed.external.thumb ?? null
    };
  }

  if (t.includes("video")) {
    return {
      kind: "video",
      playlist: embed.playlist ?? null,
      thumbnail: embed.thumbnail ?? null,
      alt: embed.alt ?? null
    };
  }

  if (t.includes("record") && t.includes("Media")) {
    const record = embed.record?.record ?? embed.record;
    const mediaEmbed = embed.media;
    return {
      kind: "media",
      record: record ? {
        uri: record.uri ?? null,
        text: extractRecordText(record.value),
        author: record.author?.handle ?? record.author?.did ?? null
      } : null,
      media: mediaEmbed
        ? buildTypedEmbed({ ...mediaEmbed, $type: mediaEmbed.$type ?? "unknown" })
        : null
    } as EmbedPayload;
  }

  if (t.includes("record") && embed.record) {
    const rec = embed.record;
    return {
      kind: "quote",
      uri: rec.uri ?? null,
      text: extractRecordText(rec.value),
      author: rec.author?.handle ?? rec.author?.did ?? null
    };
  }

  return null;
};
