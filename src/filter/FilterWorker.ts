import { Effect } from "effect";
import { RawEventBatch } from "../domain/types";
import { PostsRepo } from "../services/PostsRepo";
import { buildSearchText, containsPaperLink } from "../filters/paperFilter";

export const processBatch = (batch: RawEventBatch) =>
  Effect.gen(function* () {
    const posts = yield* PostsRepo;

    const paperPosts = batch.events
      .filter((event) => event.collection === "app.bsky.feed.post" && event.operation !== "delete" && event.record)
      .map((event) => {
        const record = event.record as Record<string, unknown>;
        const searchText = buildSearchText(record as any);
        return { event, searchText };
      })
      .filter((entry) => containsPaperLink(entry.searchText))
      .map((entry) => ({
        uri: entry.event.uri,
        cid: entry.event.cid ?? "",
        authorDid: entry.event.did,
        createdAt: Math.floor(entry.event.timeUs / 1000),
        indexedAt: Date.now(),
        searchText: entry.searchText,
        replyRoot: null,
        replyParent: null,
        status: "active" as const
      }));

    yield* posts.putMany(paperPosts);

    for (const event of batch.events) {
      if (event.operation === "delete") {
        yield* posts.markDeleted(event.uri);
      }
    }
  });
