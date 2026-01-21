import { it, expect } from "bun:test";
import { Effect, Layer, RequestResolver } from "effect";
import { PostsRepo, type PaperPost } from "./PostsRepo";
import { ListRecentByAuthor, PostsReadResolver } from "./PostsReadResolver";

it("batches listRecentByAuthor requests by limit", async () => {
  let calls = 0;

  const PostsTest = Layer.succeed(PostsRepo, {
    putMany: () => Effect.void,
    listRecent: () => Effect.succeed([]),
    listRecentByAuthor: () => Effect.succeed([]),
    listRecentByAuthors: (authorDids: ReadonlyArray<string>, limit: number) =>
      Effect.sync(() => {
        calls += 1;
        return authorDids.map((authorDid): PaperPost => ({
          uri: `at://${authorDid}/app.bsky.feed.post/${limit}`,
          cid: "cid",
          authorDid,
          createdAt: limit,
          createdAtDay: "1970-01-01",
          indexedAt: limit,
          searchText: "arxiv",
          replyRoot: null,
          replyParent: null,
          status: "active"
        }));
      }),
    markDeleted: () => Effect.void,
    markDeletedMany: () => Effect.void
  });

  const requests = [
    new ListRecentByAuthor({ authorDid: "did:plc:1", limit: 2 }),
    new ListRecentByAuthor({ authorDid: "did:plc:2", limit: 2 }),
    new ListRecentByAuthor({ authorDid: "did:plc:3", limit: 1 })
  ];

  const resolver = RequestResolver.contextFromServices(PostsRepo)(PostsReadResolver);

  const results = await Effect.runPromise(
    Effect.forEach(
      requests,
      (req) => Effect.request(req, resolver),
      { concurrency: "unbounded", batching: "inherit" }
    ).pipe(
      Effect.withRequestBatching(true),
      Effect.withRequestCaching(false),
      Effect.provide(PostsTest)
    )
  );

  expect(calls).toBe(2);
  expect(results.length).toBe(3);
  expect(results[0]?.[0]?.authorDid).toBe("did:plc:1");
  expect(results[1]?.[0]?.authorDid).toBe("did:plc:2");
  expect(results[2]?.[0]?.authorDid).toBe("did:plc:3");
});
