import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
import { SqliteClient } from "@effect/sql-sqlite-bun";
import { PostsRepo } from "../PostsRepo";
import { PostsRepoD1 } from "./PostsRepoD1";
import { runMigrations } from "../../db/migrate";

it("lists recent posts with cursor", async () => {
  const program = Effect.gen(function* () {
    yield* runMigrations;
    const repo = yield* PostsRepo;
    yield* repo.putMany([
      {
        uri: "at://did:plc:1/app.bsky.feed.post/1",
        cid: "cid1",
        authorDid: "did:plc:1",
        createdAt: 200,
        indexedAt: 250,
        searchText: "arxiv",
        replyRoot: null,
        replyParent: null,
        status: "active"
      },
      {
        uri: "at://did:plc:2/app.bsky.feed.post/2",
        cid: "cid2",
        authorDid: "did:plc:2",
        createdAt: 100,
        indexedAt: 150,
        searchText: "arxiv",
        replyRoot: null,
        replyParent: null,
        status: "active"
      }
    ]);
    const first = yield* repo.listRecent(null, 10);
    const older = yield* repo.listRecent(150, 10);
    return { first, older };
  });

  const result = await Effect.runPromise(
    program.pipe(
      Effect.provide(PostsRepoD1.layer),
      Effect.provide(SqliteClient.layer({ filename: ":memory:" }))
    )
  );

  expect(result.first[0]?.createdAt).toBe(200);
  expect(result.older.length).toBe(1);
});
