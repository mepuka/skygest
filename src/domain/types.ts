import { Schema } from "effect";

const isHttpsUrl = (value: string) => {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
};

export const HttpsUrl = Schema.String.pipe(
  Schema.check(Schema.makeFilter(isHttpsUrl)),
  Schema.brand("HttpsUrl")
);
export type HttpsUrl = Schema.Schema.Type<typeof HttpsUrl>;

export const Did = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^did:/)),
  Schema.brand("Did")
).annotate({ description: "Decentralized Identifier, e.g. did:plc:abc123" });
export type Did = Schema.Schema.Type<typeof Did>;

export const AtUri = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^at:\/\//)),
  Schema.brand("AtUri")
).annotate({ description: "AT Protocol URI, e.g. at://did:plc:abc/app.bsky.feed.post/rkey" });
export type AtUri = Schema.Schema.Type<typeof AtUri>;

export const PostUri = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^(at|x):\/\//)),
  Schema.brand("PostUri")
).annotate({ description: "Post URI — at:// (Bluesky) or x:// (Twitter)" });
export type PostUri = Schema.Schema.Type<typeof PostUri>;

const PODCAST_SEGMENT_URI_PREFIX = "podcast-segment://";

const validatePodcastSegmentUri = (value: string) =>
  value.startsWith(PODCAST_SEGMENT_URI_PREFIX) &&
  value.length > PODCAST_SEGMENT_URI_PREFIX.length &&
  !/\s/u.test(value)
    ? undefined
    : "expected a podcast segment URI like podcast-segment://show/episode/segment";

export const PodcastSegmentUri = Schema.String.pipe(
  Schema.check(Schema.makeFilter(validatePodcastSegmentUri)),
  Schema.brand("PodcastSegmentUri")
).annotate({
  description: "Podcast segment URI, e.g. podcast-segment://catalyst-canary-media/2026-04-04/segment-3"
});
export type PodcastSegmentUri = Schema.Schema.Type<typeof PodcastSegmentUri>;

export const PublicationId = Schema.NonEmptyString.pipe(
  Schema.brand("PublicationId")
).annotate({
  description: "Stable publication identifier — hostname for text publications or show slug for podcast publications"
});
export type PublicationId = Schema.Schema.Type<typeof PublicationId>;

export const PlatformSchema = Schema.Literals(["bluesky", "twitter"]);
export type Platform = Schema.Schema.Type<typeof PlatformSchema>;

export const NonNegativeInt = Schema.Int.pipe(
  Schema.check(Schema.isGreaterThanOrEqualTo(0))
);
export type NonNegativeInt = Schema.Schema.Type<typeof NonNegativeInt>;

export const PlatformCounts = Schema.Struct({
  bluesky: NonNegativeInt,
  twitter: NonNegativeInt
});
export type PlatformCounts = Schema.Schema.Type<typeof PlatformCounts>;

/** Safe widening — every AtUri matches PostUri's pattern (at:// ⊂ at://|x://) */
export const atUriToPostUri = (uri: AtUri): PostUri => uri as unknown as PostUri;

/** Safe widening — every hostname/show slug chosen as a publication key is a PublicationId. */
export const stringToPublicationId = (value: string): PublicationId =>
  value as unknown as PublicationId;

export const podcastSegmentUriFromId = (
  segmentId: string
) =>
  Schema.decodeUnknownEffect(PodcastSegmentUri)(
    `${PODCAST_SEGMENT_URI_PREFIX}${segmentId}`
  );

export const platformFromUri = (uri: PostUri): Platform =>
  (uri as string).startsWith("at://") ? "bluesky" : "twitter";

export const FeedItem = Schema.Struct({
  post: AtUri,
  reason: Schema.optionalKey(Schema.Unknown)
});
export type FeedItem = Schema.Schema.Type<typeof FeedItem>;

export const RawEvent = Schema.Struct({
  kind: Schema.Literal("commit"),
  operation: Schema.Union([
    Schema.Literal("create"),
    Schema.Literal("update"),
    Schema.Literal("delete")
  ]),
  collection: Schema.String,
  did: Did,
  uri: AtUri,
  cid: Schema.optionalKey(Schema.String),
  record: Schema.optionalKey(Schema.Unknown),
  timeUs: Schema.Number
});
export type RawEvent = Schema.Schema.Type<typeof RawEvent>;

export const RawEventBatch = Schema.Struct({
  cursor: Schema.optionalKey(Schema.Number),
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
  defaultFrom: Schema.optionalKey(Schema.Number),
  recs: Schema.Array(FeedItem)
});
export type PostprocessMessage = Schema.Schema.Type<typeof PostprocessMessage>;
