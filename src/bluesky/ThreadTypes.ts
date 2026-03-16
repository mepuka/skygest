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

// --- PostView (core post object with engagement counts) ---

export const ThreadPostView = Schema.Struct({
  uri: Schema.String,
  cid: Schema.String,
  author: ThreadProfileBasic,
  record: Schema.Unknown,
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
