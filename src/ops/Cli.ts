import type { FileSystem } from "effect/FileSystem";
import type { Path } from "effect/Path";
import type { Stdio } from "effect/Stdio";
import type { Terminal } from "effect/Terminal";
import { Argument, Command, Flag } from "effect/unstable/cli";
import type { ChildProcessSpawner } from "effect/unstable/process/ChildProcessSpawner";
import { Console, Effect, Layer, Option, Redacted, Stream } from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import { BlueskyClient, makeBlueskyClient } from "../bluesky/BlueskyClient";
import { parsePostUrl, SUPPORTED_FORMATS } from "../domain/ingestUrl";
import { normalizeBlueskyThread } from "./BlueskyNormalizer";
import { energySeedDid } from "../bootstrap/CheckedInExpertSeeds";
import type { ExpertTier } from "../domain/bi";
import type { CurationAction } from "../domain/curation";
import {
  defaultSchemaVersionForEnrichmentKind,
  WorkflowEnrichmentKind
} from "../domain/enrichment";
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

const blueskyCliLayer = Layer.effect(
  BlueskyClient,
  makeBlueskyClient("https://public.api.bsky.app")
).pipe(Layer.provide(FetchHttpClient.layer));

const deployWorkers = [
  "all",
  "ingest",
  "agent",
  "resolver"
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
] as const satisfies ReadonlyArray<WorkflowEnrichmentKind>;
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

const ingestTierOption = Flag.choice("tier", expertTiers).pipe(
  Flag.withDescription("Expert tier (default: energy-focused)"),
  Flag.withDefault("energy-focused")
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
        ["agent", "wrangler.agent.toml"],
        ["resolver", "wrangler.resolver.toml"]
      ] as const
      : [[
          worker,
          worker === "ingest"
            ? "wrangler.toml"
            : worker === "agent"
              ? "wrangler.agent.toml"
              : "wrangler.resolver.toml"
        ]] as const;

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
// Twitter import commands — lazy-loaded to avoid top-level @pooks/twitter-scraper dependency
// ---------------------------------------------------------------------------

/**
 * Dynamically import the Twitter scraper module. Called only from command
 * handlers that actually need it (twitter subcommands, ingest-url for tweets).
 */
const loadTwitterModule = () => import("./TwitterCommands");

// ---------------------------------------------------------------------------
// ingest-url command
// ---------------------------------------------------------------------------

const runIngestUrl = (options: {
  readonly url: string;
  readonly baseUrl: string;
  readonly tier: string;
  readonly note: Option.Option<string>;
}) =>
  Effect.gen(function* () {
    const { value: secret } = yield* OperatorSecret;
    const client = yield* StagingOperatorClient;
    const baseUrl = yield* parseBaseUrl(options.baseUrl);
    const note = Option.getOrUndefined(options.note);

    const parsedOpt = parsePostUrl(options.url);
    if (Option.isNone(parsedOpt)) {
      yield* Console.log(`Unsupported URL format: ${options.url}\n${SUPPORTED_FORMATS}`);
      return;
    }
    const parsed = parsedOpt.value;
    yield* Console.log(`Ingesting ${parsed.platform} post: ${options.url}`);

    let importInput: any;

    if (parsed.platform === "twitter") {
      // Lazy-load the Twitter scraper module on demand
      const tw = yield* Effect.promise(loadTwitterModule);

      // Fetch via scraper (same pattern as runTwitterImportTweet)
      const { focal, profile } = yield* Effect.gen(function* () {
        const twitter = yield* tw.TwitterPublic;
        const tweetsSvc = yield* tw.TwitterTweets;
        const doc = yield* tweetsSvc.getTweet(parsed.id);
        const focal = doc.tweets.find((t: any) => t.id === doc.focalTweetId);
        if (!focal) return { focal: null as any, profile: null as any };
        const profile = yield* twitter.getProfile(focal.username ?? focal.userId ?? "");
        return { focal, profile };
      }).pipe(Effect.provide(tw.scraperLayer));

      if (!focal) {
        yield* Console.log("Tweet not found");
        return;
      }

      const post = tw.normalizeTweetDetail(focal);
      if (post === null) {
        yield* Console.log("Tweet missing userId, skipping");
        return;
      }

      const expert = tw.normalizeProfile(profile, options.tier as ExpertTier);
      importInput = {
        experts: expert !== null ? [expert] : [],
        posts: [post],
        operatorOverride: true
      };
    } else {
      // Fetch via Bluesky public API
      const normalized = yield* Effect.gen(function* () {
        const bsky = yield* BlueskyClient;
        const resolved = yield* bsky.resolveDidOrHandle(parsed.handle);
        const atUri = `at://${resolved.did}/app.bsky.feed.post/${parsed.id}`;
        const thread = yield* bsky.getPostThread(atUri, { depth: 0, parentHeight: 0 });
        return normalizeBlueskyThread(thread, options.tier);
      }).pipe(Effect.provide(blueskyCliLayer));

      if (Option.isNone(normalized)) {
        yield* Console.log("Could not extract post from Bluesky thread");
        return;
      }
      const { post, expert } = normalized.value;

      importInput = {
        experts: [expert],
        posts: [post],
        operatorOverride: true
      };
    }

    // Import
    const importResult = yield* client.importPosts(baseUrl, secret, importInput);
    const wasNew = importResult.imported > 0;
    yield* Console.log(
      wasNew
        ? `Imported: ${String(importResult.imported)} post(s), ${String(importResult.flagged)} flagged`
        : `Post already exists (skipped import)`
    );

    // Curate (enrichment starts automatically inside curatePost)
    const postUri = importInput.posts[0].uri;
    const curateResult = yield* client.curatePost(baseUrl, secret, {
      postUri,
      action: "curate",
      ...(note === undefined ? {} : { note })
    });

    const stateChanged = curateResult.previousStatus !== curateResult.newStatus;
    yield* Console.log(
      stateChanged
        ? `Curated: ${String(curateResult.previousStatus ?? "none")} → ${curateResult.newStatus}`
        : `Already curated (no change)`
    );

    yield* Console.log(
      `Done. URI: ${postUri}\n` +
      `To start enrichment: use start_enrichment MCP tool or ops stage enrichment-start --post-uri "${postUri}"`
    );
  });

const urlArg = Argument.string("url");

const ingestUrlCommand = Command.make(
  "ingest-url",
  {
    url: urlArg,
    tier: ingestTierOption,
    note: noteOption,
    baseUrl: baseUrlOption
  },
  ({ url, tier, note, baseUrl }) =>
    runIngestUrl({ url, tier: tier as string, note, baseUrl })
);

/**
 * Build the full ops command tree. The twitter subcommands are loaded lazily
 * via dynamic import so the base CLI never requires @pooks/twitter-scraper.
 */
const buildOpsCommand = async () => {
  const base = Command.make("ops", {}, () => Effect.void);

  // Try to load twitter commands; if the scraper package isn't available,
  // register a placeholder that tells the user.
  let twitterCmd;
  try {
    const tw = await import("./TwitterCommands");
    twitterCmd = tw.twitterCommand;
  } catch {
    twitterCmd = Command.make("twitter", {}, () =>
      Console.log("Twitter commands require @pooks/twitter-scraper (bun link @pooks/twitter-scraper)")
    );
  }

  return Command.withSubcommands(base, [
    deployCommand,
    stageCommand,
    twitterCmd,
    ingestUrlCommand
  ]);
};

let _opsCommandPromise: ReturnType<typeof buildOpsCommand> | null = null;
const getOpsCommand = () => {
  if (_opsCommandPromise === null) {
    _opsCommandPromise = buildOpsCommand();
  }
  return _opsCommandPromise;
};

// Static export for tests that import the command tree directly
export const opsCommand = Command.make("ops", {}, () => Effect.void).pipe(
  Command.withSubcommands([deployCommand, stageCommand, ingestUrlCommand])
);

type OpsCliEnv =
  | ChildProcessSpawner
  | FileSystem
  | Path
  | Stdio
  | Terminal
  | OperatorSecret
  | StagingOperatorClient
  | WranglerCli;

export const runOpsCli = (
  argv: ReadonlyArray<string>
): Effect.Effect<void, unknown, OpsCliEnv> =>
  Effect.suspend(() =>
    Effect.promise(getOpsCommand).pipe(
      Effect.flatMap((cmd) =>
        Command.runWith(cmd, { version: "0.1.0" })(Array.from(argv).slice(2))
      )
    )
  );
