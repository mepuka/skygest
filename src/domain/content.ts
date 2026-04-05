import { Schema } from "effect";
import type { KnowledgePost } from "./bi";
import { Did, PodcastSegmentUri, PostUri } from "./types";

const PODCAST_SEGMENT_URI_PREFIX = "podcast-segment://";

const isContentIdString = (value: string) =>
  value.startsWith("at://") ||
  value.startsWith("x://") ||
  (value.startsWith(PODCAST_SEGMENT_URI_PREFIX) &&
    value.length > PODCAST_SEGMENT_URI_PREFIX.length &&
    !/\s/u.test(value));

export const ContentType = Schema.Literals(["post", "podcast-segment"]);
export type ContentType = Schema.Schema.Type<typeof ContentType>;

export const ContentId = Schema.String.pipe(
  Schema.check(Schema.makeFilter(isContentIdString)),
  Schema.brand("ContentId")
).annotate({
  description: "Content identifier — PostUri for posts or PodcastSegmentUri for podcast segments"
});
export type ContentId = Schema.Schema.Type<typeof ContentId>;

const ContentItemFields = {
  contentId: ContentId,
  authorDid: Did,
  text: Schema.String,
  createdAt: Schema.Number
} as const;

export const PostContentItem = Schema.Struct({
  contentType: Schema.Literal("post"),
  ...ContentItemFields
});
export type PostContentItem = Schema.Schema.Type<typeof PostContentItem>;

export const PodcastSegmentContentItem = Schema.Struct({
  contentType: Schema.Literal("podcast-segment"),
  ...ContentItemFields
});
export type PodcastSegmentContentItem = Schema.Schema.Type<
  typeof PodcastSegmentContentItem
>;

export const ContentItem = Schema.Union([
  PostContentItem,
  PodcastSegmentContentItem
]);
export type ContentItem = Schema.Schema.Type<typeof ContentItem>;

export type PostContentItemSource = Pick<
  KnowledgePost,
  "uri" | "did" | "text" | "createdAt"
>;

export const isContentId = Schema.is(ContentId);
export const isContentItem = Schema.is(ContentItem);

export const isPostContentId = (value: string): value is ContentId =>
  value.startsWith("at://") || value.startsWith("x://");

export const isPodcastSegmentContentId = (
  value: ContentId
): value is ContentId =>
  value.startsWith("podcast-segment://");

/** Safe widening — every PostUri matches ContentId's accepted patterns. */
export const postUriToContentId = (uri: PostUri): ContentId =>
  uri as unknown as ContentId;

/** Safe widening — every PodcastSegmentUri matches ContentId's accepted patterns. */
export const podcastSegmentUriToContentId = (
  uri: PodcastSegmentUri
): ContentId => uri as unknown as ContentId;

export const contentTypeFromContentId = (contentId: ContentId): ContentType =>
  isPodcastSegmentContentId(contentId) ? "podcast-segment" : "post";

export const postToContentItem = (
  post: PostContentItemSource
): PostContentItem => ({
  contentId: postUriToContentId(post.uri),
  contentType: "post",
  authorDid: post.did,
  text: post.text,
  createdAt: post.createdAt
});

export const isPostContentItem = (value: unknown): value is PostContentItem =>
  isContentItem(value) && value.contentType === "post";

export const isPodcastSegmentContentItem = (
  value: unknown
): value is PodcastSegmentContentItem =>
  isContentItem(value) && value.contentType === "podcast-segment";
