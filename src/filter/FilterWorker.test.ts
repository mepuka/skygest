import { it, expect } from "bun:test";
import { Effect, Layer } from "effect";
import { processBatch } from "./FilterWorker";
import { PostsRepo } from "../services/PostsRepo";
import { RawEventBatch } from "../domain/types";

it("filters paper posts", async () => {
  let inserted = 0;
  let deleted = 0;
  const PostsTest = Layer.succeed(PostsRepo, {
    putMany: () => Effect.sync(() => void (inserted += 1)),
    listRecent: () => Effect.succeed([]),
    markDeleted: () => Effect.void,
    markDeletedMany: () => Effect.sync(() => void (deleted += 1))
  });

  const batch: RawEventBatch = {
    cursor: 1,
    events: [
      {
        kind: "commit",
        operation: "create",
        collection: "app.bsky.feed.post",
        did: "did:plc:1",
        uri: "at://did:plc:1/app.bsky.feed.post/1",
        cid: "cid",
        record: { text: "https://arxiv.org/abs/2401.00001" },
        timeUs: 1
      },
      {
        kind: "commit",
        operation: "delete",
        collection: "app.bsky.feed.post",
        did: "did:plc:1",
        uri: "at://did:plc:1/app.bsky.feed.post/1",
        cid: "cid",
        record: undefined,
        timeUs: 2
      }
    ]
  };

  await Effect.runPromise(processBatch(batch).pipe(Effect.provide(PostsTest)));

  expect(inserted).toBe(1);
  expect(deleted).toBe(1);
});
