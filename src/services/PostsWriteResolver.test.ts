import { it, expect } from "bun:test";
import { Effect, Layer, RequestResolver } from "effect";
import { PostsRepo, type PaperPost } from "./PostsRepo";
import { DeletePost, PutPost, PostsWriteResolver } from "./PostsWriteResolver";

it("batches put and delete requests", async () => {
  let putCalls = 0;
  let deleteCalls = 0;
  let putCount = 0;
  let deleteCount = 0;

  const PostsTest = Layer.succeed(PostsRepo, {
    putMany: (posts: ReadonlyArray<PaperPost>) =>
      Effect.sync(() => {
        putCalls += 1;
        putCount += posts.length;
      }),
    listRecent: () => Effect.succeed([]),
    markDeleted: () => Effect.void,
    markDeletedMany: (uris: ReadonlyArray<string>) =>
      Effect.sync(() => {
        deleteCalls += 1;
        deleteCount += uris.length;
      })
  });

  const requests = [
    new PutPost({
      post: {
        uri: "at://1",
        cid: "c1",
        authorDid: "did:1",
        createdAt: 1,
        indexedAt: 1,
        searchText: null,
        replyRoot: null,
        replyParent: null,
        status: "active"
      }
    }),
    new PutPost({
      post: {
        uri: "at://2",
        cid: "c2",
        authorDid: "did:2",
        createdAt: 2,
        indexedAt: 2,
        searchText: null,
        replyRoot: null,
        replyParent: null,
        status: "active"
      }
    }),
    new DeletePost({ uri: "at://3" })
  ];

  const resolver = RequestResolver.contextFromServices(PostsRepo)(PostsWriteResolver);

  await Effect.runPromise(
    Effect.forEach(
      requests,
      (req) => Effect.request(req, resolver),
      { concurrency: "unbounded", batching: "inherit", discard: true }
    ).pipe(
      Effect.withRequestBatching(true),
      Effect.withRequestCaching(false),
      Effect.provide(PostsTest)
    )
  );

  expect(putCalls).toBe(1);
  expect(putCount).toBe(2);
  expect(deleteCalls).toBe(1);
  expect(deleteCount).toBe(1);
});
