import { Command, Options } from "@effect/cli";
import { Console, Effect } from "effect";
import { energySeedDid } from "../bootstrap/CheckedInExpertSeeds";
import type { IngestRunRecord } from "../domain/polling";
import { stringifyUnknown } from "../platform/Json";
import { smokeFixtureUris, smokeSearchQuery } from "../staging/SmokeFixture";
import {
  InvalidBaseUrlError,
  SmokeAssertionError
} from "./Errors";
import { OperatorSecret } from "./OperatorSecret";
import { StagingOperatorClient } from "./StagingOperatorClient";
import { WranglerCli } from "./WranglerCli";

const deployWorkers = [
  "all",
  "ingest",
  "agent"
] as const;

type DeployWorker = typeof deployWorkers[number];

const envOption = Options.text("env").pipe(
  Options.withDescription("Wrangler environment name"),
  Options.withDefault("staging")
);

const workerOption = Options.choice("worker", deployWorkers).pipe(
  Options.withDescription("Worker selection"),
  Options.withDefault("all")
);

const baseUrlOption = Options.text("base-url").pipe(
  Options.withDescription("Base workers.dev URL for the staging agent worker")
);

const expectCondition = (condition: boolean, message: string) =>
  condition
    ? Effect.void
    : SmokeAssertionError.make({ message });

const expectNonEmpty = <A>(items: ReadonlyArray<A>, message: string) =>
  items.length > 0
    ? Effect.succeed(items)
    : SmokeAssertionError.make({ message });

const waitForIngestRun = Effect.fn("ops.waitForIngestRun")(function* (
  baseUrl: URL,
  secret: string,
  did?: string
) {
  const client = yield* StagingOperatorClient;
  const queued = yield* client.pollIngest(baseUrl, secret, did);
  const finalState = yield* Effect.iterate(
    {
      attempt: 0,
      run: null as IngestRunRecord | null
    },
    {
      while: ({ attempt, run }) =>
        attempt < 30 && (run === null || (run.status !== "complete" && run.status !== "failed")),
      body: ({ attempt }) =>
        client.getIngestRun(baseUrl, secret, queued.runId).pipe(
          Effect.tap((run) =>
            run.status === "complete" || run.status === "failed"
              ? Effect.void
              : Effect.sleep(1000)
          ),
          Effect.map((run) => ({
            attempt: attempt + 1,
            run
          }))
        )
    }
  );

  if (finalState.run?.status === "complete") {
    return finalState.run;
  }

  if (finalState.run?.status === "failed") {
    return yield* SmokeAssertionError.make({
      message: `ingest run ${finalState.run.id} failed: ${stringifyUnknown(finalState.run.error ?? "unknown error")}`
    });
  }

  return yield* SmokeAssertionError.make({
    message: `ingest run ${queued.runId} did not finish within the expected window`
  });
});

const parseBaseUrl = Effect.fn("ops.parseBaseUrl")(function* (value: string) {
  return yield* Effect.try({
    try: () => new URL(value.endsWith("/") ? value : `${value}/`),
    catch: () =>
      InvalidBaseUrlError.make({
        value
      })
  });
});

const deploySelection = (env: string, worker: DeployWorker) =>
  Effect.gen(function* () {
    const wrangler = yield* WranglerCli;
    const targets = worker === "all"
      ? [
        ["ingest", "wrangler.toml"],
        ["agent", "wrangler.agent.toml"]
      ] as const
      : [[worker, worker === "ingest" ? "wrangler.toml" : "wrangler.agent.toml"]] as const;

    yield* Effect.forEach(
      targets,
      ([label, configFile]) =>
        Effect.gen(function* () {
          yield* Console.log(`Deploying ${label} worker to ${env}`);
          yield* wrangler.deploy(configFile, env);
        }),
      { discard: true }
    );
  });

const runStagePrepare = (options: {
  readonly env: string;
  readonly baseUrl: string;
}) =>
  Effect.gen(function* () {
    const { value: secret } = yield* OperatorSecret;
    const client = yield* StagingOperatorClient;
    const baseUrl = yield* parseBaseUrl(options.baseUrl);

    yield* Console.log(`Preparing ${options.env} staging at ${options.baseUrl}`);
    yield* client.migrate(baseUrl, secret);
    const bootstrap = yield* client.bootstrapExperts(baseUrl, secret);
    yield* waitForIngestRun(baseUrl, secret, energySeedDid);
    const fixture = yield* client.loadSmokeFixture(baseUrl, secret);

    yield* Console.log(
      `Prepared ${bootstrap.count} experts and ${fixture.posts} smoke posts`
    );
  });

const runStageSmoke = (options: {
  readonly env: string;
  readonly baseUrl: string;
}) =>
  Effect.gen(function* () {
    const { value: secret } = yield* OperatorSecret;
    const client = yield* StagingOperatorClient;
    const baseUrl = yield* parseBaseUrl(options.baseUrl);
    const expectedUri = smokeFixtureUris()[0];

    yield* Console.log(`Running ${options.env} smoke checks at ${options.baseUrl}`);

    const health = yield* client.health(baseUrl);
    yield* expectCondition(
      health.trim() === "ok",
      `expected /health to return ok, received: ${health}`
    );

    yield* client.listAdminExperts(baseUrl, secret).pipe(
      Effect.flatMap((items) =>
        expectNonEmpty(
          items,
          "expected /admin/experts to return at least one expert"
        )
      )
    );

    yield* waitForIngestRun(baseUrl, secret, energySeedDid).pipe(
      Effect.flatMap((summary) =>
        expectCondition(
          summary.totalExperts > 0,
          "expected /admin/ingest/poll to cover at least one expert"
        )
      )
    );

    yield* client.listExpertsMcp(baseUrl, secret).pipe(
      Effect.flatMap((items) =>
        expectNonEmpty(
          items,
          "expected MCP list_experts to return at least one expert"
        )
      )
    );

    const searchResults = yield* client.searchPostsMcp(
      baseUrl,
      secret,
      smokeSearchQuery
    );
    const matched = searchResults.find((result) => result.uri === expectedUri);

    yield* expectCondition(
      matched !== undefined && matched.topics.includes("solar"),
      "expected MCP search_posts to return the deterministic smoke fixture hit"
    );

    yield* Console.log("Smoke checks passed");
  });

const runStageRepair = (options: {
  readonly env: string;
  readonly baseUrl: string;
}) =>
  Effect.gen(function* () {
    const { value: secret } = yield* OperatorSecret;
    const client = yield* StagingOperatorClient;
    const baseUrl = yield* parseBaseUrl(options.baseUrl);

    yield* Console.log(`Repairing ${options.env} ingest state at ${options.baseUrl}`);
    const summary = yield* client.repairIngest(baseUrl, secret);

    yield* Console.log(
      `Repair summary: repairedRuns=${summary.repairedRuns} failedItems=${summary.failedItems} requeuedItems=${summary.requeuedItems} untouchedRuns=${summary.untouchedRuns}`
    );
  });

const deployCommand = Command.make(
  "deploy",
  { env: envOption, worker: workerOption },
  ({ env, worker }) => deploySelection(env, worker as DeployWorker)
);

const prepareCommand = Command.make(
  "prepare",
  { env: envOption, baseUrl: baseUrlOption },
  runStagePrepare
);

const smokeCommand = Command.make(
  "smoke",
  { env: envOption, baseUrl: baseUrlOption },
  runStageSmoke
);

const repairCommand = Command.make(
  "repair",
  { env: envOption, baseUrl: baseUrlOption },
  runStageRepair
);

const stageCommand = Command.make("stage", {}, () => Effect.void).pipe(
  Command.withSubcommands([prepareCommand, smokeCommand, repairCommand])
);

export const opsCommand = Command.make("ops", {}, () => Effect.void).pipe(
  Command.withSubcommands([deployCommand, stageCommand])
);

const cli = Command.run(opsCommand, {
  name: "Skygest Ops",
  version: "0.1.0"
});

export const runOpsCli = (argv: ReadonlyArray<string>) =>
  Effect.suspend(() => cli(Array.from(argv)));
