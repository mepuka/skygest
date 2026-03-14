import { Context, Effect, Layer } from "effect";
import type { SqlError } from "@effect/sql/SqlError";
import type { DbError } from "../domain/errors";
import type {
  DeletedKnowledgePost,
  ExpertRecord,
  KnowledgePostResult
} from "../domain/bi";
import { ExpertNotFoundError } from "../domain/bi";
import { BlueskyApiError, toIngestErrorEnvelope } from "../domain/errors";
import type {
  ExpertSyncStateRecord,
  ListRecordsResult,
  PollRequest,
  RepoPostRecordValue
} from "../domain/polling";
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

export const WORKFLOW_HEAD_MAX_PAGES = HEAD_MAX_PAGES;
export const WORKFLOW_CHUNK_MAX_PAGES = 2;
export const WORKFLOW_CHUNK_MAX_POSTS = 200;

type PollWindowRecord = {
  readonly uri: AtUri;
  readonly cid: string;
  readonly record: RepoPostRecordValue;
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

type PollWindowState = PollWindow & {
  readonly cursor: string | null;
};

export type ExpertPollExecutionResult = {
  readonly pagesFetched: number;
  readonly postsSeen: number;
  readonly postsStored: number;
  readonly postsDeleted: number;
  readonly postsDropped: number;
  readonly processedRecords: number;
  readonly completed: boolean;
  readonly nextCursor: string | null;
};

export type ExpertPollResult = Omit<
  ExpertPollExecutionResult,
  "completed" | "nextCursor" | "processedRecords"
>;

export type ExpertPollChunkOptions = {
  readonly initialCursor?: string | null;
  readonly maxPages?: number;
  readonly maxPosts?: number;
  readonly maxAgeDays?: number;
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

const parseCreatedAt = (createdAt: string): number | null => {
  const millis = Date.parse(createdAt);
  return Number.isFinite(millis) ? millis : null;
};

const toRkey = (uri: string) => {
  const parts = uri.split("/");
  return parts[parts.length - 1] ?? uri;
};

const toPollWindowRecord = (
  uri: AtUri,
  cid: string,
  record: RepoPostRecordValue
): PollWindowRecord | null => {
  const createdAt = parseCreatedAt(record.createdAt);
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

const emptyPollWindowState = (initialCursor?: string | null): PollWindowState => ({
  cursor: initialCursor ?? null,
  fetchedRecords: [],
  processedRecords: [],
  pagesFetched: 0,
  nextCursor: initialCursor ?? null,
  completed: false
});

export class ExpertPollExecutor extends Context.Tag("@skygest/ExpertPollExecutor")<
  ExpertPollExecutor,
  {
    readonly runExpert: (
      expert: ExpertRecord,
      request: PollRequest,
      options?: ExpertPollChunkOptions
    ) => Effect.Effect<ExpertPollExecutionResult, BlueskyApiError | SqlError | DbError>;
    readonly runDid: (
      did: ExpertRecord["did"],
      request: PollRequest,
      options?: ExpertPollChunkOptions
    ) => Effect.Effect<
      ExpertPollExecutionResult,
      ExpertNotFoundError | BlueskyApiError | SqlError | DbError
    >;
  }
>() {
  static readonly layer = Layer.effect(
    ExpertPollExecutor,
    Effect.gen(function* () {
      const repoRecords = yield* RepoRecordsClient;
      const syncStateRepo = yield* ExpertSyncStateRepo;
      const expertsRepo = yield* ExpertsRepo;
      const knowledgeRepo = yield* KnowledgeRepo;
      const ontology = yield* OntologyCatalog;

      const resolveSyncState = Effect.fn("ExpertPollExecutor.resolveSyncState")(function* (
        did: ExpertRecord["did"]
      ) {
        const stored = yield* syncStateRepo.getByDid(did);
        return stored ?? defaultSyncState(did);
      });

      const persistState = Effect.fn("ExpertPollExecutor.persistState")(function* (
        did: ExpertRecord["did"],
        update: (current: ExpertSyncStateRecord) => ExpertSyncStateRecord
      ) {
        const current = yield* resolveSyncState(did);
        const nextState = update(current);
        yield* syncStateRepo.upsert(nextState);
        return nextState;
      });

      const fetchWindow = Effect.fn("ExpertPollExecutor.fetchWindow")(function* (
        expert: ExpertRecord,
        options: {
          readonly initialCursor?: string | null;
          readonly stopAtUri?: string | null;
          readonly maxPages: number;
          readonly maxPosts?: number;
          readonly maxAgeDays?: number;
        }
      ) {
        const minCreatedAt = options.maxAgeDays === undefined
          ? null
          : Date.now() - options.maxAgeDays * 24 * 60 * 60 * 1000;
        const applyPage = (
          state: PollWindowState,
          page: ListRecordsResult
        ) => {
          const decoded = page.records
            .map((record) => toPollWindowRecord(record.uri, record.cid, record.value))
            .filter((record): record is PollWindowRecord => record !== null);

          let pageRecords = decoded;
          let completed = state.completed;

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
            const remaining = Math.max(0, options.maxPosts - state.processedRecords.length);
            if (pageRecords.length > remaining) {
              pageRecords = pageRecords.slice(0, remaining);
              completed = true;
            }
          }

          const processedRecords = [
            ...state.processedRecords,
            ...pageRecords
          ];
          const exhausted =
            page.cursor === null ||
            decoded.length === 0 ||
            (options.maxPosts !== undefined && processedRecords.length >= options.maxPosts);

          return {
            cursor: page.cursor,
            fetchedRecords: [
              ...state.fetchedRecords,
              ...decoded
            ],
            processedRecords,
            pagesFetched: state.pagesFetched + 1,
            nextCursor: page.cursor,
            completed: completed || exhausted
          } satisfies PollWindowState;
        };

        const finalState = yield* Effect.iterate(
          emptyPollWindowState(options.initialCursor),
          {
            while: (state) =>
              state.pagesFetched < options.maxPages &&
              !state.completed,
            body: (state) =>
              repoRecords.listRecords({
                repo: expert.did,
                collection: POSTS_COLLECTION,
                cursor: state.cursor ?? undefined,
                limit: HEAD_PAGE_LIMIT
              }).pipe(
                Effect.map((page) => applyPage(state, page))
              )
          }
        );

        return {
          fetchedRecords: finalState.fetchedRecords,
          processedRecords: finalState.processedRecords,
          pagesFetched: finalState.pagesFetched,
          nextCursor: finalState.nextCursor,
          completed: finalState.completed
        } satisfies PollWindow;
      });

      const processRecords = Effect.fn("ExpertPollExecutor.processRecords")(function* (
        expert: ExpertRecord,
        records: ReadonlyArray<PollWindowRecord>
      ) {
        if (records.length === 0) {
          return {
            postsStored: 0,
            postsDeleted: 0,
            postsDropped: 0
          } satisfies ProcessBatchSummary;
        }

        return yield* processBatch(toRawBatch(expert, records)).pipe(
          Effect.provideService(KnowledgeRepo, knowledgeRepo),
          Effect.provideService(OntologyCatalog, ontology)
        );
      });

      const reconcileDeletes = Effect.fn("ExpertPollExecutor.reconcileDeletes")(function* (
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

      const persistFailure = Effect.fn("ExpertPollExecutor.persistFailure")(function* (
        did: ExpertRecord["did"],
        request: PollRequest,
        error: unknown
      ) {
        const operation = request.mode === "reconcile"
          ? `ExpertPollExecutor.${request.mode}:${request.depth}`
          : `ExpertPollExecutor.${request.mode}`;
        yield* persistState(did, (current) => ({
          ...current,
          lastPolledAt: Date.now(),
          backfillStatus: request.mode === "backfill" ? "failed" : current.backfillStatus,
          lastError: toIngestErrorEnvelope(error, {
            did,
            operation
          })
        }));
      });

      const runExpert = Effect.fn("ExpertPollExecutor.runExpert")(function* (
        expert: ExpertRecord,
        request: PollRequest,
        options?: ExpertPollChunkOptions
      ) {
        const state = yield* resolveSyncState(expert.did);

        return yield* Effect.gen(function* () {
          if (request.mode === "head") {
            const window = yield* fetchWindow(expert, {
              stopAtUri: state.headUri,
              maxPages: options?.maxPages ?? HEAD_MAX_PAGES
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
              // Only seed backfill from a head sweep when we consumed whole pages.
              // If the stored head stopped us mid-page, a page-level cursor would
              // skip the older tail of that page on a later backfill.
              backfillCursor: current.backfillCursor ??
                (current.headUri === null ? window.nextCursor : null),
              lastError: null
            }));
            yield* expertsRepo.setLastSyncedAt(expert.did, finishedAt);

            return {
              pagesFetched: window.pagesFetched,
              postsSeen: window.fetchedRecords.length,
              postsStored: processed.postsStored,
              postsDeleted: deleted,
              postsDropped: processed.postsDropped,
              processedRecords: window.processedRecords.length,
              completed: true,
              nextCursor: null
            } satisfies ExpertPollExecutionResult;
          }

          if (request.mode === "backfill") {
            yield* persistState(expert.did, (current) => ({
              ...current,
              backfillStatus: "running",
              lastError: null
            }));

            const maxPosts = options?.maxPosts ?? clampBackfillMaxPosts(request.maxPosts);
            const window = yield* fetchWindow(expert, {
              initialCursor: options?.initialCursor ?? state.backfillCursor,
              maxPages: options?.maxPages ?? Math.ceil(maxPosts / HEAD_PAGE_LIMIT) + 1,
              maxPosts,
              maxAgeDays: options?.maxAgeDays ?? request.maxAgeDays ?? DEFAULT_BACKFILL_MAX_AGE_DAYS
            });
            const processed = yield* processRecords(expert, window.processedRecords);
            const finishedAt = Date.now();

            yield* persistState(expert.did, (current) => ({
              ...current,
              lastPolledAt: finishedAt,
              lastCompletedAt: finishedAt,
              backfillCursor: window.completed ? null : window.nextCursor,
              backfillStatus: window.completed ? "complete" : "running",
              lastError: null
            }));
            yield* expertsRepo.setLastSyncedAt(expert.did, finishedAt);

            return {
              pagesFetched: window.pagesFetched,
              postsSeen: window.fetchedRecords.length,
              postsStored: processed.postsStored,
              postsDeleted: 0,
              postsDropped: processed.postsDropped,
              processedRecords: window.processedRecords.length,
              completed: window.completed,
              nextCursor: window.completed ? null : window.nextCursor
            } satisfies ExpertPollExecutionResult;
          }

          const isDeep = request.depth === "deep";
          const window = yield* fetchWindow(expert, {
            initialCursor: options?.initialCursor ?? null,
            maxPages: options?.maxPages ?? (isDeep ? DEEP_RECONCILE_MAX_PAGES : RECENT_RECONCILE_MAX_PAGES),
            maxPosts: options?.maxPosts ?? (isDeep ? DEEP_RECONCILE_MAX_POSTS : RECENT_RECONCILE_MAX_POSTS),
            maxAgeDays: options?.maxAgeDays ?? (isDeep ? DEEP_RECONCILE_MAX_AGE_DAYS : DEFAULT_BACKFILL_MAX_AGE_DAYS)
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
            postsDeleted: deleted,
            postsDropped: processed.postsDropped,
            processedRecords: window.processedRecords.length,
            completed: window.completed,
            nextCursor: window.completed ? null : window.nextCursor
          } satisfies ExpertPollExecutionResult;
        }).pipe(
          Effect.catchAll((error) =>
            persistFailure(expert.did, request, error).pipe(
              Effect.zipRight(
                Effect.failSync(() => error as BlueskyApiError | SqlError | DbError)
              )
            )
          )
        );
      });

      const runDid = Effect.fn("ExpertPollExecutor.runDid")(function* (
        did: ExpertRecord["did"],
        request: PollRequest,
        options?: ExpertPollChunkOptions
      ) {
        const expert = yield* expertsRepo.getByDid(did);
        if (expert === null) {
          return yield* ExpertNotFoundError.make({ did });
        }

        return yield* runExpert(expert, request, options);
      });

      return ExpertPollExecutor.of({
        runExpert,
        runDid
      });
    })
  );
}
