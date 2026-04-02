import { Result, Schema } from "effect";
import { HttpsUrl, type Did } from "../domain/types";

const decodeHttpsUrl = Schema.decodeUnknownResult(HttpsUrl);

export const parseAvatarUrl = (raw: string): HttpsUrl | null => {
  const result = decodeHttpsUrl(raw);
  return Result.isSuccess(result) ? result.success : null;
};

export const feedThumbnailUrl = (did: Did, blobCid: string): HttpsUrl => {
  const url = `https://cdn.bsky.app/img/feed_thumbnail/plain/${did}/${blobCid}@jpeg`;
  return Schema.decodeUnknownSync(HttpsUrl)(url);
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
