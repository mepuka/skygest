import { Effect, Either } from "effect";
import {
  collectMetadataTexts,
  decodeSlimPostRecordEither,
  formatSlimPostRecordDecodeError,
  extractLinkRecords
} from "../bluesky/PostRecord";
import type { RawEventBatch } from "../domain/types";
import type { DeletedKnowledgePost, KnowledgePost } from "../domain/bi";
import { KnowledgeRepo } from "../services/KnowledgeRepo";
import { OntologyCatalog } from "../services/OntologyCatalog";

const makeIngestId = (
  uri: string,
  operation: "create" | "update" | "delete",
  cid: string | null,
  timeUs: number
) => `${uri}:${operation}:${cid ?? "none"}:${timeUs}`;

export type ProcessBatchSummary = {
  readonly postsStored: number;
  readonly postsDeleted: number;
};

export const processBatch = Effect.fn("FilterWorker.processBatch")(function* (batch: RawEventBatch) {
  const knowledgeRepo = yield* KnowledgeRepo;
  const ontology = yield* OntologyCatalog;

  const upserts: Array<KnowledgePost> = [];
  const deletions: Array<DeletedKnowledgePost> = [];

  for (const event of batch.events) {
    if (event.collection !== "app.bsky.feed.post") {
      continue;
    }

    const indexedAt = Date.now();
    const createdAt = Math.floor(event.timeUs / 1000);
    const ingestId = makeIngestId(event.uri, event.operation, event.cid ?? null, event.timeUs);

    if (event.operation === "delete") {
      deletions.push({
        uri: event.uri,
        did: event.did,
        cid: event.cid ?? null,
        createdAt,
        indexedAt,
        ingestId
      });
      continue;
    }

    const record = decodeSlimPostRecordEither(event.record);
    if (Either.isLeft(record)) {
      yield* Effect.logWarning("skipping undecodable bluesky post record").pipe(
        Effect.annotateLogs({
          uri: event.uri,
          did: event.did,
          operation: event.operation,
          decodeError: formatSlimPostRecordDecodeError(record.left)
        }),
        Effect.asVoid
      );
      continue;
    }

    const decoded = record.right;
    const text = decoded.text?.trim() ?? "";
    const links = extractLinkRecords(decoded, indexedAt);
    const topics = yield* ontology.match(text, collectMetadataTexts(decoded));

    if (topics.length === 0) {
      continue;
    }

    upserts.push({
      uri: event.uri,
      did: event.did,
      cid: event.cid ?? null,
      text,
      createdAt,
      indexedAt,
      hasLinks: links.length > 0,
      status: "active",
      ingestId,
      topics,
      links
    });
  }

  yield* knowledgeRepo.upsertPosts(upserts);
  yield* knowledgeRepo.markDeleted(deletions);

  return {
    postsStored: upserts.length,
    postsDeleted: deletions.length
  } satisfies ProcessBatchSummary;
});
