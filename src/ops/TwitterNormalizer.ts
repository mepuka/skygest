/**
 * Pure normalizer functions that convert Twitter scraper shapes into the
 * ImportPostsInput format accepted by `POST /admin/import/posts`.
 *
 * These interfaces duck-type the scraper models so that skygest-cloudflare
 * has no hard dependency on the scraper package.
 */

import type { Did, PostUri } from "../domain/types";
import type { ExpertTier } from "../domain/bi";
import type {
  ImportExpertInput,
  ImportLinkInput,
  ImportPostInput
} from "../domain/api";
import type { EmbedKind, EmbedPayload } from "../domain/embed";

// ---------------------------------------------------------------------------
// Lightweight input interfaces (duck-typed to scraper shapes)
// ---------------------------------------------------------------------------

export interface ScraperTweetPhoto {
  readonly id: string;
  readonly url: string;
  readonly altText?: string;
}

export interface ScraperTweetVideo {
  readonly id: string;
  readonly preview: string;
  readonly url?: string;
}

export interface ScraperTweet {
  readonly id: string;
  readonly userId?: string;
  readonly username?: string;
  readonly name?: string;
  readonly text?: string;
  readonly timestamp?: number; // seconds since epoch
  readonly hashtags: readonly string[];
  readonly urls: readonly string[];
  readonly photos: readonly ScraperTweetPhoto[];
  readonly videos: readonly ScraperTweetVideo[];
  readonly likes?: number;
  readonly retweets?: number;
  readonly replies?: number;
  readonly isQuoted: boolean;
  readonly quotedTweetId?: string;
  readonly isRetweet: boolean;
  readonly isReply: boolean;
}

export interface ScraperTweetDetailNode extends ScraperTweet {
  readonly resolution?: string;
  readonly versions?: readonly string[];
  readonly isEdited?: boolean;
}

export interface ScraperProfile {
  readonly userId?: string;
  readonly username?: string;
  readonly name?: string;
  readonly avatar?: string;
  readonly biography?: string;
  readonly followersCount?: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const extractDomain = (url: string): string | undefined => {
  try {
    return new URL(url).hostname;
  } catch {
    return undefined;
  }
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
  tweet: ScraperTweet
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
  readonly embedType?: EmbedKind | null;
  readonly embedPayload?: EmbedPayload | null;
  readonly links: readonly ImportLinkInput[];
}

/**
 * Normalize a timeline Tweet into the import post shape.
 * Returns null when the tweet lacks a userId (skip).
 */
export const normalizeTweet = (tweet: ScraperTweet): NormalizedPost | null => {
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
    ...(embed !== null
      ? { embedType: embed.embedType, embedPayload: embed.embedPayload }
      : {}),
    links
  };
};

/**
 * Normalize a TweetDetailNode (richer model from tweet detail API).
 * Same mapping as normalizeTweet but accepts the detail shape.
 */
export const normalizeTweetDetail = (
  node: ScraperTweetDetailNode
): NormalizedPost | null => {
  // Delegate to the same core logic — the detail node is a superset of Tweet
  return normalizeTweet(node);
};

/**
 * Normalize a Twitter profile into the ImportExpertInput shape.
 * Returns null when the profile lacks a userId (skip).
 */
export const normalizeProfile = (
  profile: ScraperProfile,
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
