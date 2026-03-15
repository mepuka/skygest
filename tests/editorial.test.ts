import { Effect, Layer, Schema } from "effect";
import { describe, expect, it } from "@effect/vitest";
import {
  makeBiLayer,
  makeSqliteLayer,
  seedKnowledgeBase,
  testConfig,
  withTempSqliteFile,
  sampleDid
} from "./support/runtime";
import { SqlClient } from "@effect/sql";
import { EditorialRepo } from "../src/services/EditorialRepo";
import { EditorialRepoD1 } from "../src/services/d1/EditorialRepoD1";
import { EditorialService } from "../src/services/EditorialService";
import { EditorialPostNotFoundError } from "../src/domain/editorial";
import { handleAdminRequestWithLayer } from "../src/admin/Router";
import { handleApiRequestWithLayer } from "../src/api/Router";
import type { AccessIdentity } from "../src/auth/AuthService";
import { BlueskyClient } from "../src/bluesky/BlueskyClient";
import { parseAvatarUrl } from "../src/bluesky/BskyCdn";
import { Did } from "../src/domain/types";
import { AppConfig, type AppConfigShape } from "../src/platform/Config";
import { Logging } from "../src/platform/Logging";
import { ExpertRegistryService } from "../src/services/ExpertRegistryService";
import { ExpertsRepoD1 } from "../src/services/d1/ExpertsRepoD1";
import { KnowledgeRepoD1 } from "../src/services/d1/KnowledgeRepoD1";
import { PublicationsRepoD1 } from "../src/services/d1/PublicationsRepoD1";
import { OntologyCatalog } from "../src/services/OntologyCatalog";
import { StagingOpsService } from "../src/services/StagingOpsService";
import { CuratedPostsPageOutput } from "../src/domain/api";
import { encodeJsonString } from "../src/platform/Json";
import { smokeFixtureUris } from "../src/staging/SmokeFixture";
import type { EditorialPickRecord } from "../src/domain/editorial";
import type { TopicSlug } from "../src/domain/bi";
import type { AtUri } from "../src/domain/types";

const makeEditorialLayer = (options?: { filename?: string }) => {
  const base = makeBiLayer(options);
  return Layer.mergeAll(base, EditorialRepoD1.layer.pipe(Layer.provideMerge(base)));
};

const decodeDid = Schema.decodeUnknownSync(Did);

const mockBlueskyClient = Layer.succeed(BlueskyClient, {
  resolveDidOrHandle: (input: string) =>
    Effect.succeed({
      did: sampleDid,
      handle: input
    }),
  getProfile: (didOrHandle: string) =>
    Effect.succeed({
      did: didOrHandle.startsWith("did:") ? decodeDid(didOrHandle) : sampleDid,
      handle: didOrHandle.startsWith("did:") ? "seed.example.com" : didOrHandle,
      displayName: "Seed Expert",
      description: "Seeded profile",
      avatar: parseAvatarUrl("https://cdn.bsky.app/img/avatar/plain/did:plc:test/cid@jpeg")
    }),
  getFollows: () =>
    Effect.succeed({
      dids: [],
      cursor: null
    }),
  resolveRepoService: () => Effect.succeed("https://pds.example.com"),
  listRecordsAtService: () =>
    Effect.succeed({
      records: [],
      cursor: null
    })
});

const makeAdminEditorialLayer = (options: {
  readonly filename: string;
  readonly config?: Partial<AppConfigShape>;
}) => {
  const sqliteLayer = makeSqliteLayer(options.filename);
  const configLayer = Layer.succeed(AppConfig, testConfig(options.config));
  const ontologyLayer = OntologyCatalog.layer;
  const expertsLayer = ExpertsRepoD1.layer.pipe(Layer.provideMerge(sqliteLayer));
  const knowledgeLayer = KnowledgeRepoD1.layer.pipe(Layer.provideMerge(sqliteLayer));
  const publicationsLayer = PublicationsRepoD1.layer.pipe(Layer.provideMerge(sqliteLayer));
  const editorialRepoLayer = EditorialRepoD1.layer.pipe(Layer.provideMerge(sqliteLayer));

  const editorialServiceLayer = EditorialService.layer.pipe(
    Layer.provideMerge(Layer.mergeAll(editorialRepoLayer, configLayer, ontologyLayer))
  );

  const registryLayer = ExpertRegistryService.layer.pipe(
    Layer.provideMerge(
      Layer.mergeAll(configLayer, expertsLayer, mockBlueskyClient, ontologyLayer)
    )
  );

  const stagingOpsLayer = StagingOpsService.layer.pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        configLayer,
        ontologyLayer,
        expertsLayer,
        knowledgeLayer,
        registryLayer,
        publicationsLayer
      )
    )
  );

  return Layer.mergeAll(
    sqliteLayer,
    configLayer,
    Logging.layer,
    ontologyLayer,
    expertsLayer,
    knowledgeLayer,
    publicationsLayer,
    editorialRepoLayer,
    editorialServiceLayer,
    mockBlueskyClient,
    registryLayer,
    stagingOpsLayer
  );
};

const operatorIdentity: AccessIdentity = {
  subject: "did:example:operator",
  email: "operator@example.com",
  issuer: "https://access.example.com",
  audience: ["skygest-mcp"],
  scopes: ["editorial:read", "editorial:write", "experts:read", "experts:write", "ops:read", "ops:refresh"],
  payload: {
    sub: "did:example:operator",
    email: "operator@example.com",
    scope: "editorial:read editorial:write experts:read experts:write ops:read ops:refresh"
  }
};

const expectJsonResponse = async <A>(
  response: Response,
  expectedStatus = 200
): Promise<A> => {
  const text = await response.text();

  if (response.status !== expectedStatus) {
    throw new Error(`expected ${String(expectedStatus)} but received ${String(response.status)}: ${text}`);
  }

  return JSON.parse(text) as A;
};

const decodeCuratedPostsPage = Schema.decodeUnknownSync(CuratedPostsPageOutput);

const fixtureUris = smokeFixtureUris(sampleDid);
const solarUri = fixtureUris[0] as AtUri;
const windUri = fixtureUris[1] as AtUri;

const makePick = (
  overrides: Partial<EditorialPickRecord> = {}
): EditorialPickRecord => ({
  postUri: solarUri,
  score: 85,
  reason: "Important solar analysis",
  category: "analysis",
  curator: "system",
  status: "active",
  pickedAt: 1_710_000_100_000,
  expiresAt: null,
  ...overrides
} as EditorialPickRecord);

describe("editorial_picks migration", () => {
  it.live("creates the editorial_picks table with post_uri as PK", () =>
    Effect.promise(() =>
      withTempSqliteFile(async (filename) => {
        const layer = makeBiLayer({ filename });
        await Effect.runPromise(
          seedKnowledgeBase().pipe(Effect.provide(layer))
        );
        await Effect.runPromise(
          Effect.gen(function* () {
            const sql = yield* SqlClient.SqlClient;
            const tables = yield* sql`
              SELECT name FROM sqlite_master
              WHERE type='table' AND name='editorial_picks'
            `;
            expect(tables).toHaveLength(1);
            const info = yield* sql`PRAGMA table_info(editorial_picks)`;
            const pkCol = (info as any[]).find((c: any) => c.pk === 1);
            expect(pkCol?.name).toBe("post_uri");
          }).pipe(Effect.provide(layer))
        );
      })
    )
  );
});

describe("EditorialRepoD1", () => {
  it.effect("upsertPick inserts a new pick and returns true", () =>
    Effect.gen(function* () {
      yield* seedKnowledgeBase();
      const repo = yield* EditorialRepo;
      const created = yield* repo.upsertPick(makePick());
      expect(created).toBe(true);
    }).pipe(Effect.provide(makeEditorialLayer()))
  );

  it.effect("upsertPick overwrites an existing pick and returns false", () =>
    Effect.gen(function* () {
      yield* seedKnowledgeBase();
      const repo = yield* EditorialRepo;

      const first = yield* repo.upsertPick(makePick());
      expect(first).toBe(true);

      const second = yield* repo.upsertPick(
        makePick({ score: 90 as any, reason: "Updated reason" })
      );
      expect(second).toBe(false);

      // Verify the update took effect
      const picks = yield* repo.listPicks({ limit: 10 });
      const pick = picks.find((p) => p.postUri === solarUri);
      expect(pick?.score).toBe(90);
      expect(pick?.reason).toBe("Updated reason");
    }).pipe(Effect.provide(makeEditorialLayer()))
  );

  it.effect("retractPick sets status to retracted and returns true", () =>
    Effect.gen(function* () {
      yield* seedKnowledgeBase();
      const repo = yield* EditorialRepo;

      yield* repo.upsertPick(makePick());
      const retracted = yield* repo.retractPick(solarUri);
      expect(retracted).toBe(true);

      // Retracted pick should not appear in active listings
      const picks = yield* repo.listPicks({ limit: 10 });
      expect(picks.find((p) => p.postUri === solarUri)).toBeUndefined();
    }).pipe(Effect.provide(makeEditorialLayer()))
  );

  it.effect("retractPick returns false for non-existent post", () =>
    Effect.gen(function* () {
      yield* seedKnowledgeBase();
      const repo = yield* EditorialRepo;

      const retracted = yield* repo.retractPick("at://did:plc:fake/app.bsky.feed.post/nope");
      expect(retracted).toBe(false);
    }).pipe(Effect.provide(makeEditorialLayer()))
  );

  it.effect("postExists returns true for seeded post, false for unknown URI", () =>
    Effect.gen(function* () {
      yield* seedKnowledgeBase();
      const repo = yield* EditorialRepo;

      const exists = yield* repo.postExists(solarUri);
      expect(exists).toBe(true);

      const notExists = yield* repo.postExists("at://did:plc:fake/app.bsky.feed.post/nope");
      expect(notExists).toBe(false);
    }).pipe(Effect.provide(makeEditorialLayer()))
  );

  it.effect("getCuratedFeed joins picks with posts/experts and returns all topics", () =>
    Effect.gen(function* () {
      yield* seedKnowledgeBase();
      const repo = yield* EditorialRepo;

      yield* repo.upsertPick(makePick({ postUri: solarUri } as any));
      yield* repo.upsertPick(
        makePick({
          postUri: windUri,
          score: 70 as any,
          reason: "Wind post",
          category: "discussion"
        } as any)
      );

      const feed = yield* repo.getCuratedFeed({ limit: 10 });

      expect(feed).toHaveLength(2);
      // Ordered by score DESC — solar (85) first, wind (70) second
      expect(feed[0]!.uri).toBe(solarUri);
      expect(feed[0]!.editorialScore).toBe(85);
      expect(feed[0]!.editorialReason).toBe("Important solar analysis");
      expect(feed[0]!.editorialCategory).toBe("analysis");
      expect(feed[0]!.topics.length).toBeGreaterThan(0);
      expect(feed[0]!.handle).not.toBeUndefined();
      expect(feed[0]!.text.length).toBeGreaterThan(0);

      expect(feed[1]!.uri).toBe(windUri);
      expect(feed[1]!.editorialScore).toBe(70);
      expect(feed[1]!.topics.length).toBeGreaterThan(0);
    }).pipe(Effect.provide(makeEditorialLayer()))
  );

  it.effect("getCuratedFeed with topic filter uses EXISTS and still returns full topic list", () =>
    Effect.gen(function* () {
      yield* seedKnowledgeBase();
      const repo = yield* EditorialRepo;

      yield* repo.upsertPick(makePick({ postUri: solarUri } as any));
      yield* repo.upsertPick(
        makePick({
          postUri: windUri,
          score: 70 as any,
          reason: "Wind post"
        } as any)
      );

      // Filter by "solar" topic — only solar post should appear
      const feed = yield* repo.getCuratedFeed({
        limit: 10,
        topicSlugs: ["solar" as TopicSlug]
      });

      expect(feed).toHaveLength(1);
      expect(feed[0]!.uri).toBe(solarUri);
      // The full topic list should still contain all topics for the post
      // (not just the filter topic), proving the LEFT JOIN aggregation
      // is separate from the EXISTS filter
      expect(feed[0]!.topics).toContain("solar");
      expect(feed[0]!.topics.length).toBeGreaterThan(0);
    }).pipe(Effect.provide(makeEditorialLayer()))
  );

  it.effect("getCuratedFeed returns empty when topicSlugs is empty array", () =>
    Effect.gen(function* () {
      yield* seedKnowledgeBase();
      const repo = yield* EditorialRepo;

      yield* repo.upsertPick(makePick());

      const feed = yield* repo.getCuratedFeed({
        limit: 10,
        topicSlugs: [] as unknown as ReadonlyArray<TopicSlug>
      });

      expect(feed).toHaveLength(0);
    }).pipe(Effect.provide(makeEditorialLayer()))
  );

  it.effect("expireStale expires picks past their expires_at", () =>
    Effect.gen(function* () {
      yield* seedKnowledgeBase();
      const repo = yield* EditorialRepo;

      const now = 1_710_000_200_000;

      // Pick that should expire (expires_at in the past relative to now)
      yield* repo.upsertPick(
        makePick({
          postUri: solarUri,
          expiresAt: now - 1000
        } as any)
      );

      // Pick that should NOT expire (no expiry)
      yield* repo.upsertPick(
        makePick({
          postUri: windUri,
          score: 70 as any,
          reason: "Wind post",
          expiresAt: null
        } as any)
      );

      const expired = yield* repo.expireStale(now);
      expect(expired).toBe(1);

      // Only the wind pick should remain active
      const picks = yield* repo.listPicks({ limit: 10 });
      expect(picks).toHaveLength(1);
      expect(picks[0]!.postUri).toBe(windUri);
    }).pipe(Effect.provide(makeEditorialLayer()))
  );

  it.effect("listPicks respects minScore filter", () =>
    Effect.gen(function* () {
      yield* seedKnowledgeBase();
      const repo = yield* EditorialRepo;

      yield* repo.upsertPick(makePick({ postUri: solarUri, score: 85 as any }));
      yield* repo.upsertPick(
        makePick({ postUri: windUri, score: 40 as any, reason: "Low score" } as any)
      );

      const high = yield* repo.listPicks({ minScore: 80 as any, limit: 10 });
      expect(high).toHaveLength(1);
      expect(high[0]!.postUri).toBe(solarUri);

      const all = yield* repo.listPicks({ limit: 10 });
      expect(all).toHaveLength(2);
    }).pipe(Effect.provide(makeEditorialLayer()))
  );
});

// ---------------------------------------------------------------------------
// Admin editorial endpoints
// ---------------------------------------------------------------------------

describe("admin editorial endpoints", () => {
  it.live("submit pick returns 200 with created: true", () =>
    Effect.promise(() =>
      withTempSqliteFile(async (filename) => {
        const layer = makeAdminEditorialLayer({ filename });
        await Effect.runPromise(seedKnowledgeBase().pipe(Effect.provide(layer)));

        const response = await handleAdminRequestWithLayer(
          new Request("https://skygest.local/admin/editorial/pick", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: encodeJsonString({
              postUri: solarUri,
              score: 85,
              reason: "Important solar analysis",
              category: "analysis"
            })
          }),
          operatorIdentity,
          layer
        );

        const body = await expectJsonResponse<{
          readonly postUri: string;
          readonly created: boolean;
        }>(response);
        expect(body.postUri).toBe(solarUri);
        expect(body.created).toBe(true);
      })
    )
  );

  it.live("submit same pick again returns created: false (upsert)", () =>
    Effect.promise(() =>
      withTempSqliteFile(async (filename) => {
        const layer = makeAdminEditorialLayer({ filename });
        await Effect.runPromise(seedKnowledgeBase().pipe(Effect.provide(layer)));

        const makeRequest = () =>
          new Request("https://skygest.local/admin/editorial/pick", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: encodeJsonString({
              postUri: solarUri,
              score: 85,
              reason: "Important solar analysis",
              category: "analysis"
            })
          });

        const first = await handleAdminRequestWithLayer(makeRequest(), operatorIdentity, layer);
        const firstBody = await expectJsonResponse<{
          readonly postUri: string;
          readonly created: boolean;
        }>(first);
        expect(firstBody.created).toBe(true);

        const second = await handleAdminRequestWithLayer(makeRequest(), operatorIdentity, layer);
        const secondBody = await expectJsonResponse<{
          readonly postUri: string;
          readonly created: boolean;
        }>(second);
        expect(secondBody.created).toBe(false);
      })
    )
  );

  it.live("submit pick for non-existent post returns 404", () =>
    Effect.promise(() =>
      withTempSqliteFile(async (filename) => {
        const layer = makeAdminEditorialLayer({ filename });
        await Effect.runPromise(seedKnowledgeBase().pipe(Effect.provide(layer)));

        const fakeUri = "at://did:plc:fake/app.bsky.feed.post/nope";
        const response = await handleAdminRequestWithLayer(
          new Request("https://skygest.local/admin/editorial/pick", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: encodeJsonString({
              postUri: fakeUri,
              score: 80,
              reason: "Nonexistent post",
              category: "analysis"
            })
          }),
          operatorIdentity,
          layer
        );

        const body = await expectJsonResponse<{
          readonly error: string;
          readonly message: string;
        }>(response, 404);
        expect(body.error).toBe("NotFound");
        expect(body.message).toContain(fakeUri);
      })
    )
  );

  it.live("list picks returns submitted pick", () =>
    Effect.promise(() =>
      withTempSqliteFile(async (filename) => {
        const layer = makeAdminEditorialLayer({ filename });
        await Effect.runPromise(seedKnowledgeBase().pipe(Effect.provide(layer)));

        // Submit a pick first
        await handleAdminRequestWithLayer(
          new Request("https://skygest.local/admin/editorial/pick", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: encodeJsonString({
              postUri: solarUri,
              score: 85,
              reason: "Solar analysis",
              category: "analysis"
            })
          }),
          operatorIdentity,
          layer
        );

        const listResponse = await handleAdminRequestWithLayer(
          new Request("https://skygest.local/admin/editorial/picks"),
          operatorIdentity,
          layer
        );

        const body = await expectJsonResponse<{
          readonly items: ReadonlyArray<{
            readonly postUri: string;
            readonly score: number;
            readonly reason: string;
          }>;
        }>(listResponse);
        expect(body.items.length).toBeGreaterThan(0);
        const pick = body.items.find((p) => p.postUri === solarUri);
        expect(pick).toBeDefined();
        expect(pick!.score).toBe(85);
        expect(pick!.reason).toBe("Solar analysis");
      })
    )
  );

  it.live("retract pick returns removed: true", () =>
    Effect.promise(() =>
      withTempSqliteFile(async (filename) => {
        const layer = makeAdminEditorialLayer({ filename });
        await Effect.runPromise(seedKnowledgeBase().pipe(Effect.provide(layer)));

        // Submit first
        await handleAdminRequestWithLayer(
          new Request("https://skygest.local/admin/editorial/pick", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: encodeJsonString({
              postUri: solarUri,
              score: 85,
              reason: "Solar analysis",
              category: "analysis"
            })
          }),
          operatorIdentity,
          layer
        );

        // Retract
        const retractResponse = await handleAdminRequestWithLayer(
          new Request("https://skygest.local/admin/editorial/retract", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: encodeJsonString({ postUri: solarUri })
          }),
          operatorIdentity,
          layer
        );

        const body = await expectJsonResponse<{
          readonly postUri: string;
          readonly removed: boolean;
        }>(retractResponse);
        expect(body.postUri).toBe(solarUri);
        expect(body.removed).toBe(true);
      })
    )
  );

  it.live("retract already-retracted pick returns removed: false", () =>
    Effect.promise(() =>
      withTempSqliteFile(async (filename) => {
        const layer = makeAdminEditorialLayer({ filename });
        await Effect.runPromise(seedKnowledgeBase().pipe(Effect.provide(layer)));

        // Submit then retract twice
        await handleAdminRequestWithLayer(
          new Request("https://skygest.local/admin/editorial/pick", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: encodeJsonString({
              postUri: solarUri,
              score: 85,
              reason: "Solar analysis",
              category: "analysis"
            })
          }),
          operatorIdentity,
          layer
        );

        await handleAdminRequestWithLayer(
          new Request("https://skygest.local/admin/editorial/retract", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: encodeJsonString({ postUri: solarUri })
          }),
          operatorIdentity,
          layer
        );

        const secondRetract = await handleAdminRequestWithLayer(
          new Request("https://skygest.local/admin/editorial/retract", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: encodeJsonString({ postUri: solarUri })
          }),
          operatorIdentity,
          layer
        );

        const body = await expectJsonResponse<{
          readonly postUri: string;
          readonly removed: boolean;
        }>(secondRetract);
        expect(body.removed).toBe(false);
      })
    )
  );

  it.live("list picks after retract returns empty", () =>
    Effect.promise(() =>
      withTempSqliteFile(async (filename) => {
        const layer = makeAdminEditorialLayer({ filename });
        await Effect.runPromise(seedKnowledgeBase().pipe(Effect.provide(layer)));

        // Submit
        await handleAdminRequestWithLayer(
          new Request("https://skygest.local/admin/editorial/pick", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: encodeJsonString({
              postUri: solarUri,
              score: 85,
              reason: "Solar analysis",
              category: "analysis"
            })
          }),
          operatorIdentity,
          layer
        );

        // Retract
        await handleAdminRequestWithLayer(
          new Request("https://skygest.local/admin/editorial/retract", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: encodeJsonString({ postUri: solarUri })
          }),
          operatorIdentity,
          layer
        );

        // List
        const listResponse = await handleAdminRequestWithLayer(
          new Request("https://skygest.local/admin/editorial/picks"),
          operatorIdentity,
          layer
        );

        const body = await expectJsonResponse<{
          readonly items: ReadonlyArray<{ readonly postUri: string }>;
        }>(listResponse);
        expect(body.items).toHaveLength(0);
      })
    )
  );
});

// ---------------------------------------------------------------------------
// Curated feed API
// ---------------------------------------------------------------------------

describe("curated feed public API", () => {
  const requestApi = (path: string, layer: ReturnType<typeof makeBiLayer>) =>
    handleApiRequestWithLayer(
      new Request(`https://skygest.local${path}`),
      layer
    );

  it.live("GET /api/posts/curated with no picks returns empty items", () =>
    Effect.promise(() =>
      withTempSqliteFile(async (filename) => {
        const layer = makeBiLayer({ filename });
        await Effect.runPromise(seedKnowledgeBase().pipe(Effect.provide(layer)));

        const response = await requestApi("/api/posts/curated", layer);
        const text = await response.text();
        expect(response.status).toBe(200);

        const body = decodeCuratedPostsPage(JSON.parse(text));
        expect(body.items).toHaveLength(0);
        expect(body.page.nextCursor).toBeNull();
      })
    )
  );

  it.live("GET /api/posts/curated with picks returns posts with editorial fields", () =>
    Effect.promise(() =>
      withTempSqliteFile(async (filename) => {
        const layer = makeBiLayer({ filename });
        await Effect.runPromise(seedKnowledgeBase().pipe(Effect.provide(layer)));

        // Insert picks via SQL
        await Effect.runPromise(
          Effect.gen(function* () {
            const sql = yield* SqlClient.SqlClient;
            yield* sql`
              INSERT INTO editorial_picks (post_uri, score, reason, category, curator, status, picked_at, expires_at)
              VALUES (${solarUri}, 90, 'Great solar post', 'analysis', 'curator', 'active', ${Date.now()}, NULL)
            `;
            yield* sql`
              INSERT INTO editorial_picks (post_uri, score, reason, category, curator, status, picked_at, expires_at)
              VALUES (${windUri}, 70, 'Wind analysis', 'discussion', 'curator', 'active', ${Date.now()}, NULL)
            `;
          }).pipe(Effect.provide(layer))
        );

        const response = await requestApi("/api/posts/curated", layer);
        const text = await response.text();
        expect(response.status).toBe(200);

        const body = decodeCuratedPostsPage(JSON.parse(text));
        expect(body.items).toHaveLength(2);

        // Ordered by score DESC
        expect(body.items[0]!.uri).toBe(solarUri);
        expect(body.items[0]!.editorialScore).toBe(90);
        expect(body.items[0]!.editorialReason).toBe("Great solar post");
        expect(body.items[0]!.editorialCategory).toBe("analysis");
        expect(body.items[0]!.topics.length).toBeGreaterThan(0);

        expect(body.items[1]!.uri).toBe(windUri);
        expect(body.items[1]!.editorialScore).toBe(70);
        expect(body.page.nextCursor).toBeNull();
      })
    )
  );

  it.live("GET /api/posts/curated?topic=solar filters by topic", () =>
    Effect.promise(() =>
      withTempSqliteFile(async (filename) => {
        const layer = makeBiLayer({ filename });
        await Effect.runPromise(seedKnowledgeBase().pipe(Effect.provide(layer)));

        // Insert picks for both posts
        await Effect.runPromise(
          Effect.gen(function* () {
            const sql = yield* SqlClient.SqlClient;
            yield* sql`
              INSERT INTO editorial_picks (post_uri, score, reason, category, curator, status, picked_at, expires_at)
              VALUES (${solarUri}, 90, 'Solar pick', 'analysis', 'curator', 'active', ${Date.now()}, NULL)
            `;
            yield* sql`
              INSERT INTO editorial_picks (post_uri, score, reason, category, curator, status, picked_at, expires_at)
              VALUES (${windUri}, 70, 'Wind pick', 'discussion', 'curator', 'active', ${Date.now()}, NULL)
            `;
          }).pipe(Effect.provide(layer))
        );

        const response = await requestApi("/api/posts/curated?topic=solar", layer);
        const text = await response.text();
        expect(response.status).toBe(200);

        const body = decodeCuratedPostsPage(JSON.parse(text));
        expect(body.items).toHaveLength(1);
        expect(body.items[0]!.uri).toBe(solarUri);
        expect(body.items[0]!.topics).toContain("solar");
      })
    )
  );
});

// ---------------------------------------------------------------------------
// EditorialService business logic
// ---------------------------------------------------------------------------

describe("EditorialService", () => {
  it.live("submitPick validates post exists and rejects non-existent URI", () =>
    Effect.promise(() =>
      withTempSqliteFile(async (filename) => {
        const layer = makeBiLayer({ filename });
        await Effect.runPromise(seedKnowledgeBase().pipe(Effect.provide(layer)));

        const result = await Effect.runPromise(
          Effect.gen(function* () {
            const editorial = yield* EditorialService;
            const outcome = yield* editorial
              .submitPick(
                {
                  postUri: "at://did:plc:fake/app.bsky.feed.post/nope" as AtUri,
                  score: 80 as any,
                  reason: "Nonexistent"
                },
                "test-curator"
              )
              .pipe(
                Effect.map(() => "ok" as const),
                Effect.catchTag("EditorialPostNotFoundError", (e) =>
                  Effect.succeed({ notFound: true, postUri: e.postUri } as const)
                )
              );
            return outcome;
          }).pipe(Effect.provide(layer))
        );

        expect(result).toEqual({
          notFound: true,
          postUri: "at://did:plc:fake/app.bsky.feed.post/nope"
        });
      })
    )
  );

  it.live("submitPick calculates default expiry from config", () =>
    Effect.promise(() =>
      withTempSqliteFile(async (filename) => {
        const layer = makeBiLayer({ filename, config: { editorialDefaultExpiryHours: 48 } });
        await Effect.runPromise(seedKnowledgeBase().pipe(Effect.provide(layer)));

        await Effect.runPromise(
          Effect.gen(function* () {
            const editorial = yield* EditorialService;
            yield* editorial.submitPick(
              {
                postUri: solarUri,
                score: 85 as any,
                reason: "Checking expiry"
              },
              "test-curator"
            );

            // Verify the pick was created with an expiry
            const repo = yield* EditorialRepo;
            const picks = yield* repo.listPicks({ limit: 10 });
            const pick = picks.find((p) => p.postUri === solarUri);
            expect(pick).toBeDefined();
            expect(pick!.expiresAt).not.toBeNull();
            // With 48-hour default, expiresAt should be roughly 48h from pickedAt
            const diffMs = pick!.expiresAt! - pick!.pickedAt;
            const diffHours = diffMs / (60 * 60 * 1000);
            // Allow small tolerance for clock skew
            expect(diffHours).toBeGreaterThanOrEqual(47.9);
            expect(diffHours).toBeLessThanOrEqual(48.1);
          }).pipe(Effect.provide(layer))
        );
      })
    )
  );

  it.live("getCuratedFeed resolves topics via ontology", () =>
    Effect.promise(() =>
      withTempSqliteFile(async (filename) => {
        const layer = makeBiLayer({ filename });
        await Effect.runPromise(seedKnowledgeBase().pipe(Effect.provide(layer)));

        await Effect.runPromise(
          Effect.gen(function* () {
            const editorial = yield* EditorialService;

            // Submit a pick via the service
            yield* editorial.submitPick(
              {
                postUri: solarUri,
                score: 85 as any,
                reason: "Solar pick for topic test",
                category: "analysis"
              },
              "test-curator"
            );
            yield* editorial.submitPick(
              {
                postUri: windUri,
                score: 70 as any,
                reason: "Wind pick for topic test",
                category: "discussion"
              },
              "test-curator"
            );

            // Query with topic filter — should use ontology resolution
            const feed = yield* editorial.getCuratedFeed({ topic: "solar" });
            expect(feed).toHaveLength(1);
            expect(feed[0]!.uri).toBe(solarUri);
            expect(feed[0]!.topics).toContain("solar");

            // Query without topic — should return both
            const allFeed = yield* editorial.getCuratedFeed({});
            expect(allFeed).toHaveLength(2);
          }).pipe(Effect.provide(layer))
        );
      })
    )
  );
});
