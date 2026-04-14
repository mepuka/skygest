/**
 * Pure normalizer functions that convert Twitter scraper shapes into the
 * ImportPostsInput format accepted by `POST /admin/import/posts`.
 */

import type { Tweet, TweetDetailNode, Profile, TweetPhoto, TweetVideo } from "@pooks/twitter-scraper";
import type { Did, PostUri } from "../domain/types";
import type { ExpertTier } from "../domain/bi";
import type {
  ImportExpertInput,
  ImportLinkInput,
  ImportPostInput
} from "../domain/api";
import type { EmbedKind, EmbedPayload } from "../domain/embed";
import { normalizeLinkedHostname } from "../platform/Normalize";

// ---------------------------------------------------------------------------
// Internal structural type for the fields normalizeTweet actually accesses.
// Both Tweet and TweetDetailNode satisfy this shape, avoiding nominal
// incompatibilities between the two Schema.Class types.
// ---------------------------------------------------------------------------

interface NormalizableFields {
  readonly id: string;
  readonly userId?: string | undefined;
  readonly username?: string | undefined;
  readonly text?: string | undefined;
  readonly timestamp?: number | undefined;
  readonly hashtags: readonly string[];
  readonly urls: readonly string[];
  readonly photos: readonly TweetPhoto[];
  readonly videos: readonly TweetVideo[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const extractDomain = (url: string): string | undefined => {
  return normalizeLinkedHostname(url) ?? undefined;
};

const buildLinks = (urls: readonly string[]): ImportLinkInput[] =>
  urls.map((url) => {
    const domain = extractDomain(url);
    return {
      url,
      ...(domain === undefined ? {} : { domain })
    };
  });

const buildEmbed = (
  tweet: NormalizableFields
): { embedType: EmbedKind; embedPayload: EmbedPayload } | null => {
  if (tweet.photos.length > 0) {
    return {
      embedType: "img" as EmbedKind,
      embedPayload: {
        kind: "img" as const,
        images: tweet.photos.map((p) => ({
          thumb: p.url,
          fullsize: p.url,
          alt: p.altText ?? null
        }))
      }
    };
  }

  if (tweet.videos.length > 0) {
    const video = tweet.videos[0]!;
    return {
      embedType: "video" as EmbedKind,
      embedPayload: {
        kind: "video" as const,
        playlist: video.url ?? null,
        thumbnail: video.preview,
        alt: null
      }
    };
  }

  return null;
};

// ---------------------------------------------------------------------------
// Public normalizers
// ---------------------------------------------------------------------------

export interface NormalizedPost {
  readonly uri: PostUri;
  readonly did: Did;
  readonly text: string;
  readonly createdAt: number;
  readonly hashtags?: readonly string[];
  readonly embedType?: EmbedKind | null;
  readonly embedPayload?: EmbedPayload | null;
  readonly links: readonly ImportLinkInput[];
}

/**
 * Internal: normalize any object satisfying NormalizableFields into a post.
 */
const normalizeTweetFromFields = (tweet: NormalizableFields): NormalizedPost | null => {
  if (!tweet.userId) {
    return null;
  }

  const uri = `x://${tweet.userId}/status/${tweet.id}` as PostUri;
  const did = `did:x:${tweet.userId}` as Did;
  const createdAt =
    tweet.timestamp !== undefined ? tweet.timestamp * 1000 : Date.now();
  const embed = buildEmbed(tweet);
  const links = buildLinks(tweet.urls as string[]);

  return {
    uri,
    did,
    text: tweet.text ?? "",
    createdAt,
    hashtags: tweet.hashtags,
    ...(embed !== null
      ? { embedType: embed.embedType, embedPayload: embed.embedPayload }
      : {}),
    links
  };
};

/**
 * Normalize a timeline Tweet into the import post shape.
 * Returns null when the tweet lacks a userId (skip).
 */
export const normalizeTweet = (tweet: Tweet): NormalizedPost | null =>
  normalizeTweetFromFields(tweet);

/**
 * Normalize a TweetDetailNode (richer model from tweet detail API).
 * Same mapping as normalizeTweet but accepts the detail shape.
 */
export const normalizeTweetDetail = (
  node: TweetDetailNode
): NormalizedPost | null => {
  // Delegate to the same core logic — both types share the NormalizableFields shape
  return normalizeTweetFromFields(node);
};

/**
 * Normalize a Twitter profile into the ImportExpertInput shape.
 * Returns null when the profile lacks a userId (skip).
 */
export const normalizeProfile = (
  profile: Profile,
  tier: ExpertTier
): ImportExpertInput | null => {
  if (!profile.userId) {
    return null;
  }

  return {
    did: `did:x:${profile.userId}` as Did,
    handle: profile.username ?? profile.userId,
    domain: "energy",
    source: "twitter-import" as const,
    tier,
    ...(profile.name !== undefined ? { displayName: profile.name } : {}),
    ...(profile.avatar !== undefined ? { avatar: profile.avatar } : {})
  };
};
