import { SqlClient } from "effect/unstable/sql";
import { Effect, Layer, Schema } from "effect";
import { describe, expect, it } from "@effect/vitest";
import { handleAdminRequestWithLayer } from "../src/admin/Router";
import type { AccessIdentity } from "../src/auth/AuthService";
import { runMigrations } from "../src/db/migrate";
import { Did, type PostUri } from "../src/domain/types";
import type { ImportPostsInput, ImportPostsOutput } from "../src/domain/api";
import { AppConfig, type AppConfigShape } from "../src/platform/Config";
import { encodeJsonString } from "../src/platform/Json";
import { Logging } from "../src/platform/Logging";
import { ExpertsRepo } from "../src/services/ExpertsRepo";
import { CandidatePayloadService } from "../src/services/CandidatePayloadService";
import { OntologyCatalog } from "../src/services/OntologyCatalog";
import { ExpertsRepoD1 } from "../src/services/d1/ExpertsRepoD1";
import { KnowledgeRepoD1 } from "../src/services/d1/KnowledgeRepoD1";
import { CurationRepoD1 } from "../src/services/d1/CurationRepoD1";
import { PublicationsRepoD1 } from "../src/services/d1/PublicationsRepoD1";
import { CandidatePayloadRepoD1 } from "../src/services/d1/CandidatePayloadRepoD1";
import { CurationService } from "../src/services/CurationService";
import { BlueskyClient } from "../src/bluesky/BlueskyClient";
import { ExpertRegistryService } from "../src/services/ExpertRegistryService";
import { PostImportService } from "../src/services/PostImportService";
import { ProviderRegistry } from "../src/services/ProviderRegistry";
import {
  makeSqliteLayer,
  testConfig,
  withTempSqliteFile
} from "./support/runtime";

const operatorIdentity: AccessIdentity = {
  subject: "did:example:operator",
  email: "operator@example.com",
  scopes: ["experts:read", "experts:write", "ops:read", "ops:refresh"]
};

const decodeDid = Schema.decodeUnknownSync(Did);

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

const stubBlueskyClient = Layer.succeed(BlueskyClient, {
  resolveDidOrHandle: (input: string) =>
    Effect.succeed({
      did: decodeDid(input.startsWith("did:") ? input : "did:plc:stub"),
      handle: input
    }),
  getProfile: (didOrHandle: string) =>
    Effect.succeed({
      did: decodeDid(didOrHandle.startsWith("did:") ? didOrHandle : "did:plc:stub"),
      handle: "stub.example.com",
      displayName: "Stub",
      description: null,
      avatar: null
    }),
  getFollows: () => Effect.succeed({ dids: [], cursor: null }),
  resolveRepoService: () => Effect.succeed("https://pds.example.com"),
  listRecordsAtService: () => Effect.succeed({ records: [], cursor: null }),
  getPostThread: () => Effect.succeed({ thread: {} }),
  getPosts: () => Effect.succeed([])
});

const makeImportTestLayer = (options: {
  readonly filename: string;
  readonly config?: Partial<AppConfigShape>;
}) => {
  const sqliteLayer = makeSqliteLayer(options.filename);
  const configLayer = Layer.succeed(AppConfig, testConfig(options.config));
  const ontologyLayer = OntologyCatalog.layer;
  const providerRegistryLayer = ProviderRegistry.layer;
  const expertsLayer = ExpertsRepoD1.layer.pipe(Layer.provideMerge(sqliteLayer));
  const knowledgeLayer = KnowledgeRepoD1.layer.pipe(Layer.provideMerge(sqliteLayer));
  const publicationsLayer = PublicationsRepoD1.layer.pipe(Layer.provideMerge(sqliteLayer));
  const curationRepoLayer = CurationRepoD1.layer.pipe(Layer.provideMerge(sqliteLayer));
  const candidatePayloadRepoLayer = CandidatePayloadRepoD1.layer.pipe(
    Layer.provideMerge(sqliteLayer)
  );
  const candidatePayloadServiceLayer = CandidatePayloadService.layer.pipe(
    Layer.provideMerge(candidatePayloadRepoLayer)
  );
  const curationServiceLayer = CurationService.layer.pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        curationRepoLayer,
        expertsLayer,
        publicationsLayer,
        providerRegistryLayer,
        candidatePayloadServiceLayer,
        stubBlueskyClient,
        configLayer
      )
    )
  );
  const postImportServiceLayer = PostImportService.layer.pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        configLayer,
        ontologyLayer,
        expertsLayer,
        knowledgeLayer,
        candidatePayloadServiceLayer,
        curationServiceLayer
      )
    )
  );

  const baseLayer = Layer.mergeAll(
    sqliteLayer,
    configLayer,
    Logging.layer,
    ontologyLayer,
    providerRegistryLayer,
    expertsLayer,
    knowledgeLayer,
    publicationsLayer,
    curationRepoLayer,
    candidatePayloadRepoLayer,
    candidatePayloadServiceLayer,
    curationServiceLayer,
    postImportServiceLayer,
    stubBlueskyClient
  );

  const registryLayer = ExpertRegistryService.layer.pipe(
    Layer.provideMerge(
      Layer.mergeAll(configLayer, expertsLayer, stubBlueskyClient, ontologyLayer)
    )
  );

  return Layer.mergeAll(baseLayer, registryLayer);
};

const postImport = (
  layer: Layer.Layer<any, any, never>,
  payload: ImportPostsInput
) =>
  handleAdminRequestWithLayer(
    new Request("https://skygest.local/admin/import/posts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: encodeJsonString(payload)
    }),
    operatorIdentity,
    layer
  );

const solarExpert: ImportPostsInput["experts"][number] = {
  did: decodeDid("did:plc:importtest1"),
  handle: "solar-expert.bsky.social",
  domain: "energy",
  source: "twitter-import",
  tier: "energy-focused"
};

// Post with solar topic text — should match ontology
const solarPost: ImportPostsInput["posts"][number] = {
  uri: "x://user1/status/111111" as PostUri,
  did: decodeDid("did:plc:importtest1"),
  text: "Solar panel installations surge across the United States electric grid.",
  createdAt: 1700000000000,
  links: [{ url: "https://example.com/solar-report", title: "Solar report", domain: "example.com" }]
};

// Post with no matching topics — should be skipped
const offTopicPost: ImportPostsInput["posts"][number] = {
  uri: "x://user1/status/222222" as PostUri,
  did: decodeDid("did:plc:importtest1"),
  text: "Just had a wonderful lunch at the new restaurant downtown.",
  createdAt: 1700000000000,
  links: []
};

// Post with embed payload
const postWithEmbed: ImportPostsInput["posts"][number] = {
  uri: "x://user1/status/333333" as PostUri,
  did: decodeDid("did:plc:importtest1"),
  text: "Wind energy capacity grows significantly with new offshore installations.",
  createdAt: 1700000000000,
  embedType: "link",
  embedPayload: {
    kind: "link",
    uri: "https://example.com/wind",
    title: "Wind energy report",
    description: "Q3 offshore wind update",
    thumb: null
  },
  links: [{ url: "https://example.com/wind", title: "Wind energy report", domain: "example.com" }]
};

// Post with null embedPayload — should NOT get a payload row
const postWithNullEmbed: ImportPostsInput["posts"][number] = {
  uri: "x://user1/status/444444" as PostUri,
  did: decodeDid("did:plc:importtest1"),
  text: "Hydrogen production costs are falling due to new electrolyzer technology.",
  createdAt: 1700000000000,
  embedType: null,
  embedPayload: null,
  links: []
};

const hashtagOnlyPost: ImportPostsInput["posts"][number] = {
  uri: "x://user1/status/555555" as PostUri,
  did: decodeDid("did:plc:importtest1"),
  text: "Big energy announcement today.",
  createdAt: 1700000000000,
  hashtags: ["solarenergy"],
  links: []
};

describe("POST /admin/import/posts", () => {
  it.live("imports posts that match topics, skips those that don't", () =>
    Effect.promise(() =>
      withTempSqliteFile(async (filename) => {
        const layer = makeImportTestLayer({ filename });

        await Effect.runPromise(runMigrations.pipe(Effect.provide(layer)));

        const response = await postImport(layer, {
          experts: [solarExpert],
          posts: [solarPost, offTopicPost]
        });

        const body = await expectJsonResponse<ImportPostsOutput>(response);

        expect(body.imported).toBe(1);
        expect(body.skipped).toBe(1);
        // flagged could be 0 or more depending on predicate thresholds
        expect(typeof body.flagged).toBe("number");
      })
    )
  );

  it.live("upserts experts with active: false", () =>
    Effect.promise(() =>
      withTempSqliteFile(async (filename) => {
        const layer = makeImportTestLayer({ filename });

        await Effect.runPromise(runMigrations.pipe(Effect.provide(layer)));

        await postImport(layer, {
          experts: [solarExpert],
          posts: [solarPost]
        });

        const expert = await Effect.runPromise(
          Effect.gen(function* () {
            const experts = yield* ExpertsRepo;
            return yield* experts.getByDid(decodeDid("did:plc:importtest1"));
          }).pipe(Effect.provide(layer))
        );

        expect(expert).not.toBeNull();
        expect(expert!.active).toBe(false);
        expect(expert!.source).toBe("twitter-import");
        expect(expert!.tier).toBe("energy-focused");
        expect(expert!.domain).toBe("energy");
      })
    )
  );

  it.live("preserves existing expert activation and editorial metadata on re-import", () =>
    Effect.promise(() =>
      withTempSqliteFile(async (filename) => {
        const layer = makeImportTestLayer({ filename });

        await Effect.runPromise(runMigrations.pipe(Effect.provide(layer)));
        await Effect.runPromise(
          Effect.gen(function* () {
            const experts = yield* ExpertsRepo;
            yield* experts.upsert({
              did: solarExpert.did,
              handle: "existing-handle",
              displayName: "Existing Name",
              description: "keep this description",
              avatar: null,
              domain: "energy",
              source: "manual",
              sourceRef: "manual-source",
              shard: 0,
              active: true,
              tier: "general-outlet",
              addedAt: 123,
              lastSyncedAt: 456
            });
          }).pipe(Effect.provide(layer))
        );

        await postImport(layer, {
          experts: [{
            ...solarExpert,
            handle: "updated-handle",
            displayName: "Updated Name"
          }],
          posts: [solarPost]
        });

        const expert = await Effect.runPromise(
          Effect.gen(function* () {
            const experts = yield* ExpertsRepo;
            return yield* experts.getByDid(solarExpert.did);
          }).pipe(Effect.provide(layer))
        );

        expect(expert).not.toBeNull();
        expect(expert!.active).toBe(true);
        expect(expert!.source).toBe("manual");
        expect(expert!.sourceRef).toBe("manual-source");
        expect(expert!.tier).toBe("general-outlet");
        expect(expert!.description).toBe("keep this description");
        expect(expert!.addedAt).toBe(123);
        expect(expert!.lastSyncedAt).toBe(456);
        expect(expert!.handle).toBe("updated-handle");
        expect(expert!.displayName).toBe("Updated Name");
      })
    )
  );

  it.live("stores posts in the knowledge repo", () =>
    Effect.promise(() =>
      withTempSqliteFile(async (filename) => {
        const layer = makeImportTestLayer({ filename });

        await Effect.runPromise(runMigrations.pipe(Effect.provide(layer)));

        await postImport(layer, {
          experts: [solarExpert],
          posts: [solarPost]
        });

        const postCount = await Effect.runPromise(
          Effect.gen(function* () {
            const sql = yield* SqlClient.SqlClient;
            const rows = yield* sql<{ count: number }>`
              SELECT COUNT(*) as count FROM posts WHERE uri = ${"x://user1/status/111111"}
            `;
            return Number(rows[0]?.count ?? 0);
          }).pipe(Effect.provide(layer))
        );

        expect(postCount).toBe(1);
      })
    )
  );

  it.live("stores embed payloads for posts with embedPayload", () =>
    Effect.promise(() =>
      withTempSqliteFile(async (filename) => {
        const layer = makeImportTestLayer({ filename });

        await Effect.runPromise(runMigrations.pipe(Effect.provide(layer)));

        await postImport(layer, {
          experts: [solarExpert],
          posts: [postWithEmbed]
        });

        const payload = await Effect.runPromise(
          Effect.gen(function* () {
            const payloadService = yield* CandidatePayloadService;
            return yield* payloadService.getPayload("x://user1/status/333333" as PostUri);
          }).pipe(Effect.provide(layer))
        );

        expect(payload).not.toBeNull();
        expect(payload!.captureStage).toBe("candidate");
        expect(payload!.embedType).toBe("link");
        expect(payload!.embedPayload).not.toBeNull();
      })
    )
  );

  it.live("does NOT store payload for posts with null embedPayload", () =>
    Effect.promise(() =>
      withTempSqliteFile(async (filename) => {
        const layer = makeImportTestLayer({ filename });

        await Effect.runPromise(runMigrations.pipe(Effect.provide(layer)));

        await postImport(layer, {
          experts: [solarExpert],
          posts: [postWithNullEmbed]
        });

        const payload = await Effect.runPromise(
          Effect.gen(function* () {
            const payloadService = yield* CandidatePayloadService;
            return yield* payloadService.getPayload("x://user1/status/444444" as PostUri);
          }).pipe(Effect.provide(layer))
        );

        expect(payload).toBeNull();
      })
    )
  );

  it.live("does NOT store payload for posts that were skipped (no topic match)", () =>
    Effect.promise(() =>
      withTempSqliteFile(async (filename) => {
        const layer = makeImportTestLayer({ filename });

        await Effect.runPromise(runMigrations.pipe(Effect.provide(layer)));

        // offTopicPost but with embedPayload — should NOT be stored since post is skipped
        const offTopicWithEmbed = {
          ...offTopicPost,
          embedType: "link" as const,
          embedPayload: {
            kind: "link" as const,
            uri: "https://example.com/food",
            title: "Restaurant",
            description: null,
            thumb: null
          }
        };

        await postImport(layer, {
          experts: [solarExpert],
          posts: [offTopicWithEmbed]
        });

        const payload = await Effect.runPromise(
          Effect.gen(function* () {
            const payloadService = yield* CandidatePayloadService;
            return yield* payloadService.getPayload("x://user1/status/222222" as PostUri);
          }).pipe(Effect.provide(layer))
        );

        expect(payload).toBeNull();
      })
    )
  );

  it.live("handles empty input gracefully", () =>
    Effect.promise(() =>
      withTempSqliteFile(async (filename) => {
        const layer = makeImportTestLayer({ filename });

        await Effect.runPromise(runMigrations.pipe(Effect.provide(layer)));

        const response = await postImport(layer, {
          experts: [],
          posts: []
        });

        const body = await expectJsonResponse<ImportPostsOutput>(response);

        expect(body.imported).toBe(0);
        expect(body.skipped).toBe(0);
        expect(body.flagged).toBe(0);
      })
    )
  );

  it.live("imports multiple posts in a single batch", () =>
    Effect.promise(() =>
      withTempSqliteFile(async (filename) => {
        const layer = makeImportTestLayer({ filename });

        await Effect.runPromise(runMigrations.pipe(Effect.provide(layer)));

        const response = await postImport(layer, {
          experts: [solarExpert],
          posts: [solarPost, postWithEmbed, postWithNullEmbed, offTopicPost]
        });

        const body = await expectJsonResponse<ImportPostsOutput>(response);

        // solarPost, postWithEmbed, postWithNullEmbed match topics; offTopicPost does not
        expect(body.imported).toBe(3);
        expect(body.skipped).toBe(1);
      })
    )
  );

  it.live("imports post with zero topics when operatorOverride is true", () =>
    Effect.promise(() =>
      withTempSqliteFile(async (filename) => {
        const layer = makeImportTestLayer({ filename });
        await Effect.runPromise(runMigrations.pipe(Effect.provide(layer)));

        const response = await postImport(layer, {
          experts: [solarExpert],
          posts: [offTopicPost],
          operatorOverride: true
        });

        const body = await expectJsonResponse<ImportPostsOutput>(response);
        expect(body.imported).toBe(1);
        expect(body.skipped).toBe(0);
      })
    )
  );

  it.live("imports posts that match through hashtags even when text is generic", () =>
    Effect.promise(() =>
      withTempSqliteFile(async (filename) => {
        const layer = makeImportTestLayer({ filename });

        await Effect.runPromise(runMigrations.pipe(Effect.provide(layer)));

        const response = await postImport(layer, {
          experts: [solarExpert],
          posts: [hashtagOnlyPost]
        });

        const body = await expectJsonResponse<ImportPostsOutput>(response);

        expect(body.imported).toBe(1);
        expect(body.skipped).toBe(0);
      })
    )
  );
});

describe("curate_post Twitter branch", () => {
  const twitterExpert: ImportPostsInput["experts"][number] = {
    did: decodeDid("did:x:12345"),
    handle: "energyanalyst",
    domain: "energy",
    source: "twitter-import",
    tier: "energy-focused"
  };

  const twitterPost: ImportPostsInput["posts"][number] = {
    uri: "x://12345/status/99001" as PostUri,
    did: decodeDid("did:x:12345"),
    text: "Solar curtailment in CAISO hit a new record today — 5.2 GWh curtailed. Grid operators are struggling.",
    createdAt: 1_710_000_000_000,
    embedType: "img",
    embedPayload: {
      kind: "img",
      images: [{
        thumb: "https://pbs.twimg.com/media/thumb.jpg",
        fullsize: "https://pbs.twimg.com/media/full.jpg",
        alt: "chart",
        mediaId: null
      }]
    },
    links: []
  };

  it.live("curates a Twitter post using stored payload, skipping Bluesky fetch", () =>
    Effect.promise(() =>
      withTempSqliteFile(async (filename) => {
        const layer = makeImportTestLayer({ filename });

        // Run migrations and import a Twitter post
        await Effect.runPromise(runMigrations.pipe(Effect.provide(layer)));

        const importResponse = await postImport(layer, {
          experts: [twitterExpert],
          posts: [twitterPost]
        });
        const importBody = await expectJsonResponse<ImportPostsOutput>(importResponse);
        expect(importBody.imported).toBe(1);

        // Curate the Twitter post via CurationService
        const curateResult = await Effect.runPromise(
          Effect.gen(function* () {
            const curation = yield* CurationService;
            return yield* curation.curatePost({
              postUri: "x://12345/status/99001" as PostUri,
              action: "curate" as const,
              note: "interesting chart"
            }, "test-curator");
          }).pipe(Effect.provide(layer))
        );

        expect(curateResult.newStatus).toBe("curated");

        // Verify payload transitioned to "picked"
        const payload = await Effect.runPromise(
          Effect.gen(function* () {
            const payloadService = yield* CandidatePayloadService;
            return yield* payloadService.getPayload("x://12345/status/99001" as PostUri);
          }).pipe(Effect.provide(layer))
        );

        expect(payload).not.toBeNull();
        expect(payload!.captureStage).toBe("picked");
      })
    )
  );

  it.live("curates a plain-text Twitter post without enrichment", () =>
    Effect.promise(() =>
      withTempSqliteFile(async (filename) => {
        const layer = makeImportTestLayer({ filename });

        await Effect.runPromise(runMigrations.pipe(Effect.provide(layer)));

        const plainTextPost: ImportPostsInput["posts"][number] = {
          ...twitterPost,
          uri: "x://12345/status/99002" as PostUri,
          embedType: null,
          embedPayload: null,
          links: []
        };

        await postImport(layer, {
          experts: [twitterExpert],
          posts: [plainTextPost]
        });

        // Curate — should succeed without payload
        const curateResult = await Effect.runPromise(
          Effect.gen(function* () {
            const curation = yield* CurationService;
            return yield* curation.curatePost({
              postUri: "x://12345/status/99002" as PostUri,
              action: "curate" as const,
              note: "insightful take"
            }, "test-curator");
          }).pipe(Effect.provide(layer))
        );

        expect(curateResult.newStatus).toBe("curated");

        // No payload should exist
        const payload = await Effect.runPromise(
          Effect.gen(function* () {
            const payloadService = yield* CandidatePayloadService;
            return yield* payloadService.getPayload("x://12345/status/99002" as PostUri);
          }).pipe(Effect.provide(layer))
        );

        expect(payload).toBeNull();
      })
    )
  );
});
