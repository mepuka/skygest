import { Option } from "effect";
import { parseUrlLike } from "../platform/Normalize";

export const parseTwitterMediaUrl = (
  raw: string
): { readonly mediaId: string } | null =>
  Option.match(parseUrlLike(raw), {
    onNone: () => null,
    onSome: (url) => {
      if (url.protocol !== "https:" || url.hostname !== "pbs.twimg.com") {
        return null;
      }

      const match = url.pathname.match(/^\/media\/([^/]+?)(?:\.[^/]+)?$/u);
      if (match === null) {
        return null;
      }

      const mediaId = match[1];
      if (mediaId === undefined || mediaId.length === 0) {
        return null;
      }

      return { mediaId };
    }
  });
