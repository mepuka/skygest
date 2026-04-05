# SKY-180: Editorial Twitter Ingestion Scripts

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Give the editorial workspace (`skygest-editorial`) full local Twitter ingestion capabilities — import from URL, bookmarks, timeline, and search — using the `@pooks/twitter-scraper` library and posting normalized results to staging via the operator API.

**Architecture:** Each script follows a three-phase pattern: (1) validate config (operator secret + cookie path) inline, (2) scrape tweets using the scraper's `authenticatedLayer` in an isolated Effect scope with in-program cookie restoration (CycleTLS conflicts with FetchHttpClient), (3) normalize via the shared `TwitterNormalizer` and POST to staging's `/admin/import/posts`. The scraper layer is provided per-command, never globally. Config validation uses the SKY-182 `validateKeys` infrastructure with a new `TwitterKeys` shape added to `ConfigShapes.ts`. The general-purpose `validate-config.ts` is NOT modified — twitter scripts validate their own keys so non-Twitter editors are never blocked.

**Tech Stack:** Effect 4, `@pooks/twitter-scraper` (`file:` dependency), Bun, `@skygest/domain/*`, `@skygest/platform/*`, and `@skygest/ops/*` path mappings from `skygest-cloudflare`.

**Repos:** Changes span both `skygest-cloudflare` (config shapes) and `skygest-editorial` (scripts, layers, docs).

**Review fixes applied (2026-04-05):**
- P1: Scraper layer rewritten — cookie restoration happens in-program via `CookieManager` after `authenticatedLayer()` is provided, matching [scraper.ts:133-147](../../../better_twitter_scraper/src/scraper.ts) documented pattern
- P1: All tier defaults changed from `"t3"` to `"independent"` per [bi.ts:29](../../src/domain/bi.ts)
- P1: Curate response logging changed from `.status` to `.newStatus` per [curation.ts:124-130](../../src/domain/curation.ts)
- P1: `validate-config.ts` left unchanged — twitter scripts validate their own keys inline so morning curation works without Twitter setup
- P2: Scraper dependency uses `"file:../better_twitter_scraper"` in package.json; commit includes bun.lock
- TwitterKeys uses `nonEmptyString` pattern; file existence validated at cookie load time (can't use `node:fs` in shared ConfigShapes without risking CF worker imports)
- ImportClient kept as thin standalone (StagingOperatorClient imports `../mcp/Client` pulling deep CF-adjacent deps); uses same domain schemas so contract is shared

---

## Task 1: Add TwitterKeys to ConfigShapes.ts

Add a shared `TwitterKeys` config shape to the cloudflare repo. This gets picked up by editorial via the existing `@skygest/platform/*` path mapping.

**Files:**
- Modify: `skygest-cloudflare/src/platform/ConfigShapes.ts`
- Modify: `skygest-cloudflare/tests/platform/ConfigShapes.test.ts`

**Step 1: Add TwitterKeys shape**

In `skygest-cloudflare/src/platform/ConfigShapes.ts`, add after the `EnrichmentKeys` block:

```typescript
// ── Twitter / editorial ingestion keys ────────────────────────────────

/** Non-empty string config that rejects empty/whitespace-only values. */
const nonEmptyString = (name: string) =>
  Config.string(name).pipe(
    Config.mapOrFail((value) =>
      value.trim().length > 0
        ? Effect.succeed(value)
        : Effect.fail(
            new Config.ConfigError(
              new ConfigProvider.SourceError({
                message: `${name} must not be empty`
              })
            )
          )
    )
  );

export const TwitterKeys = {
  twitterCookiePath: nonEmptyString("TWITTER_COOKIE_PATH")
} as const;
```

No default — a missing cookie path should be a validation error in twitter scripts. The path points to the JSON file containing serialized auth cookies (e.g., `../better_twitter_scraper/tests/live-auth-cookies.local.json`). File existence is validated at cookie load time in the scraper layer, not here (can't use `node:fs` in shared ConfigShapes without risking CF worker imports).

**Step 2: Write the failing test**

In `skygest-cloudflare/tests/platform/ConfigShapes.test.ts`, add imports for `Result` and `TwitterKeys`, then add a test group:

```typescript
import { TwitterKeys } from "../../src/platform/ConfigShapes";
// (Result should already be imported — if not, add it)

describe("TwitterKeys", () => {
  it("resolves when TWITTER_COOKIE_PATH is set", () =>
    Effect.gen(function* () {
      const provider = ConfigProvider.fromUnknown({
        TWITTER_COOKIE_PATH: "/path/to/cookies.json"
      });
      const result = yield* TwitterKeys.twitterCookiePath.parse(provider);
      expect(result).toBe("/path/to/cookies.json");
    }).pipe(Effect.runPromise));

  it("fails when TWITTER_COOKIE_PATH is missing", () =>
    Effect.gen(function* () {
      const provider = ConfigProvider.fromUnknown({});
      const result = yield* Effect.result(
        TwitterKeys.twitterCookiePath.parse(provider)
      );
      expect(Result.isFailure(result)).toBe(true);
    }).pipe(Effect.runPromise));

  it("fails when TWITTER_COOKIE_PATH is empty", () =>
    Effect.gen(function* () {
      const provider = ConfigProvider.fromUnknown({
        TWITTER_COOKIE_PATH: "   "
      });
      const result = yield* Effect.result(
        TwitterKeys.twitterCookiePath.parse(provider)
      );
      expect(Result.isFailure(result)).toBe(true);
    }).pipe(Effect.runPromise));
});
```

**Step 3: Run test to verify it fails**

Run: `cd /Users/pooks/Dev/skygest-cloudflare && bun run test tests/platform/ConfigShapes.test.ts`
Expected: FAIL — `TwitterKeys` not exported yet (if test file is written before step 1, reverse order).

**Step 4: Run test to verify it passes**

Run: `cd /Users/pooks/Dev/skygest-cloudflare && bun run test tests/platform/ConfigShapes.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
cd /Users/pooks/Dev/skygest-cloudflare
git add src/platform/ConfigShapes.ts tests/platform/ConfigShapes.test.ts
git commit -m "feat(config): add TwitterKeys shape for editorial cookie path (SKY-180)"
```

---

## Task 2: Add ops path mapping + scraper dependency to editorial

Give the editorial repo access to the `TwitterNormalizer` (via path mapping) and the `@pooks/twitter-scraper` package (via `file:` dependency).

**Files:**
- Modify: `skygest-editorial/tsconfig.json`
- Modify: `skygest-editorial/package.json`
- Modify: `skygest-editorial/.env.example`

**Step 1: Add `@skygest/ops/*` path mapping**

In `skygest-editorial/tsconfig.json`, add to the `paths` object:

```json
"@skygest/ops/*": ["../skygest-cloudflare/src/ops/*"]
```

The full paths block becomes:
```json
"paths": {
  "@skygest/domain/*": ["../skygest-cloudflare/src/domain/*"],
  "@skygest/platform/*": ["../skygest-cloudflare/src/platform/*"],
  "@skygest/ops/*": ["../skygest-cloudflare/src/ops/*"]
}
```

**Step 2: Add scraper as file dependency**

In `skygest-editorial/package.json`, add to `dependencies`:

```json
"dependencies": {
  "effect": "4.0.0-beta.43",
  "@pooks/twitter-scraper": "file:../better_twitter_scraper"
}
```

Then install:

```bash
cd /Users/pooks/Dev/skygest-editorial
bun install
```

Verify the symlink:

```bash
ls -la node_modules/@pooks/twitter-scraper
```

**Step 3: Update .env.example**

Add the twitter cookie path to `skygest-editorial/.env.example`:

```
# Skygest staging credentials
SKYGEST_STAGING_BASE_URL=https://skygest-bi-agent-staging.kokokessy.workers.dev
SKYGEST_OPERATOR_SECRET=your-operator-secret-here

# Twitter ingestion (only needed for twitter import scripts)
TWITTER_COOKIE_PATH=../better_twitter_scraper/tests/live-auth-cookies.local.json
```

**Step 4: Update .env with actual values**

In your local `skygest-editorial/.env`, add:

```
TWITTER_COOKIE_PATH=../better_twitter_scraper/tests/live-auth-cookies.local.json
```

**Step 5: Verify typecheck**

Run: `cd /Users/pooks/Dev/skygest-editorial && bun run typecheck`
Expected: Compiles (existing warnings may appear from current validate-config.ts — that's pre-existing).

**Step 6: Commit**

```bash
cd /Users/pooks/Dev/skygest-editorial
git add tsconfig.json package.json bun.lock .env.example
git commit -m "feat: add ops path mapping and twitter scraper file dependency (SKY-180)"
```

---

## Task 3: Build editorial ScraperLayer

Create the authenticated scraper layer for editorial scripts. Uses `TwitterScraper.authenticatedLayer()` which provides ALL services: TwitterPublic, TwitterTweets (incl. bookmarks), TwitterSearch, TwitterLists, plus CookieManager.

Cookie restoration is an in-program effect, NOT a wrapping layer. This matches the [documented scraper usage pattern](../../../better_twitter_scraper/src/scraper.ts:133-147) where cookies are restored inside `Effect.gen` after the layer is provided.

**Files:**
- Create: `skygest-editorial/src/twitter/ScraperLayer.ts`

**Step 1: Write ScraperLayer.ts**

```typescript
/**
 * Authenticated Twitter scraper layer + cookie restoration for editorial scripts.
 *
 * Uses TwitterScraper.authenticatedLayer() which provides all services:
 * TwitterPublic, TwitterTweets (incl. bookmarks), TwitterSearch, TwitterLists,
 * plus CookieManager.
 *
 * Cookie restoration happens in-program via restoreCookies(), NOT as a
 * wrapping layer. authenticatedLayer() creates CookieManager.liveLayer
 * internally — the cookies must be restored AFTER the layer is provided.
 *
 * IMPORTANT: This layer provides HttpClient via CycleTLS, which conflicts
 * with FetchHttpClient used for staging API calls. Provide this layer ONLY
 * within scraper Effect blocks, not globally.
 */
import { Effect } from "effect";
import { CookieManager, TwitterScraper } from "@pooks/twitter-scraper";

/**
 * Pre-built authenticated scraper layer.
 * Provides: TwitterPublic, TwitterTweets, TwitterSearch, TwitterLists,
 * CookieManager, UserAuth, GuestAuth, and all supporting services.
 */
export const scraperLayer = TwitterScraper.authenticatedLayer();

/**
 * Restore serialized auth cookies from a JSON file on disk.
 * Must be called inside an Effect.gen block AFTER scraperLayer is provided.
 *
 * Usage:
 * ```ts
 * yield* Effect.gen(function* () {
 *   yield* restoreCookies(cookiePath);
 *   const tweets = yield* TwitterTweets;
 *   // ... use services
 * }).pipe(Effect.provide(scraperLayer));
 * ```
 */
export const restoreCookies = (cookiePath: string) =>
  Effect.gen(function* () {
    const cookies = yield* CookieManager;
    const text = yield* Effect.tryPromise(() => Bun.file(cookiePath).text());
    const raw = JSON.parse(text) as ReadonlyArray<{
      name: string;
      value: string;
    }>;
    yield* cookies.restoreSerializedCookies(raw);
  });
```

**Step 2: Verify typecheck**

Run: `cd /Users/pooks/Dev/skygest-editorial && bun run typecheck`
Expected: Compiles.

**Step 3: Commit**

```bash
cd /Users/pooks/Dev/skygest-editorial
git add src/twitter/ScraperLayer.ts
git commit -m "feat: add authenticated scraper layer for editorial (SKY-180)"
```

---

## Task 4: Build editorial ImportClient

Create a thin pair of standalone functions for POSTing normalized tweets to staging. Only needs `importPosts` and `curatePost` — much simpler than the full `StagingOperatorClient` (which imports `../mcp/Client` and pulls deep CF-adjacent deps).

Uses the same domain schemas (`ImportPostsInput`, `ImportPostsOutput`, `CuratePostInput`, `CuratePostOutput`) so the API contract is shared — no drift risk on the wire format.

**Files:**
- Create: `skygest-editorial/src/twitter/ImportClient.ts`

**Step 1: Write ImportClient.ts**

```typescript
/**
 * Thin HTTP functions for posting normalized tweets to the staging import API.
 *
 * Uses FetchHttpClient (not CycleTLS) — safe to use outside scraper scope.
 *
 * NOTE: These functions overlap with StagingOperatorClient.importPosts and
 * StagingOperatorClient.curatePost in skygest-cloudflare. We duplicate the
 * HTTP plumbing here (~60 lines) rather than importing StagingOperatorClient
 * because that service depends on ../mcp/Client and other CF-adjacent modules.
 * Both use the same domain schemas, so the wire contract is shared.
 */
import { Effect, Redacted, Schema } from "effect";
import {
  FetchHttpClient,
  HttpBody,
  HttpClient,
  HttpClientResponse
} from "effect/unstable/http";
import { ImportPostsInput, ImportPostsOutput } from "@skygest/domain/api";
import { CuratePostInput, CuratePostOutput } from "@skygest/domain/curation";

export class ImportClientError extends Schema.TaggedErrorClass<ImportClientError>()(
  "ImportClientError",
  {
    operation: Schema.String,
    message: Schema.String,
    status: Schema.optionalKey(Schema.Number)
  }
) {}

const jsonBody = (body: unknown) =>
  HttpBody.raw(JSON.stringify(body), { contentType: "application/json" });

const authHeader = (secret: Redacted.Redacted<string>) => ({
  authorization: `Bearer ${Redacted.value(secret)}`
});

const assertOk = (
  response: HttpClientResponse.HttpClientResponse,
  operation: string
): Effect.Effect<HttpClientResponse.HttpClientResponse, ImportClientError> =>
  response.status >= 200 && response.status < 300
    ? Effect.succeed(response)
    : Effect.gen(function* () {
        const body = yield* response.text.pipe(Effect.orElseSucceed(() => ""));
        return yield* new ImportClientError({
          operation,
          message: `${response.status} ${response.request.method} ${response.request.url}\n${body.slice(0, 500)}`,
          status: response.status
        });
      });

export const importPosts = (
  baseUrl: URL,
  secret: Redacted.Redacted<string>,
  input: Schema.Codec.Encoded<typeof ImportPostsInput>
): Effect.Effect<Schema.Schema.Type<typeof ImportPostsOutput>, ImportClientError> =>
  Effect.gen(function* () {
    const http = yield* HttpClient.HttpClient;
    const response = yield* http
      .post(new URL("/admin/import/posts", baseUrl), {
        headers: { "content-type": "application/json", ...authHeader(secret) },
        body: jsonBody(input)
      })
      .pipe(Effect.mapError((e) => new ImportClientError({ operation: "import-posts", message: String(e) })));
    yield* assertOk(response, "import-posts");
    return yield* HttpClientResponse.schemaBodyJson(ImportPostsOutput)(response).pipe(
      Effect.mapError((e) => new ImportClientError({ operation: "import-posts", message: String(e) }))
    );
  }).pipe(Effect.provide(FetchHttpClient.layer));

export const curatePost = (
  baseUrl: URL,
  secret: Redacted.Redacted<string>,
  input: Schema.Codec.Encoded<typeof CuratePostInput>
): Effect.Effect<Schema.Schema.Type<typeof CuratePostOutput>, ImportClientError> =>
  Effect.gen(function* () {
    const http = yield* HttpClient.HttpClient;
    const response = yield* http
      .post(new URL("/admin/curation/curate", baseUrl), {
        headers: { "content-type": "application/json", ...authHeader(secret) },
        body: jsonBody(input)
      })
      .pipe(Effect.mapError((e) => new ImportClientError({ operation: "curate-post", message: String(e) })));
    yield* assertOk(response, "curate-post");
    return yield* HttpClientResponse.schemaBodyJson(CuratePostOutput)(response).pipe(
      Effect.mapError((e) => new ImportClientError({ operation: "curate-post", message: String(e) }))
    );
  }).pipe(Effect.provide(FetchHttpClient.layer));
```

**Step 2: Verify typecheck**

Run: `cd /Users/pooks/Dev/skygest-editorial && bun run typecheck`
Expected: Compiles.

**Step 3: Commit**

```bash
cd /Users/pooks/Dev/skygest-editorial
git add src/twitter/ImportClient.ts
git commit -m "feat: add import client for staging API (SKY-180)"
```

---

## Task 5: Build twitter-import-url.ts script

The most important script — paste a tweet URL, scrape it, normalize, import to staging, auto-curate.

**Files:**
- Create: `skygest-editorial/scripts/twitter-import-url.ts`

**Step 1: Write the script**

```typescript
#!/usr/bin/env bun
/**
 * Import a single tweet by URL.
 *
 * Usage: bun scripts/twitter-import-url.ts <url> [--curate] [--tier <tier>]
 *
 * Fetches the tweet detail, normalizes it, imports to staging.
 * With --curate, also auto-curates the post with operatorOverride.
 *
 * Tier must be one of: energy-focused, general-outlet, independent (default).
 */
import { Effect, ConfigProvider, Option } from "effect";
import { TwitterPublic, TwitterTweets } from "@pooks/twitter-scraper";
import { OperatorKeys, TwitterKeys } from "@skygest/platform/ConfigShapes";
import { validateKeys } from "@skygest/platform/ConfigValidation";
import { parsePostUrl } from "@skygest/domain/ingestUrl";
import { normalizeTweetDetail, normalizeProfile } from "@skygest/ops/TwitterNormalizer";
import { scraperLayer, restoreCookies } from "../src/twitter/ScraperLayer";
import { importPosts, curatePost } from "../src/twitter/ImportClient";
import type { ExpertTier } from "@skygest/domain/bi";

const args = process.argv.slice(2);
const url = args.find((a) => !a.startsWith("--"));
const shouldCurate = args.includes("--curate");
const tierIdx = args.indexOf("--tier");
const tier: ExpertTier = (tierIdx >= 0 ? args[tierIdx + 1] as ExpertTier : "independent") ?? "independent";

if (!url) {
  console.error("Usage: bun scripts/twitter-import-url.ts <url> [--curate] [--tier <tier>]");
  console.error("  Supported: https://x.com/<handle>/status/<id>");
  console.error("             https://twitter.com/<handle>/status/<id>");
  console.error("  Tiers: energy-focused, general-outlet, independent (default)");
  process.exit(1);
}

const main = Effect.gen(function* () {
  // 1. Validate config (operator keys + twitter keys together)
  const provider = ConfigProvider.fromEnv();
  const config = yield* validateKeys({ ...OperatorKeys, ...TwitterKeys }, provider);

  // 2. Parse URL
  const parsed = parsePostUrl(url!);
  if (Option.isNone(parsed) || parsed.value.platform !== "twitter") {
    console.error(`Unsupported URL: ${url}`);
    console.error("Expected: https://x.com/<handle>/status/<id>");
    return yield* Effect.fail(new Error("Unsupported URL"));
  }
  const { handle, id } = parsed.value;
  console.log(`Fetching tweet ${id} by @${handle}...`);

  // 3. Scrape tweet detail + profile (isolated scraper scope)
  const { detail, profile } = yield* Effect.gen(function* () {
    yield* restoreCookies(config.twitterCookiePath);
    const tweets = yield* TwitterTweets;
    const pub = yield* TwitterPublic;
    const detail = yield* tweets.getTweet(id);
    const profile = yield* pub.getProfile(handle);
    return { detail, profile };
  }).pipe(Effect.provide(scraperLayer));

  // 4. Normalize
  const focalTweet = detail.tweets.find((t) => t.id === detail.focalTweetId);
  if (!focalTweet) {
    console.error("Could not find focal tweet in detail response");
    return yield* Effect.fail(new Error("No focal tweet"));
  }

  const normalizedPost = normalizeTweetDetail(focalTweet);
  if (!normalizedPost) {
    console.error("Normalization failed (missing userId)");
    return yield* Effect.fail(new Error("Normalization failed"));
  }

  const normalizedExpert = normalizeProfile(profile, tier);
  if (!normalizedExpert) {
    console.error("Profile normalization failed (missing userId)");
    return yield* Effect.fail(new Error("Profile normalization failed"));
  }

  console.log(`Normalized: ${normalizedPost.uri}`);
  console.log(`Expert: ${normalizedExpert.handle} (${normalizedExpert.did})`);

  // 5. Import to staging
  const result = yield* importPosts(config.baseUrl, config.operatorSecret, {
    experts: [normalizedExpert],
    posts: [normalizedPost],
    operatorOverride: true
  });
  console.log(`Import: ${result.imported} imported, ${result.skipped} skipped, ${result.flagged} flagged`);

  // 6. Auto-curate if requested
  if (shouldCurate && result.imported > 0) {
    const curation = yield* curatePost(config.baseUrl, config.operatorSecret, {
      postUri: normalizedPost.uri,
      action: "curate"
    });
    console.log(`Curated: ${curation.previousStatus} → ${curation.newStatus}`);
  }
});

Effect.runPromise(main).catch((e) => {
  console.error("Failed:", e.message ?? e);
  process.exit(1);
});
```

**Step 2: Test manually**

Run: `cd /Users/pooks/Dev/skygest-editorial && bun scripts/twitter-import-url.ts https://x.com/BlakeShaworthy/status/1234567890 --curate`
Expected: Fetches tweet, normalizes, imports, curates. Output shows import counts and status transition.

**Step 3: Commit**

```bash
cd /Users/pooks/Dev/skygest-editorial
git add scripts/twitter-import-url.ts
git commit -m "feat: add twitter-import-url script (SKY-180)"
```

---

## Task 6: Build twitter-import-bookmarks.ts script

Pull the authenticated user's bookmarks and batch-import them.

**Files:**
- Create: `skygest-editorial/scripts/twitter-import-bookmarks.ts`

**Step 1: Write the script**

```typescript
#!/usr/bin/env bun
/**
 * Import recent Twitter bookmarks.
 *
 * Usage: bun scripts/twitter-import-bookmarks.ts [--limit <n>] [--curate]
 *
 * Fetches the authenticated user's bookmarked tweets, normalizes them,
 * and imports to staging. Default limit: 50.
 */
import { Effect, ConfigProvider, Stream, Chunk } from "effect";
import { TwitterTweets } from "@pooks/twitter-scraper";
import { OperatorKeys, TwitterKeys } from "@skygest/platform/ConfigShapes";
import { validateKeys } from "@skygest/platform/ConfigValidation";
import { normalizeTweet } from "@skygest/ops/TwitterNormalizer";
import { scraperLayer, restoreCookies } from "../src/twitter/ScraperLayer";
import { importPosts, curatePost } from "../src/twitter/ImportClient";
import type { NormalizedPost } from "@skygest/ops/TwitterNormalizer";
import type { ImportExpertInput } from "@skygest/domain/api";

const args = process.argv.slice(2);
const limitIdx = args.indexOf("--limit");
const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1]!, 10) : 50;
const shouldCurate = args.includes("--curate");

const main = Effect.gen(function* () {
  // 1. Validate config
  const provider = ConfigProvider.fromEnv();
  const config = yield* validateKeys({ ...OperatorKeys, ...TwitterKeys }, provider);

  console.log(`Fetching up to ${limit} bookmarks...`);

  // 2. Scrape bookmarks (isolated scraper scope — restore cookies first)
  const tweets = yield* Effect.gen(function* () {
    yield* restoreCookies(config.twitterCookiePath);
    const tweetsService = yield* TwitterTweets;
    return yield* Stream.runCollect(
      tweetsService.getBookmarks({ limit })
    );
  }).pipe(Effect.provide(scraperLayer));

  const tweetArray = Chunk.toArray(tweets);
  console.log(`Fetched ${tweetArray.length} bookmarks`);

  if (tweetArray.length === 0) {
    console.log("No bookmarks to import.");
    return;
  }

  // 3. Normalize tweets
  const posts: NormalizedPost[] = [];
  const expertDids = new Set<string>();
  const experts: ImportExpertInput[] = [];

  for (const tweet of tweetArray) {
    const normalized = normalizeTweet(tweet);
    if (!normalized) continue;
    posts.push(normalized);

    // Build minimal expert entries from tweet data (no profile fetch needed)
    if (!expertDids.has(normalized.did)) {
      expertDids.add(normalized.did);
      experts.push({
        did: normalized.did,
        handle: tweet.username ?? tweet.userId ?? "unknown",
        domain: "energy",
        source: "twitter-import" as const,
        tier: "independent"
      });
    }
  }

  console.log(`Normalized ${posts.length} posts from ${experts.length} experts`);

  // 4. Import to staging
  const result = yield* importPosts(config.baseUrl, config.operatorSecret, {
    experts,
    posts,
    operatorOverride: true
  });
  console.log(`Import: ${result.imported} imported, ${result.skipped} skipped, ${result.flagged} flagged`);

  // 5. Auto-curate if requested
  if (shouldCurate && result.imported > 0) {
    for (const post of posts) {
      const curation = yield* curatePost(config.baseUrl, config.operatorSecret, {
        postUri: post.uri,
        action: "curate"
      }).pipe(
        Effect.catchAll((e) =>
          Effect.succeed({ postUri: post.uri, action: "curate" as const, previousStatus: null, newStatus: `failed: ${e.message}` as const })
        )
      );
      console.log(`  Curated ${post.uri}: ${curation.newStatus}`);
    }
  }
});

Effect.runPromise(main).catch((e) => {
  console.error("Failed:", e.message ?? e);
  process.exit(1);
});
```

**Step 2: Test manually**

Run: `cd /Users/pooks/Dev/skygest-editorial && bun scripts/twitter-import-bookmarks.ts --limit 5`
Expected: Fetches 5 most recent bookmarks, normalizes, imports.

**Step 3: Commit**

```bash
cd /Users/pooks/Dev/skygest-editorial
git add scripts/twitter-import-bookmarks.ts
git commit -m "feat: add twitter-import-bookmarks script (SKY-180)"
```

---

## Task 7: Build twitter-import-timeline.ts script

Import recent tweets from a specific expert's timeline.

**Files:**
- Create: `skygest-editorial/scripts/twitter-import-timeline.ts`

**Step 1: Write the script**

```typescript
#!/usr/bin/env bun
/**
 * Import recent tweets from an expert's timeline.
 *
 * Usage: bun scripts/twitter-import-timeline.ts <handle> [--limit <n>] [--since <date>] [--tier <tier>]
 *
 * Fetches the expert's profile and recent tweets, normalizes, imports.
 * Tier must be one of: energy-focused, general-outlet, independent (default).
 */
import { Effect, ConfigProvider, Stream, Chunk } from "effect";
import { TwitterPublic } from "@pooks/twitter-scraper";
import { OperatorKeys, TwitterKeys } from "@skygest/platform/ConfigShapes";
import { validateKeys } from "@skygest/platform/ConfigValidation";
import { normalizeTweet, normalizeProfile } from "@skygest/ops/TwitterNormalizer";
import { scraperLayer, restoreCookies } from "../src/twitter/ScraperLayer";
import { importPosts } from "../src/twitter/ImportClient";
import type { ExpertTier } from "@skygest/domain/bi";

const args = process.argv.slice(2);
const handle = args.find((a) => !a.startsWith("--"));
const limitIdx = args.indexOf("--limit");
const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1]!, 10) : 20;
const sinceIdx = args.indexOf("--since");
const sinceDate = sinceIdx >= 0 ? new Date(args[sinceIdx + 1]!).getTime() : undefined;
const tierIdx = args.indexOf("--tier");
const tier: ExpertTier = (tierIdx >= 0 ? args[tierIdx + 1] as ExpertTier : "independent") ?? "independent";

if (!handle) {
  console.error("Usage: bun scripts/twitter-import-timeline.ts <handle> [--limit <n>] [--since <date>] [--tier <tier>]");
  console.error("  Tiers: energy-focused, general-outlet, independent (default)");
  process.exit(1);
}

const main = Effect.gen(function* () {
  // 1. Validate config
  const provider = ConfigProvider.fromEnv();
  const config = yield* validateKeys({ ...OperatorKeys, ...TwitterKeys }, provider);

  console.log(`Fetching timeline for @${handle} (limit: ${limit})...`);

  // 2. Scrape profile + tweets (isolated scraper scope — restore cookies first)
  const { profile, tweets } = yield* Effect.gen(function* () {
    yield* restoreCookies(config.twitterCookiePath);
    const pub = yield* TwitterPublic;
    const profile = yield* pub.getProfile(handle!);
    const tweets = yield* Stream.runCollect(
      pub.getTweets(handle!, { limit })
    );
    return { profile, tweets };
  }).pipe(Effect.provide(scraperLayer));

  let tweetArray = Chunk.toArray(tweets);
  console.log(`Fetched ${tweetArray.length} tweets from @${profile.username ?? handle}`);

  // 3. Apply --since filter
  if (sinceDate !== undefined) {
    const before = tweetArray.length;
    tweetArray = tweetArray.filter(
      (t) => t.timestamp !== undefined && t.timestamp * 1000 >= sinceDate
    );
    console.log(`Filtered to ${tweetArray.length} tweets since ${new Date(sinceDate).toISOString()} (dropped ${before - tweetArray.length})`);
  }

  if (tweetArray.length === 0) {
    console.log("No tweets to import.");
    return;
  }

  // 4. Normalize
  const normalizedExpert = normalizeProfile(profile, tier);
  if (!normalizedExpert) {
    console.error("Profile normalization failed (missing userId)");
    return yield* Effect.fail(new Error("Profile normalization failed"));
  }

  const posts = tweetArray
    .map(normalizeTweet)
    .filter((p): p is NonNullable<typeof p> => p !== null);

  console.log(`Normalized ${posts.length} posts for ${normalizedExpert.handle} (${normalizedExpert.did})`);

  // 5. Import to staging
  const result = yield* importPosts(config.baseUrl, config.operatorSecret, {
    experts: [normalizedExpert],
    posts,
    operatorOverride: false
  });
  console.log(`Import: ${result.imported} imported, ${result.skipped} skipped, ${result.flagged} flagged`);
});

Effect.runPromise(main).catch((e) => {
  console.error("Failed:", e.message ?? e);
  process.exit(1);
});
```

**Step 2: Test manually**

Run: `cd /Users/pooks/Dev/skygest-editorial && bun scripts/twitter-import-timeline.ts BlakeShaworthy --limit 5`
Expected: Fetches profile + 5 recent tweets, normalizes, imports.

**Step 3: Commit**

```bash
cd /Users/pooks/Dev/skygest-editorial
git add scripts/twitter-import-timeline.ts
git commit -m "feat: add twitter-import-timeline script (SKY-180)"
```

---

## Task 8: Build twitter-search.ts script

Search tweets by keyword and import matching results.

**Files:**
- Create: `skygest-editorial/scripts/twitter-search.ts`

**Step 1: Write the script**

```typescript
#!/usr/bin/env bun
/**
 * Search Twitter and import matching tweets.
 *
 * Usage: bun scripts/twitter-search.ts <query> [--limit <n>] [--mode <top|latest>] [--curate]
 *
 * Searches Twitter for the given query, normalizes results, imports to staging.
 */
import { Effect, ConfigProvider, Stream, Chunk } from "effect";
import { TwitterSearch } from "@pooks/twitter-scraper";
import { OperatorKeys, TwitterKeys } from "@skygest/platform/ConfigShapes";
import { validateKeys } from "@skygest/platform/ConfigValidation";
import { normalizeTweet } from "@skygest/ops/TwitterNormalizer";
import { scraperLayer, restoreCookies } from "../src/twitter/ScraperLayer";
import { importPosts, curatePost } from "../src/twitter/ImportClient";
import type { NormalizedPost } from "@skygest/ops/TwitterNormalizer";
import type { ImportExpertInput } from "@skygest/domain/api";

const args = process.argv.slice(2);
const query = args.find((a) => !a.startsWith("--"));
const limitIdx = args.indexOf("--limit");
const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1]!, 10) : 20;
const modeIdx = args.indexOf("--mode");
const mode = (modeIdx >= 0 ? args[modeIdx + 1] : "top") as "top" | "latest";
const shouldCurate = args.includes("--curate");

if (!query) {
  console.error("Usage: bun scripts/twitter-search.ts <query> [--limit <n>] [--mode <top|latest>] [--curate]");
  process.exit(1);
}

const main = Effect.gen(function* () {
  // 1. Validate config
  const provider = ConfigProvider.fromEnv();
  const config = yield* validateKeys({ ...OperatorKeys, ...TwitterKeys }, provider);

  console.log(`Searching: "${query}" (mode: ${mode}, limit: ${limit})...`);

  // 2. Search (isolated scraper scope — restore cookies first)
  const tweets = yield* Effect.gen(function* () {
    yield* restoreCookies(config.twitterCookiePath);
    const search = yield* TwitterSearch;
    return yield* Stream.runCollect(
      search.searchTweets(query!, { limit, mode })
    );
  }).pipe(Effect.provide(scraperLayer));

  const tweetArray = Chunk.toArray(tweets);
  console.log(`Found ${tweetArray.length} tweets`);

  if (tweetArray.length === 0) {
    console.log("No results to import.");
    return;
  }

  // 3. Normalize
  const posts: NormalizedPost[] = [];
  const expertDids = new Set<string>();
  const experts: ImportExpertInput[] = [];

  for (const tweet of tweetArray) {
    const normalized = normalizeTweet(tweet);
    if (!normalized) continue;
    posts.push(normalized);

    if (!expertDids.has(normalized.did)) {
      expertDids.add(normalized.did);
      experts.push({
        did: normalized.did,
        handle: tweet.username ?? tweet.userId ?? "unknown",
        domain: "energy",
        source: "twitter-import" as const,
        tier: "independent"
      });
    }
  }

  console.log(`Normalized ${posts.length} posts from ${experts.length} experts`);

  // 4. Import to staging
  const result = yield* importPosts(config.baseUrl, config.operatorSecret, {
    experts,
    posts,
    operatorOverride: true
  });
  console.log(`Import: ${result.imported} imported, ${result.skipped} skipped, ${result.flagged} flagged`);

  // 5. Auto-curate if requested
  if (shouldCurate && result.imported > 0) {
    for (const post of posts) {
      const curation = yield* curatePost(config.baseUrl, config.operatorSecret, {
        postUri: post.uri,
        action: "curate"
      }).pipe(
        Effect.catchAll((e) =>
          Effect.succeed({ postUri: post.uri, action: "curate" as const, previousStatus: null, newStatus: `failed: ${e.message}` as const })
        )
      );
      console.log(`  Curated ${post.uri}: ${curation.newStatus}`);
    }
  }
});

Effect.runPromise(main).catch((e) => {
  console.error("Failed:", e.message ?? e);
  process.exit(1);
});
```

**Step 2: Test manually**

Run: `cd /Users/pooks/Dev/skygest-editorial && bun scripts/twitter-search.ts "energy storage" --limit 5 --mode latest`
Expected: Searches, normalizes, imports.

**Step 3: Commit**

```bash
cd /Users/pooks/Dev/skygest-editorial
git add scripts/twitter-search.ts
git commit -m "feat: add twitter-search script (SKY-180)"
```

---

## Task 9: Update CLAUDE.md and morning-curation skill

Document the twitter ingestion capabilities in the editorial workspace context. The morning-curation skill gets a note about twitter import but does NOT require twitter setup — it's opt-in.

**Files:**
- Modify: `skygest-editorial/CLAUDE.md`
- Modify: `skygest-editorial/.claude/skills/morning-curation/SKILL.md`

**Step 1: Add Twitter scripts section to CLAUDE.md**

After the "Where things live" section (line 44) in `CLAUDE.md`, add:

```markdown

## Twitter ingestion (local)

Bluesky posts arrive via cloud ingestion (Cloudflare Worker polling). Twitter posts are ingested locally via scraper scripts, then imported to staging via the operator API.

Scripts (all in `scripts/`):
- `bun scripts/twitter-import-url.ts <url> [--curate]` — paste a tweet URL to import + optionally curate
- `bun scripts/twitter-import-bookmarks.ts [--limit <n>] [--curate]` — import your recent bookmarks
- `bun scripts/twitter-import-timeline.ts <handle> [--limit <n>] [--since <date>]` — import an expert's recent tweets
- `bun scripts/twitter-search.ts <query> [--limit <n>] [--mode <top|latest>] [--curate]` — search and import

These scripts require `TWITTER_COOKIE_PATH` in `.env` (see `.env.example`). They validate this alongside operator credentials before running. The general `validate-config.ts` and morning curation workflow do NOT require Twitter setup.

Imported tweets use `x://` URIs (e.g., `x://12345/status/67890`). They appear in `list_curation_candidates` alongside Bluesky posts and can be curated, enriched, and picked via the same MCP tools. Thread expansion (`get_post_thread`) is Bluesky-only — Twitter posts are evaluated on their standalone content + enrichment.

If cookies are stale, re-extract from Chrome and update the cookie file at the path in `TWITTER_COOKIE_PATH`.
```

**Step 2: Add twitter awareness to morning-curation skill**

In `skygest-editorial/.claude/skills/morning-curation/SKILL.md`, after step 1 ("Pull candidates"), add a sub-bullet:

```markdown
   - If the editor mentions bookmarks, recent tweets, or a specific tweet URL, offer to run the appropriate twitter import script first (`bun scripts/twitter-import-url.ts`, `bun scripts/twitter-import-bookmarks.ts`, etc.) before pulling candidates. This is optional — morning curation works without Twitter setup.
```

**Step 3: Commit**

```bash
cd /Users/pooks/Dev/skygest-editorial
git add CLAUDE.md .claude/skills/morning-curation/SKILL.md
git commit -m "docs: document twitter ingestion in CLAUDE.md and curation skill (SKY-180)"
```

---

## Out of scope (documented for future tickets)

- **Twitter cookie freshness validation** — `TwitterKeys` currently checks the path is non-empty but not that the file exists, contains valid JSON, or has unexpired cookies. Extension point: add a validation script that parses cookie expiry dates.
- **Twitter thread expansion in MCP** — `get_post_thread` / `get_thread_document` are Bluesky-only. Wiring the scraper's `getTweet` detail + `getReplyTree`/`getSelfThread` projections into an MCP tool would require running the scraper server-side, blocked by CycleTLS not running on CF Workers.
- **SKY-142** — Fresh checkout requiring linked scraper. The editorial `file:` dependency inherits this coupling. A future fix should make the scraper a proper npm package.
- **Operator secret naming unification** — `OPERATOR_SECRET` (worker) vs `SKYGEST_OPERATOR_SECRET` (editorial). Not addressed here.
- **StagingOperatorClient consolidation** — The editorial ImportClient duplicates ~60 lines of HTTP plumbing. If the MCP dependency in StagingOperatorClient is ever factored out, editorial could import it directly via the `@skygest/ops/*` mapping.
