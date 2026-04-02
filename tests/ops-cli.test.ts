import * as BunContext from "./helpers/BunContext";
import { FetchHttpClient } from "effect/unstable/http";
import { Effect, Layer, Redacted } from "effect";
import { describe, expect, it } from "@effect/vitest";
import { energySeedDid } from "../src/bootstrap/CheckedInExpertSeeds";
import { runOpsCli } from "../src/ops/Cli";
import {
  MissingOperatorSecretEnvError,
  SmokeAssertionError,
  StagingRequestError
} from "../src/ops/Errors";
import { OperatorSecret } from "../src/ops/OperatorSecret";
import { StagingOperatorClient } from "../src/ops/StagingOperatorClient";
import { WranglerCli } from "../src/ops/WranglerCli";
import { smokeFixtureUris } from "../src/staging/SmokeFixture";

const makeSampleEnrichmentRun = () => ({
  id: "enrich-run-1",
  workflowInstanceId: "enrich-run-1",
  postUri: "at://did:plc:test/app.bsky.feed.post/post-1" as any,
  enrichmentType: "vision" as const,
  schemaVersion: "v1",
  triggeredBy: "admin" as const,
  requestedBy: "operator@example.com",
  status: "failed" as const,
  phase: "failed" as const,
  attemptCount: 1,
  modelLane: null,
  promptVersion: null,
  inputFingerprint: null,
  startedAt: 1,
  finishedAt: 2,
  lastProgressAt: 2,
  resultWrittenAt: null,
  error: null
});

const makeCliLayer = (options?: {
  readonly deploy?: (configFile: string, env: string) => Effect.Effect<void, never>;
  readonly client?: Layer.Layer<StagingOperatorClient>;
  readonly operatorSecretLayer?: Layer.Layer<OperatorSecret, unknown>;
}) => {
  const deployCalls: Array<{ readonly configFile: string; readonly env: string }> = [];
  const remoteCalls: Array<{ readonly action: string; readonly secret?: string }> = [];
  const reveal = (secret: Redacted.Redacted<string>) => Redacted.value(secret);

  const wranglerLayer = Layer.succeed(WranglerCli, {
    deploy: (configFile: string, env: string) =>
      (options?.deploy ?? (() =>
        Effect.sync(() => {
          deployCalls.push({ configFile, env });
        })))(configFile, env)
    });

  const clientLayer = options?.client ?? Layer.succeed(StagingOperatorClient, {
    health: () =>
      Effect.sync(() => {
        remoteCalls.push({ action: "health" });
        return "ok";
      }),
    migrate: (_baseUrl: URL, secret: Redacted.Redacted<string>) =>
      Effect.sync(() => {
        remoteCalls.push({ action: "migrate", secret: reveal(secret) });
        return { ok: true } as const;
      }),
    bootstrapExperts: (_baseUrl: URL, secret: Redacted.Redacted<string>) =>
      Effect.sync(() => {
        remoteCalls.push({ action: "bootstrap", secret: reveal(secret) });
        return {
          domain: "energy",
          count: 1
        } as const;
      }),
    pollIngest: (_baseUrl: URL, secret: Redacted.Redacted<string>, did?: string) =>
      Effect.sync(() => {
        const revealed = reveal(secret);
        remoteCalls.push({ action: "poll", secret: did === undefined ? revealed : `${revealed}:${did}` });
        return {
          runId: "run-1",
          workflowInstanceId: "run-1",
          status: "queued"
        } as const;
      }),
    getIngestRun: (_baseUrl: URL, secret: Redacted.Redacted<string>, _runId: string) =>
      Effect.sync(() => {
        remoteCalls.push({ action: "run-status", secret: reveal(secret) });
        return {
          id: "run-1",
          workflowInstanceId: "run-1",
          kind: "head-sweep",
          triggeredBy: "admin",
          requestedBy: "operator@example.com",
          status: "complete",
          phase: "complete",
          startedAt: 1,
          finishedAt: 2,
          lastProgressAt: 2,
          totalExperts: 1,
          expertsSucceeded: 1,
          expertsFailed: 0,
          pagesFetched: 1,
          postsSeen: 1,
          postsStored: 1,
          postsDeleted: 0,
          error: null
        } as const;
      }),
    repairIngest: (_baseUrl: URL, secret: Redacted.Redacted<string>) =>
      Effect.sync(() => {
        remoteCalls.push({ action: "repair", secret: reveal(secret) });
        return {
          repairedRuns: 0,
          failedItems: 0,
          requeuedItems: 0,
          untouchedRuns: 0
        } as const;
      }),
    startEnrichment: (_baseUrl: URL, secret: Redacted.Redacted<string>, input) =>
      Effect.sync(() => {
        remoteCalls.push({
          action: `enrichment-start:${input.enrichmentType}:${input.postUri}`,
          secret: reveal(secret)
        });
        return {
          runId: "enrich-start-1",
          workflowInstanceId: "enrich-start-1",
          status: "queued"
        } as const;
      }),
    listEnrichmentRuns: (_baseUrl: URL, secret: Redacted.Redacted<string>, _options) =>
      Effect.sync(() => {
        remoteCalls.push({ action: "enrichment-runs", secret: reveal(secret) });
        return [makeSampleEnrichmentRun()] as const;
      }),
    getEnrichmentRun: (_baseUrl: URL, secret: Redacted.Redacted<string>, _runId: string) =>
      Effect.sync(() => {
        remoteCalls.push({ action: "enrichment-run", secret: reveal(secret) });
        return makeSampleEnrichmentRun();
      }),
    retryEnrichment: (_baseUrl: URL, secret: Redacted.Redacted<string>, _runId: string) =>
      Effect.sync(() => {
        remoteCalls.push({ action: "enrichment-retry", secret: reveal(secret) });
        return {
          runId: "enrich-run-1",
          workflowInstanceId: "enrich-run-1",
          status: "queued"
        } as const;
      }),
    repairEnrichment: (_baseUrl: URL, secret: Redacted.Redacted<string>) =>
      Effect.sync(() => {
        remoteCalls.push({ action: "enrichment-repair", secret: reveal(secret) });
        return {
          repairedRuns: 1,
          staleQueuedRuns: 1,
          staleRunningRuns: 0,
          untouchedRuns: 0
        } as const;
      }),
    loadSmokeFixture: (_baseUrl: URL, secret: Redacted.Redacted<string>) =>
      Effect.sync(() => {
        remoteCalls.push({ action: "fixture", secret: reveal(secret) });
        return {
          posts: 2,
          links: 2,
          topics: 3
        } as const;
      }),
    curatePost: (_baseUrl: URL, secret: Redacted.Redacted<string>, input) =>
      Effect.sync(() => {
        remoteCalls.push({
          action: `curate:${input.action}:${input.postUri}${input.note === undefined ? "" : `:${input.note}`}`,
          secret: reveal(secret)
        });
        return {
          postUri: input.postUri as any,
          action: input.action,
          previousStatus: null,
          newStatus: input.action === "reject" ? "rejected" as const : "curated" as const
        };
      }),
    listAdminExperts: (_baseUrl: URL, secret: Redacted.Redacted<string>) =>
      Effect.sync(() => {
        remoteCalls.push({ action: "admin-experts", secret: reveal(secret) });
        return [{ did: "did:plc:test", domain: "energy" }] as const;
      }),
    listExpertsMcp: (_baseUrl: URL, secret: Redacted.Redacted<string>) =>
      Effect.sync(() => {
        remoteCalls.push({ action: "mcp-list", secret: reveal(secret) });
        return [{ did: "did:plc:test", domain: "energy" }] as const;
      }),
    seedPublications: (_baseUrl: URL, secret: Redacted.Redacted<string>) =>
      Effect.sync(() => {
        remoteCalls.push({ action: "seed-publications", secret: reveal(secret) });
        return {
          seeded: 15,
          snapshotVersion: "0.3.0-test"
        } as const;
      }),
    listPublications: (_baseUrl: URL, secret: Redacted.Redacted<string>) =>
      Effect.sync(() => {
        remoteCalls.push({ action: "list-publications", secret: reveal(secret) });
        return Array.from({ length: 34 }, (_, i) => ({
          hostname: `pub${i}.com`,
          tier: "energy-focused" as const,
          postCount: 100 - i
        }));
      }),
    searchPostsMcp: (_baseUrl: URL, secret: Redacted.Redacted<string>) =>
      Effect.sync(() => {
        remoteCalls.push({ action: "mcp-search", secret: reveal(secret) });
        return [{
          uri: smokeFixtureUris()[0],
          topics: ["solar"]
        }] as const;
      }),
    getStats: (_baseUrl: URL, secret: Redacted.Redacted<string>) =>
      Effect.sync(() => {
        remoteCalls.push({ action: "get-stats", secret: reveal(secret) });
        return {
          timestamp: Date.now(),
          experts: { total: 5, active: 3 },
          posts: { total: 100, inLast24h: 10, withLinks: 50 },
          curation: { flagged: 2, curated: 1, rejected: 0 },
          enrichment: { queued: 0, running: 0, complete: 5, failed: 1, needsReview: 0 },
          lastIngest: null
        } as const;
      }),
    importPosts: (_baseUrl: URL, secret: Redacted.Redacted<string>, _input) =>
      Effect.sync(() => {
        remoteCalls.push({ action: "import-posts", secret: reveal(secret) });
        return { imported: 0, flagged: 0, skipped: 0 } as const;
      }),
    refreshProfiles: () => Effect.succeed({ updated: 0, failed: 0 })
  });
  const operatorSecretLayer = options?.operatorSecretLayer ?? Layer.succeed(
    OperatorSecret,
    OperatorSecret.of({ value: Redacted.make("stage-secret") })
  );

  return {
    layer: Layer.mergeAll(wranglerLayer, clientLayer, operatorSecretLayer),
    deployCalls,
    remoteCalls
  };
};

describe("ops CLI", () => {
  it.live("parses deploy and fans out to both workers", () =>
    Effect.promise(async () => {
      const { layer, deployCalls } = makeCliLayer();
      const runtimeLayer = Layer.mergeAll(BunContext.layer, layer);

      await Effect.runPromise(
        runOpsCli(["bun", "ops", "deploy", "--env", "staging", "--worker", "all"]).pipe(
          Effect.provide(runtimeLayer)
        )
      );

      expect(deployCalls).toEqual([
        { configFile: "wrangler.toml", env: "staging" },
        { configFile: "wrangler.agent.toml", env: "staging" }
      ]);
    })
  );

  it.live("runs stage prepare in order and sources SKYGEST_OPERATOR_SECRET", () =>
    Effect.promise(async () => {
      const { layer, remoteCalls } = makeCliLayer();
      const runtimeLayer = Layer.mergeAll(BunContext.layer, layer);

      await Effect.runPromise(
        runOpsCli([
          "bun",
          "ops",
          "stage",
          "prepare",
          "--env",
          "staging",
          "--base-url",
          "https://skygest-bi-agent-staging.workers.dev"
        ]).pipe(Effect.provide(runtimeLayer))
      );

      expect(remoteCalls).toEqual([
        { action: "migrate", secret: "stage-secret" },
        { action: "bootstrap", secret: "stage-secret" },
        { action: "poll", secret: `stage-secret:${energySeedDid}` },
        { action: "run-status", secret: "stage-secret" },
        { action: "fixture", secret: "stage-secret" }
      ]);
    })
  );

  it.live("runs stage curate with default and explicit actions", () =>
    Effect.promise(async () => {
      const { layer, remoteCalls } = makeCliLayer();
      const runtimeLayer = Layer.mergeAll(BunContext.layer, layer);

      await Effect.runPromise(
        runOpsCli([
          "bun",
          "ops",
          "stage",
          "curate",
          "--env",
          "staging",
          "--base-url",
          "https://skygest-bi-agent-staging.workers.dev",
          "--post-uri",
          "at://did:plc:test/app.bsky.feed.post/post-1"
        ]).pipe(Effect.provide(runtimeLayer))
      );

      await Effect.runPromise(
        runOpsCli([
          "bun",
          "ops",
          "stage",
          "curate",
          "--env",
          "staging",
          "--base-url",
          "https://skygest-bi-agent-staging.workers.dev",
          "--post-uri",
          "at://did:plc:test/app.bsky.feed.post/post-2",
          "--action",
          "reject",
          "--note",
          "duplicate"
        ]).pipe(Effect.provide(runtimeLayer))
      );

      expect(remoteCalls).toEqual([
        {
          action: "curate:curate:at://did:plc:test/app.bsky.feed.post/post-1",
          secret: "stage-secret"
        },
        {
          action: "curate:reject:at://did:plc:test/app.bsky.feed.post/post-2:duplicate",
          secret: "stage-secret"
        }
      ]);
    })
  );

  it.live("runs stage smoke against admin and MCP endpoints", () =>
    Effect.promise(async () => {
      const { layer, remoteCalls } = makeCliLayer();
      const runtimeLayer = Layer.mergeAll(BunContext.layer, layer);

      await Effect.runPromise(
        runOpsCli([
          "bun",
          "ops",
          "stage",
          "smoke",
          "--env",
          "staging",
          "--base-url",
          "https://skygest-bi-agent-staging.workers.dev"
        ]).pipe(Effect.provide(runtimeLayer))
      );

      expect(remoteCalls).toEqual([
        { action: "health" },
        { action: "admin-experts", secret: "stage-secret" },
        { action: "poll", secret: `stage-secret:${energySeedDid}` },
        { action: "run-status", secret: "stage-secret" },
        { action: "mcp-list", secret: "stage-secret" },
        { action: "mcp-search", secret: "stage-secret" },
        { action: "list-publications", secret: "stage-secret" }
      ]);
    })
  );

  it.live("runs enrichment start, inspection, and retry commands through the staging client", () =>
    Effect.promise(async () => {
      const { layer, remoteCalls } = makeCliLayer();
      const runtimeLayer = Layer.mergeAll(BunContext.layer, layer);

      await Effect.runPromise(
        runOpsCli([
          "bun",
          "ops",
          "stage",
          "enrichment-start",
          "--env",
          "staging",
          "--base-url",
          "https://skygest-bi-agent-staging.workers.dev",
          "--post-uri",
          "at://did:plc:test/app.bsky.feed.post/post-1",
          "--enrichment-type",
          "vision",
          "--schema-version",
          "v1"
        ]).pipe(Effect.provide(runtimeLayer))
      );

      await Effect.runPromise(
        runOpsCli([
          "bun",
          "ops",
          "stage",
          "enrichment-runs",
          "--env",
          "staging",
          "--base-url",
          "https://skygest-bi-agent-staging.workers.dev",
          "--status",
          "failed",
          "--limit",
          "5"
        ]).pipe(Effect.provide(runtimeLayer))
      );

      await Effect.runPromise(
        runOpsCli([
          "bun",
          "ops",
          "stage",
          "enrichment-retry",
          "--env",
          "staging",
          "--base-url",
          "https://skygest-bi-agent-staging.workers.dev",
          "--run-id",
          "enrich-run-1"
        ]).pipe(Effect.provide(runtimeLayer))
      );

      expect(remoteCalls).toEqual([
        {
          action: "enrichment-start:vision:at://did:plc:test/app.bsky.feed.post/post-1",
          secret: "stage-secret"
        },
        { action: "enrichment-runs", secret: "stage-secret" },
        { action: "enrichment-retry", secret: "stage-secret" }
      ]);
    })
  );

  it.live("fails clearly when the operator secret is missing or a remote call fails", () =>
    Effect.promise(async () => {
      const missingSecretLayer = Layer.mergeAll(
        BunContext.layer,
        makeCliLayer({
          operatorSecretLayer: Layer.effect(
            OperatorSecret,
            Effect.fail(new MissingOperatorSecretEnvError({
              envVar: "SKYGEST_OPERATOR_SECRET"
            }))
          )
        }).layer
      );
      const missingSecret = await Effect.runPromise(
        Effect.flip(
          runOpsCli([
            "bun",
            "ops",
            "stage",
            "prepare",
            "--env",
            "staging",
            "--base-url",
            "https://skygest-bi-agent-staging.workers.dev"
          ]).pipe(Effect.provide(missingSecretLayer))
        )
      );

      const failingLayer = makeCliLayer({
        client: Layer.succeed(StagingOperatorClient, {
          health: (baseUrl) =>
            Effect.fail(new StagingRequestError({
              operation: "health",
              status: baseUrl.hostname.length,
              message: "boom"
            })),
          migrate: (_baseUrl, _secret) => Effect.succeed({ ok: true } as const),
          bootstrapExperts: (_baseUrl, _secret) =>
            Effect.succeed({
              domain: "energy",
              count: 1
            } as const),
          pollIngest: (_baseUrl, _secret, _did) =>
            Effect.succeed({
              runId: "run-1",
              workflowInstanceId: "run-1",
              status: "queued"
            } as const),
          getIngestRun: (_baseUrl, _secret, _runId) =>
            Effect.succeed({
              id: "run-1",
              workflowInstanceId: "run-1",
              kind: "head-sweep",
              triggeredBy: "admin",
              requestedBy: "operator@example.com",
              status: "complete",
              phase: "complete",
              startedAt: 1,
              finishedAt: 2,
              lastProgressAt: 2,
              totalExperts: 1,
              expertsSucceeded: 1,
              expertsFailed: 0,
              pagesFetched: 1,
              postsSeen: 1,
              postsStored: 1,
              postsDeleted: 0,
              error: null
            } as const),
          repairIngest: (_baseUrl, _secret) =>
            Effect.succeed({
              repairedRuns: 0,
              failedItems: 0,
              requeuedItems: 0,
              untouchedRuns: 0
            } as const),
          startEnrichment: (_baseUrl, _secret, _input) =>
            Effect.succeed({
              runId: "enrich-start-1",
              workflowInstanceId: "enrich-start-1",
              status: "queued"
            } as const),
          listEnrichmentRuns: (_baseUrl, _secret, _options) => Effect.succeed([] as const),
          getEnrichmentRun: (_baseUrl, _secret, _runId) =>
            Effect.succeed(makeSampleEnrichmentRun()),
          retryEnrichment: (_baseUrl, _secret, _runId) =>
            Effect.succeed({
              runId: "enrich-run-1",
              workflowInstanceId: "enrich-run-1",
              status: "queued"
            } as const),
          repairEnrichment: (_baseUrl, _secret) =>
            Effect.succeed({
              repairedRuns: 0,
              staleQueuedRuns: 0,
              staleRunningRuns: 0,
              untouchedRuns: 0
            } as const),
          loadSmokeFixture: (_baseUrl, _secret) =>
            Effect.succeed({
              posts: 2,
              links: 2,
              topics: 3
            } as const),
          curatePost: (_baseUrl, _secret, input) =>
            Effect.succeed({
              postUri: input.postUri as any,
              action: input.action,
              previousStatus: null,
              newStatus: input.action === "reject" ? "rejected" as const : "curated" as const
            }),
          listAdminExperts: (_baseUrl, _secret) =>
            Effect.succeed([{ did: "did:plc:test", domain: "energy" }] as const),
          listExpertsMcp: (_baseUrl, _secret) =>
            Effect.succeed([{ did: "did:plc:test", domain: "energy" }] as const),
          seedPublications: (_baseUrl, _secret) =>
            Effect.succeed({
              seeded: 15,
              snapshotVersion: "0.3.0-test"
            } as const),
          listPublications: (_baseUrl, _secret) =>
            Effect.succeed([{ hostname: "utilitydive.com", tier: "energy-focused", postCount: 100 }] as const),
          searchPostsMcp: (_baseUrl, _secret, _query) =>
            Effect.succeed([{
              uri: smokeFixtureUris()[0],
              topics: ["solar"]
            }] as const),
          getStats: () =>
            Effect.succeed({
              timestamp: Date.now(),
              experts: { total: 5, active: 3 },
              posts: { total: 100, inLast24h: 10, withLinks: 50 },
              curation: { flagged: 2, curated: 1, rejected: 0 },
              enrichment: { queued: 0, running: 0, complete: 5, failed: 1, needsReview: 0 },
              lastIngest: null
            } as const),
          importPosts: () => Effect.succeed({ imported: 0, flagged: 0, skipped: 0 } as const),
          refreshProfiles: () => Effect.succeed({ updated: 0, failed: 0 })
        })
      }).layer;
      const failingRuntimeLayer = Layer.mergeAll(BunContext.layer, failingLayer);
      const remoteFailure = await Effect.runPromise(
        Effect.flip(
          runOpsCli([
            "bun",
            "ops",
            "stage",
            "smoke",
            "--env",
            "staging",
            "--base-url",
            "https://skygest-bi-agent-staging.workers.dev"
          ]).pipe(Effect.provide(failingRuntimeLayer))
        )
      );

      expect(missingSecret).toBeInstanceOf(MissingOperatorSecretEnvError);
      expect(remoteFailure).toBeInstanceOf(StagingRequestError);
      if (remoteFailure instanceof StagingRequestError) {
        expect(remoteFailure.message).toContain("boom");
      }
    })
  );

  it.live("stringifies structured ingest failures in operator-visible CLI errors", () =>
    Effect.promise(async () => {
      const failingRunLayer = makeCliLayer({
        client: Layer.succeed(StagingOperatorClient, {
          health: () => Effect.succeed("ok"),
          migrate: (_baseUrl, _secret) => Effect.succeed({ ok: true } as const),
          bootstrapExperts: (_baseUrl, _secret) =>
            Effect.succeed({
              domain: "energy",
              count: 1
            } as const),
          pollIngest: (_baseUrl, _secret, _did) =>
            Effect.succeed({
              runId: "run-1",
              workflowInstanceId: "run-1",
              status: "queued"
            } as const),
          getIngestRun: (_baseUrl, _secret, _runId) =>
            Effect.succeed({
              id: "run-1",
              workflowInstanceId: "run-1",
              kind: "head-sweep",
              triggeredBy: "admin",
              requestedBy: "operator@example.com",
              status: "failed",
              phase: "failed",
              startedAt: 1,
              finishedAt: 2,
              lastProgressAt: 2,
              totalExperts: 1,
              expertsSucceeded: 0,
              expertsFailed: 1,
              pagesFetched: 1,
              postsSeen: 1,
              postsStored: 0,
              postsDeleted: 0,
              error: {
                tag: "BlueskyApiError",
                message: "upstream rate limit",
                retryable: true,
                status: 429,
                did: energySeedDid,
                runId: "run-1",
                operation: "ExpertPollCoordinatorDo.alarm"
              }
            } as const),
          repairIngest: (_baseUrl, _secret) =>
            Effect.succeed({
              repairedRuns: 0,
              failedItems: 0,
              requeuedItems: 0,
              untouchedRuns: 0
            } as const),
          startEnrichment: (_baseUrl, _secret, _input) =>
            Effect.succeed({
              runId: "enrich-start-1",
              workflowInstanceId: "enrich-start-1",
              status: "queued"
            } as const),
          listEnrichmentRuns: (_baseUrl, _secret, _options) => Effect.succeed([] as const),
          getEnrichmentRun: (_baseUrl, _secret, _runId) =>
            Effect.succeed(makeSampleEnrichmentRun()),
          retryEnrichment: (_baseUrl, _secret, _runId) =>
            Effect.succeed({
              runId: "enrich-run-1",
              workflowInstanceId: "enrich-run-1",
              status: "queued"
            } as const),
          repairEnrichment: (_baseUrl, _secret) =>
            Effect.succeed({
              repairedRuns: 0,
              staleQueuedRuns: 0,
              staleRunningRuns: 0,
              untouchedRuns: 0
            } as const),
          loadSmokeFixture: (_baseUrl, _secret) =>
            Effect.succeed({
              posts: 2,
              links: 2,
              topics: 3
            } as const),
          curatePost: (_baseUrl, _secret, input) =>
            Effect.succeed({
              postUri: input.postUri as any,
              action: input.action,
              previousStatus: null,
              newStatus: input.action === "reject" ? "rejected" as const : "curated" as const
            }),
          listAdminExperts: (_baseUrl, _secret) =>
            Effect.succeed([{ did: "did:plc:test", domain: "energy" }] as const),
          listExpertsMcp: (_baseUrl, _secret) =>
            Effect.succeed([{ did: "did:plc:test", domain: "energy" }] as const),
          seedPublications: (_baseUrl, _secret) =>
            Effect.succeed({
              seeded: 15,
              snapshotVersion: "0.3.0-test"
            } as const),
          listPublications: (_baseUrl, _secret) =>
            Effect.succeed([{ hostname: "utilitydive.com", tier: "energy-focused", postCount: 100 }] as const),
          searchPostsMcp: (_baseUrl, _secret, _query) =>
            Effect.succeed([{
              uri: smokeFixtureUris()[0],
              topics: ["solar"]
            }] as const),
          getStats: () =>
            Effect.succeed({
              timestamp: Date.now(),
              experts: { total: 5, active: 3 },
              posts: { total: 100, inLast24h: 10, withLinks: 50 },
              curation: { flagged: 2, curated: 1, rejected: 0 },
              enrichment: { queued: 0, running: 0, complete: 5, failed: 1, needsReview: 0 },
              lastIngest: null
            } as const),
          importPosts: () => Effect.succeed({ imported: 0, flagged: 0, skipped: 0 } as const),
          refreshProfiles: () => Effect.succeed({ updated: 0, failed: 0 })
        })
      }).layer;
      const failure = await Effect.runPromise(
        Effect.flip(
          runOpsCli([
            "bun",
            "ops",
            "stage",
            "prepare",
            "--env",
            "staging",
            "--base-url",
            "https://skygest-bi-agent-staging.workers.dev"
          ]).pipe(
            Effect.provide(Layer.mergeAll(BunContext.layer, failingRunLayer))
          )
        )
      );

      expect(failure).toBeInstanceOf(SmokeAssertionError);
      if (failure instanceof SmokeAssertionError) {
        expect(failure.message).toContain("BlueskyApiError");
        expect(failure.message).not.toContain("[object Object]");
      }
    })
  );

  it.effect("StagingOperatorClient.live rejects non-2xx health responses with status", () =>
    Effect.gen(function* () {
      const fakeFetchLayer = Layer.succeed(
        FetchHttpClient.Fetch,
        ((_url: string | URL | Request, _init?: RequestInit) =>
          Promise.resolve(
            new Response("internal server error", { status: 500 })
          )) as typeof globalThis.fetch
      );
      const httpLayer = FetchHttpClient.layer.pipe(Layer.provide(fakeFetchLayer));
      const clientLayer = StagingOperatorClient.live.pipe(Layer.provide(httpLayer));
      const client = yield* Effect.service(StagingOperatorClient).pipe(Effect.provide(clientLayer));
      const error = yield* client.health(new URL("https://broken.test")).pipe(Effect.flip);

      expect(error._tag).toBe("StagingRequestError");
      expect(error.operation).toBe("health");
      expect(error.status).toBe(500);
    })
  );
});
