import { Option, Result, Schema } from "effect";
import { Did, HttpsUrl } from "../domain/types";
import { parseUrlLike } from "../platform/Normalize";

const decodeHttpsUrl = Schema.decodeUnknownResult(HttpsUrl);
const decodeDid = Schema.decodeUnknownResult(Did);

export const parseAvatarUrl = (raw: string): HttpsUrl | null => {
  const result = decodeHttpsUrl(raw);
  return Result.isSuccess(result) ? result.success : null;
};

export const feedThumbnailUrl = (did: Did, blobCid: string): HttpsUrl => {
  const url = `https://cdn.bsky.app/img/feed_thumbnail/plain/${did}/${blobCid}@jpeg`;
  return Schema.decodeUnknownSync(HttpsUrl)(url);
};

export const parseFeedImageUrl = (
  raw: string
): { readonly did: Did; readonly blobCid: string } | null => {
  return Option.match(parseUrlLike(raw), {
    onNone: () => null,
    onSome: (url) => {
      if (url.protocol !== "https:" || url.hostname !== "cdn.bsky.app") {
        return null;
      }

      const match = url.pathname.match(
        /^\/img\/feed_(?:fullsize|thumbnail)\/plain\/([^/]+)\/([^/@:]+)(?:@[^/]+)?$/u
      );
      if (match === null) {
        return null;
      }

      const didValue = match[1];
      const blobCid = match[2];
      if (didValue === undefined || blobCid === undefined || blobCid.length === 0) {
        return null;
      }

      const did = decodeDid(didValue);
      if (!Result.isSuccess(did)) {
        return null;
      }

      return {
        did: did.success,
        blobCid
      };
    }
  });
};

export const extractBlobCid = (thumb: unknown): string | null => {
  if (typeof thumb !== "object" || thumb === null) {
    return null;
  }

  const obj = thumb as Record<string, unknown>;

  if (typeof obj.ref === "object" && obj.ref !== null) {
    const ref = obj.ref as Record<string, unknown>;
    if (typeof ref.$link === "string" && ref.$link.length > 0) {
      return ref.$link;
    }
  }

  if (typeof obj.$link === "string" && obj.$link.length > 0) {
    return obj.$link;
  }

  return null;
};
