import { BunContext } from "@effect/platform-bun";
import { Effect, Layer } from "effect";
import { describe, expect, it } from "@effect/vitest";
import { runOpsCli } from "../src/ops/Cli";
import {
  MissingOperatorSecretEnvError,
  StagingRequestError
} from "../src/ops/Errors";
import { OperatorSecret } from "../src/ops/OperatorSecret";
import { StagingOperatorClient } from "../src/ops/StagingOperatorClient";
import { WranglerCli } from "../src/ops/WranglerCli";
import { smokeFixtureUris } from "../src/staging/SmokeFixture";

const makeCliLayer = (options?: {
  readonly deploy?: (configFile: string, env: string) => Effect.Effect<void, never>;
  readonly client?: Layer.Layer<StagingOperatorClient>;
  readonly operatorSecretLayer?: Layer.Layer<OperatorSecret, unknown>;
}) => {
  const deployCalls: Array<{ readonly configFile: string; readonly env: string }> = [];
  const remoteCalls: Array<{ readonly action: string; readonly secret?: string }> = [];

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
    migrate: (_baseUrl: URL, secret: string) =>
      Effect.sync(() => {
        remoteCalls.push({ action: "migrate", secret });
        return { ok: true } as const;
      }),
    bootstrapExperts: (_baseUrl: URL, secret: string) =>
      Effect.sync(() => {
        remoteCalls.push({ action: "bootstrap", secret });
        return {
          domain: "energy",
          count: 1
        } as const;
      }),
    pollIngest: (_baseUrl: URL, secret: string) =>
      Effect.sync(() => {
        remoteCalls.push({ action: "poll", secret });
        return {
          runId: "run-1",
          mode: "head",
          startedAt: 1,
          finishedAt: 2,
          expertsTotal: 1,
          expertsSucceeded: 1,
          expertsFailed: 0,
          pagesFetched: 1,
          postsSeen: 1,
          postsStored: 1,
          postsDeleted: 0,
          failures: []
        } as const;
      }),
    loadSmokeFixture: (_baseUrl: URL, secret: string) =>
      Effect.sync(() => {
        remoteCalls.push({ action: "fixture", secret });
        return {
          posts: 2,
          links: 2,
          topics: 3
        } as const;
      }),
    listAdminExperts: (_baseUrl: URL, secret: string) =>
      Effect.sync(() => {
        remoteCalls.push({ action: "admin-experts", secret });
        return [{ did: "did:plc:test", domain: "energy" }] as const;
      }),
    listExpertsMcp: (_baseUrl: URL, secret: string) =>
      Effect.sync(() => {
        remoteCalls.push({ action: "mcp-list", secret });
        return [{ did: "did:plc:test", domain: "energy" }] as const;
      }),
    searchPostsMcp: (_baseUrl: URL, secret: string) =>
      Effect.sync(() => {
        remoteCalls.push({ action: "mcp-search", secret });
        return [{
          uri: smokeFixtureUris()[0],
          topics: ["solar"]
        }] as const;
      })
  });
  const operatorSecretLayer = options?.operatorSecretLayer ?? Layer.succeed(
    OperatorSecret,
    OperatorSecret.of({ value: "stage-secret" })
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
        { action: "poll", secret: "stage-secret" },
        { action: "fixture", secret: "stage-secret" }
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
        { action: "poll", secret: "stage-secret" },
        { action: "mcp-list", secret: "stage-secret" },
        { action: "mcp-search", secret: "stage-secret" }
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
            MissingOperatorSecretEnvError.make({
              envVar: "SKYGEST_OPERATOR_SECRET"
            })
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
            Effect.fail(StagingRequestError.make({
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
          pollIngest: (_baseUrl, _secret) =>
            Effect.succeed({
              runId: "run-1",
              mode: "head",
              startedAt: 1,
              finishedAt: 2,
              expertsTotal: 1,
              expertsSucceeded: 1,
              expertsFailed: 0,
              pagesFetched: 1,
              postsSeen: 1,
              postsStored: 1,
              postsDeleted: 0,
              failures: []
            } as const),
          loadSmokeFixture: (_baseUrl, _secret) =>
            Effect.succeed({
              posts: 2,
              links: 2,
              topics: 3
            } as const),
          listAdminExperts: (_baseUrl, _secret) =>
            Effect.succeed([{ did: "did:plc:test", domain: "energy" }] as const),
          listExpertsMcp: (_baseUrl, _secret) =>
            Effect.succeed([{ did: "did:plc:test", domain: "energy" }] as const),
          searchPostsMcp: (_baseUrl, _secret, _query) =>
            Effect.succeed([{
              uri: smokeFixtureUris()[0],
              topics: ["solar"]
            }] as const)
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
});
