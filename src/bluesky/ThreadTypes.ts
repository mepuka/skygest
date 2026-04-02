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
  handle: Schema.optionalKey(Schema.String),
  displayName: Schema.optionalKey(Schema.String),
  avatar: Schema.optionalKey(Schema.String)
});
export type ThreadProfileBasic = Schema.Schema.Type<typeof ThreadProfileBasic>;

// --- Embed view schemas (AT Proto lexicon-aligned, lenient decoding) ---

export const ThreadImageView = Schema.Struct({
  thumb: Schema.String,
  fullsize: Schema.String,
  alt: Schema.optionalKey(Schema.String),
  aspectRatio: Schema.optionalKey(Schema.Struct({
    width: Schema.Number,
    height: Schema.Number
  }))
});
export type ThreadImageView = Schema.Schema.Type<typeof ThreadImageView>;

const ThreadExternalView = Schema.Struct({
  uri: Schema.String,
  title: Schema.optionalKey(Schema.String),
  description: Schema.optionalKey(Schema.String),
  thumb: Schema.optionalKey(Schema.String)
});

const ThreadRecordViewRecord = Schema.Struct({
  uri: Schema.optionalKey(Schema.String),
  cid: Schema.optionalKey(Schema.String),
  author: Schema.optionalKey(ThreadProfileBasic),
  value: Schema.optionalKey(Schema.Unknown)
});

export const ThreadEmbedView = Schema.Struct({
  $type: Schema.optionalKey(Schema.String),
  // images#view
  images: Schema.optionalKey(Schema.Array(ThreadImageView)),
  // external#view
  external: Schema.optionalKey(ThreadExternalView),
  // record#view — contains a "record" sub-object
  record: Schema.optionalKey(ThreadRecordViewRecord),
  // recordWithMedia#view — media sub-object
  media: Schema.optionalKey(Schema.Struct({
    $type: Schema.optionalKey(Schema.String),
    images: Schema.optionalKey(Schema.Array(ThreadImageView)),
    external: Schema.optionalKey(ThreadExternalView),
    // video fields when media is a video
    cid: Schema.optionalKey(Schema.String),
    playlist: Schema.optionalKey(Schema.String),
    thumbnail: Schema.optionalKey(Schema.String),
    alt: Schema.optionalKey(Schema.String)
  })),
  // video#view — fields live directly on embed
  cid: Schema.optionalKey(Schema.String),
  playlist: Schema.optionalKey(Schema.String),
  thumbnail: Schema.optionalKey(Schema.String),
  alt: Schema.optionalKey(Schema.String)
});
export type ThreadEmbedView = Schema.Schema.Type<typeof ThreadEmbedView>;

// --- PostView (core post object with engagement counts) ---

export const ThreadPostView = Schema.Struct({
  uri: Schema.String,
  cid: Schema.String,
  author: ThreadProfileBasic,
  record: Schema.Unknown,
  embed: Schema.optionalKey(ThreadEmbedView),
  replyCount: Schema.optionalKey(Schema.Number),
  repostCount: Schema.optionalKey(Schema.Number),
  likeCount: Schema.optionalKey(Schema.Number),
  quoteCount: Schema.optionalKey(Schema.Number),
  indexedAt: Schema.String
});
export type ThreadPostView = Schema.Schema.Type<typeof ThreadPostView>;

// --- ThreadViewPost node (recursive — parent/replies decoded lazily) ---

export const ThreadViewPostNode = Schema.Struct({
  $type: Schema.optionalKey(Schema.String),
  post: ThreadPostView,
  parent: Schema.optionalKey(Schema.Unknown),
  replies: Schema.optionalKey(Schema.Array(Schema.Unknown))
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
