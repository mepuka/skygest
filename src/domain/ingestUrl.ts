import { Option, Schema } from "effect";
import type { Platform } from "./types";

export class UnsupportedUrlError extends Schema.TaggedErrorClass<UnsupportedUrlError>()(
  "UnsupportedUrlError",
  {
    url: Schema.String,
    message: Schema.String
  }
) {}

export type ParsedPostUrl = {
  readonly platform: Platform;
  readonly handle: string;
  readonly id: string;
};

const BSKY_RE = /^https:\/\/bsky\.app\/profile\/([^/]+)\/post\/([a-zA-Z0-9]+)/;
const TWITTER_RE = /^https:\/\/(?:x\.com|twitter\.com)\/([^/]+)\/status\/(\d+)/;

const SUPPORTED_FORMATS =
  `Supported:\n` +
  `  https://bsky.app/profile/<handle>/post/<rkey>\n` +
  `  https://x.com/<handle>/status/<id>\n` +
  `  https://twitter.com/<handle>/status/<id>`;

/** Parse a post URL into platform + handle + id. Returns Option.none for unsupported formats. */
export const parsePostUrl = (url: string): Option.Option<ParsedPostUrl> => {
  const bsky = BSKY_RE.exec(url);
  if (bsky) return Option.some({ platform: "bluesky" as const, handle: bsky[1]!, id: bsky[2]! });

  const twitter = TWITTER_RE.exec(url);
  if (twitter) return Option.some({ platform: "twitter" as const, handle: twitter[1]!, id: twitter[2]! });

  return Option.none();
};

export { SUPPORTED_FORMATS };
