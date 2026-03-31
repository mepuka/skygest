import { Effect, Either } from "effect";
import {
  collectMetadataTexts,
  decodeSlimPostRecordEither,
  formatSlimPostRecordDecodeError,
  extractLinkRecords
} from "../bluesky/PostRecord";
import { extractEmbedKind } from "../bluesky/EmbedExtract";
import type { RawEventBatch } from "../domain/types";
import type { DeletedKnowledgePost, KnowledgePost } from "../domain/bi";
import { KnowledgeRepo } from "../services/KnowledgeRepo";
import { CurationService } from "../services/CurationService";
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
  const ontology = yield* OntologyCatalog;

  const actions = yield* Effect.reduce(
    batch.events,
    emptyBatchActions(),
    (state, event) => {
      if (event.collection !== "app.bsky.feed.post") {
        return Effect.succeed(state);
      }

      const indexedAt = Date.now();
      const createdAt = Math.floor(event.timeUs / 1000);
      const ingestId = makeIngestId(event.uri, event.operation, event.cid ?? null, event.timeUs);

      if (event.operation === "delete") {
        return Effect.succeed({
          ...state,
          deletions: [
            ...state.deletions,
            {
              uri: event.uri,
              did: event.did,
              cid: event.cid ?? null,
              createdAt,
              indexedAt,
              ingestId
            }
          ]
        });
      }

      const record = decodeSlimPostRecordEither(event.record);
      if (Either.isLeft(record)) {
        return Effect.logWarning("skipping undecodable bluesky post record").pipe(
          Effect.annotateLogs({
            uri: event.uri,
            did: event.did,
            operation: event.operation,
            decodeError: formatSlimPostRecordDecodeError(record.left)
          }),
          Effect.as({
            ...state
          })
        );
      }

      const decoded = record.right;
      const embedType = extractEmbedKind(decoded.embed ?? null);
      const text = decoded.text?.trim() ?? "";
      const links = extractLinkRecords(decoded, event.did, indexedAt);
      const domains = links
        .map((link) => link.domain)
        .filter((domain): domain is string => domain !== null && domain.length > 0);

      return ontology.match({
        text,
        metadataTexts: collectMetadataTexts(decoded),
        hashtags: decoded.tags ?? [],
        domains
      }).pipe(
        Effect.map((topics) =>
          topics.length === 0
            ? { ...state, dropped: state.dropped + 1 }
            : {
                ...state,
                upserts: [
                  ...state.upserts,
                  {
                    uri: event.uri,
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
              }
        )
      );
    }
  );

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
    Effect.catchAll(() => Effect.succeed(0))
  );

  return {
    postsStored: actions.upserts.length,
    postsDeleted: actions.deletions.length,
    postsDropped: actions.dropped
  } satisfies ProcessBatchSummary;
});
