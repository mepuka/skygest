import { Schema } from "effect";

const isHttpsUrl = (value: string) => {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
};

export const HttpsUrl = Schema.String.pipe(
  Schema.filter(isHttpsUrl),
  Schema.brand("HttpsUrl")
);
export type HttpsUrl = Schema.Schema.Type<typeof HttpsUrl>;

export const Did = Schema.String.pipe(
  Schema.pattern(/^did:/),
  Schema.brand("Did")
).annotations({ description: "Decentralized Identifier, e.g. did:plc:abc123" });
export type Did = Schema.Schema.Type<typeof Did>;

export const AtUri = Schema.String.pipe(
  Schema.pattern(/^at:\/\//),
  Schema.brand("AtUri")
).annotations({ description: "AT Protocol URI, e.g. at://did:plc:abc/app.bsky.feed.post/rkey" });
export type AtUri = Schema.Schema.Type<typeof AtUri>;

export const PostUri = Schema.String.pipe(
  Schema.pattern(/^(at|x):\/\//),
  Schema.brand("PostUri")
).annotations({ description: "Post URI — at:// (Bluesky) or x:// (Twitter)" });
export type PostUri = Schema.Schema.Type<typeof PostUri>;

export type Platform = "bluesky" | "twitter";

/** Safe widening — every AtUri matches PostUri's pattern (at:// ⊂ at://|x://) */
export const atUriToPostUri = (uri: AtUri): PostUri => uri as unknown as PostUri;

export const platformFromUri = (uri: PostUri): Platform =>
  (uri as string).startsWith("at://") ? "bluesky" : "twitter";

export const FeedItem = Schema.Struct({
  post: AtUri,
  reason: Schema.optional(Schema.Unknown)
});
export type FeedItem = Schema.Schema.Type<typeof FeedItem>;

export const RawEvent = Schema.Struct({
  kind: Schema.Literal("commit"),
  operation: Schema.Union(
    Schema.Literal("create"),
    Schema.Literal("update"),
    Schema.Literal("delete")
  ),
  collection: Schema.String,
  did: Did,
  uri: AtUri,
  cid: Schema.optional(Schema.String),
  record: Schema.optional(Schema.Unknown),
  timeUs: Schema.Number
});
export type RawEvent = Schema.Schema.Type<typeof RawEvent>;

export const RawEventBatch = Schema.Struct({
  cursor: Schema.optional(Schema.Number),
  events: Schema.Array(RawEvent)
});
export type RawEventBatch = Schema.Schema.Type<typeof RawEventBatch>;

export const FeedGenMessage = Schema.Struct({
  users: Schema.Array(Did),
  batchId: Schema.Number,
  generateAgg: Schema.Boolean
});
export type FeedGenMessage = Schema.Schema.Type<typeof FeedGenMessage>;

export const PostprocessMessage = Schema.Struct({
  viewer: Did,
  accessAt: Schema.Number,
  limit: Schema.Number,
  cursorStart: Schema.Number,
  cursorEnd: Schema.Number,
  defaultFrom: Schema.optional(Schema.Number),
  recs: Schema.Array(FeedItem)
});
export type PostprocessMessage = Schema.Schema.Type<typeof PostprocessMessage>;
