import { Effect, Result } from "effect";
import {
  collectMetadataTexts,
  decodeSlimPostRecordEither,
  formatSlimPostRecordDecodeError,
  extractLinkRecords
} from "../bluesky/PostRecord";
import { extractEmbedKind } from "../bluesky/EmbedExtract";
import { atUriToPostUri, type RawEventBatch } from "../domain/types";
import type { DeletedKnowledgePost, KnowledgePost } from "../domain/bi";
import { KnowledgeRepo } from "../services/KnowledgeRepo";
import { CurationService } from "../services/CurationService";
import { matchTopics } from "./TopicMatcher";

const makeIngestId = (
  uri: string,
  operation: "create" | "update" | "delete",
  cid: string | null,
  timeUs: number
) => `${uri}:${operation}:${cid ?? "none"}:${timeUs}`;

export type ProcessBatchSummary = {
  readonly postsStored: number;
  readonly postsDeleted: number;
  readonly postsDropped: number;
};

type BatchActions = {
  readonly upserts: ReadonlyArray<KnowledgePost>;
  readonly deletions: ReadonlyArray<DeletedKnowledgePost>;
  readonly dropped: number;
};

const emptyBatchActions = (): BatchActions => ({
  upserts: [],
  deletions: [],
  dropped: 0
});

export const processBatch = Effect.fn("FilterWorker.processBatch")(function* (batch: RawEventBatch) {
  const knowledgeRepo = yield* KnowledgeRepo;

  let actions = emptyBatchActions();
  for (const event of batch.events) {
    if (event.collection !== "app.bsky.feed.post") {
      continue;
    }

    const indexedAt = Date.now();
    const createdAt = Math.floor(event.timeUs / 1000);
    const ingestId = makeIngestId(event.uri, event.operation, event.cid ?? null, event.timeUs);

    if (event.operation === "delete") {
      actions = {
        ...actions,
        deletions: [
          ...actions.deletions,
          {
            uri: atUriToPostUri(event.uri),
            did: event.did,
            cid: event.cid ?? null,
            createdAt,
            indexedAt,
            ingestId
          }
        ]
      };
      continue;
    }

    const record = decodeSlimPostRecordEither(event.record);
    if (Result.isFailure(record)) {
      yield* Effect.logWarning("skipping undecodable bluesky post record").pipe(
        Effect.annotateLogs({
          uri: event.uri,
          did: event.did,
          operation: event.operation,
          decodeError: formatSlimPostRecordDecodeError(record.failure)
        })
      );
      continue;
    }

    const decoded = record.success;
    const embedType = extractEmbedKind(decoded.embed ?? null);
    const text = decoded.text?.trim() ?? "";
    const links = extractLinkRecords(decoded, event.did, indexedAt);

    const topics = yield* matchTopics({
      text,
      metadataTexts: collectMetadataTexts(decoded),
      hashtags: decoded.tags ?? [],
      links
    });

    if (topics.length === 0) {
      actions = { ...actions, dropped: actions.dropped + 1 };
    } else {
      actions = {
        ...actions,
        upserts: [
          ...actions.upserts,
          {
            uri: atUriToPostUri(event.uri),
            did: event.did,
            cid: event.cid ?? null,
            text,
            createdAt,
            indexedAt,
            hasLinks: links.length > 0,
            status: "active",
            ingestId,
            embedType,
            topics,
            links
          }
        ]
      };
    }
  }

  yield* knowledgeRepo.upsertPosts(actions.upserts);
  yield* knowledgeRepo.markDeleted(actions.deletions);

  // Curation: flag high-signal posts (error-tolerant — never fails ingest)
  const curationService = yield* CurationService;
  yield* curationService.flagBatch(actions.upserts).pipe(
    Effect.tapError((e) =>
      Effect.logWarning("curation flagging failed, continuing").pipe(
        Effect.annotateLogs({ error: String(e) })
      )
    ),
    Effect.catch(() => Effect.succeed(0))
  );

  return {
    postsStored: actions.upserts.length,
    postsDeleted: actions.deletions.length,
    postsDropped: actions.dropped
  } satisfies ProcessBatchSummary;
});
