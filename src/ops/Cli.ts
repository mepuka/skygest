import { Command, Options } from "@effect/cli";
import { Console, Effect } from "effect";
import { energySeedDid } from "../bootstrap/CheckedInExpertSeeds";
import { defaultSchemaVersionForEnrichmentKind } from "../domain/enrichment";
import type { EnrichmentRunRecord } from "../domain/enrichmentRun";
import type { IngestRunRecord } from "../domain/polling";
import { stringifyUnknown } from "../platform/Json";
import { smokeFixtureUris, smokeSearchQuery } from "../staging/SmokeFixture";
import {
  InvalidBaseUrlError,
  SmokeAssertionError
} from "./Errors";
import { OperatorSecret } from "./OperatorSecret";
import { runSearchSmokeChecks } from "./SearchSmokeRunner";
import { StagingOperatorClient } from "./StagingOperatorClient";
import { WranglerCli } from "./WranglerCli";

const deployWorkers = [
  "all",
  "ingest",
  "agent"
] as const;

type DeployWorker = typeof deployWorkers[number];
const enrichmentStatuses = [
  "all",
  "queued",
  "running",
  "complete",
  "failed",
  "needs-review"
] as const;
const enrichmentKinds = [
  "vision",
  "source-attribution",
  "grounding"
] as const;

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

const enrichmentStatusOption = Options.choice("status", enrichmentStatuses).pipe(
  Options.withDescription("Filter enrichment runs by status"),
  Options.withDefault("all")
);

const enrichmentLimitOption = Options.integer("limit").pipe(
  Options.withDescription("Maximum enrichment runs to show"),
  Options.withDefault(20)
);

const runIdOption = Options.text("run-id").pipe(
  Options.withDescription("Run id")
);

const postUriOption = Options.text("post-uri").pipe(
  Options.withDescription("Post URI")
);

const enrichmentTypeOption = Options.choice("enrichment-type", enrichmentKinds).pipe(
  Options.withDescription("Enrichment lane to run")
);

const schemaVersionOption = Options.text("schema-version").pipe(
  Options.withDescription("Schema version"),
  Options.withDefault("auto")
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

const runStageStats = (options: {
  readonly env: string;
  readonly baseUrl: string;
}) =>
  Effect.gen(function* () {
    const { value: secret } = yield* OperatorSecret;
    const client = yield* StagingOperatorClient;
    const baseUrl = yield* parseBaseUrl(options.baseUrl);

    yield* Console.log(`Fetching stats for ${options.env} at ${options.baseUrl}`);
    const stats = yield* client.getStats(baseUrl, secret);

    yield* Console.log("");
    yield* Console.log("Experts");
    yield* Console.log(`  total: ${String(stats.experts.total)}  active: ${String(stats.experts.active)}`);

    yield* Console.log("");
    yield* Console.log("Posts");
    yield* Console.log(`  total: ${String(stats.posts.total)}  last 24h: ${String(stats.posts.inLast24h)}  with links: ${String(stats.posts.withLinks)}`);

    yield* Console.log("");
    yield* Console.log("Curation");
    yield* Console.log(`  flagged: ${String(stats.curation.flagged)}  curated: ${String(stats.curation.curated)}  rejected: ${String(stats.curation.rejected)}`);

    yield* Console.log("");
    yield* Console.log("Enrichment Runs");
    yield* Console.log(`  queued: ${String(stats.enrichment.queued)}  running: ${String(stats.enrichment.running)}  complete: ${String(stats.enrichment.complete)}  failed: ${String(stats.enrichment.failed)}  needs-review: ${String(stats.enrichment.needsReview)}`);

    if (stats.lastIngest !== null) {
      yield* Console.log("");
      yield* Console.log("Last Ingest");
      yield* Console.log(`  run: ${stats.lastIngest.runId}`);
      yield* Console.log(`  kind: ${stats.lastIngest.kind}  status: ${stats.lastIngest.status}`);
      yield* Console.log(`  posts seen: ${String(stats.lastIngest.postsSeen)}  stored: ${String(stats.lastIngest.postsStored)}`);
      yield* Console.log(`  started: ${new Date(stats.lastIngest.startedAt).toISOString()}`);
      if (stats.lastIngest.finishedAt !== null) {
        yield* Console.log(`  finished: ${new Date(stats.lastIngest.finishedAt).toISOString()}`);
      }
    }
  });

const runSeedPublications = (options: {
  readonly env: string;
  readonly baseUrl: string;
}) =>
  Effect.gen(function* () {
    const { value: secret } = yield* OperatorSecret;
    const client = yield* StagingOperatorClient;
    const baseUrl = yield* parseBaseUrl(options.baseUrl);

    yield* Console.log(`Seeding publications for ${options.env} at ${options.baseUrl}`);
    const result = yield* client.seedPublications(baseUrl, secret);

    yield* Console.log(
      `Seeded ${result.seeded} publications (snapshot ${result.snapshotVersion})`
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

    const publications = yield* client.listPublications(baseUrl, secret);
    yield* expectNonEmpty(
      publications,
      "expected /api/publications to return at least one publication"
    );

    const energyPubs = publications.filter((p) => p.tier === "energy-focused");
    yield* expectCondition(
      energyPubs.length >= 30,
      `expected at least 30 energy-focused publications, got ${energyPubs.length}`
    );

    yield* Console.log("Smoke checks passed");
  });

const runStageRefreshProfiles = (options: {
  readonly env: string;
  readonly baseUrl: string;
}) =>
  Effect.gen(function* () {
    const { value: secret } = yield* OperatorSecret;
    const client = yield* StagingOperatorClient;
    const baseUrl = yield* parseBaseUrl(options.baseUrl);

    yield* Console.log(`Refreshing expert profiles at ${options.baseUrl}`);
    const result = yield* client.refreshProfiles(baseUrl, secret);

    yield* Console.log(
      `Refreshed profiles: updated=${String(result.updated)} failed=${String(result.failed)}`
    );
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

const formatMaybeTimestamp = (value: number | null) =>
  value === null ? "none" : String(value);

const formatEnrichmentRunLine = (run: EnrichmentRunRecord) =>
  [
    run.id,
    `type=${run.enrichmentType}`,
    `status=${run.status}`,
    `phase=${run.phase}`,
    `attempts=${String(run.attemptCount)}`,
    `lastProgress=${formatMaybeTimestamp(run.lastProgressAt)}`
  ].join(" ");

const formatMaybeText = (value: string | null | undefined) =>
  value ?? "none";

const formatEnrichmentRunDetail = (run: EnrichmentRunRecord) => [
  `runId=${run.id}`,
  `workflowInstanceId=${run.workflowInstanceId}`,
  `postUri=${run.postUri}`,
  `type=${run.enrichmentType}`,
  `schemaVersion=${run.schemaVersion}`,
  `triggeredBy=${run.triggeredBy}`,
  `requestedBy=${formatMaybeText(run.requestedBy)}`,
  `status=${run.status}`,
  `phase=${run.phase}`,
  `attempts=${String(run.attemptCount)}`,
  `modelLane=${formatMaybeText(run.modelLane)}`,
  `promptVersion=${formatMaybeText(run.promptVersion)}`,
  `inputFingerprint=${formatMaybeText(run.inputFingerprint)}`,
  `startedAt=${String(run.startedAt)}`,
  `finishedAt=${formatMaybeTimestamp(run.finishedAt)}`,
  `lastProgressAt=${formatMaybeTimestamp(run.lastProgressAt)}`,
  `resultWrittenAt=${formatMaybeTimestamp(run.resultWrittenAt)}`,
  `error=${run.error === null ? "none" : stringifyUnknown(run.error)}`
];

const runStageEnrichmentRuns = (options: {
  readonly env: string;
  readonly baseUrl: string;
  readonly status: typeof enrichmentStatuses[number];
  readonly limit: number;
}) =>
  Effect.gen(function* () {
    const { value: secret } = yield* OperatorSecret;
    const client = yield* StagingOperatorClient;
    const baseUrl = yield* parseBaseUrl(options.baseUrl);

    yield* Console.log(
      `Listing enrichment runs for ${options.env} at ${options.baseUrl}`
    );
    const runs = yield* client.listEnrichmentRuns(baseUrl, secret, {
      ...(options.status === "all" ? {} : { status: options.status }),
      limit: options.limit
    });

    if (runs.length === 0) {
      yield* Console.log("No enrichment runs found");
      return;
    }

    yield* Effect.forEach(
      runs,
      (run) => Console.log(formatEnrichmentRunLine(run)),
      { discard: true }
    );
  });

const runStageEnrichmentRun = (options: {
  readonly env: string;
  readonly baseUrl: string;
  readonly runId: string;
}) =>
  Effect.gen(function* () {
    const { value: secret } = yield* OperatorSecret;
    const client = yield* StagingOperatorClient;
    const baseUrl = yield* parseBaseUrl(options.baseUrl);

    yield* Console.log(
      `Loading enrichment run ${options.runId} from ${options.baseUrl}`
    );
    const run = yield* client.getEnrichmentRun(baseUrl, secret, options.runId);

    yield* Effect.forEach(
      formatEnrichmentRunDetail(run),
      (line) => Console.log(line),
      { discard: true }
    );
  });

const runStageEnrichmentRetry = (options: {
  readonly env: string;
  readonly baseUrl: string;
  readonly runId: string;
}) =>
  Effect.gen(function* () {
    const { value: secret } = yield* OperatorSecret;
    const client = yield* StagingOperatorClient;
    const baseUrl = yield* parseBaseUrl(options.baseUrl);

    const queued = yield* client.retryEnrichment(baseUrl, secret, options.runId);
    yield* Console.log(
      `Retried enrichment run ${queued.runId}; workflow status is ${queued.status}`
    );
  });

const runStageEnrichmentRepair = (options: {
  readonly env: string;
  readonly baseUrl: string;
}) =>
  Effect.gen(function* () {
    const { value: secret } = yield* OperatorSecret;
    const client = yield* StagingOperatorClient;
    const baseUrl = yield* parseBaseUrl(options.baseUrl);

    const summary = yield* client.repairEnrichment(baseUrl, secret);
    yield* Console.log(
      `Enrichment repair summary: repairedRuns=${summary.repairedRuns} staleQueuedRuns=${summary.staleQueuedRuns} staleRunningRuns=${summary.staleRunningRuns} untouchedRuns=${summary.untouchedRuns}`
    );
  });

const runStageEnrichmentStart = (options: {
  readonly env: string;
  readonly baseUrl: string;
  readonly postUri: string;
  readonly enrichmentType: typeof enrichmentKinds[number];
  readonly schemaVersion: string;
}) =>
  Effect.gen(function* () {
    const { value: secret } = yield* OperatorSecret;
    const client = yield* StagingOperatorClient;
    const baseUrl = yield* parseBaseUrl(options.baseUrl);

    const queued = yield* client.startEnrichment(baseUrl, secret, {
      postUri: options.postUri,
      enrichmentType: options.enrichmentType,
      schemaVersion:
        options.schemaVersion === "auto"
          ? defaultSchemaVersionForEnrichmentKind(options.enrichmentType)
          : options.schemaVersion
    });

    yield* Console.log(
      `Queued ${options.enrichmentType} enrichment for ${options.postUri} as run ${queued.runId}`
    );
  });

const deployCommand = Command.make(
  "deploy",
  { env: envOption, worker: workerOption },
  ({ env, worker }) => deploySelection(env, worker as DeployWorker)
);

const statsCommand = Command.make(
  "stats",
  { env: envOption, baseUrl: baseUrlOption },
  runStageStats
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

const refreshProfilesCommand = Command.make(
  "refresh-profiles",
  { env: envOption, baseUrl: baseUrlOption },
  runStageRefreshProfiles
);

const repairCommand = Command.make(
  "repair",
  { env: envOption, baseUrl: baseUrlOption },
  runStageRepair
);

const enrichmentRunsCommand = Command.make(
  "enrichment-runs",
  {
    env: envOption,
    baseUrl: baseUrlOption,
    status: enrichmentStatusOption,
    limit: enrichmentLimitOption
  },
  runStageEnrichmentRuns
);

const enrichmentStartCommand = Command.make(
  "enrichment-start",
  {
    env: envOption,
    baseUrl: baseUrlOption,
    postUri: postUriOption,
    enrichmentType: enrichmentTypeOption,
    schemaVersion: schemaVersionOption
  },
  runStageEnrichmentStart
);

const enrichmentRunCommand = Command.make(
  "enrichment-run",
  { env: envOption, baseUrl: baseUrlOption, runId: runIdOption },
  runStageEnrichmentRun
);

const enrichmentRetryCommand = Command.make(
  "enrichment-retry",
  { env: envOption, baseUrl: baseUrlOption, runId: runIdOption },
  runStageEnrichmentRetry
);

const enrichmentRepairCommand = Command.make(
  "enrichment-repair",
  { env: envOption, baseUrl: baseUrlOption },
  runStageEnrichmentRepair
);

const smokeSearchCommand = Command.make(
  "smoke-search",
  { env: envOption, baseUrl: baseUrlOption },
  (options) =>
    Effect.gen(function* () {
      const baseUrl = yield* parseBaseUrl(options.baseUrl);
      yield* runSearchSmokeChecks(baseUrl);
    })
);

const seedPublicationsCommand = Command.make(
  "seed-publications",
  { env: envOption, baseUrl: baseUrlOption },
  runSeedPublications
);

const stageCommand = Command.make("stage", {}, () => Effect.void).pipe(
  Command.withSubcommands([
    statsCommand,
    prepareCommand,
    smokeCommand,
    smokeSearchCommand,
    refreshProfilesCommand,
    repairCommand,
    enrichmentRunsCommand,
    enrichmentStartCommand,
    enrichmentRunCommand,
    enrichmentRetryCommand,
    enrichmentRepairCommand,
    seedPublicationsCommand
  ])
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
