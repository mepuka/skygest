import { useMemo, useCallback, useState } from "react";
import { useAtomValue, useAtomSet } from "@effect-atom/atom-react";
import { Result } from "@effect-atom/atom";
import { feedAtom, topicsAtom, linksAtom, publicationsAtom, selectedTopicAtom, topicLookupAtom } from "../lib/atoms.ts";
import type { TopicEntry } from "../lib/types.ts";
import { PostCard } from "./PostCard.tsx";
import { TopicFilterBar } from "./TopicFilterBar.tsx";
import { TooltipProvider } from "../primitives/index.ts";

const EMPTY_TOPICS: readonly never[] = [];
const EMPTY_LINKS = new Map<string, never>();
const EMPTY_PUBS = new Map<string, never>();

export function Shell() {
  const feedResult = useAtomValue(feedAtom);
  const topicsResult = useAtomValue(topicsAtom);
  const linksResult = useAtomValue(linksAtom);
  const pubsResult = useAtomValue(publicationsAtom);
  const selectedTopic = useAtomValue(selectedTopicAtom);
  const setSelectedTopic = useAtomSet(selectedTopicAtom);
  const topicLookup = useAtomValue(topicLookupAtom);

  const [activePostUri, setActivePostUri] = useState<string | null>(null);

  const topics = Result.getOrElse(topicsResult, () => EMPTY_TOPICS);
  const linksMap = Result.getOrElse(linksResult, () => EMPTY_LINKS);
  const pubIndex = Result.getOrElse(pubsResult, () => EMPTY_PUBS);

  const selectedTopicLabel = useMemo(
    () => selectedTopic ? topicLookup.get(selectedTopic)?.label ?? null : null,
    [selectedTopic, topicLookup]
  );

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
            <h1 className="font-brand text-[28px] leading-none text-heading">
              Skygest
            </h1>
            <div className="size-7 rounded-full bg-border shrink-0" />
          </div>
        </header>

        {/* ---- Topic Filter Bar ---- */}
        <div className="px-20 pb-4 border-b border-border max-lg:px-5">
          <div className="mx-auto max-w-[1080px]">
            {topics.length > 0 && (
              <TopicFilterBar
                topics={topics}
                selectedSlug={selectedTopic}
                onSelect={setSelectedTopic}
              />
            )}
          </div>
        </div>

        {/* ---- Feed Content: two-column on desktop ---- */}
        <main className="px-20 pt-6 max-lg:px-5">
          <div className="mx-auto max-w-[1080px] flex gap-10 max-lg:flex-col max-lg:gap-0">

            {/* Main Column — magazine layer */}
            <div className="w-[680px] shrink-0 max-lg:w-full">
              {Result.builder(feedResult)
                .onInitialOrWaiting(() => (
                  <div className="py-8 text-center text-mid text-sm">
                    Loading…
                  </div>
                ))
                .onError((error) => (
                  <div className="py-8 text-center text-accent text-sm">
                    {"message" in error ? String(error.message) : "Something went wrong."}
                  </div>
                ))
                .onDefect(() => (
                  <div className="py-8 text-center text-accent text-sm">
                    Something went wrong.
                  </div>
                ))
                .onSuccess((feed) => {
                  const feedLinks = feed.linksMap ?? linksMap;
                  return feed.items.length === 0 ? (
                    <div className="py-8 text-center text-mid text-sm">
                      No posts yet.
                    </div>
                  ) : (
                    <>
                      {feed.items.map((post) => (
                        <PostCard
                          key={post.uri}
                          post={post}
                          link={feedLinks.get(post.uri) ?? null}
                          publicationIndex={pubIndex}
                          topicLabel={selectedTopicLabel}
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
