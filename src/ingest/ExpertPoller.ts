import { Context, Effect, Layer } from "effect";
import type { SqlError } from "@effect/sql/SqlError";
import type { ExpertRecord, DeletedKnowledgePost, KnowledgePostResult } from "../domain/bi";
import { BlueskyApiError } from "../domain/errors";
import type { ExpertSyncStateRecord, PollRequest } from "../domain/polling";
import { RepoRecordsClient } from "../bluesky/RepoRecordsClient";
import { processBatch, type ProcessBatchSummary } from "../filter/FilterWorker";
import type { AtUri, RawEventBatch } from "../domain/types";
import { ExpertSyncStateRepo } from "../services/ExpertSyncStateRepo";
import { ExpertsRepo } from "../services/ExpertsRepo";
import { KnowledgeRepo } from "../services/KnowledgeRepo";
import { OntologyCatalog } from "../services/OntologyCatalog";

const POSTS_COLLECTION = "app.bsky.feed.post";
const HEAD_PAGE_LIMIT = 100;
const HEAD_MAX_PAGES = 2;
const DEFAULT_BACKFILL_MAX_POSTS = 300;
const DEFAULT_BACKFILL_MAX_AGE_DAYS = 90;
const MAX_BACKFILL_POSTS = 1000;
const RECENT_RECONCILE_MAX_POSTS = 200;
const RECENT_RECONCILE_MAX_PAGES = 2;
const DEEP_RECONCILE_MAX_POSTS = 1000;
const DEEP_RECONCILE_MAX_PAGES = 10;
const DEEP_RECONCILE_MAX_AGE_DAYS = 180;

type PollWindowRecord = {
  readonly uri: AtUri;
  readonly cid: string;
  readonly record: unknown;
  readonly createdAt: number;
  readonly timeUs: number;
  readonly rkey: string;
};

type PollWindow = {
  readonly fetchedRecords: ReadonlyArray<PollWindowRecord>;
  readonly processedRecords: ReadonlyArray<PollWindowRecord>;
  readonly pagesFetched: number;
  readonly nextCursor: string | null;
  readonly completed: boolean;
};

export type ExpertPollResult = {
  readonly pagesFetched: number;
  readonly postsSeen: number;
  readonly postsStored: number;
  readonly postsDeleted: number;
};

const defaultSyncState = (did: ExpertRecord["did"]): ExpertSyncStateRecord => ({
  did,
  pdsUrl: null,
  pdsVerifiedAt: null,
  headUri: null,
  headRkey: null,
  headCreatedAt: null,
  lastPolledAt: null,
  lastCompletedAt: null,
  backfillCursor: null,
  backfillStatus: "idle",
  lastError: null
});

const clampBackfillMaxPosts = (value: number | undefined) => {
  if (value === undefined || value <= 0) {
    return DEFAULT_BACKFILL_MAX_POSTS;
  }
  return Math.min(MAX_BACKFILL_POSTS, value);
};

const parseCreatedAt = (record: unknown): number | null => {
  if (typeof record !== "object" || record === null || !("createdAt" in record)) {
    return null;
  }

  const createdAt = record.createdAt;
  if (typeof createdAt !== "string") {
    return null;
  }

  const millis = Date.parse(createdAt);
  return Number.isFinite(millis) ? millis : null;
};

const toRkey = (uri: string) => {
  const parts = uri.split("/");
  return parts[parts.length - 1] ?? uri;
};

const toPollWindowRecord = (uri: AtUri, cid: string, record: unknown): PollWindowRecord | null => {
  const createdAt = parseCreatedAt(record);
  if (createdAt === null) {
    return null;
  }

  return {
    uri,
    cid,
    record,
    createdAt,
    timeUs: createdAt * 1000,
    rkey: toRkey(uri)
  };
};

const toRawBatch = (expert: ExpertRecord, records: ReadonlyArray<PollWindowRecord>) => ({
  events: records.map((record) => ({
    kind: "commit" as const,
    operation: "create" as const,
    collection: POSTS_COLLECTION,
    did: expert.did,
    uri: record.uri,
    cid: record.cid,
    record: record.record,
    timeUs: record.timeUs
  }))
}) satisfies RawEventBatch;

const toReconcileDelete = (
  expert: ExpertRecord,
  post: KnowledgePostResult,
  indexedAt: number,
  suffix: string
): DeletedKnowledgePost => ({
  uri: post.uri,
  did: expert.did,
  cid: null,
  createdAt: post.createdAt,
  indexedAt,
  ingestId: `reconcile:${suffix}:${post.uri}:${indexedAt}`
});

export class ExpertPoller extends Context.Tag("@skygest/ExpertPoller")<
  ExpertPoller,
  {
    readonly poll: (
      expert: ExpertRecord,
      request: PollRequest
    ) => Effect.Effect<ExpertPollResult, BlueskyApiError | SqlError>;
  }
>() {
  static readonly layer = Layer.effect(
    ExpertPoller,
    Effect.gen(function* () {
      const repoRecords = yield* RepoRecordsClient;
      const syncStateRepo = yield* ExpertSyncStateRepo;
      const expertsRepo = yield* ExpertsRepo;
      const knowledgeRepo = yield* KnowledgeRepo;
      const ontology = yield* OntologyCatalog;

      const resolveSyncState = Effect.fn("ExpertPoller.resolveSyncState")(function* (
        did: ExpertRecord["did"]
      ) {
        const stored = yield* syncStateRepo.getByDid(did);
        return stored ?? defaultSyncState(did);
      });

      const persistState = Effect.fn("ExpertPoller.persistState")(function* (
        did: ExpertRecord["did"],
        update: (current: ExpertSyncStateRecord) => ExpertSyncStateRecord
      ) {
        const current = yield* resolveSyncState(did);
        const nextState = update(current);
        yield* syncStateRepo.upsert(nextState);
        return nextState;
      });

      const fetchWindow = Effect.fn("ExpertPoller.fetchWindow")(function* (
        expert: ExpertRecord,
        options: {
          readonly initialCursor?: string | null;
          readonly stopAtUri?: string | null;
          readonly maxPages: number;
          readonly maxPosts?: number;
          readonly maxAgeDays?: number;
        }
      ) {
        let cursor = options.initialCursor ?? null;
        let nextCursor: string | null = cursor;
        let pagesFetched = 0;
        let completed = false;
        const fetchedRecords: Array<PollWindowRecord> = [];
        const processedRecords: Array<PollWindowRecord> = [];
        const minCreatedAt = options.maxAgeDays === undefined
          ? null
          : Date.now() - options.maxAgeDays * 24 * 60 * 60 * 1000;

        while (pagesFetched < options.maxPages) {
          const page = yield* repoRecords.listRecords({
            repo: expert.did,
            collection: POSTS_COLLECTION,
            cursor: cursor ?? undefined,
            limit: HEAD_PAGE_LIMIT,
            reverse: true
          });

          pagesFetched += 1;

          const decoded = page.records
            .map((record) => toPollWindowRecord(record.uri, record.cid, record.value))
            .filter((record): record is PollWindowRecord => record !== null);

          fetchedRecords.push(...decoded);

          let pageRecords = decoded;

          if (options.stopAtUri != null) {
            const stopIndex = pageRecords.findIndex((record) => record.uri === options.stopAtUri);
            if (stopIndex >= 0) {
              pageRecords = pageRecords.slice(0, stopIndex);
              completed = true;
            }
          }

          if (minCreatedAt !== null) {
            const ageStopIndex = pageRecords.findIndex((record) => record.createdAt < minCreatedAt);
            if (ageStopIndex >= 0) {
              pageRecords = pageRecords.slice(0, ageStopIndex);
              completed = true;
            }
          }

          if (options.maxPosts !== undefined) {
            const remaining = Math.max(0, options.maxPosts - processedRecords.length);
            if (pageRecords.length > remaining) {
              pageRecords = pageRecords.slice(0, remaining);
              completed = true;
            }
          }

          processedRecords.push(...pageRecords);
          nextCursor = page.cursor;

          if (
            completed ||
            page.cursor === null ||
            decoded.length === 0 ||
            (options.maxPosts !== undefined && processedRecords.length >= options.maxPosts)
          ) {
            completed = completed || page.cursor === null || decoded.length === 0;
            break;
          }

          cursor = page.cursor;
        }

        return {
          fetchedRecords,
          processedRecords,
          pagesFetched,
          nextCursor,
          completed
        } satisfies PollWindow;
      });

      const processRecords = Effect.fn("ExpertPoller.processRecords")(function* (
        expert: ExpertRecord,
        records: ReadonlyArray<PollWindowRecord>
      ) {
        if (records.length === 0) {
          return {
            postsStored: 0,
            postsDeleted: 0
          } satisfies ProcessBatchSummary;
        }

        return yield* processBatch(toRawBatch(expert, records)).pipe(
          Effect.provideService(KnowledgeRepo, knowledgeRepo),
          Effect.provideService(OntologyCatalog, ontology)
        );
      });

      const reconcileDeletes = Effect.fn("ExpertPoller.reconcileDeletes")(function* (
        expert: ExpertRecord,
        records: ReadonlyArray<PollWindowRecord>,
        suffix: string
      ) {
        if (records.length === 0) {
          return 0;
        }

        const oldestCreatedAt = records.reduce(
          (oldest, record) => Math.min(oldest, record.createdAt),
          records[0]!.createdAt
        );
        const local = yield* knowledgeRepo.getRecentPosts({
          expertDid: expert.did,
          since: oldestCreatedAt,
          limit: records.length
        });
        const remoteUris = new Set(records.map((record) => record.uri));
        const indexedAt = Date.now();
        const deletions = local
          .filter((post) => !remoteUris.has(post.uri))
          .map((post) => toReconcileDelete(expert, post, indexedAt, suffix));

        if (deletions.length === 0) {
          return 0;
        }

        yield* knowledgeRepo.markDeleted(deletions);
        return deletions.length;
      });

      const persistFailure = Effect.fn("ExpertPoller.persistFailure")(function* (
        did: ExpertRecord["did"],
        request: PollRequest,
        error: unknown
      ) {
        yield* persistState(did, (current) => ({
          ...current,
          lastPolledAt: Date.now(),
          backfillStatus: request.mode === "backfill" ? "failed" : current.backfillStatus,
          lastError: error instanceof Error ? error.message : String(error)
        }));
      });

      const poll = Effect.fn("ExpertPoller.poll")(function* (
        expert: ExpertRecord,
        request: PollRequest
      ) {
        const state = yield* resolveSyncState(expert.did);
        return yield* Effect.gen(function* () {
          if (request.mode === "head") {
            const window = yield* fetchWindow(expert, {
              stopAtUri: state.headUri,
              maxPages: HEAD_MAX_PAGES
            });
            const processed = yield* processRecords(expert, window.processedRecords);
            const deleted = yield* reconcileDeletes(expert, window.fetchedRecords, "recent");
            const finishedAt = Date.now();
            const newest = window.processedRecords[0] ?? null;

            yield* persistState(expert.did, (current) => ({
              ...current,
              headUri: newest?.uri ?? current.headUri,
              headRkey: newest?.rkey ?? current.headRkey,
              headCreatedAt: newest?.createdAt ?? current.headCreatedAt,
              lastPolledAt: finishedAt,
              lastCompletedAt: finishedAt,
              backfillCursor: current.backfillCursor ?? window.nextCursor,
              lastError: null
            }));
            yield* expertsRepo.setLastSyncedAt(expert.did, finishedAt);

            return {
              pagesFetched: window.pagesFetched,
              postsSeen: window.fetchedRecords.length,
              postsStored: processed.postsStored,
              postsDeleted: deleted
            } satisfies ExpertPollResult;
          }

          if (request.mode === "backfill") {
            const window = yield* fetchWindow(expert, {
              initialCursor: state.backfillCursor,
              maxPages: Math.ceil(clampBackfillMaxPosts(request.maxPosts) / HEAD_PAGE_LIMIT) + 1,
              maxPosts: clampBackfillMaxPosts(request.maxPosts),
              maxAgeDays: request.maxAgeDays ?? DEFAULT_BACKFILL_MAX_AGE_DAYS
            });
            const processed = yield* processRecords(expert, window.processedRecords);
            const finishedAt = Date.now();
            yield* persistState(expert.did, (current) => ({
              ...current,
              lastPolledAt: finishedAt,
              lastCompletedAt: finishedAt,
              backfillCursor: window.completed ? null : window.nextCursor,
              backfillStatus: window.completed ? "complete" : "idle",
              lastError: null
            }));
            yield* expertsRepo.setLastSyncedAt(expert.did, finishedAt);

            return {
              pagesFetched: window.pagesFetched,
              postsSeen: window.fetchedRecords.length,
              postsStored: processed.postsStored,
              postsDeleted: 0
            } satisfies ExpertPollResult;
          }

          const isDeep = request.depth === "deep";
          const window = yield* fetchWindow(expert, {
            maxPages: isDeep ? DEEP_RECONCILE_MAX_PAGES : RECENT_RECONCILE_MAX_PAGES,
            maxPosts: isDeep ? DEEP_RECONCILE_MAX_POSTS : RECENT_RECONCILE_MAX_POSTS,
            maxAgeDays: isDeep ? DEEP_RECONCILE_MAX_AGE_DAYS : DEFAULT_BACKFILL_MAX_AGE_DAYS
          });
          const processed = yield* processRecords(expert, window.processedRecords);
          const deleted = yield* reconcileDeletes(
            expert,
            window.fetchedRecords,
            isDeep ? "deep" : "recent"
          );
          const finishedAt = Date.now();
          yield* persistState(expert.did, (current) => ({
            ...current,
            lastPolledAt: finishedAt,
            lastCompletedAt: finishedAt,
            lastError: null
          }));

          return {
            pagesFetched: window.pagesFetched,
            postsSeen: window.fetchedRecords.length,
            postsStored: processed.postsStored,
            postsDeleted: deleted
          } satisfies ExpertPollResult;
        }).pipe(
          Effect.catchAll((error) =>
            persistFailure(expert.did, request, error).pipe(
              Effect.zipRight(
                Effect.failSync(() => error as BlueskyApiError | SqlError)
              )
            )
          )
        );
      });

      return ExpertPoller.of({
        poll
      });
    })
  );
}
