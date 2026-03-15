import { Atom } from "@effect-atom/atom";
import { Effect } from "effect";
import { SkygestApi } from "./client.ts";

export const selectedTopicAtom = Atom.make<string | null>(null).pipe(
  Atom.keepAlive
);

export const topicsAtom = SkygestApi.query("topics", "list", {
  urlParams: {}
}).pipe(
  Atom.mapResult((res) => res.items),
  Atom.keepAlive
);

export const postsAtom = SkygestApi.runtime.atom((get) => {
  const topic = get(selectedTopicAtom) ?? undefined;
  return Effect.gen(function* () {
    const client = yield* SkygestApi;
    const result = yield* client.posts.recent({
      urlParams: topic !== undefined ? { topic, limit: 30 } : { limit: 30 }
    });
    return result.items;
  });
});
