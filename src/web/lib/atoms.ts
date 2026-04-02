import { AsyncResult, Atom } from "effect/unstable/reactivity";
import { Effect } from "effect";
import { SkygestApi } from "./client.ts";
import { buildPublicationIndex } from "./publications.ts";
import type { TopicEntry } from "./types.ts";

export const topicsAtom = SkygestApi.query("topics", "list", {
  query: {}
}).pipe(
  Atom.mapResult((res: any) => res.items),
  Atom.keepAlive
);

export const publicationsAtom = SkygestApi.query("publications", "list", {
  query: {}
}).pipe(
  Atom.mapResult((res: any) => buildPublicationIndex(res.items)),
  Atom.keepAlive
);

// @ts-expect-error — `as any` client casts widen requirements to `unknown`
export const linksAtom = SkygestApi.runtime.atom((_get) =>
  Effect.gen(function* () {
    const client = yield* SkygestApi;
    const result = yield* (client as any).links.list({
      query: { limit: 100 }
    });
    const byPostUri = new Map<string, any>();
    for (const link of (result as any).items) {
      if (!byPostUri.has(link.postUri)) {
        byPostUri.set(link.postUri, link);
      }
    }
    return byPostUri;
  })
);

// @ts-expect-error — `as any` client casts widen requirements to `unknown`
export const feedAtom = SkygestApi.runtime.atom((_get) =>
  Effect.gen(function* () {
    const client = yield* SkygestApi;
    const curated = yield* (client as any).posts.curated({
      query: { limit: 30 }
    });
    // Curated picks may reference older posts — fetch links without the
    // recent-window constraint that linksAtom uses, so previews render
    // regardless of post age.
    const linksResult = yield* (client as any).links.list({
      query: { limit: 100 }
    });
    const linksMap = new Map<string, any>();
    for (const link of (linksResult as any).items) {
      if (!linksMap.has(link.postUri)) {
        linksMap.set(link.postUri, link);
      }
    }
    return { items: curated.items, linksMap };
  })
);

/** Resolve topic slugs to label entries for OntologyBreadcrumb */
export const topicLookupAtom = Atom.make((get) => {
  const items = AsyncResult.getOrElse(get(topicsAtom), () => [] as readonly never[]);
  const map = new Map<string, TopicEntry>();
  for (const t of items) {
    map.set(t.slug, { slug: t.slug, label: t.label });
  }
  return map;
});
