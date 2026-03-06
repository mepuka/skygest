import { SqlClient } from "@effect/sql";
import { Effect, Layer, Schema } from "effect";
import { describe, expect, it } from "@effect/vitest";
import { handleAdminRequestWithLayer } from "../src/admin/Router";
import type { AccessIdentity } from "../src/auth/AuthService";
import { bootstrapExperts, computeShard } from "../src/bootstrap/ExpertSeeds";
import { runMigrations } from "../src/db/migrate";
import { BlueskyClient } from "../src/bluesky/BlueskyClient";
import { Did } from "../src/domain/types";
import { AppConfig, type AppConfigShape } from "../src/platform/Config";
import { encodeJsonString } from "../src/platform/Json";
import { Logging } from "../src/platform/Logging";
import { ExpertRegistryService } from "../src/services/ExpertRegistryService";
import { ExpertsRepo } from "../src/services/ExpertsRepo";
import { IngestShardRefresher } from "../src/services/IngestShardRefresher";
import { ExpertsRepoD1 } from "../src/services/d1/ExpertsRepoD1";
import {
  makeSqliteLayer,
  sampleDid,
  seedManifest,
  testConfig,
  withTempSqliteFile
} from "./support/runtime";

const operatorIdentity: AccessIdentity = {
  subject: "did:example:operator",
  email: "operator@example.com",
  issuer: "https://access.example.com",
  audience: ["skygest-mcp"],
  scopes: ["experts:write", "ops:refresh"],
  payload: {
    sub: "did:example:operator",
    email: "operator@example.com",
    scope: "experts:write ops:refresh"
  }
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

const makeAdminTestLayer = (options: {
  readonly filename: string;
  readonly config?: Partial<AppConfigShape>;
  readonly blueskyClient?: Layer.Layer<BlueskyClient>;
  readonly refresher?: Layer.Layer<IngestShardRefresher>;
}) => {
  const sqliteLayer = makeSqliteLayer(options.filename);
  const configLayer = Layer.succeed(AppConfig, testConfig(options.config));
  const expertsLayer = ExpertsRepoD1.layer.pipe(Layer.provideMerge(sqliteLayer));
  const blueskyLayer = options.blueskyClient ?? Layer.succeed(BlueskyClient, {
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
        description: "Seeded profile"
      }),
    getFollows: () =>
      Effect.succeed({
        dids: [],
        cursor: null
      })
  });
  const refreshLayer = options.refresher ?? Layer.succeed(IngestShardRefresher, {
    refreshShard: (shard: number) => Effect.succeed([shard] as const),
    refreshAllShards: () => Effect.succeed([0])
  });
  const baseLayer = Layer.mergeAll(
    sqliteLayer,
    configLayer,
    Logging.layer,
    expertsLayer,
    blueskyLayer,
    refreshLayer
  );

  return Layer.mergeAll(
    baseLayer,
    ExpertRegistryService.layer.pipe(Layer.provideMerge(baseLayer))
  );
};

describe("admin expert registry routes", () => {
  it.live("adds experts by handle, upserts metadata, and refreshes the affected shard", () =>
    Effect.promise(() =>
      withTempSqliteFile(async (filename) => {
        const refreshedShards: number[] = [];
        let displayName = "Solar Lead";
        const addedDid = decodeDid("did:plc:solar-operator");
        const layer = makeAdminTestLayer({
          filename,
          config: { ingestShardCount: 4 },
          blueskyClient: Layer.succeed(BlueskyClient, {
            resolveDidOrHandle: () =>
              Effect.succeed({
                did: addedDid,
                handle: "solar.example.com"
              }),
            getProfile: () =>
              Effect.succeed({
                did: addedDid,
                handle: "solar.example.com",
                displayName,
                description: "Solar sector operator"
              }),
            getFollows: () =>
              Effect.succeed({
                dids: [],
                cursor: null
              })
          }),
          refresher: Layer.succeed(IngestShardRefresher, {
            refreshShard: (shard: number) =>
              Effect.sync(() => {
                refreshedShards.push(shard);
                return [shard] as const;
              }),
            refreshAllShards: () => Effect.succeed([])
          })
        });

        await Effect.runPromise(runMigrations.pipe(Effect.provide(layer)));

        const firstResponse = await handleAdminRequestWithLayer(
          new Request("https://skygest.local/admin/experts", {
            method: "POST",
            body: encodeJsonString({ didOrHandle: "solar.example.com" })
          }),
          operatorIdentity,
          layer
        );

        displayName = "Solar Lead Updated";

        const secondResponse = await handleAdminRequestWithLayer(
          new Request("https://skygest.local/admin/experts", {
            method: "POST",
            body: encodeJsonString({ didOrHandle: "solar.example.com" })
          }),
          operatorIdentity,
          layer
        );

        await expectJsonResponse(firstResponse);
        const secondBody = await expectJsonResponse<{
          readonly did: string;
          readonly displayName: string | null;
          readonly shard: number;
          readonly source: string;
        }>(secondResponse);
        const stored = await Effect.runPromise(
          Effect.gen(function* () {
            const experts = yield* ExpertsRepo;
            const sql = yield* SqlClient.SqlClient;
            const expert = yield* experts.getByDid(addedDid);
            const [count] = yield* sql<{ count: number }>`
              SELECT COUNT(*) as count
              FROM experts
              WHERE did = ${addedDid}
            `;

            return {
              expert,
              count: count?.count ?? 0
            };
          }).pipe(Effect.provide(layer))
        );
        const shard = computeShard(addedDid, 4);

        expect(secondBody.did).toBe(addedDid);
        expect(secondBody.displayName).toBe("Solar Lead Updated");
        expect(secondBody.shard).toBe(shard);
        expect(secondBody.source).toBe("manual");
        expect(stored.count).toBe(1);
        expect(stored.expert?.displayName).toBe("Solar Lead Updated");
        expect(refreshedShards).toEqual([shard, shard]);
      })
    )
  );

  it.live("deactivates experts and refreshes the affected shard", () =>
    Effect.promise(() =>
      withTempSqliteFile(async (filename) => {
        const refreshedShards: number[] = [];
        const shardCount = 4;
        const layer = makeAdminTestLayer({
          filename,
          config: { ingestShardCount: shardCount },
          refresher: Layer.succeed(IngestShardRefresher, {
            refreshShard: (shard: number) =>
              Effect.sync(() => {
                refreshedShards.push(shard);
                return [shard] as const;
              }),
            refreshAllShards: () => Effect.succeed([])
          })
        });

        await Effect.runPromise(
          Effect.gen(function* () {
            yield* runMigrations;
            yield* bootstrapExperts(seedManifest, shardCount, 1_710_000_000_000);
          }).pipe(Effect.provide(layer))
        );

        const response = await handleAdminRequestWithLayer(
          new Request(
            `https://skygest.local/admin/experts/${encodeURIComponent(sampleDid)}/activate`,
            {
              method: "POST",
              body: encodeJsonString({ active: false })
            }
          ),
          operatorIdentity,
          layer
        );

        const body = await expectJsonResponse<{
          readonly active: boolean;
          readonly shard: number;
        }>(response);
        const expert = await Effect.runPromise(
          Effect.gen(function* () {
            const experts = yield* ExpertsRepo;
            return yield* experts.getByDid(sampleDid);
          }).pipe(Effect.provide(layer))
        );
        const shard = computeShard(sampleDid, shardCount);

        expect(body.active).toBe(false);
        expect(body.shard).toBe(shard);
        expect(expert?.active).toBe(false);
        expect(refreshedShards).toEqual([shard]);
      })
    )
  );

  it.live("lists experts with filters and clamps the requested limit", () =>
    Effect.promise(() =>
      withTempSqliteFile(async (filename) => {
        const layer = makeAdminTestLayer({
          filename,
          config: { mcpLimitMax: 1 }
        });

        await Effect.runPromise(
          Effect.gen(function* () {
            yield* runMigrations;
            yield* bootstrapExperts(seedManifest, 1, 1_710_000_000_000);
          }).pipe(Effect.provide(layer))
        );

        const response = await handleAdminRequestWithLayer(
          new Request("https://skygest.local/admin/experts?domain=energy&limit=999"),
          operatorIdentity,
          layer
        );
        const body = await expectJsonResponse<{
          readonly items: ReadonlyArray<{ readonly domain: string }>;
        }>(response);

        expect(body.items).toHaveLength(1);
        expect(body.items[0]?.domain).toBe("energy");
      })
    )
  );

  it.live("returns 400 for invalid admin request input", () =>
    Effect.promise(() =>
      withTempSqliteFile(async (filename) => {
        const layer = makeAdminTestLayer({ filename });

        await Effect.runPromise(runMigrations.pipe(Effect.provide(layer)));

        const response = await handleAdminRequestWithLayer(
          new Request("https://skygest.local/admin/experts?active=maybe"),
          operatorIdentity,
          layer
        );

        const body = await expectJsonResponse<{ readonly error: string }>(response, 400);
        expect(body.error).toContain("active must be");
      })
    )
  );

  it.live("fans out explicit shard refreshes when no shard is specified", () =>
    Effect.promise(() =>
      withTempSqliteFile(async (filename) => {
        const refreshedShards: number[] = [];
        const layer = makeAdminTestLayer({
          filename,
          config: { ingestShardCount: 3 },
          refresher: Layer.succeed(IngestShardRefresher, {
            refreshShard: (shard: number) => Effect.succeed([shard] as const),
            refreshAllShards: () =>
              Effect.sync(() => {
                refreshedShards.push(0, 1, 2);
                return [0, 1, 2] as const;
              })
          })
        });

        await Effect.runPromise(runMigrations.pipe(Effect.provide(layer)));

        const response = await handleAdminRequestWithLayer(
          new Request("https://skygest.local/admin/shards/refresh", {
            method: "POST",
            body: encodeJsonString({})
          }),
          operatorIdentity,
          layer
        );
        const body = await expectJsonResponse<{
          readonly refreshedShards: ReadonlyArray<number>;
        }>(response);

        expect(body.refreshedShards).toEqual([0, 1, 2]);
        expect(refreshedShards).toEqual([0, 1, 2]);
      })
    )
  );
});
