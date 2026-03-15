import { useAtomValue } from "@effect-atom/atom-react";
import { Result } from "@effect-atom/atom";
import { postsAtom } from "../lib/atoms.ts";
import { PostCard } from "./PostCard.tsx";

export function Shell() {
  const postsResult = useAtomValue(postsAtom);

  return (
    <div className="min-h-screen bg-recessed font-ui">
      <header className="bg-surface border-b border-border">
        <div className="mx-auto max-w-[640px] px-4 py-4">
          <h1 className="font-brand text-[28px] text-heading tracking-[-0.01em]">
            Skygest
          </h1>
        </div>
      </header>

      <main className="mx-auto max-w-[640px] px-4 py-6">
        <div className="bg-surface rounded border border-border">
          {Result.builder(postsResult)
            .onInitialOrWaiting(() => (
              <div className="p-8 text-center text-mid text-sm">
                Loading...
              </div>
            ))
            .onError((error) => (
              <div className="p-8 text-center text-accent text-sm">
                {"message" in error ? error.message : "Something went wrong."}
              </div>
            ))
            .onDefect(() => (
              <div className="p-8 text-center text-accent text-sm">
                Something went wrong.
              </div>
            ))
            .onSuccess((posts) =>
              posts.length === 0 ? (
                <div className="p-8 text-center text-mid text-sm">
                  No posts yet.
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {posts.map((post) => (
                    <PostCard key={post.uri} post={post} />
                  ))}
                </div>
              )
            )
            .render()}
        </div>
      </main>
    </div>
  );
}
