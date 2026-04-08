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

const ISO_TIMESTAMP_WITH_TIMEZONE_PATTERN =
  /^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:\d{2})$/u;

const validateIsoTimestamp = (value: string) => {
  if (!ISO_TIMESTAMP_WITH_TIMEZONE_PATTERN.test(value)) {
    return "expected an ISO 8601 timestamp with timezone";
  }

  return !Number.isNaN(Date.parse(value))
    ? undefined
    : "expected a parseable ISO 8601 timestamp";
};

export const IsoTimestamp = Schema.String.pipe(
  Schema.check(Schema.makeFilter(validateIsoTimestamp)),
  Schema.brand("IsoTimestamp")
);
export type IsoTimestamp = Schema.Schema.Type<typeof IsoTimestamp>;

const DATE_LIKE_PATTERN = /^\d{4}(?:-\d{2}(?:-\d{2}(?:T.+)?)?)?$/u;

const validateDateLike = (value: string) =>
  DATE_LIKE_PATTERN.test(value)
    ? undefined
    : "expected a date-like value: YYYY, YYYY-MM, YYYY-MM-DD, or ISO 8601 timestamp";

/** Flexible date string — accepts year, year-month, date, or full timestamp. */
export const DateLike = Schema.String.pipe(
  Schema.check(Schema.makeFilter(validateDateLike))
).annotate({ description: "Date-like value: YYYY, YYYY-MM, YYYY-MM-DD, or ISO 8601 timestamp" });
export type DateLike = Schema.Schema.Type<typeof DateLike>;

const isWebUrl = (value: string) => {
  try {
    const protocol = new URL(value).protocol;
    return protocol === "https:" || protocol === "http:";
  } catch {
    return false;
  }
};

/** Web URL — accepts http: and https: (many government data portals use http). */
export const WebUrl = Schema.String.pipe(
  Schema.check(Schema.makeFilter(isWebUrl))
).annotate({ description: "Web URL (http or https)" });
export type WebUrl = Schema.Schema.Type<typeof WebUrl>;

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

export const PodcastEpisodeId = Schema.NonEmptyString.pipe(
  Schema.brand("PodcastEpisodeId")
).annotate({
  description: "Stable podcast episode identifier"
});
export type PodcastEpisodeId = Schema.Schema.Type<typeof PodcastEpisodeId>;

export const PodcastSegmentId = Schema.NonEmptyString.pipe(
  Schema.brand("PodcastSegmentId")
).annotate({
  description: "Stable podcast segment identifier"
});
export type PodcastSegmentId = Schema.Schema.Type<typeof PodcastSegmentId>;

const validateTranscriptR2Key = (value: string) => {
  if (
    !value.startsWith("transcripts/") ||
    !value.endsWith(".json") ||
    value.includes("\\") ||
    value.includes("..")
  ) {
    return "Transcript R2 keys must use the transcripts/<showSlug>/<episodeId>.json shape";
  }

  const [, showSlug, filename, ...rest] = value.split("/");
  if (
    showSlug == null ||
    showSlug.length === 0 ||
    filename == null ||
    filename.length === 0 ||
    rest.length > 0
  ) {
    return "Transcript R2 keys must include exactly one show slug and one episode filename";
  }

  return undefined;
};

export const TranscriptR2Key = Schema.NonEmptyString.pipe(
  Schema.check(Schema.makeFilter(validateTranscriptR2Key)),
  Schema.brand("TranscriptR2Key")
).annotate({
  description: "R2 object key for a stored podcast transcript"
});
export type TranscriptR2Key = Schema.Schema.Type<typeof TranscriptR2Key>;

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
