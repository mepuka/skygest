import { useMemo, useCallback } from "react";
import { useAtomValue, useAtomSet } from "@effect-atom/atom-react";
import { Result } from "@effect-atom/atom";
import { feedAtom, topicsAtom, linksAtom, publicationsAtom, selectedTopicAtom, topicLookupAtom } from "../lib/atoms.ts";
import type { TopicEntry } from "../lib/types.ts";
import { PostCard } from "./PostCard.tsx";
import { TopicFilterBar } from "./TopicFilterBar.tsx";

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
    <div className="min-h-screen bg-recessed font-ui text-[12px] leading-4 antialiased">
      <header className="bg-surface border-b border-border">
        <div className="mx-auto max-w-[680px] px-4 py-4 flex items-center justify-between">
          <div className="flex items-baseline gap-2">
            <h1 className="font-brand text-[28px] leading-none text-heading tracking-[-0.01em]">
              skygest
            </h1>
            <span className="font-ui text-[10px] font-semibold tracking-[0.1em] uppercase text-ghost">
              Energy
            </span>
          </div>
          <div className="flex gap-4" role="navigation" aria-label="Main">
            <span className="font-ui text-[13px] text-mid">Search</span>
            <span className="font-ui text-[13px] text-heading font-medium" aria-current="page">Feed</span>
            <span className="font-ui text-[13px] text-mid">Topics</span>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[680px] py-4">
        <div className="bg-surface rounded border border-border">
          {topics.length > 0 && (
            <TopicFilterBar
              topics={topics}
              selectedSlug={selectedTopic}
              onSelect={setSelectedTopic}
            />
          )}

          <div aria-live="polite">
            {Result.builder(feedResult)
              .onInitialOrWaiting(() => (
                <div className="p-8 text-center text-mid text-sm">
                  Loading…
                </div>
              ))
              .onError((error) => (
                <div className="p-8 text-center text-accent text-sm">
                  {"message" in error ? String(error.message) : "Something went wrong."}
                </div>
              ))
              .onDefect(() => (
                <div className="p-8 text-center text-accent text-sm">
                  Something went wrong.
                </div>
              ))
              .onSuccess((feed) => {
                // Curated mode bundles its own links map (covers older posts);
                // chronological mode uses the standard linksAtom.
                const feedLinks = feed.linksMap ?? linksMap;
                return feed.items.length === 0 ? (
                  <div className="p-8 text-center text-mid text-sm">
                    No posts yet.
                  </div>
                ) : (
                  <div>
                    <div className="flex items-center px-4 py-2 gap-2">
                      <span className="font-ui text-[10px] font-semibold tracking-[0.1em] uppercase text-ghost">
                        {feed.mode === "curated" ? "Curated" : "Recent"}
                      </span>
                      <div className="grow h-px bg-border" />
                    </div>
                    {feed.items.map((post) => (
                      <PostCard
                        key={post.uri}
                        post={post}
                        link={feedLinks.get(post.uri) ?? null}
                        publicationIndex={pubIndex}
                        topicLabel={selectedTopicLabel}
                        topicEntries={resolveTopicEntries(post.topics)}
                        editorialCategory={"editorialCategory" in post ? post.editorialCategory : undefined}
                      />
                    ))}
                  </div>
                );
              }
              )
              .render()}
          </div>
        </div>
      </main>
    </div>
  );
}
