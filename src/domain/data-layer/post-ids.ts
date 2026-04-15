import { Result, Schema } from "effect";
import { Did, PostUri } from "../types";

export const SGPOST_TBOX_NAMESPACE = "https://skygest.dev/vocab/post/" as const;
export const SGPOST_ABOX_NAMESPACE = "https://id.skygest.io/post/" as const;

const decodeDidResult = Schema.decodeUnknownResult(Did);
const decodePostSkygestUri = Schema.decodeUnknownSync(
  Schema.String.pipe(
    Schema.check(
      Schema.isPattern(
        /^https:\/\/id\.skygest\.io\/post\/(?:bluesky\/[^/]+\/[^/]+|twitter\/[^/]+)$/
      )
    ),
    Schema.brand("PostSkygestUri")
  )
);
const decodeChartAssetId = Schema.decodeUnknownSync(
  Schema.String.pipe(
    Schema.check(
      Schema.isPattern(
        /^https:\/\/id\.skygest\.io\/post\/(?:bluesky\/[^/]+\/[^/]+|twitter\/[^/]+)\/chart\/[^/]+$/
      )
    ),
    Schema.brand("ChartAssetId")
  )
);

export const PostSkygestUri = Schema.String.pipe(
  Schema.check(
    Schema.isPattern(
      /^https:\/\/id\.skygest\.io\/post\/(?:bluesky\/[^/]+\/[^/]+|twitter\/[^/]+)$/
    )
  ),
  Schema.brand("PostSkygestUri")
).annotate({
  description:
    "Canonical Skygest post URI — https://id.skygest.io/post/{platform}/..."
});
export type PostSkygestUri = Schema.Schema.Type<typeof PostSkygestUri>;

export const ChartAssetId = Schema.String.pipe(
  Schema.check(
    Schema.isPattern(
      /^https:\/\/id\.skygest\.io\/post\/(?:bluesky\/[^/]+\/[^/]+|twitter\/[^/]+)\/chart\/[^/]+$/
    )
  ),
  Schema.brand("ChartAssetId")
).annotate({
  description:
    "Canonical Skygest chart asset URI — https://id.skygest.io/post/{platform}/.../chart/{assetId}"
});
export type ChartAssetId = Schema.Schema.Type<typeof ChartAssetId>;

type ParsedPlatformPostUri =
  | {
      readonly platform: "bluesky";
      readonly did: Did;
      readonly rkey: string;
    }
  | {
      readonly platform: "twitter";
      readonly userId: string;
      readonly tweetId: string;
    };

export type ParsedPostSkygestUri =
  | {
      readonly platform: "bluesky";
      readonly did: Did;
      readonly rkey: string;
    }
  | {
      readonly platform: "twitter";
      readonly tweetId: string;
    };

export type ParsedChartAssetId =
  | {
      readonly platform: "bluesky";
      readonly did: Did;
      readonly rkey: string;
      readonly blobCid: string;
    }
  | {
      readonly platform: "twitter";
      readonly tweetId: string;
      readonly mediaId: string;
    };

const BLUESKY_POST_URI_PATTERN =
  /^at:\/\/([^/]+)\/app\.bsky\.feed\.post\/([^/?#]+)$/u;
const TWITTER_POST_URI_PATTERN = /^x:\/\/([^/]+)\/(?:status\/)?([^/?#]+)$/u;
const BLUESKY_POST_SKYGEST_PATTERN =
  /^https:\/\/id\.skygest\.io\/post\/bluesky\/([^/]+)\/([^/]+)$/u;
const TWITTER_POST_SKYGEST_PATTERN =
  /^https:\/\/id\.skygest\.io\/post\/twitter\/([^/]+)$/u;
const BLUESKY_CHART_SKYGEST_PATTERN =
  /^https:\/\/id\.skygest\.io\/post\/bluesky\/([^/]+)\/([^/]+)\/chart\/([^/]+)$/u;
const TWITTER_CHART_SKYGEST_PATTERN =
  /^https:\/\/id\.skygest\.io\/post\/twitter\/([^/]+)\/chart\/([^/]+)$/u;

const parseDid = (raw: string): Did | null => {
  const result = decodeDidResult(raw);
  return Result.isSuccess(result) ? result.success : null;
};

const parsePlatformPostUri = (postUri: PostUri): ParsedPlatformPostUri | null => {
  const blueskyMatch = BLUESKY_POST_URI_PATTERN.exec(postUri);
  if (blueskyMatch !== null) {
    const didValue = blueskyMatch[1];
    const rkey = blueskyMatch[2];

    if (didValue !== undefined && rkey !== undefined && rkey.length > 0) {
      const did = parseDid(didValue);
      if (did === null) {
        return null;
      }

      return {
        platform: "bluesky",
        did,
        rkey
      };
    }
  }

  const twitterMatch = TWITTER_POST_URI_PATTERN.exec(postUri);
  if (twitterMatch !== null) {
    const userId = twitterMatch[1];
    const tweetId = twitterMatch[2];

    if (
      userId !== undefined &&
      userId.length > 0 &&
      tweetId !== undefined &&
      tweetId.length > 0
    ) {
      return {
        platform: "twitter",
        userId,
        tweetId
      };
    }
  }

  return null;
};

const encodeDidSegment = (segment: string) =>
  encodeURIComponent(segment).replaceAll(".", "%2E");

export const encodeDidDots = (did: Did): string =>
  did.split(":").map(encodeDidSegment).join(".");

export const decodeDidDots = (didDots: string): Did | null => {
  try {
    const did = didDots
      .split(".")
      .map((segment) => decodeURIComponent(segment))
      .join(":");

    return parseDid(did);
  } catch {
    return null;
  }
};

const requireParsedPostUri = (postUri: PostUri): ParsedPlatformPostUri => {
  const parsed = parsePlatformPostUri(postUri);
  if (parsed !== null) {
    return parsed;
  }

  throw new TypeError(`Unsupported post URI for Skygest minting: ${postUri}`);
};

export const mintPostSkygestUri = (postUri: PostUri): PostSkygestUri => {
  const parsed = requireParsedPostUri(postUri);

  switch (parsed.platform) {
    case "bluesky":
      return decodePostSkygestUri(
        `${SGPOST_ABOX_NAMESPACE}bluesky/${encodeDidDots(parsed.did)}/${parsed.rkey}`
      );
    case "twitter":
      return decodePostSkygestUri(
        `${SGPOST_ABOX_NAMESPACE}twitter/${parsed.tweetId}`
      );
  }
};

export const mintBlueskyChartAssetId = ({
  did,
  rkey,
  blobCid
}: {
  readonly did: Did;
  readonly rkey: string;
  readonly blobCid: string;
}): ChartAssetId =>
  decodeChartAssetId(
    `${SGPOST_ABOX_NAMESPACE}bluesky/${encodeDidDots(did)}/${rkey}/chart/${blobCid}`
  );

export const mintTwitterChartAssetId = ({
  tweetId,
  mediaId
}: {
  readonly tweetId: string;
  readonly mediaId: string;
}): ChartAssetId =>
  decodeChartAssetId(
    `${SGPOST_ABOX_NAMESPACE}twitter/${tweetId}/chart/${mediaId}`
  );

export const chartAssetIdFromBluesky = (
  postUri: PostUri,
  blobCid: string
): ChartAssetId => {
  const parsed = requireParsedPostUri(postUri);

  if (parsed.platform !== "bluesky") {
    throw new TypeError(
      `Expected a Bluesky post URI when minting a Bluesky chart asset: ${postUri}`
    );
  }

  return mintBlueskyChartAssetId({
    did: parsed.did,
    rkey: parsed.rkey,
    blobCid
  });
};

export const chartAssetIdFromTwitter = (
  postUri: PostUri,
  mediaId: string
): ChartAssetId => {
  const parsed = requireParsedPostUri(postUri);

  if (parsed.platform !== "twitter") {
    throw new TypeError(
      `Expected a Twitter post URI when minting a Twitter chart asset: ${postUri}`
    );
  }

  return mintTwitterChartAssetId({
    tweetId: parsed.tweetId,
    mediaId
  });
};

export const parsePostSkygestUri = (
  value: string | PostSkygestUri
): ParsedPostSkygestUri | null => {
  const blueskyMatch = BLUESKY_POST_SKYGEST_PATTERN.exec(value);
  if (blueskyMatch !== null) {
    const didDots = blueskyMatch[1];
    const rkey = blueskyMatch[2];

    if (didDots !== undefined && rkey !== undefined && rkey.length > 0) {
      const did = decodeDidDots(didDots);
      if (did === null) {
        return null;
      }

      return {
        platform: "bluesky",
        did,
        rkey
      };
    }
  }

  const twitterMatch = TWITTER_POST_SKYGEST_PATTERN.exec(value);
  if (twitterMatch !== null) {
    const tweetId = twitterMatch[1];
    if (tweetId !== undefined && tweetId.length > 0) {
      return {
        platform: "twitter",
        tweetId
      };
    }
  }

  return null;
};

export const parseChartAssetId = (
  value: string | ChartAssetId
): ParsedChartAssetId | null => {
  const blueskyMatch = BLUESKY_CHART_SKYGEST_PATTERN.exec(value);
  if (blueskyMatch !== null) {
    const didDots = blueskyMatch[1];
    const rkey = blueskyMatch[2];
    const blobCid = blueskyMatch[3];

    if (
      didDots !== undefined &&
      rkey !== undefined &&
      rkey.length > 0 &&
      blobCid !== undefined &&
      blobCid.length > 0
    ) {
      const did = decodeDidDots(didDots);
      if (did === null) {
        return null;
      }

      return {
        platform: "bluesky",
        did,
        rkey,
        blobCid
      };
    }
  }

  const twitterMatch = TWITTER_CHART_SKYGEST_PATTERN.exec(value);
  if (twitterMatch !== null) {
    const tweetId = twitterMatch[1];
    const mediaId = twitterMatch[2];

    if (
      tweetId !== undefined &&
      tweetId.length > 0 &&
      mediaId !== undefined &&
      mediaId.length > 0
    ) {
      return {
        platform: "twitter",
        tweetId,
        mediaId
      };
    }
  }

  return null;
};
