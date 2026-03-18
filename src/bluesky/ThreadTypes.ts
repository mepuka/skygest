/**
 * Lightweight Effect schemas for Bluesky thread API responses.
 *
 * Only decodes fields we need — does not model the full AT Protocol lexicon.
 * Uses Schema.Unknown for recursive parent/replies to avoid recursive schema
 * issues; the thread flattener decodes each level manually.
 */

import { Schema } from "effect";

// --- Profile (minimal, for thread context) ---

export const ThreadProfileBasic = Schema.Struct({
  did: Schema.String,
  handle: Schema.optional(Schema.String),
  displayName: Schema.optional(Schema.String),
  avatar: Schema.optional(Schema.String)
});
export type ThreadProfileBasic = Schema.Schema.Type<typeof ThreadProfileBasic>;

// --- Embed view schemas (AT Proto lexicon-aligned, lenient decoding) ---

export const ThreadImageView = Schema.Struct({
  thumb: Schema.String,
  fullsize: Schema.String,
  alt: Schema.optional(Schema.String),
  aspectRatio: Schema.optional(Schema.Struct({
    width: Schema.Number,
    height: Schema.Number
  }))
});
export type ThreadImageView = Schema.Schema.Type<typeof ThreadImageView>;

const ThreadExternalView = Schema.Struct({
  uri: Schema.String,
  title: Schema.optional(Schema.String),
  description: Schema.optional(Schema.String),
  thumb: Schema.optional(Schema.String)
});

const ThreadRecordViewRecord = Schema.Struct({
  uri: Schema.optional(Schema.String),
  cid: Schema.optional(Schema.String),
  author: Schema.optional(ThreadProfileBasic),
  value: Schema.optional(Schema.Unknown)
});

export const ThreadEmbedView = Schema.Struct({
  $type: Schema.optional(Schema.String),
  // images#view
  images: Schema.optional(Schema.Array(ThreadImageView)),
  // external#view
  external: Schema.optional(ThreadExternalView),
  // record#view — contains a "record" sub-object
  record: Schema.optional(ThreadRecordViewRecord),
  // recordWithMedia#view — media sub-object
  media: Schema.optional(Schema.Struct({
    $type: Schema.optional(Schema.String),
    images: Schema.optional(Schema.Array(ThreadImageView)),
    external: Schema.optional(ThreadExternalView),
    // video fields when media is a video
    cid: Schema.optional(Schema.String),
    playlist: Schema.optional(Schema.String),
    thumbnail: Schema.optional(Schema.String),
    alt: Schema.optional(Schema.String)
  })),
  // video#view — fields live directly on embed
  cid: Schema.optional(Schema.String),
  playlist: Schema.optional(Schema.String),
  thumbnail: Schema.optional(Schema.String),
  alt: Schema.optional(Schema.String)
});
export type ThreadEmbedView = Schema.Schema.Type<typeof ThreadEmbedView>;

// --- PostView (core post object with engagement counts) ---

export const ThreadPostView = Schema.Struct({
  uri: Schema.String,
  cid: Schema.String,
  author: ThreadProfileBasic,
  record: Schema.Unknown,
  embed: Schema.optional(ThreadEmbedView),
  replyCount: Schema.optional(Schema.Number),
  repostCount: Schema.optional(Schema.Number),
  likeCount: Schema.optional(Schema.Number),
  quoteCount: Schema.optional(Schema.Number),
  indexedAt: Schema.String
});
export type ThreadPostView = Schema.Schema.Type<typeof ThreadPostView>;

// --- ThreadViewPost node (recursive — parent/replies decoded lazily) ---

export const ThreadViewPostNode = Schema.Struct({
  $type: Schema.optional(Schema.String),
  post: ThreadPostView,
  parent: Schema.optional(Schema.Unknown),
  replies: Schema.optional(Schema.Array(Schema.Unknown))
});
export type ThreadViewPostNode = Schema.Schema.Type<typeof ThreadViewPostNode>;

// --- API response envelope ---

export const GetPostThreadResponse = Schema.Struct({
  thread: Schema.Unknown
});
export type GetPostThreadResponse = Schema.Schema.Type<typeof GetPostThreadResponse>;

export const GetPostsResponse = Schema.Struct({
  posts: Schema.Array(ThreadPostView)
});
export type GetPostsResponse = Schema.Schema.Type<typeof GetPostsResponse>;
