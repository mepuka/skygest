import { Array, Effect, Match, Option, RequestResolver } from "effect";
import { RawEvent, RawEventBatch } from "../domain/types";
import { buildSearchText, containsPaperLink } from "../filters/paperFilter";
import { PostsRepo } from "../services/PostsRepo";
import { DeletePost, PutPost, PostsWriteResolver } from "../services/PostsWriteResolver";

const resolver = RequestResolver.contextFromServices(PostsRepo)(PostsWriteResolver);
const toDay = (unixSeconds: number) =>
  new Date(unixSeconds * 1000).toISOString().slice(0, 10);

export const processBatch = (batch: RawEventBatch) =>
  Effect.forEach(
    Array.filterMap(batch.events, toRequest),
    (req) => Effect.request(req, resolver),
    { concurrency: "unbounded", batching: "inherit", discard: true }
  ).pipe(
    Effect.withRequestBatching(true),
    Effect.withRequestCaching(false)
  );

const toRequest = (event: RawEvent) =>
  Match.value(event).pipe(
    Match.when({ collection: "app.bsky.feed.post", operation: "delete" }, (e) =>
      Option.some(new DeletePost({ uri: e.uri }))
    ),
    Match.when({ collection: "app.bsky.feed.post" }, (e) =>
      Option.fromNullable(e.record).pipe(
        Option.map((record) => ({ record, event: e })),
        Option.map(({ record, event }) => ({
          event,
          searchText: buildSearchText(record as any)
        })),
        Option.filter((entry) => containsPaperLink(entry.searchText)),
        Option.map((entry) => {
          const createdAt = Math.floor(entry.event.timeUs / 1000);
          return new PutPost({
            post: {
              uri: entry.event.uri,
              cid: entry.event.cid ?? "",
              authorDid: entry.event.did,
              createdAt,
              createdAtDay: toDay(createdAt),
              indexedAt: Date.now(),
              searchText: entry.searchText,
              replyRoot: null,
              replyParent: null,
              status: "active" as const
            }
          });
        })
      )
    ),
    Match.orElse(() => Option.none())
  );
