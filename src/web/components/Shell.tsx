import { useCallback, useState } from "react";
import { useAtomValue } from "../lib/react.tsx";
import { AsyncResult } from "effect/unstable/reactivity";
import { feedAtom, publicationsAtom, topicLookupAtom } from "../lib/atoms.ts";
import type { TopicEntry } from "../lib/types.ts";
import { PostCard } from "./PostCard.tsx";
import { TooltipProvider } from "../primitives/index.ts";

const EMPTY_PUBS = new Map<string, never>();

export function Shell() {
  const feedResult = useAtomValue(feedAtom);
  const pubsResult = useAtomValue(publicationsAtom);
  const topicLookup = useAtomValue(topicLookupAtom);

  const [activePostUri, setActivePostUri] = useState<string | null>(null);

  const pubIndex = AsyncResult.getOrElse(pubsResult, () => EMPTY_PUBS);

  const resolveTopicEntries = useCallback(
    (slugs: readonly string[]): readonly TopicEntry[] =>
      slugs
        .map((s) => topicLookup.get(s))
        .filter((t): t is TopicEntry => t !== undefined),
    [topicLookup]
  );

  return (
    <TooltipProvider>
      <div className="min-h-screen bg-recessed font-ui text-[12px] leading-4 antialiased">
        {/* ---- Header ---- */}
        <header className="px-20 pt-6 max-lg:px-5 max-lg:pt-4">
          <div className="mx-auto max-w-[1080px] flex items-baseline justify-between pb-5">
            <h1 className="font-brand text-[28px] leading-[34px] text-heading">
              Skygest
            </h1>
            <div className="size-7 rounded-full bg-border shrink-0" />
          </div>
        </header>

        {/* ---- Feed Content: two-column on desktop ---- */}
        <main className="px-20 pt-6 max-lg:px-5">
          <div className="mx-auto max-w-[1080px] flex gap-10 max-lg:flex-col max-lg:gap-0">

            {/* Main Column — magazine layer */}
            <div className="w-[680px] shrink-0 max-lg:w-full">
              {AsyncResult.builder(feedResult)
                .onInitialOrWaiting(() => (
                  <div className="py-8 text-center text-mid text-sm">
                    Loading…
                  </div>
                ))
                .onError((error: any) => (
                  <div className="py-8 text-center text-accent text-sm">
                    {"message" in error ? String(error.message) : "Something went wrong."}
                  </div>
                ))
                .onDefect(() => (
                  <div className="py-8 text-center text-accent text-sm">
                    Something went wrong.
                  </div>
                ))
                .onSuccess((feed: any) => {
                  const feedLinks = feed.linksMap;
                  return feed.items.length === 0 ? (
                    <div className="py-8 text-center text-mid text-sm">
                      No curated picks yet.
                    </div>
                  ) : (
                    <>
                      {feed.items.map((post: any) => (
                        <PostCard
                          key={post.uri}
                          post={post}
                          link={feedLinks.get(post.uri) ?? null}
                          publicationIndex={pubIndex}
                          topicLabel={null}
                          topicEntries={resolveTopicEntries(post.topics)}
                          editorialCategory={"editorialCategory" in post ? post.editorialCategory : undefined}
                          active={activePostUri === post.uri}
                          onHover={setActivePostUri}
                        />
                      ))}
                    </>
                  );
                })
                .render()}
            </div>

            {/* Margin Column — data layer (desktop only) */}
            <aside className="w-[320px] shrink-0 pt-3.5 max-lg:hidden" aria-label="Annotations">
              {/* Margin notes render here, anchored to activePostUri */}
              {activePostUri === null && (
                <div className="text-data-secondary font-data-mono text-[11px] leading-3.5">
                  Hover a thread to see annotations
                </div>
              )}
            </aside>

          </div>
        </main>
      </div>
    </TooltipProvider>
  );
}
