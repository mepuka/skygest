# SKY-180: Editorial Twitter Ingestion Scripts

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Give the editorial workspace (`skygest-editorial`) full local Twitter ingestion capabilities — import from URL, bookmarks, timeline, and search — using the `@pooks/twitter-scraper` library and posting normalized results to staging via the operator API.

**Architecture:** Each script follows a three-phase pattern: (1) validate config (operator secret + cookie path), (2) scrape tweets using the scraper's `authenticatedLayer` in an isolated Effect scope (CycleTLS conflicts with FetchHttpClient), (3) normalize via the shared `TwitterNormalizer` and POST to staging's `/admin/import/posts`. The scraper layer is provided per-command, never globally. Config validation uses the SKY-182 `validateKeys` infrastructure with a new `TwitterKeys` shape added to `ConfigShapes.ts`.

**Tech Stack:** Effect 4, `@pooks/twitter-scraper` (linked), Bun, `@skygest/domain/*` and `@skygest/platform/*` path mappings from `skygest-cloudflare`.

**Repos:** Changes span both `skygest-cloudflare` (config shapes, path mappings) and `skygest-editorial` (scripts, layers, docs).

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

export const TwitterKeys = {
  twitterCookiePath: Config.string("TWITTER_COOKIE_PATH")
} as const;
```

No default — a missing cookie path should be a validation error in editorial. The path points to the JSON file containing serialized auth cookies (e.g., `../better_twitter_scraper/tests/live-auth-cookies.local.json`).

**Step 2: Write the failing test**

In `skygest-cloudflare/tests/platform/ConfigShapes.test.ts`, add a test group for `TwitterKeys`:

```typescript
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

Give the editorial repo access to the `TwitterNormalizer` (via path mapping) and the `@pooks/twitter-scraper` package (via `bun link`).

**Files:**
- Modify: `skygest-editorial/tsconfig.json`
- Modify: `skygest-editorial/package.json`
- Modify: `skygest-editorial/.env.example`
- Modify: `skygest-editorial/.gitignore` (if not already ignoring cookies)

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

**Step 2: Link the scraper package**

```bash
cd /Users/pooks/Dev/skygest-editorial
bun link @pooks/twitter-scraper
```

This creates a symlink in `node_modules/@pooks/twitter-scraper` → `../better_twitter_scraper`. Verify with:

```bash
ls -la node_modules/@pooks/twitter-scraper
```

**Step 3: Update .env.example**

Add the twitter cookie path to `skygest-editorial/.env.example`:

```
# Skygest staging credentials
SKYGEST_STAGING_BASE_URL=https://skygest-bi-agent-staging.kokokessy.workers.dev
SKYGEST_OPERATOR_SECRET=your-operator-secret-here

# Twitter ingestion
TWITTER_COOKIE_PATH=../better_twitter_scraper/tests/live-auth-cookies.local.json
```

**Step 4: Update .env with actual values**

In your local `skygest-editorial/.env`, add:

```
TWITTER_COOKIE_PATH=../better_twitter_scraper/tests/live-auth-cookies.local.json
```

**Step 5: Verify typecheck**

Run: `cd /Users/pooks/Dev/skygest-editorial && bun run typecheck`
Expected: PASS (no new TS errors)

**Step 6: Commit**

```bash
cd /Users/pooks/Dev/skygest-editorial
git add tsconfig.json package.json .env.example
git commit -m "feat: add ops path mapping and twitter scraper dependency (SKY-180)"
```

---

## Task 3: Build editorial ScraperLayer

Create the authenticated scraper layer for editorial scripts. Uses `TwitterScraper.authenticatedLayer()` (provides ALL services: TwitterPublic, TwitterTweets, TwitterSearch, TwitterLists) with cookie restoration from the config-validated path.

**Files:**
- Create: `skygest-editorial/src/twitter/ScraperLayer.ts`

**Step 1: Write ScraperLayer.ts**

```typescript
/**
 * Authenticated Twitter scraper layer for editorial scripts.
 *
 * Uses TwitterScraper.authenticatedLayer() which provides all services:
 * TwitterPublic, TwitterTweets (incl. bookmarks), TwitterSearch, TwitterLists.
 *
 * IMPORTANT: This layer provides HttpClient via CycleTLS, which conflicts
 * with FetchHttpClient used for staging API calls. Provide this layer ONLY
 * within scraper Effect blocks, not globally.
 */
import { Effect, Layer } from "effect";
import {
  CookieManager,
  TwitterScraper,
  UserAuth
} from "@pooks/twitter-scraper";

/**
 * Build the authenticated scraper layer with cookies loaded from disk.
 *
 * @param cookiePath - Absolute or relative path to the serialized cookie JSON file
 */
export const makeScraperLayer = (cookiePath: string) => {
  const restoreCookies = Layer.effectDiscard(
    Effect.gen(function* () {
      const cookies = yield* CookieManager;
      const text = yield* Effect.tryPromise(() => Bun.file(cookiePath).text());
      const raw = JSON.parse(text) as ReadonlyArray<{
        name: string;
        value: string;
      }>;
      yield* cookies.restoreSerializedCookies(raw);
    })
  );

  return TwitterScraper.authenticatedLayer().pipe(
    Layer.provideMerge(restoreCookies)
  );
};
```

**Step 2: Verify typecheck**

Run: `cd /Users/pooks/Dev/skygest-editorial && bun run typecheck`
Expected: PASS

**Step 3: Commit**

```bash
cd /Users/pooks/Dev/skygest-editorial
git add src/twitter/ScraperLayer.ts
git commit -m "feat: add authenticated scraper layer for editorial (SKY-180)"
```

---

## Task 4: Build editorial ImportClient

Create a thin Effect service for POSTing normalized tweets to staging. Only needs `importPosts` and `curatePost` — much simpler than the full `StagingOperatorClient`.

**Files:**
- Create: `skygest-editorial/src/twitter/ImportClient.ts`

**Step 1: Write ImportClient.ts**

```typescript
/**
 * Thin HTTP client for posting normalized tweets to the staging import API.
 *
 * Uses FetchHttpClient (not CycleTLS) — safe to use outside scraper scope.
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
Expected: PASS

**Step 3: Commit**

```bash
cd /Users/pooks/Dev/skygest-editorial
git add src/twitter/ImportClient.ts
git commit -m "feat: add import client for staging API (SKY-180)"
```

---

## Task 5: Update validate-config.ts for Twitter keys

Extend the existing config validation script to check both operator keys and twitter keys.

**Files:**
- Modify: `skygest-editorial/scripts/validate-config.ts`

**Step 1: Update validate-config.ts**

Replace the full file:

```typescript
import { Effect, ConfigProvider } from "effect";
import { OperatorKeys, TwitterKeys } from "@skygest/platform/ConfigShapes";
import { validateKeys, ConfigValidationError } from "@skygest/platform/ConfigValidation";

/** All keys required for editorial twitter workflows. */
const EditorialKeys = {
  ...OperatorKeys,
  ...TwitterKeys
} as const;

const main = Effect.gen(function* () {
  const provider = ConfigProvider.fromEnv();

  const config = yield* validateKeys(EditorialKeys, provider).pipe(
    Effect.catch((error: ConfigValidationError) =>
      Effect.gen(function* () {
        console.error(error.summary);
        return yield* Effect.fail(error);
      })
    )
  );

  console.log("Config validation passed:");
  console.log("  SKYGEST_STAGING_BASE_URL:", config.baseUrl.href);
  console.log("  SKYGEST_OPERATOR_SECRET: [set]");
  console.log("  TWITTER_COOKIE_PATH:", config.twitterCookiePath);
});

Effect.runPromise(main).catch(() => process.exit(1));
```

**Step 2: Run validation**

Run: `cd /Users/pooks/Dev/skygest-editorial && bun scripts/validate-config.ts`
Expected: PASS if `.env` has all three vars, or clear error summary showing which are missing.

**Step 3: Commit**

```bash
cd /Users/pooks/Dev/skygest-editorial
git add scripts/validate-config.ts
git commit -m "feat: validate twitter cookie path in config check (SKY-180)"
```

---

## Task 6: Build twitter-import-url.ts script

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
 */
import { Effect, ConfigProvider, Option, Redacted, Stream } from "effect";
import { TwitterPublic, TwitterTweets } from "@pooks/twitter-scraper";
import { OperatorKeys, TwitterKeys } from "@skygest/platform/ConfigShapes";
import { validateKeys } from "@skygest/platform/ConfigValidation";
import { parsePostUrl } from "@skygest/domain/ingestUrl";
import { normalizeTweetDetail, normalizeProfile } from "@skygest/ops/TwitterNormalizer";
import { makeScraperLayer } from "../src/twitter/ScraperLayer";
import { importPosts, curatePost } from "../src/twitter/ImportClient";
import type { ExpertTier } from "@skygest/domain/bi";

const args = process.argv.slice(2);
const url = args.find((a) => !a.startsWith("--"));
const shouldCurate = args.includes("--curate");
const tierIdx = args.indexOf("--tier");
const tier: ExpertTier = (tierIdx >= 0 ? args[tierIdx + 1] as ExpertTier : "t3") ?? "t3";

if (!url) {
  console.error("Usage: bun scripts/twitter-import-url.ts <url> [--curate] [--tier <tier>]");
  console.error("  Supported: https://x.com/<handle>/status/<id>");
  console.error("             https://twitter.com/<handle>/status/<id>");
  process.exit(1);
}

const main = Effect.gen(function* () {
  // 1. Validate config
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
  const scraperLayer = makeScraperLayer(config.twitterCookiePath);

  const { detail, profile } = yield* Effect.gen(function* () {
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
    console.log(`Curated: ${curation.status}`);
  }
});

Effect.runPromise(main).catch((e) => {
  console.error("Failed:", e.message ?? e);
  process.exit(1);
});
```

**Step 2: Test manually**

Run: `cd /Users/pooks/Dev/skygest-editorial && bun scripts/twitter-import-url.ts https://x.com/BlakeShaworthy/status/1234567890 --curate`
Expected: Fetches tweet, normalizes, imports, curates. Output shows import counts.

**Step 3: Commit**

```bash
cd /Users/pooks/Dev/skygest-editorial
git add scripts/twitter-import-url.ts
git commit -m "feat: add twitter-import-url script (SKY-180)"
```

---

## Task 7: Build twitter-import-bookmarks.ts script

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
import { Effect, ConfigProvider, Redacted, Stream, Chunk } from "effect";
import { TwitterTweets, TwitterPublic } from "@pooks/twitter-scraper";
import { OperatorKeys, TwitterKeys } from "@skygest/platform/ConfigShapes";
import { validateKeys } from "@skygest/platform/ConfigValidation";
import { normalizeTweet, normalizeProfile } from "@skygest/ops/TwitterNormalizer";
import { makeScraperLayer } from "../src/twitter/ScraperLayer";
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

  // 2. Scrape bookmarks (isolated scraper scope)
  const scraperLayer = makeScraperLayer(config.twitterCookiePath);

  const tweets = yield* Effect.gen(function* () {
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
        tier: "t3"
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
      }).pipe(Effect.catchAll((e) => Effect.succeed({ status: `failed: ${e.message}` })));
      console.log(`  Curated ${post.uri}: ${curation.status}`);
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

## Task 8: Build twitter-import-timeline.ts script

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
 */
import { Effect, ConfigProvider, Redacted, Stream, Chunk } from "effect";
import { TwitterPublic } from "@pooks/twitter-scraper";
import { OperatorKeys, TwitterKeys } from "@skygest/platform/ConfigShapes";
import { validateKeys } from "@skygest/platform/ConfigValidation";
import { normalizeTweet, normalizeProfile } from "@skygest/ops/TwitterNormalizer";
import { makeScraperLayer } from "../src/twitter/ScraperLayer";
import { importPosts } from "../src/twitter/ImportClient";
import type { ExpertTier } from "@skygest/domain/bi";

const args = process.argv.slice(2);
const handle = args.find((a) => !a.startsWith("--"));
const limitIdx = args.indexOf("--limit");
const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1]!, 10) : 20;
const sinceIdx = args.indexOf("--since");
const sinceDate = sinceIdx >= 0 ? new Date(args[sinceIdx + 1]!).getTime() : undefined;
const tierIdx = args.indexOf("--tier");
const tier: ExpertTier = (tierIdx >= 0 ? args[tierIdx + 1] as ExpertTier : "t3") ?? "t3";

if (!handle) {
  console.error("Usage: bun scripts/twitter-import-timeline.ts <handle> [--limit <n>] [--since <date>] [--tier <tier>]");
  process.exit(1);
}

const main = Effect.gen(function* () {
  // 1. Validate config
  const provider = ConfigProvider.fromEnv();
  const config = yield* validateKeys({ ...OperatorKeys, ...TwitterKeys }, provider);

  console.log(`Fetching timeline for @${handle} (limit: ${limit})...`);

  // 2. Scrape profile + tweets (isolated scraper scope)
  const scraperLayer = makeScraperLayer(config.twitterCookiePath);

  const { profile, tweets } = yield* Effect.gen(function* () {
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

## Task 9: Build twitter-search.ts script

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
import { makeScraperLayer } from "../src/twitter/ScraperLayer";
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

  // 2. Search (isolated scraper scope)
  const scraperLayer = makeScraperLayer(config.twitterCookiePath);

  const tweets = yield* Effect.gen(function* () {
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
        tier: "t3"
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
      }).pipe(Effect.catchAll((e) => Effect.succeed({ status: `failed: ${e.message}` })));
      console.log(`  Curated ${post.uri}: ${curation.status}`);
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

## Task 10: Update CLAUDE.md and morning-curation skill

Document the twitter ingestion capabilities in the editorial workspace context.

**Files:**
- Modify: `skygest-editorial/CLAUDE.md`
- Modify: `skygest-editorial/.claude/skills/morning-curation/SKILL.md`

**Step 1: Add Twitter scripts section to CLAUDE.md**

After the "Where things live" section in `CLAUDE.md`, add:

```markdown
## Twitter ingestion (local)

Bluesky posts arrive via cloud ingestion (Cloudflare Worker polling). Twitter posts are ingested locally via scraper scripts, then imported to staging via the operator API.

Scripts (all in `scripts/`):
- `bun scripts/twitter-import-url.ts <url> [--curate]` — paste a tweet URL to import + optionally curate
- `bun scripts/twitter-import-bookmarks.ts [--limit <n>] [--curate]` — import your recent bookmarks
- `bun scripts/twitter-import-timeline.ts <handle> [--limit <n>] [--since <date>]` — import an expert's recent tweets
- `bun scripts/twitter-search.ts <query> [--limit <n>] [--mode <top|latest>] [--curate]` — search and import

All scripts validate config first (`SKYGEST_OPERATOR_SECRET`, `SKYGEST_STAGING_BASE_URL`, `TWITTER_COOKIE_PATH`). If cookies are stale, re-extract from Chrome and update the cookie file.

Imported tweets use `x://` URIs (e.g., `x://12345/status/67890`). They appear in `list_curation_candidates` alongside Bluesky posts and can be curated, enriched, and picked via the same MCP tools. Thread expansion (`get_post_thread`) is Bluesky-only — Twitter posts are evaluated on their standalone content + enrichment.
```

**Step 2: Add twitter awareness to morning-curation skill**

In `skygest-editorial/.claude/skills/morning-curation/SKILL.md`, add a note after step 1:

After the line `1. **Pull candidates** — call `list_curation_candidates`...`, add:

```markdown
   - If the editor mentions bookmarks, recent tweets, or a specific tweet URL, run the appropriate twitter import script first (`bun scripts/twitter-import-url.ts`, `bun scripts/twitter-import-bookmarks.ts`, etc.) before pulling candidates. This ensures fresh Twitter content is available for curation.
```

**Step 3: Commit**

```bash
cd /Users/pooks/Dev/skygest-editorial
git add CLAUDE.md .claude/skills/morning-curation/SKILL.md
git commit -m "docs: document twitter ingestion in CLAUDE.md and curation skill (SKY-180)"
```

---

## Task 11: Update morning-curation.sh to validate twitter config

The shell entry point should validate twitter config alongside operator config.

**Files:**
- Modify: `skygest-editorial/scripts/morning-curation.sh`

**Step 1: No code change needed**

The `morning-curation.sh` already calls `bun scripts/validate-config.ts` (line 15), and we updated that script in Task 5 to validate `TwitterKeys` alongside `OperatorKeys`. The shell script automatically gets twitter validation for free.

Verify by running:

Run: `cd /Users/pooks/Dev/skygest-editorial && ./scripts/morning-curation.sh`
Expected: "Config validation passed" showing all three keys (base URL, operator secret, cookie path).

**Step 2: Commit (skip if no changes)**

No commit needed — validation was already wired in Task 5.

---

## Out of scope (documented for future tickets)

- **Twitter cookie freshness validation** — `TwitterKeys` currently only checks the path exists as a string. A future enhancement could read the file, parse cookie expiry dates, and fail if cookies are stale. Extension point: add a `Config.mapOrFail` in `TwitterKeys` that reads and validates the file.
- **Twitter thread expansion in MCP** — `get_post_thread` / `get_thread_document` are Bluesky-only. Wiring the scraper's `getTweet` detail + `getReplyTree`/`getSelfThread` projections into an MCP tool would require running the scraper server-side, which is blocked by CycleTLS not running on CF Workers.
- **SKY-142** — Fresh checkout requiring linked scraper. The editorial dependency on `@pooks/twitter-scraper` inherits this issue. A future fix should make the scraper a proper npm package or use lazy loading.
- **Operator secret naming unification** — `OPERATOR_SECRET` (worker) vs `SKYGEST_OPERATOR_SECRET` (editorial). Not addressed here.
