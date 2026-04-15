/**
 * Typed embed payload schemas replacing Schema.Unknown.
 *
 * The EmbedPayload union formalizes the shapes already produced by
 * buildEmbedContent in Toolkit.ts. It is used in both:
 * - CandidatePayloadRecord.embedPayload (stored path)
 * - ThreadPostResult.embedContent (live MCP path)
 *
 * The `kind` field is defaulted via Schema.withDecodingDefaultKey so that:
 * - Existing stored JSON without `kind` decodes correctly (kind injected)
 * - New writes from buildTypedEmbed include `kind` explicitly
 * - The decoded Type always has `kind` for downstream consumers
 */

import { Schema } from "effect";

// ---------------------------------------------------------------------------
// EmbedKind — Bluesky wire-level embed discriminator
// Re-exports the same values as ThreadEmbedType in bi.ts
// ---------------------------------------------------------------------------

export const EmbedKind = Schema.Literals(["link", "img", "quote", "media", "video"]);
export type EmbedKind = Schema.Schema.Type<typeof EmbedKind>;

// ---------------------------------------------------------------------------
// Helper types
// ---------------------------------------------------------------------------

export const ImageRef = Schema.Struct({
  thumb: Schema.String,
  fullsize: Schema.String,
  alt: Schema.NullOr(Schema.String),
  mediaId: Schema.NullOr(Schema.String).pipe(
    Schema.withDecodingDefaultKey(() => null)
  )
});
export type ImageRef = Schema.Schema.Type<typeof ImageRef>;

export const QuoteRef = Schema.Struct({
  uri: Schema.NullOr(Schema.String),
  text: Schema.NullOr(Schema.String),
  author: Schema.NullOr(Schema.String)
});
export type QuoteRef = Schema.Schema.Type<typeof QuoteRef>;

// ---------------------------------------------------------------------------
// Embed variants
//
// Each variant uses withDecodingDefaultKey for `kind` so that:
// - Encoded form (stored JSON, test fixtures) can omit `kind`
// - Decoded form (runtime Type) always has `kind`
// ---------------------------------------------------------------------------

export const LinkEmbed = Schema.Struct({
  kind: Schema.Literal("link").pipe(Schema.withDecodingDefaultKey(() => "link" as const)),
  uri: Schema.String,
  title: Schema.NullOr(Schema.String),
  description: Schema.NullOr(Schema.String),
  thumb: Schema.NullOr(Schema.String)
});
export type LinkEmbed = Schema.Schema.Type<typeof LinkEmbed>;

export const ImageEmbed = Schema.Struct({
  kind: Schema.Literal("img").pipe(Schema.withDecodingDefaultKey(() => "img" as const)),
  images: Schema.Array(ImageRef)
});
export type ImageEmbed = Schema.Schema.Type<typeof ImageEmbed>;

export const VideoEmbed = Schema.Struct({
  kind: Schema.Literal("video").pipe(Schema.withDecodingDefaultKey(() => "video" as const)),
  playlist: Schema.NullOr(Schema.String),
  thumbnail: Schema.NullOr(Schema.String),
  alt: Schema.NullOr(Schema.String)
});
export type VideoEmbed = Schema.Schema.Type<typeof VideoEmbed>;

export const QuoteEmbed = Schema.Struct({
  kind: Schema.Literal("quote").pipe(Schema.withDecodingDefaultKey(() => "quote" as const)),
  uri: Schema.NullOr(Schema.String),
  text: Schema.NullOr(Schema.String),
  author: Schema.NullOr(Schema.String)
});
export type QuoteEmbed = Schema.Schema.Type<typeof QuoteEmbed>;

/**
 * MediaComboEmbed represents Bluesky's recordWithMedia — a quoted post
 * combined with media. The media portion can be images, video, OR an
 * external link card (all three are valid Bluesky embed combinations).
 */
export const MediaComboEmbed = Schema.Struct({
  kind: Schema.Literal("media").pipe(Schema.withDecodingDefaultKey(() => "media" as const)),
  record: Schema.NullOr(QuoteRef),
  media: Schema.NullOr(Schema.Union([LinkEmbed, ImageEmbed, VideoEmbed]))
});
export type MediaComboEmbed = Schema.Schema.Type<typeof MediaComboEmbed>;

// ---------------------------------------------------------------------------
// EmbedPayload union
// ---------------------------------------------------------------------------

export const EmbedPayload = Schema.Union([
  LinkEmbed,
  ImageEmbed,
  VideoEmbed,
  QuoteEmbed,
  MediaComboEmbed
]);
export type EmbedPayload = Schema.Schema.Type<typeof EmbedPayload>;
