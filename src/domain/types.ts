import { Schema } from "effect";

export const Did = Schema.String.pipe(
  Schema.pattern(/^did:/),
  Schema.brand("Did")
);
export type Did = Schema.Schema.Type<typeof Did>;

export const AtUri = Schema.String.pipe(
  Schema.pattern(/^at:\/\//),
  Schema.brand("AtUri")
);
export type AtUri = Schema.Schema.Type<typeof AtUri>;

export const FeedCursor = Schema.Union(
  Schema.Number,
  Schema.Literal("eof")
);
export type FeedCursor = Schema.Schema.Type<typeof FeedCursor>;

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
