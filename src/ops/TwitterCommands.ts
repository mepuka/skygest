/**
 * Twitter-specific CLI command handlers and command definitions.
 *
 * This module is loaded dynamically (via `await import(...)`) from
 * Cli.ts so that the base ops CLI does not require `@pooks/twitter-scraper`
 * at module load time. Non-Twitter commands (stage, deploy, etc.) work
 * from a fresh checkout without the linked scraper package.
 */
import { Argument, Command, Flag } from "effect/unstable/cli";
import { Console, Effect, Option, Stream } from "effect";
import { TwitterPublic, TwitterTweets } from "@pooks/twitter-scraper";
import type { Tweet, TweetDetailNode } from "@pooks/twitter-scraper";
import type { ExpertTier } from "../domain/bi";
import { scraperLayer } from "./ScraperLayer";
import { InvalidBaseUrlError } from "./Errors";
import { OperatorSecret } from "./OperatorSecret";
import { StagingOperatorClient } from "./StagingOperatorClient";
import {
  normalizeTweet,
  normalizeTweetDetail,
  normalizeProfile
} from "./TwitterNormalizer";

// Re-export so the lazy importer in Cli.ts can use them for ingest-url
export { normalizeTweetDetail, normalizeProfile, scraperLayer };
export { TwitterPublic, TwitterTweets };
export type { TweetDetailNode };

// ---------------------------------------------------------------------------
// Shared options
// ---------------------------------------------------------------------------

const expertTiers = [
  "energy-focused",
  "general-outlet",
  "independent"
] as const;

const baseUrlOption = Flag.string("base-url").pipe(
  Flag.withDescription("Base workers.dev URL for the staging agent worker")
);

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

// ---------------------------------------------------------------------------
// Helpers (duplicated from Cli.ts to avoid circular dependency)
// ---------------------------------------------------------------------------

const parseBaseUrl = Effect.fn("ops.parseBaseUrl")(function* (value: string) {
  return yield* Effect.try({
    try: () => new URL(value.endsWith("/") ? value : `${value}/`),
    catch: () => new InvalidBaseUrlError({ value })
  });
});

// ---------------------------------------------------------------------------
// Twitter command handlers
// ---------------------------------------------------------------------------

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

    const profile = yield* Effect.gen(function* () {
      const twitter = yield* TwitterPublic;
      return yield* twitter.getProfile(options.handle);
    }).pipe(Effect.provide(scraperLayer));

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

    const { profile, tweets } = yield* Effect.gen(function* () {
      const twitter = yield* TwitterPublic;
      const profile = yield* twitter.getProfile(options.handle);
      const tweetStream = twitter.getTweets(options.handle, { limit: options.limit });
      const chunk = yield* Stream.runCollect(tweetStream);
      return { profile, tweets: [...chunk] as Tweet[] };
    }).pipe(Effect.provide(scraperLayer));

    const expert = normalizeProfile(profile, "independent");
    if (expert === null) {
      yield* Console.log("Profile missing userId, skipping");
      return;
    }

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

    const { focal, profile } = yield* Effect.gen(function* () {
      const twitter = yield* TwitterPublic;
      const tweetsSvc = yield* TwitterTweets;

      const doc = yield* tweetsSvc.getTweet(options.tweetId);
      const focal = doc.tweets.find((t: TweetDetailNode) => t.id === doc.focalTweetId);
      if (!focal) return { focal: null as TweetDetailNode | null, profile: null as any };

      const profile = yield* twitter.getProfile(focal.username ?? focal.userId ?? "");
      return { focal, profile };
    }).pipe(Effect.provide(scraperLayer));

    if (!focal) {
      yield* Console.log("Focal tweet not found in detail document");
      return;
    }

    const post = normalizeTweetDetail(focal);
    if (post === null) {
      yield* Console.log("Tweet missing userId, skipping");
      return;
    }

    const expert = normalizeProfile(profile, "independent");

    const result = yield* client.importPosts(baseUrl, secret, {
      experts: expert !== null ? [expert] : [],
      posts: [post]
    });

    yield* Console.log(
      `Import complete: imported=${String(result.imported)} flagged=${String(result.flagged)} skipped=${String(result.skipped)}`
    );
  });

// ---------------------------------------------------------------------------
// Command definitions
// ---------------------------------------------------------------------------

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

export const twitterCommand = Command.make("twitter", {}, () => Effect.void).pipe(
  Command.withSubcommands([
    twitterAddExpertCommand,
    twitterImportTimelineCommand,
    twitterImportTweetCommand
  ])
);
