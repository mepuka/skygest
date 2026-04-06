# SKY-180: Editorial Twitter Ingestion Scripts

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Give the editorial workspace (`skygest-editorial`) full local Twitter ingestion capabilities — import from URL, bookmarks, timeline, and search — as a unified Effect CLI application with typed commands, shared flags, and composable layers.

**Architecture:** A single CLI entry point (`scripts/twitter.ts`) with subcommands, mirroring the proven `ops` CLI architecture in `skygest-cloudflare/src/ops/Cli.ts`. Uses `Command`, `Flag`, and `Argument` from `effect/unstable/cli` for fully typed argument parsing with auto-generated `--help`. Config validation, scraper layer provision, cookie restoration, and import client setup are shared infrastructure wired via `Command.withSharedFlags` and scoped `Effect.provide` — not duplicated per command. Handler functions are standalone `Effect.gen` generators following the ops CLI pattern.

**Tech Stack:** Effect 4 (`effect/unstable/cli`), `@pooks/twitter-scraper` (`file:` dependency), Bun, `@skygest/domain/*`, `@skygest/platform/*`, and `@skygest/ops/*` path mappings from `skygest-cloudflare`.

**Repos:** Changes span both `skygest-cloudflare` (config shapes) and `skygest-editorial` (CLI, layers, docs).

**Revision history:**
- v1: Separate scripts with manual `process.argv` parsing
- v2 (current): Unified Effect CLI with typed commands, shared flags, composable layers. Research: Effect CLI API lives at `effect/unstable/cli` and is already used in `skygest-cloudflare/src/ops/Cli.ts`

---

## Completed Tasks (from v1)

These tasks are already implemented and remain valid:

- **Task 1:** `TwitterKeys` added to `ConfigShapes.ts` — commits `616b6dc`, `1941156` (skygest-cloudflare)
- **Task 2:** `@skygest/ops/*` path mapping + `file:` scraper dependency — commit `931f71d` (skygest-editorial)
- **Task 3:** `ScraperLayer.ts` — commit `0b48256` (skygest-editorial)
- **Task 4:** `ImportClient.ts` — commit `a4146c9` (skygest-editorial)

---

## Task 5: Build the unified Twitter CLI

Replace the standalone scripts with a single Effect CLI entry point at `scripts/twitter.ts`.

### Command tree

```
twitter (root — shared flags: --verbose)
  ├── import-url <url>         [--curate] [--tier <tier>]
  ├── bookmarks                [--limit <n>] [--curate]
  ├── timeline <handle>        [--limit <n>] [--since <date>] [--tier <tier>]
  └── search <query>           [--limit <n>] [--mode <top|latest>] [--curate]
```

All commands share config validation (operator keys + twitter keys) and scraper layer provision.

### Files

- Delete: `skygest-editorial/scripts/twitter-import-url.ts` (replaced)
- Delete: `skygest-editorial/scripts/twitter-import-bookmarks.ts` (replaced)
- Create: `skygest-editorial/src/twitter/Cli.ts` — command definitions + handlers
- Create: `skygest-editorial/src/twitter/Errors.ts` — tagged error classes
- Create: `skygest-editorial/scripts/twitter.ts` — entry point

### Step 1: Create Errors.ts

```typescript
/**
 * Tagged error classes for the editorial Twitter CLI.
 */
import { Schema } from "effect";

export class TwitterConfigError extends Schema.TaggedErrorClass<TwitterConfigError>()(
  "TwitterConfigError",
  { message: Schema.String }
) {}

export class TwitterScraperError extends Schema.TaggedErrorClass<TwitterScraperError>()(
  "TwitterScraperError",
  {
    operation: Schema.String,
    message: Schema.String
  }
) {}

export class TwitterNormalizationError extends Schema.TaggedErrorClass<TwitterNormalizationError>()(
  "TwitterNormalizationError",
  { message: Schema.String }
) {}
```

### Step 2: Create Cli.ts

This is the core file. It follows the exact pattern from `skygest-cloudflare/src/ops/Cli.ts`:
- Flag/Argument declarations at module level
- Handler functions as standalone `Effect.gen` generators
- `Command.make` wiring flags to handlers
- `Command.withSubcommands` for tree composition
- `Command.runWith` for the runner

```typescript
import { Argument, Command, Flag } from "effect/unstable/cli";
import { Console, Effect, Option, Stream } from "effect";
import { TwitterPublic, TwitterTweets, TwitterSearch } from "@pooks/twitter-scraper";
import type { TweetDetailNode } from "@pooks/twitter-scraper";
import { OperatorKeys, TwitterKeys } from "@skygest/platform/ConfigShapes";
import { validateKeys, ConfigValidationError } from "@skygest/platform/ConfigValidation";
import { parsePostUrl } from "@skygest/domain/ingestUrl";
import {
  normalizeTweet,
  normalizeTweetDetail,
  normalizeProfile
} from "@skygest/ops/TwitterNormalizer";
import type { NormalizedPost } from "@skygest/ops/TwitterNormalizer";
import type { ExpertTier } from "@skygest/domain/bi";
import type { ImportExpertInput } from "@skygest/domain/api";
import { scraperLayer, restoreCookies } from "./ScraperLayer";
import { importPosts, curatePost } from "./ImportClient";
import { TwitterConfigError, TwitterScraperError, TwitterNormalizationError } from "./Errors";
import { ConfigProvider } from "effect";

// ── Centralized config (builds on SKY-182 validateKeys infrastructure) ──
//
// Uses the shared ConfigShapes from @skygest/platform — same keys validated
// by the /health endpoint and editorial validate-config.ts. TwitterKeys
// (TWITTER_COOKIE_PATH) was added in Task 1 of this plan.
//
// All keys are validated at once with per-key error accumulation.
// Failures show a human-readable summary before exiting.

const EditorialTwitterKeys = {
  ...OperatorKeys,
  ...TwitterKeys
} as const;

const validateConfig = Effect.gen(function* () {
  const provider = ConfigProvider.fromEnv();
  return yield* validateKeys(EditorialTwitterKeys, provider).pipe(
    Effect.catchTag("ConfigValidationError", (error) =>
      Effect.gen(function* () {
        yield* Console.error(error.summary);
        return yield* new TwitterConfigError({ message: error.summary });
      })
    )
  );
});

// ── Shared flags ──────────────────────────────────────────────────────

const expertTiers = ["energy-focused", "general-outlet", "independent"] as const;

const tierOption = Flag.choice("tier", expertTiers).pipe(
  Flag.withDescription("Expert tier classification"),
  Flag.withDefault("independent")
);

const limitOption = Flag.integer("limit").pipe(
  Flag.withDescription("Maximum number of items to fetch"),
  Flag.withDefault(20)
);

const curateOption = Flag.boolean("curate").pipe(
  Flag.withDescription("Auto-curate imported posts"),
  Flag.withDefault(false)
);

const searchModes = ["top", "latest"] as const;

const modeOption = Flag.choice("mode", searchModes).pipe(
  Flag.withDescription("Search result ordering"),
  Flag.withDefault("top")
);

// ── Helper: batch curate ──────────────────────────────────────────────

const batchCurate = (
  baseUrl: URL,
  secret: import("effect").Redacted.Redacted<string>,
  posts: ReadonlyArray<NormalizedPost>
) =>
  Effect.forEach(
    posts,
    (post) =>
      curatePost(baseUrl, secret, {
        postUri: post.uri,
        action: "curate"
      }).pipe(
        Effect.match({
          onSuccess: (c) =>
            Console.log(`  Curated ${post.uri}: ${c.previousStatus} → ${c.newStatus}`),
          onFailure: (e) =>
            Console.error(`  Curate failed ${post.uri}: ${e.message}`)
        }),
        Effect.flatten
      ),
    { concurrency: 1 }
  );

// ── Helper: build experts from tweets ─────────────────────────────────

const buildExpertsFromTweets = (
  posts: ReadonlyArray<NormalizedPost>,
  tweets: ReadonlyArray<{ username?: string; userId?: string }>
): ImportExpertInput[] => {
  const seen = new Set<string>();
  const experts: ImportExpertInput[] = [];
  for (let i = 0; i < posts.length; i++) {
    const post = posts[i]!;
    const tweet = tweets[i]!;
    if (!seen.has(post.did)) {
      seen.add(post.did);
      experts.push({
        did: post.did,
        handle: tweet.username ?? tweet.userId ?? "unknown",
        domain: "energy",
        source: "twitter-import" as const,
        tier: "independent"
      });
    }
  }
  return experts;
};

// ── Handlers ──────────────────────────────────────────────────────────

const runImportUrl = (options: {
  readonly url: string;
  readonly curate: boolean;
  readonly tier: string;
}) =>
  Effect.gen(function* () {
    const config = yield* validateConfig;

    // Parse URL
    const parsed = parsePostUrl(options.url);
    if (Option.isNone(parsed) || parsed.value.platform !== "twitter") {
      return yield* new TwitterConfigError({
        message: `Unsupported URL: ${options.url}\nExpected: https://x.com/<handle>/status/<id>`
      });
    }
    const { id } = parsed.value;
    yield* Console.log(`Fetching tweet ${id}...`);

    // Scrape (isolated scope)
    const { focalTweet, profile } = yield* Effect.gen(function* () {
      yield* restoreCookies(config.twitterCookiePath);
      const tweets = yield* TwitterTweets;
      const pub = yield* TwitterPublic;

      const detail = yield* tweets.getTweet(id);
      const focal = detail.tweets.find((t) => t.id === detail.focalTweetId);
      if (!focal) return { focalTweet: null as TweetDetailNode | null, profile: null as null };

      const authorHandle = focal.username ?? focal.userId ?? "";
      const profile = yield* pub.getProfile(authorHandle);
      return { focalTweet: focal, profile };
    }).pipe(Effect.provide(scraperLayer));

    if (!focalTweet) {
      return yield* new TwitterScraperError({ operation: "getTweet", message: "Focal tweet not found in detail response" });
    }

    // Normalize
    const normalizedPost = normalizeTweetDetail(focalTweet);
    if (!normalizedPost) {
      return yield* new TwitterNormalizationError({ message: "Tweet normalization failed (missing userId)" });
    }

    const normalizedExpert = normalizeProfile(profile!, options.tier as ExpertTier);
    if (!normalizedExpert) {
      return yield* new TwitterNormalizationError({ message: "Profile normalization failed (missing userId)" });
    }

    yield* Console.log(`Normalized: ${normalizedPost.uri}`);
    yield* Console.log(`Expert: ${normalizedExpert.handle} (${normalizedExpert.did})`);

    // Import
    const result = yield* importPosts(config.baseUrl, config.operatorSecret, {
      experts: [normalizedExpert],
      posts: [normalizedPost],
      operatorOverride: true
    });
    yield* Console.log(`Import: ${result.imported} imported, ${result.skipped} skipped, ${result.flagged} flagged`);

    // Curate
    if (options.curate && result.imported > 0) {
      const curation = yield* curatePost(config.baseUrl, config.operatorSecret, {
        postUri: normalizedPost.uri,
        action: "curate"
      });
      yield* Console.log(`Curated: ${curation.previousStatus} → ${curation.newStatus}`);
    }
  });

const runBookmarks = (options: {
  readonly limit: number;
  readonly curate: boolean;
}) =>
  Effect.gen(function* () {
    const config = yield* validateConfig;
    yield* Console.log(`Fetching up to ${options.limit} bookmarks...`);

    // Scrape (isolated scope)
    const tweetArray = yield* Effect.gen(function* () {
      yield* restoreCookies(config.twitterCookiePath);
      const tweetsService = yield* TwitterTweets;
      return yield* Stream.runCollect(tweetsService.getBookmarks({ limit: options.limit }));
    }).pipe(Effect.provide(scraperLayer));

    yield* Console.log(`Fetched ${tweetArray.length} bookmarks`);
    if (tweetArray.length === 0) {
      yield* Console.log("No bookmarks to import.");
      return;
    }

    // Normalize
    const normalized = tweetArray.map(normalizeTweet).filter((p): p is NormalizedPost => p !== null);
    const experts = buildExpertsFromTweets(normalized, tweetArray);
    yield* Console.log(`Normalized ${normalized.length} posts from ${experts.length} experts`);

    // Import
    const result = yield* importPosts(config.baseUrl, config.operatorSecret, {
      experts,
      posts: normalized,
      operatorOverride: true
    });
    yield* Console.log(`Import: ${result.imported} imported, ${result.skipped} skipped, ${result.flagged} flagged`);

    // Curate
    if (options.curate && result.imported > 0) {
      yield* batchCurate(config.baseUrl, config.operatorSecret, normalized);
    }
  });

const runTimeline = (options: {
  readonly handle: string;
  readonly limit: number;
  readonly since: Option.Option<string>;
  readonly tier: string;
}) =>
  Effect.gen(function* () {
    const config = yield* validateConfig;
    yield* Console.log(`Fetching timeline for @${options.handle} (limit: ${options.limit})...`);

    // Scrape (isolated scope)
    const { profile, tweetArray } = yield* Effect.gen(function* () {
      yield* restoreCookies(config.twitterCookiePath);
      const pub = yield* TwitterPublic;
      const profile = yield* pub.getProfile(options.handle);
      const tweets = yield* Stream.runCollect(pub.getTweets(options.handle, { limit: options.limit }));
      return { profile, tweetArray: tweets };
    }).pipe(Effect.provide(scraperLayer));

    yield* Console.log(`Fetched ${tweetArray.length} tweets from @${profile.username ?? options.handle}`);

    // Apply --since filter
    let filtered = tweetArray;
    if (Option.isSome(options.since)) {
      const sinceMs = new Date(options.since.value).getTime();
      filtered = tweetArray.filter(
        (t) => t.timestamp !== undefined && t.timestamp * 1000 >= sinceMs
      );
      yield* Console.log(`Filtered to ${filtered.length} tweets since ${options.since.value}`);
    }

    if (filtered.length === 0) {
      yield* Console.log("No tweets to import.");
      return;
    }

    // Normalize
    const normalizedExpert = normalizeProfile(profile, options.tier as ExpertTier);
    if (!normalizedExpert) {
      return yield* new TwitterNormalizationError({ message: "Profile normalization failed" });
    }

    const posts = filtered.map(normalizeTweet).filter((p): p is NormalizedPost => p !== null);
    yield* Console.log(`Normalized ${posts.length} posts for ${normalizedExpert.handle}`);

    // Import
    const result = yield* importPosts(config.baseUrl, config.operatorSecret, {
      experts: [normalizedExpert],
      posts,
      operatorOverride: false
    });
    yield* Console.log(`Import: ${result.imported} imported, ${result.skipped} skipped, ${result.flagged} flagged`);
  });

const runSearch = (options: {
  readonly query: string;
  readonly limit: number;
  readonly mode: string;
  readonly curate: boolean;
}) =>
  Effect.gen(function* () {
    const config = yield* validateConfig;
    yield* Console.log(`Searching: "${options.query}" (mode: ${options.mode}, limit: ${options.limit})...`);

    // Scrape (isolated scope)
    const tweetArray = yield* Effect.gen(function* () {
      yield* restoreCookies(config.twitterCookiePath);
      const search = yield* TwitterSearch;
      return yield* Stream.runCollect(
        search.searchTweets(options.query, { limit: options.limit, mode: options.mode as "top" | "latest" })
      );
    }).pipe(Effect.provide(scraperLayer));

    yield* Console.log(`Found ${tweetArray.length} tweets`);
    if (tweetArray.length === 0) {
      yield* Console.log("No results to import.");
      return;
    }

    // Normalize
    const normalized = tweetArray.map(normalizeTweet).filter((p): p is NormalizedPost => p !== null);
    const experts = buildExpertsFromTweets(normalized, tweetArray);
    yield* Console.log(`Normalized ${normalized.length} posts from ${experts.length} experts`);

    // Import
    const result = yield* importPosts(config.baseUrl, config.operatorSecret, {
      experts,
      posts: normalized,
      operatorOverride: true
    });
    yield* Console.log(`Import: ${result.imported} imported, ${result.skipped} skipped, ${result.flagged} flagged`);

    // Curate
    if (options.curate && result.imported > 0) {
      yield* batchCurate(config.baseUrl, config.operatorSecret, normalized);
    }
  });

// ── Command definitions ───────────────────────────────────────────────

const sinceOption = Flag.string("since").pipe(
  Flag.withDescription("Only import tweets after this date (ISO 8601)"),
  Flag.optional
);

const importUrlCommand = Command.make(
  "import-url",
  {
    url: Argument.string("url").pipe(
      Argument.withDescription("Tweet URL (https://x.com/... or https://twitter.com/...)")
    ),
    curate: curateOption,
    tier: tierOption
  },
  ({ url, curate, tier }) => runImportUrl({ url, curate, tier })
).pipe(
  Command.withDescription("Import a single tweet by URL")
);

const bookmarksCommand = Command.make(
  "bookmarks",
  {
    limit: limitOption.pipe(Flag.withDefault(50)),
    curate: curateOption
  },
  ({ limit, curate }) => runBookmarks({ limit, curate })
).pipe(
  Command.withDescription("Import recent bookmarks")
);

const timelineCommand = Command.make(
  "timeline",
  {
    handle: Argument.string("handle").pipe(
      Argument.withDescription("Twitter handle (without @)")
    ),
    limit: limitOption,
    since: sinceOption,
    tier: tierOption
  },
  ({ handle, limit, since, tier }) => runTimeline({ handle, limit, since, tier })
).pipe(
  Command.withDescription("Import tweets from an expert's timeline")
);

const searchCommand = Command.make(
  "search",
  {
    query: Argument.string("query").pipe(
      Argument.withDescription("Search query")
    ),
    limit: limitOption,
    mode: modeOption,
    curate: curateOption
  },
  ({ query, limit, mode, curate }) => runSearch({ query, limit, mode, curate })
).pipe(
  Command.withDescription("Search Twitter and import results")
);

// ── Root command + tree ───────────────────────────────────────────────

export const twitterCommand = Command.make("twitter", {}, () => Effect.void).pipe(
  Command.withDescription("Twitter ingestion tools for editorial workflows"),
  Command.withSubcommands([importUrlCommand, bookmarksCommand, timelineCommand, searchCommand])
);

const cli = Command.runWith(twitterCommand, { version: "0.1.0" });

export const runTwitterCli = (argv: ReadonlyArray<string>) =>
  Effect.suspend(() => cli(Array.from(argv).slice(2)));
```

### Step 3: Create the entry point (scripts/twitter.ts)

```typescript
#!/usr/bin/env bun
/**
 * Twitter ingestion CLI for editorial workflows.
 *
 * Usage:
 *   bun scripts/twitter.ts import-url <url> [--curate] [--tier <tier>]
 *   bun scripts/twitter.ts bookmarks [--limit <n>] [--curate]
 *   bun scripts/twitter.ts timeline <handle> [--limit <n>] [--since <date>]
 *   bun scripts/twitter.ts search <query> [--limit <n>] [--mode <top|latest>] [--curate]
 *   bun scripts/twitter.ts --help
 */
import { Effect, FileSystem, Layer, Path, Runtime, Stdio, Stream, Terminal } from "effect";
import { ChildProcessSpawner } from "effect/unstable/process";
import { runTwitterCli } from "../src/twitter/Cli";

// CLI Environment stubs — the twitter CLI doesn't use these directly,
// but effect/unstable/cli requires them in scope.
const die = (label: string) => (..._args: Array<any>): any =>
  Effect.die(new Error(`${label}: not used in twitter CLI`));

const cliEnvLayer = Layer.mergeAll(
  Layer.succeed(
    ChildProcessSpawner.ChildProcessSpawner,
    ChildProcessSpawner.make((_command) =>
      Effect.die(new Error("ChildProcessSpawner: not used in twitter CLI"))
    )
  ),
  Layer.succeed(FileSystem.FileSystem, {
    exists: die("FileSystem.exists"),
    readFileString: die("FileSystem.readFileString"),
    writeFileString: die("FileSystem.writeFileString")
  } as unknown as FileSystem.FileSystem),
  Layer.succeed(Path.Path, {
    sep: "/",
    basename: (p: string) => p.split("/").pop() ?? "",
    dirname: (p: string) => p.split("/").slice(0, -1).join("/") || ".",
    extname: () => "",
    format: () => "",
    fromFileUrl: die("Path.fromFileUrl"),
    isAbsolute: (p: string) => p.startsWith("/"),
    join: (...paths: ReadonlyArray<string>) => paths.join("/"),
    normalize: (p: string) => p,
    parse: () => ({ root: "", dir: "", base: "", ext: "", name: "" }),
    relative: () => "",
    resolve: (...segs: ReadonlyArray<string>) => segs.join("/"),
    toFileUrl: die("Path.toFileUrl"),
    toNamespacedPath: (p: string) => p
  } as unknown as Path.Path),
  Layer.succeed(Terminal.Terminal, {
    columns: Effect.succeed(80),
    readInput: Effect.die(new Error("Terminal.readInput: not used")),
    readLine: Effect.die(new Error("Terminal.readLine: not used")),
    display: () => Effect.void
  } as unknown as Terminal.Terminal),
  Layer.succeed(Stdio.Stdio, {
    args: Effect.succeed(process.argv),
    stdout: die("Stdio.stdout"),
    stderr: die("Stdio.stderr"),
    stdin: Stream.empty
  } as unknown as Stdio.Stdio)
);

const runMain = Runtime.makeRunMain(({ fiber, teardown }) => {
  fiber.addObserver((exit) => teardown(exit, (code) => process.exit(code)));
});

Effect.suspend(() => runTwitterCli(process.argv)).pipe(
  Effect.provide(cliEnvLayer),
  runMain
);
```

### Step 4: Delete old standalone scripts

```bash
cd /Users/pooks/Dev/skygest-editorial
rm scripts/twitter-import-url.ts
rm scripts/twitter-import-bookmarks.ts
```

### Step 5: Verify

Run: `cd /Users/pooks/Dev/skygest-editorial && bun run typecheck`
Expected: Compiles.

Run: `bun scripts/twitter.ts --help`
Expected: Shows help with subcommands listed.

### Step 6: Commit

```bash
cd /Users/pooks/Dev/skygest-editorial
git add -A
git commit -m "feat: unified Effect CLI for twitter ingestion (SKY-180)

Replace standalone scripts with a single CLI entry point using
Command/Flag/Argument from effect/unstable/cli. Mirrors the ops CLI
architecture from skygest-cloudflare.

Commands: import-url, bookmarks, timeline, search
Shared: config validation, scraper layer, cookie restoration
"
```

---

## Task 6: Update CLAUDE.md + morning-curation skill

Document the unified twitter CLI in the editorial workspace context.

### Files

- Modify: `skygest-editorial/CLAUDE.md`
- Modify: `skygest-editorial/.claude/skills/morning-curation/SKILL.md`

### Step 1: Add Twitter CLI section to CLAUDE.md

After the "Where things live" section in `CLAUDE.md`, add:

```markdown

## Twitter ingestion (local CLI)

Bluesky posts arrive via cloud ingestion (Cloudflare Worker polling). Twitter posts are ingested locally via a unified CLI, then imported to staging via the operator API.

```
bun scripts/twitter.ts import-url <url> [--curate] [--tier <tier>]
bun scripts/twitter.ts bookmarks [--limit <n>] [--curate]
bun scripts/twitter.ts timeline <handle> [--limit <n>] [--since <date>] [--tier <tier>]
bun scripts/twitter.ts search <query> [--limit <n>] [--mode <top|latest>] [--curate]
bun scripts/twitter.ts --help
```

Requires `TWITTER_COOKIE_PATH` in `.env` (see `.env.example`). The CLI validates this alongside operator credentials before running.

Imported tweets use `x://` URIs. They appear in `list_curation_candidates` alongside Bluesky posts and can be curated, enriched, and picked via the same MCP tools. Thread expansion (`get_post_thread`) is Bluesky-only.

If cookies are stale, re-extract from Chrome and update the cookie file.
```

### Step 2: Add twitter awareness to morning-curation skill

In `skygest-editorial/.claude/skills/morning-curation/SKILL.md`, after step 1, add:

```markdown
   - If the editor mentions bookmarks, recent tweets, or a specific tweet URL, offer to run the twitter CLI first (`bun scripts/twitter.ts import-url <url>`, `bun scripts/twitter.ts bookmarks`, etc.) before pulling candidates. This is optional — morning curation works without Twitter setup.
```

### Step 3: Commit

```bash
cd /Users/pooks/Dev/skygest-editorial
git add CLAUDE.md .claude/skills/morning-curation/SKILL.md
git commit -m "docs: document twitter CLI in CLAUDE.md and curation skill (SKY-180)"
```

---

## Out of scope (documented for future tickets)

- **Twitter cookie freshness validation** — `TwitterKeys` checks path is non-empty but not that cookies are unexpired. Extension point: add validation script.
- **Twitter thread expansion in MCP** — `get_post_thread` is Bluesky-only. Would need scraper server-side (blocked by CycleTLS on CF Workers).
- **SKY-142** — Fresh checkout requiring linked scraper. The `file:` dependency inherits this.
- **Operator secret naming unification** — `OPERATOR_SECRET` (worker) vs `SKYGEST_OPERATOR_SECRET` (editorial).
- **StagingOperatorClient consolidation** — ImportClient duplicates ~60 lines. Factor out if MCP dep is removed from StagingOperatorClient.
- **CLI env stubs extraction** — The FileSystem/Path/Terminal/Stdio stubs are identical between ops and editorial. Could be a shared module.
- **Effect.fn for handlers** — The handlers use plain `Effect.gen`. Could be upgraded to `Effect.fn("twitter.importUrl")` for automatic span tracing.
