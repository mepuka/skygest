import { Effect, Layer } from "effect";
import { describe, expect, it } from "@effect/vitest";
import ontologySnapshotJson from "../config/ontology/energy-snapshot.json";
import type {
  DeletedKnowledgePost,
  ExpertRecord,
  KnowledgePost,
  KnowledgePostResult,
  MatchedTopic
} from "../src/domain/bi";
import type { ExpertSyncStateRecord, ListRecordsResult, PollRequest } from "../src/domain/polling";
import type { AtUri, Did } from "../src/domain/types";
import { RepoRecordsClient } from "../src/bluesky/RepoRecordsClient";
import { ExpertPollExecutor } from "../src/ingest/ExpertPollExecutor";
import { ExpertSyncStateRepo } from "../src/services/ExpertSyncStateRepo";
import { ExpertsRepo } from "../src/services/ExpertsRepo";
import { KnowledgeRepo } from "../src/services/KnowledgeRepo";
import { OntologyCatalog } from "../src/services/OntologyCatalog";

const asDid = (value: string) => value as Did;
const asUri = (value: string) => value as AtUri;

const makeExpert = (did: Did): ExpertRecord => ({
  did,
  handle: "expert.test",
  displayName: "Expert",
  description: null,
  avatar: null,
  domain: "energy",
  source: "manual",
  sourceRef: null,
  shard: 0,
  active: true,
  addedAt: 1,
  lastSyncedAt: null
});

const makeRecordPage = (
  did: Did,
  keys: ReadonlyArray<string>,
  cursor: string | null,
  createdAtStartMs: number
): ListRecordsResult => ({
  records: keys.map((key, index) => ({
    uri: asUri(`at://${did}/app.bsky.feed.post/${key}`),
    cid: `cid-${key}`,
    value: {
      text: `solar update ${key}`,
      createdAt: new Date(createdAtStartMs - index * 1_000).toISOString()
    }
  })),
  cursor
});

const defaultSyncState = (did: Did): ExpertSyncStateRecord => ({
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

const matchedTopics: ReadonlyArray<MatchedTopic> = [
  {
    topicSlug: "solar" as MatchedTopic["topicSlug"],
    matchedTerm: "solar",
    matchSignal: "term",
    matchValue: "solar",
    matchScore: 2,
    ontologyVersion: "0.3.0",
    matcherVersion: "test-snapshot"
  }
];

const makeHarness = (options: {
  readonly pages: Readonly<Record<string, ListRecordsResult>>;
  readonly syncState?: ExpertSyncStateRecord | null;
  readonly recentPosts?: ReadonlyArray<KnowledgePostResult>;
}) => {
  const did = asDid("did:plc:expert-1");
  const expert = makeExpert(did);
  let syncState = options.syncState ?? null;
  let lastSyncedAt: number | null = null;
  const upserts: Array<KnowledgePost> = [];
  const deletions: Array<DeletedKnowledgePost> = [];

  const layer = Layer.mergeAll(
    Layer.succeed(RepoRecordsClient, {
      listRecords: ({ cursor }) =>
        Effect.succeed(options.pages[cursor ?? "__start__"] ?? { records: [], cursor: null }),
      invalidateRepo: () => Effect.void
    }),
    Layer.succeed(ExpertSyncStateRepo, {
      getByDid: () => Effect.succeed(syncState),
      upsert: (state) =>
        Effect.sync(() => {
          syncState = state;
        })
    }),
    Layer.succeed(ExpertsRepo, {
      upsert: () => Effect.void,
      upsertMany: () => Effect.void,
      getByDid: () => Effect.succeed(expert),
      setActive: () => Effect.void,
      setLastSyncedAt: (_did, value) =>
        Effect.sync(() => {
          lastSyncedAt = value;
        }),
      listActive: () => Effect.succeed([expert]),
      listActiveByShard: () => Effect.succeed([]),
      list: () => Effect.succeed([])
    }),
    Layer.succeed(KnowledgeRepo, {
      upsertPosts: (posts) =>
        Effect.sync(() => {
          upserts.push(...posts);
        }),
      markDeleted: (posts) =>
        Effect.sync(() => {
          deletions.push(...posts);
        }),
      searchPosts: () => Effect.succeed([]),
      getRecentPosts: ({ expertDid, since, limit }) =>
        Effect.succeed(
          (options.recentPosts ?? [])
            .filter((post) =>
              (expertDid === undefined || post.did === expertDid) &&
              (since === undefined || post.createdAt >= since)
            )
            .slice(0, limit ?? Number.POSITIVE_INFINITY)
        ),
      getRecentPostsPage: ({ expertDid, since, limit }) =>
        Effect.succeed(
          (options.recentPosts ?? [])
            .filter((post) =>
              (expertDid === undefined || post.did === expertDid) &&
              (since === undefined || post.createdAt >= since)
            )
            .slice(0, limit ?? Number.POSITIVE_INFINITY)
        ),
      getPostLinks: () => Effect.succeed([]),
      getPostLinksPage: () => Effect.succeed([]),
      getPostTopicMatches: () => Effect.succeed([]),
      searchPostsPage: () => Effect.succeed([]),
      optimizeFts: () => Effect.void
    }),
    Layer.succeed(OntologyCatalog, {
      snapshot: ontologySnapshotJson as any,
      topics: ontologySnapshotJson.canonicalTopics as any,
      concepts: ontologySnapshotJson.concepts as any,
      match: () => Effect.succeed(matchedTopics),
      listTopics: () => Effect.succeed([]),
      getTopic: () => Effect.succeed(null),
      expandTopics: () =>
        Effect.succeed({
          mode: "exact",
          inputSlugs: [],
          resolvedSlugs: [],
          canonicalTopicSlugs: [],
          items: []
        })
    })
  );

  const executorLayer = ExpertPollExecutor.layer.pipe(Layer.provideMerge(layer));

  const runDid = (request: PollRequest, options?: Parameters<typeof ExpertPollExecutor.Service.runDid>[2]) =>
    Effect.runPromise(
      Effect.scoped(
        Effect.flatMap(ExpertPollExecutor, (executor) => executor.runDid(did, request, options)).pipe(
          Effect.provide(executorLayer)
        )
      )
    );

  return {
    did,
    runDid,
    getSyncState: () => syncState ?? defaultSyncState(did),
    getLastSyncedAt: () => lastSyncedAt,
    upserts,
    deletions
  };
};

describe("ExpertPollExecutor", () => {
  it.live("completes head polls in one pass and updates the head cursor", () =>
    Effect.promise(async () => {
      const did = asDid("did:plc:expert-1");
      const harness = makeHarness({
        pages: {
          __start__: makeRecordPage(did, ["head-2", "head-1"], null, Date.UTC(2026, 2, 8, 12, 0, 0))
        }
      });

      const result = await harness.runDid(
        { mode: "head" },
        { maxPages: 2 }
      );

      expect(result.completed).toBe(true);
      expect(result.processedRecords).toBe(2);
      expect(harness.getSyncState().headUri).toBe(asUri(`at://${did}/app.bsky.feed.post/head-2`));
      expect(harness.getLastSyncedAt()).not.toBeNull();
      expect(harness.upserts).toHaveLength(2);
    })
  );

  it.live("processes only newer records when the stored head appears mid-page", () =>
    Effect.promise(async () => {
      const did = asDid("did:plc:expert-1");
      const storedHeadUri = asUri(`at://${did}/app.bsky.feed.post/head-3`);
      const harness = makeHarness({
        pages: {
          __start__: makeRecordPage(
            did,
            ["head-5", "head-4", "head-3", "head-2"],
            "cursor-2",
            Date.UTC(2026, 2, 8, 12, 0, 0)
          )
        },
        syncState: {
          ...defaultSyncState(did),
          headUri: storedHeadUri,
          headRkey: "head-3",
          headCreatedAt: Date.UTC(2026, 2, 8, 11, 59, 58)
        }
      });

      const result = await harness.runDid(
        { mode: "head" },
        { maxPages: 2 }
      );

      expect(result.completed).toBe(true);
      expect(result.processedRecords).toBe(2);
      expect(harness.upserts.map((post) => post.uri)).toEqual([
        asUri(`at://${did}/app.bsky.feed.post/head-5`),
        asUri(`at://${did}/app.bsky.feed.post/head-4`)
      ]);
      expect(harness.getSyncState().headUri).toBe(asUri(`at://${did}/app.bsky.feed.post/head-5`));
      expect(harness.getSyncState().backfillCursor).toBeNull();
    })
  );

  it.live("keeps backfill state running when a bounded chunk needs continuation", () =>
    Effect.promise(async () => {
      const did = asDid("did:plc:expert-1");
      const harness = makeHarness({
        pages: {
          __start__: makeRecordPage(did, ["backfill-4", "backfill-3"], "cursor-2", Date.UTC(2026, 2, 8, 11, 0, 0)),
          "cursor-2": makeRecordPage(did, ["backfill-2", "backfill-1"], "cursor-3", Date.UTC(2026, 2, 8, 10, 0, 0))
        }
      });

      const result = await harness.runDid(
        {
          mode: "backfill",
          maxPosts: 500,
          maxAgeDays: 90
        },
        {
          maxPages: 2,
          maxPosts: 200,
          maxAgeDays: 90
        }
      );

      expect(result.completed).toBe(false);
      expect(result.nextCursor).toBe("cursor-3");
      expect(result.processedRecords).toBe(4);
      expect(harness.getSyncState().backfillCursor).toBe("cursor-3");
      expect(harness.getSyncState().backfillStatus).toBe("running");
    })
  );

  it.live("returns deep reconcile continuation state and records deletes for missing local posts", () =>
    Effect.promise(async () => {
      const did = asDid("did:plc:expert-1");
      const missingUri = asUri(`at://${did}/app.bsky.feed.post/missing-local`);
      const harness = makeHarness({
        pages: {
          "cursor-1": makeRecordPage(did, ["remote-4", "remote-3"], "cursor-2", Date.UTC(2026, 2, 8, 9, 0, 0)),
          "cursor-2": makeRecordPage(did, ["remote-2", "remote-1"], "cursor-3", Date.UTC(2026, 2, 8, 8, 0, 0))
        },
        recentPosts: [
          {
            uri: missingUri,
            did,
            handle: null,
            avatar: null,
            text: "solar stale",
            createdAt: Date.UTC(2026, 2, 8, 8, 30, 0),
            topics: ["solar"]
          }
        ]
      });

      const result = await harness.runDid(
        {
          mode: "reconcile",
          depth: "deep"
        },
        {
          initialCursor: "cursor-1",
          maxPages: 2,
          maxPosts: 200,
          maxAgeDays: 180
        }
      );

      expect(result.completed).toBe(false);
      expect(result.nextCursor).toBe("cursor-3");
      expect(result.postsDeleted).toBe(1);
      expect(harness.deletions).toHaveLength(1);
      expect(harness.deletions[0]?.uri).toBe(missingUri);
    })
  );
});
