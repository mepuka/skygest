import { Atom, Result } from "@effect-atom/atom";
import { Effect } from "effect";
import { SkygestApi } from "./client.ts";
import { buildPublicationIndex } from "./publications.ts";
import type { TopicEntry } from "./types.ts";

export const topicsAtom = SkygestApi.query("topics", "list", {
  urlParams: {}
}).pipe(
  Atom.mapResult((res) => res.items),
  Atom.keepAlive
);

export const publicationsAtom = SkygestApi.query("publications", "list", {
  urlParams: {}
}).pipe(
  Atom.mapResult((res) => buildPublicationIndex(res.items)),
  Atom.keepAlive
);

export const linksAtom = SkygestApi.runtime.atom(() =>
  Effect.gen(function* () {
    const client = yield* SkygestApi;
    const result = yield* client.links.list({
      urlParams: { limit: 100 }
    });
    const byPostUri = new Map<string, (typeof result.items)[number]>();
    for (const link of result.items) {
      if (!byPostUri.has(link.postUri)) {
        byPostUri.set(link.postUri, link);
      }
    }
    return byPostUri;
  })
);

export const feedAtom = SkygestApi.runtime.atom(() =>
  Effect.gen(function* () {
    const client = yield* SkygestApi;
    const curated = yield* client.posts.curated({
      urlParams: { limit: 30 }
    });
    // Curated picks may reference older posts — fetch links without the
    // recent-window constraint that linksAtom uses, so previews render
    // regardless of post age.
    const linksResult = yield* client.links.list({
      urlParams: { limit: 100 }
    });
    const linksMap = new Map<string, (typeof linksResult.items)[number]>();
    for (const link of linksResult.items) {
      if (!linksMap.has(link.postUri)) {
        linksMap.set(link.postUri, link);
      }
    }
    return { items: curated.items, linksMap };
  })
);

/** Resolve topic slugs to label entries for OntologyBreadcrumb */
export const topicLookupAtom = Atom.make((get) => {
  const items = Result.getOrElse(get(topicsAtom), () => [] as readonly never[]);
  const map = new Map<string, TopicEntry>();
  for (const t of items) {
    map.set(t.slug, { slug: t.slug, label: t.label });
  }
  return map;
});
