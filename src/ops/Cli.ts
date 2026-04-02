import { Argument, Command, Flag } from "effect/unstable/cli";
import { Console, Effect, Option, Redacted, Stream } from "effect";
import { energySeedDid } from "../bootstrap/CheckedInExpertSeeds";
import type { ExpertTier } from "../domain/bi";
import type { CurationAction } from "../domain/curation";
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
import {
  normalizeTweet,
  normalizeTweetDetail,
  normalizeProfile
} from "./TwitterNormalizer";
import type {
  ScraperTweet,
  ScraperTweetDetailNode,
  ScraperProfile
} from "./TwitterNormalizer";
import { WranglerCli } from "./WranglerCli";

type TwitterPublicService = {
  readonly getProfile: (username: string) => Effect.Effect<ScraperProfile, unknown, never>;
  readonly getTweets: (
    username: string,
    options?: { readonly limit?: number }
  ) => Stream.Stream<ScraperTweet, unknown, never>;
};

type TwitterTweetsService = {
  readonly getTweet: (id: string) => Effect.Effect<{
    readonly focalTweetId: string;
    readonly tweets: ReadonlyArray<ScraperTweetDetailNode>;
  }, unknown, never>;
};

type TwitterPublicModule = {
  readonly TwitterPublic: Effect.Effect<TwitterPublicService, unknown, never>;
};

type TwitterTweetsModule = {
  readonly TwitterTweets: Effect.Effect<TwitterTweetsService, unknown, never>;
};

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
const curationActions = [
  "curate",
  "reject"
] as const;
const expertTiers = [
  "energy-focused",
  "general-outlet",
  "independent"
] as const;

const envOption = Flag.string("env").pipe(
  Flag.withDescription("Wrangler environment name"),
  Flag.withDefault("staging")
);

const workerOption = Flag.choice("worker", deployWorkers).pipe(
  Flag.withDescription("Worker selection"),
  Flag.withDefault("all")
);

const baseUrlOption = Flag.string("base-url").pipe(
  Flag.withDescription("Base workers.dev URL for the staging agent worker")
);

const enrichmentStatusOption = Flag.choice("status", enrichmentStatuses).pipe(
  Flag.withDescription("Filter enrichment runs by status"),
  Flag.withDefault("all")
);

const enrichmentLimitOption = Flag.integer("limit").pipe(
  Flag.withDescription("Maximum enrichment runs to show"),
  Flag.withDefault(20)
);

const runIdOption = Flag.string("run-id").pipe(
  Flag.withDescription("Run id")
);

const postUriOption = Flag.string("post-uri").pipe(
  Flag.withDescription("Post URI")
);

const curationActionOption = Flag.choice("action", curationActions).pipe(
  Flag.withDescription("Curation action"),
  Flag.withDefault("curate")
);

const noteOption = Flag.string("note").pipe(
  Flag.withDescription("Optional review note"),
  Flag.optional
);

const enrichmentTypeOption = Flag.choice("enrichment-type", enrichmentKinds).pipe(
  Flag.withDescription("Enrichment lane to run")
);

const schemaVersionOption = Flag.string("schema-version").pipe(
  Flag.withDescription("Schema version"),
  Flag.withDefault("auto")
);

const expectCondition = (condition: boolean, message: string) =>
  condition
    ? Effect.void
    : Effect.fail(new SmokeAssertionError({ message }));

const expectNonEmpty = <A>(items: ReadonlyArray<A>, message: string) =>
  items.length > 0
    ? Effect.succeed(items)
    : Effect.fail(new SmokeAssertionError({ message }));

const waitForIngestRun = Effect.fn("ops.waitForIngestRun")(function* (
  baseUrl: URL,
  secret: Redacted.Redacted<string>,
  did?: string
) {
  const client = yield* StagingOperatorClient;
  const queued = yield* client.pollIngest(baseUrl, secret, did);
  let iterState = { attempt: 0, run: null as IngestRunRecord | null };
  while (
    iterState.attempt < 30 &&
    (iterState.run === null || (iterState.run.status !== "complete" && iterState.run.status !== "failed"))
  ) {
    const run = yield* client.getIngestRun(baseUrl, secret, queued.runId);
    if (run.status !== "complete" && run.status !== "failed") {
      yield* Effect.sleep(1000);
    }
    iterState = { attempt: iterState.attempt + 1, run };
  }
  const finalState = iterState;

  if (finalState.run?.status === "complete") {
    return finalState.run;
  }

  if (finalState.run?.status === "failed") {
    return yield* new SmokeAssertionError({
      message: `ingest run ${finalState.run.id} failed: ${stringifyUnknown(finalState.run.error ?? "unknown error")}`
    });
  }

  return yield* new SmokeAssertionError({
    message: `ingest run ${queued.runId} did not finish within the expected window`
  });
});

const parseBaseUrl = Effect.fn("ops.parseBaseUrl")(function* (value: string) {
  return yield* Effect.try({
    try: () => new URL(value.endsWith("/") ? value : `${value}/`),
    catch: () =>
      new InvalidBaseUrlError({
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
      `Seeded ${result.seeded} publications (seed version ${result.snapshotVersion})`
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

const runStageCurate = (options: {
  readonly env: string;
  readonly baseUrl: string;
  readonly postUri: string;
  readonly action: CurationAction;
  readonly note: Option.Option<string>;
}) =>
  Effect.gen(function* () {
    const { value: secret } = yield* OperatorSecret;
    const client = yield* StagingOperatorClient;
    const baseUrl = yield* parseBaseUrl(options.baseUrl);
    const note = Option.getOrUndefined(options.note);

    yield* Console.log(`Curating ${options.postUri} on ${options.env} at ${options.baseUrl}`);
    const result = yield* client.curatePost(baseUrl, secret, {
      postUri: options.postUri,
      action: options.action,
      ...(note === undefined ? {} : { note })
    });

    yield* Console.log(
      `Post ${result.postUri}: ${String(result.previousStatus ?? "none")} -> ${result.newStatus}`
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

const curateCommand = Command.make(
  "curate",
  {
    env: envOption,
    baseUrl: baseUrlOption,
    postUri: postUriOption,
    action: curationActionOption,
    note: noteOption
  },
  runStageCurate
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
    curateCommand,
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

// ---------------------------------------------------------------------------
// Twitter import commands
// ---------------------------------------------------------------------------

const tierOption = Flag.choice("tier", expertTiers).pipe(
  Flag.withDescription("Expert tier classification")
);

const twitterLimitOption = Flag.integer("limit").pipe(
  Flag.withDescription("Maximum tweets to import"),
  Flag.withDefault(100)
);

const sinceOption = Flag.string("since").pipe(
  Flag.withDescription("Only import tweets after this ISO date"),
  Flag.optional
);

const handleArg = Argument.string("handle");
const tweetIdArg = Argument.string("tweet-id");

/**
 * Dynamically import the twitter scraper at runtime.
 * The scraper is not a compile-time dependency of skygest-cloudflare:
 * it lives in a sibling directory and is only available on the
 * operator's machine.
 */
const importScraper = <A>(modulePath: string) =>
  Effect.tryPromise({
    try: (): Promise<A> => import(/* @vite-ignore */ modulePath) as Promise<A>,
    catch: () =>
      new SmokeAssertionError({
        message: `Failed to import ${modulePath} — is better_twitter_scraper available?`
      })
  });

const SCRAPER_ROOT = process.env.TWITTER_SCRAPER_PATH ?? "/Users/pooks/Dev/better_twitter_scraper/src";

const loadTwitterPublic = (modulePath: string) =>
  importScraper<TwitterPublicModule>(modulePath).pipe(
    Effect.flatMap((module) => module.TwitterPublic)
  );

const loadTwitterTweets = (modulePath: string) =>
  importScraper<TwitterTweetsModule>(modulePath).pipe(
    Effect.flatMap((module) => module.TwitterTweets)
  );

const runTwitterAddExpert = (options: {
  readonly handle: string;
  readonly tier: ExpertTier;
  readonly baseUrl: string;
}) =>
  Effect.gen(function* () {
    const { value: secret } = yield* OperatorSecret;
    const client = yield* StagingOperatorClient;
    const baseUrl = yield* parseBaseUrl(options.baseUrl);

    yield* Console.log(`Fetching profile for @${options.handle}`);

    const twitter = yield* loadTwitterPublic(`${SCRAPER_ROOT}/public`);
    const profile = yield* twitter.getProfile(options.handle);

    const expert = normalizeProfile(profile, options.tier);
    if (expert === null) {
      yield* Console.log("Profile missing userId, skipping");
      return;
    }

    const result = yield* client.importPosts(baseUrl, secret, {
      experts: [expert],
      posts: []
    });

    yield* Console.log(
      `Added expert ${expert.did} (${expert.handle}) imported=${String(result.imported)} skipped=${String(result.skipped)}`
    );
  });

const runTwitterImportTimeline = (options: {
  readonly handle: string;
  readonly limit: number;
  readonly since: Option.Option<string>;
  readonly baseUrl: string;
}) =>
  Effect.gen(function* () {
    const { value: secret } = yield* OperatorSecret;
    const client = yield* StagingOperatorClient;
    const baseUrl = yield* parseBaseUrl(options.baseUrl);
    const sinceMs = Option.map(options.since, (s) => new Date(s).getTime()).pipe(
      Option.getOrUndefined
    );

    yield* Console.log(
      `Importing timeline for @${options.handle} (limit=${String(options.limit)})`
    );

    const twitter = yield* loadTwitterPublic(`${SCRAPER_ROOT}/public`);
    const profile = yield* twitter.getProfile(options.handle);

    const expert = normalizeProfile(profile, "independent");
    if (expert === null) {
      yield* Console.log("Profile missing userId, skipping");
      return;
    }

    const tweetStream = twitter.getTweets(options.handle, { limit: options.limit });
    const chunk = yield* Stream.runCollect(tweetStream);
    const tweets: ScraperTweet[] = [...chunk];

    const posts = tweets
      .map(normalizeTweet)
      .filter((p): p is NonNullable<typeof p> => p !== null)
      .filter((p) => sinceMs === undefined || p.createdAt >= sinceMs);

    yield* Console.log(`Normalized ${String(posts.length)} posts from ${String(tweets.length)} tweets`);

    const result = yield* client.importPosts(baseUrl, secret, {
      experts: [expert],
      posts
    });

    yield* Console.log(
      `Import complete: imported=${String(result.imported)} flagged=${String(result.flagged)} skipped=${String(result.skipped)}`
    );
  });

const runTwitterImportTweet = (options: {
  readonly tweetId: string;
  readonly baseUrl: string;
}) =>
  Effect.gen(function* () {
    const { value: secret } = yield* OperatorSecret;
    const client = yield* StagingOperatorClient;
    const baseUrl = yield* parseBaseUrl(options.baseUrl);

    yield* Console.log(`Importing tweet ${options.tweetId}`);

    const twitter = yield* loadTwitterPublic(`${SCRAPER_ROOT}/public`);
    const tweetsSvc = yield* loadTwitterTweets(`${SCRAPER_ROOT}/tweets`);

    // Get the detail document for this tweet
    const doc = yield* tweetsSvc.getTweet(options.tweetId);

    const focal = (doc.tweets as ScraperTweetDetailNode[]).find(
      (t) => t.id === doc.focalTweetId
    );
    if (!focal) {
      yield* Console.log("Focal tweet not found in detail document");
      return;
    }

    const post = normalizeTweetDetail(focal);
    if (post === null) {
      yield* Console.log("Tweet missing userId, skipping");
      return;
    }

    // Also fetch the profile so we can register the expert
    const profile = yield* twitter.getProfile(
      focal.username ?? focal.userId ?? ""
    );
    const expert = normalizeProfile(profile, "independent");

    const result = yield* client.importPosts(baseUrl, secret, {
      experts: expert !== null ? [expert] : [],
      posts: [post]
    });

    yield* Console.log(
      `Import complete: imported=${String(result.imported)} flagged=${String(result.flagged)} skipped=${String(result.skipped)}`
    );
  });

const twitterAddExpertCommand = Command.make(
  "add-expert",
  {
    handle: handleArg,
    tier: tierOption,
    baseUrl: baseUrlOption
  },
  ({ handle, tier, baseUrl }) =>
    runTwitterAddExpert({ handle, tier: tier as ExpertTier, baseUrl })
);

const twitterImportTimelineCommand = Command.make(
  "import-timeline",
  {
    handle: handleArg,
    limit: twitterLimitOption,
    since: sinceOption,
    baseUrl: baseUrlOption
  },
  ({ handle, limit, since, baseUrl }) =>
    runTwitterImportTimeline({ handle, limit, since, baseUrl })
);

const twitterImportTweetCommand = Command.make(
  "import-tweet",
  {
    tweetId: tweetIdArg,
    baseUrl: baseUrlOption
  },
  ({ tweetId, baseUrl }) =>
    runTwitterImportTweet({ tweetId, baseUrl })
);

const twitterCommand = Command.make("twitter", {}, () => Effect.void).pipe(
  Command.withSubcommands([
    twitterAddExpertCommand,
    twitterImportTimelineCommand,
    twitterImportTweetCommand
  ])
);

export const opsCommand = Command.make("ops", {}, () => Effect.void).pipe(
  Command.withSubcommands([deployCommand, stageCommand, twitterCommand])
);

const cli = Command.runWith(opsCommand, {
  version: "0.1.0"
});

export const runOpsCli = (argv: ReadonlyArray<string>) =>
  Effect.suspend(() => cli(Array.from(argv)));
