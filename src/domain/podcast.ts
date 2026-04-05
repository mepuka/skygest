import { Schema } from "effect";
import { MatchSignal, TopicSlug } from "./bi";
import {
  Did,
  HttpsUrl,
  NonNegativeInt,
  PodcastEpisodeId,
  PodcastSegmentId,
  PublicationId,
  TranscriptR2Key
} from "./types";

export const PodcastEpisodeLifecycleState = Schema.Literals([
  "fetched",
  "transcribed",
  "segmented",
  "pushed"
]);
export type PodcastEpisodeLifecycleState = Schema.Schema.Type<
  typeof PodcastEpisodeLifecycleState
>;

export const PodcastChapterMarker = Schema.Struct({
  startTimestampMs: NonNegativeInt,
  title: Schema.String.pipe(Schema.check(Schema.isMinLength(1)))
});
export type PodcastChapterMarker = Schema.Schema.Type<typeof PodcastChapterMarker>;

const PodcastSegmentTopicMatchFields = {
  topicSlug: TopicSlug,
  matchedTerm: Schema.NullOr(Schema.String),
  matchSignal: MatchSignal,
  matchValue: Schema.NullOr(Schema.String),
  matchScore: Schema.NullOr(Schema.Number),
  ontologyVersion: Schema.String,
  matcherVersion: Schema.String
} as const;

const validatePodcastEpisodeRecord = (value: {
  readonly createdAt: number;
  readonly updatedAt: number;
}) =>
  value.updatedAt >= value.createdAt
    ? undefined
    : "podcast episode updatedAt must be greater than or equal to createdAt";

const validatePodcastSegmentRecord = (value: {
  readonly primarySpeakerDid: Did;
  readonly speakerDids: ReadonlyArray<Did>;
  readonly startTimestampMs: number;
  readonly endTimestampMs: number;
  readonly topicMatches: ReadonlyArray<{ readonly topicSlug: TopicSlug }>;
}) => {
  if (value.endTimestampMs <= value.startTimestampMs) {
    return "podcast segment endTimestampMs must be greater than startTimestampMs";
  }

  if (!value.speakerDids.includes(value.primarySpeakerDid)) {
    return "podcast segment speakerDids must include the primarySpeakerDid";
  }

  const topicSlugs = value.topicMatches.map((topicMatch) => topicMatch.topicSlug);
  if (new Set(topicSlugs).size !== topicSlugs.length) {
    return "podcast segment topicMatches must not repeat topicSlug values";
  }

  return undefined;
};

export const PodcastEpisodeRecord = Schema.Struct({
  episodeId: PodcastEpisodeId,
  showSlug: PublicationId,
  title: Schema.String.pipe(Schema.check(Schema.isMinLength(1))),
  publishedAt: NonNegativeInt,
  audioUrl: Schema.NullOr(HttpsUrl),
  durationSeconds: Schema.NullOr(NonNegativeInt),
  speakerDids: Schema.Array(Did),
  chapterMarkers: Schema.NullOr(Schema.Array(PodcastChapterMarker)),
  transcriptR2Key: Schema.NullOr(Schema.String),
  lifecycleState: PodcastEpisodeLifecycleState,
  createdAt: NonNegativeInt,
  updatedAt: NonNegativeInt
}).pipe(
  Schema.check(Schema.makeFilter(validatePodcastEpisodeRecord))
);
export type PodcastEpisodeRecord = Schema.Schema.Type<typeof PodcastEpisodeRecord>;

export const PodcastSegmentTopicMatch = Schema.Struct(
  PodcastSegmentTopicMatchFields
);
export type PodcastSegmentTopicMatch = Schema.Schema.Type<
  typeof PodcastSegmentTopicMatch
>;

export const PodcastSegmentRecord = Schema.Struct({
  segmentId: PodcastSegmentId,
  episodeId: PodcastEpisodeId,
  segmentIndex: NonNegativeInt,
  primarySpeakerDid: Did,
  speakerDids: Schema.Array(Did),
  startTimestampMs: NonNegativeInt,
  endTimestampMs: NonNegativeInt,
  text: Schema.String.pipe(Schema.check(Schema.isMinLength(1))),
  createdAt: NonNegativeInt,
  topicMatches: Schema.Array(PodcastSegmentTopicMatch)
}).pipe(
  Schema.check(Schema.makeFilter(validatePodcastSegmentRecord))
);
export type PodcastSegmentRecord = Schema.Schema.Type<typeof PodcastSegmentRecord>;

const validatePodcastEpisodeBundle = (value: {
  readonly episode: PodcastEpisodeRecord;
  readonly segments: ReadonlyArray<PodcastSegmentRecord>;
}) => {
  const segmentIds = value.segments.map((segment) => segment.segmentId);
  if (new Set(segmentIds).size !== segmentIds.length) {
    return "podcast episode bundle segments must not repeat segmentId values";
  }

  const segmentIndexes = value.segments.map((segment) => segment.segmentIndex);
  if (new Set(segmentIndexes).size !== segmentIndexes.length) {
    return "podcast episode bundle segments must not repeat segmentIndex values";
  }

  if (!value.segments.every((segment) => segment.episodeId === value.episode.episodeId)) {
    return "podcast episode bundle segments must all belong to the enclosing episode";
  }

  return undefined;
};

export const PodcastEpisodeBundle = Schema.Struct({
  episode: PodcastEpisodeRecord,
  segments: Schema.Array(PodcastSegmentRecord)
}).pipe(
  Schema.check(Schema.makeFilter(validatePodcastEpisodeBundle))
);
export type PodcastEpisodeBundle = Schema.Schema.Type<typeof PodcastEpisodeBundle>;

const TranscriptSpeakerId = Schema.String.pipe(
  Schema.check(Schema.isMinLength(1)),
  Schema.brand("TranscriptSpeakerId")
);
export type TranscriptSpeakerId = Schema.Schema.Type<typeof TranscriptSpeakerId>;

const validateTranscriptSegment = (value: {
  readonly startMs: number;
  readonly endMs: number;
}) =>
  value.endMs > value.startMs
    ? undefined
    : "podcast transcript segment endMs must be greater than startMs";

export const PodcastTranscriptSpeaker = Schema.Struct({
  id: TranscriptSpeakerId,
  resolvedDid: Schema.NullOr(Did),
  name: Schema.String.pipe(Schema.check(Schema.isMinLength(1)))
});
export type PodcastTranscriptSpeaker = Schema.Schema.Type<
  typeof PodcastTranscriptSpeaker
>;

export const PodcastTranscriptSegment = Schema.Struct({
  startMs: NonNegativeInt,
  endMs: NonNegativeInt,
  speakerId: TranscriptSpeakerId,
  text: Schema.String.pipe(Schema.check(Schema.isMinLength(1)))
}).pipe(
  Schema.check(Schema.makeFilter(validateTranscriptSegment))
);
export type PodcastTranscriptSegment = Schema.Schema.Type<
  typeof PodcastTranscriptSegment
>;

const validatePodcastTranscript = (value: {
  readonly durationMs: number;
  readonly speakers: ReadonlyArray<PodcastTranscriptSpeaker>;
  readonly segments: ReadonlyArray<PodcastTranscriptSegment>;
}) => {
  const speakerIds = value.speakers.map((speaker) => speaker.id);
  if (new Set(speakerIds).size !== speakerIds.length) {
    return "podcast transcript speakers must not repeat speaker ids";
  }

  if (!value.segments.every((segment) => speakerIds.includes(segment.speakerId))) {
    return "podcast transcript segments must reference known speaker ids";
  }

  if (!value.segments.every((segment) => segment.endMs <= value.durationMs)) {
    return "podcast transcript segments must end before durationMs";
  }

  for (let index = 1; index < value.segments.length; index++) {
    if (value.segments[index - 1]!.startMs > value.segments[index]!.startMs) {
      return "podcast transcript segments must be ordered by startMs";
    }
  }

  return undefined;
};

export const PodcastTranscript = Schema.Struct({
  format: Schema.Literal("skygest-transcript-v1"),
  showSlug: PublicationId,
  episodeId: PodcastEpisodeId,
  transcriptR2Key: Schema.optionalKey(TranscriptR2Key),
  durationMs: NonNegativeInt,
  speakers: Schema.Array(PodcastTranscriptSpeaker),
  segments: Schema.Array(PodcastTranscriptSegment)
}).pipe(
  Schema.check(Schema.makeFilter(validatePodcastTranscript))
);
export type PodcastTranscript = Schema.Schema.Type<typeof PodcastTranscript>;
