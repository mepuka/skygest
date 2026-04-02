# Quick-Ingest CLI Command Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add an `ops ingest-url <url>` CLI command that imports a Bluesky or Twitter post, curates it, and lets enrichment start automatically — all in one step.

**Architecture:** CLI-first. The command orchestrates existing remote endpoints (`importPosts` + `curatePost`) via `StagingOperatorClient`. No new MCP tool — the CLI handles both platforms locally. For Twitter, the scraper fetches the tweet. For Bluesky, a lightweight `BlueskyClient` layer fetches the thread from the public API. `curatePost` already queues enrichment internally, so no separate enrichment step. Topic gate bypass is an explicit `operatorOverride` flag on the import endpoint, not a change to default batch behavior.

**Tech Stack:** Effect.ts 4 CLI (`effect/unstable/cli`), StagingOperatorClient (HTTP), BlueskyClient (AT Protocol XRPC), `@pooks/twitter-scraper` (CycleTLS)

---

## Design Decisions (from code review)

1. **No cross-platform MCP tool.** Ship CLI first. If MCP convenience matters later, add a Bluesky-only MCP tool separately.
2. **No separate enrichment step.** `curatePost` already calls `queuePickedEnrichment` for both Twitter (line 231) and Bluesky (line 294) of `CurationService.ts`. `start_enrichment` stays as a manual retry tool.
3. **Avoid double Bluesky fetch.** The CLI captures embed payload at import time. `curatePost`'s Bluesky path is updated to use stored payload when one exists, mirroring the Twitter path. This eliminates a redundant thread fetch.
4. **Explicit topic override.** Add `operatorOverride` flag to `ImportPostsInput`. When true, posts with zero topic matches are still imported. Default batch import behavior is unchanged.
5. **Detailed return shape.** CLI reports whether post was newly imported or already existed, curation state change, and enrichment status.

## Implementation Notes (from architecture review)

- **`ExpertSource` needs `"bluesky-import"`** — The current `ExpertSource` schema in `src/domain/bi.ts` only has `"manual"`, `"starter_pack"`, `"list"`, `"network"`, `"twitter-import"`. Task 4 adds `"bluesky-import"` for provenance tracking.
- **`tierOption` has no default** — The existing `tierOption` in `Cli.ts` is required. The `ingest-url` command defines its own with `Flag.withDefault("energy-focused")` to reduce friction.
- **`GetPostThreadResponse.thread` is `Schema.Unknown`** — Use `flattenThread` from `src/bluesky/ThreadFlatten.ts` to safely decode the thread, not raw property access. This matches the pattern in `CurationService.ts`.
- **`StagingOperatorClient` needs no changes** — It passes raw input as JSON body via `jsonBody(input)`. The `operatorOverride` field flows through automatically.
- **CycleTLS/FetchHttpClient isolation** — The `blueskyCliLayer` uses `FetchHttpClient.layer`, scoped via `Effect.provide(blueskyCliLayer)`. The `scraperLayer` is similarly scoped. Neither leaks into the shared layer. This mirrors the existing pattern in `runTwitterImportTweet`.
- **`buildTypedEmbed` and `extractEmbedKind`** — Verify these are exported from `src/bluesky/EmbedExtract.ts`. If not, extract them from `CurationService.ts` first.
- **External link card in links array** — When embed is `"external"`, add the card URL to the `links` array so `hasLinks` is correct. The Twitter normalizer already does this for tweet URLs.

---

## Task 1: URL Parser

**Files:**
- Create: `src/domain/ingestUrl.ts`
- Create: `tests/ingest-url-parser.test.ts`

### Step 1: Write the failing test

```ts
// tests/ingest-url-parser.test.ts
import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { parsePostUrl } from "../src/domain/ingestUrl";

describe("parsePostUrl", () => {
  it.effect("parses bsky.app URL", () =>
    Effect.gen(function* () {
      const result = parsePostUrl("https://bsky.app/profile/simonevans.bsky.social/post/3abc123");
      expect(result.platform).toBe("bluesky");
      expect(result.handle).toBe("simonevans.bsky.social");
      expect(result.id).toBe("3abc123");
    })
  );

  it.effect("parses x.com URL", () =>
    Effect.gen(function* () {
      const result = parsePostUrl("https://x.com/DrSimEvans/status/123456789");
      expect(result.platform).toBe("twitter");
      expect(result.handle).toBe("DrSimEvans");
      expect(result.id).toBe("123456789");
    })
  );

  it.effect("parses twitter.com URL", () =>
    Effect.gen(function* () {
      const result = parsePostUrl("https://twitter.com/DrSimEvans/status/123456789");
      expect(result.platform).toBe("twitter");
      expect(result.handle).toBe("DrSimEvans");
      expect(result.id).toBe("123456789");
    })
  );

  it.effect("throws for unsupported URL", () =>
    Effect.gen(function* () {
      expect(() => parsePostUrl("https://mastodon.social/@user/123")).toThrow(/Unsupported URL/);
    })
  );

  it.effect("throws for malformed input", () =>
    Effect.gen(function* () {
      expect(() => parsePostUrl("not-a-url")).toThrow(/Unsupported URL/);
    })
  );
});
```

### Step 2: Run test to verify it fails

Run: `bun run test tests/ingest-url-parser.test.ts`
Expected: FAIL — module not found

### Step 3: Write minimal implementation

```ts
// src/domain/ingestUrl.ts
import type { Platform } from "./types";

export type ParsedPostUrl = {
  readonly platform: Platform;
  readonly handle: string;
  readonly id: string;
};

const BSKY_RE = /^https:\/\/bsky\.app\/profile\/([^/]+)\/post\/([a-zA-Z0-9]+)$/;
const TWITTER_RE = /^https:\/\/(?:x\.com|twitter\.com)\/([^/]+)\/status\/(\d+)$/;

export const parsePostUrl = (url: string): ParsedPostUrl => {
  const bsky = BSKY_RE.exec(url);
  if (bsky) return { platform: "bluesky", handle: bsky[1], id: bsky[2] };

  const twitter = TWITTER_RE.exec(url);
  if (twitter) return { platform: "twitter", handle: twitter[1], id: twitter[2] };

  throw new Error(
    `Unsupported URL format. Supported:\n` +
    `  https://bsky.app/profile/<handle>/post/<rkey>\n` +
    `  https://x.com/<handle>/status/<id>\n` +
    `  https://twitter.com/<handle>/status/<id>`
  );
};
```

### Step 4: Run test to verify it passes

Run: `bun run test tests/ingest-url-parser.test.ts`
Expected: PASS

### Step 5: Type check

Run: `bunx tsc --noEmit`
Expected: 0 errors

### Step 6: Commit

```bash
git add src/domain/ingestUrl.ts tests/ingest-url-parser.test.ts
git commit -m "feat(domain): add URL parser for quick-ingest (SKY-143)"
```

---

## Task 2: Operator Override on Import Endpoint

Add an explicit `operatorOverride` flag to `ImportPostsInput`. When true, zero-topic-match posts are still imported. Default behavior (skip on zero topics) is unchanged.

**Files:**
- Modify: `src/domain/api.ts` — add flag to schema
- Modify: `src/admin/Router.ts` — respect flag in import handler
- Modify: `tests/import-endpoint.test.ts` — add test for override behavior

### Step 1: Write the failing test

Add to `tests/import-endpoint.test.ts`:

```ts
it.effect("imports post with zero topics when operatorOverride is true", () =>
  Effect.gen(function* () {
    // Post with text that won't match any topics
    const result = yield* importWithOverride({
      experts: [testExpert],
      posts: [{ ...testPost, text: "completely unrelated gibberish" }],
      operatorOverride: true
    });
    expect(result.imported).toBe(1);
    expect(result.skipped).toBe(0);
  })
);
```

### Step 2: Run test to verify it fails

Run: `bun run test tests/import-endpoint.test.ts`
Expected: FAIL — `operatorOverride` not recognized or post still skipped

### Step 3: Add flag to ImportPostsInput schema

In `src/domain/api.ts`, modify `ImportPostsInput`:

```ts
export const ImportPostsInput = Schema.Struct({
  experts: Schema.Array(ImportExpertInput),
  posts: Schema.Array(ImportPostInput),
  operatorOverride: Schema.optionalKey(Schema.Boolean.annotate({
    description: "When true, import posts even with zero topic matches. For operator-submitted posts where the human has already judged relevance."
  }))
});
```

### Step 4: Respect flag in import handler

In `src/admin/Router.ts`, modify the topic matching loop (around line 460):

```ts
if (topics.length === 0 && !payload.operatorOverride) {
  skipped += 1;
  continue;
}
```

No other changes — the rest of the import handler works the same whether topics are empty or not.

### Step 5: Run test to verify it passes

Run: `bun run test tests/import-endpoint.test.ts`
Expected: PASS — including existing test that verifies default skip behavior

### Step 6: Type check

Run: `bunx tsc --noEmit`
Expected: 0 errors

### Step 7: Commit

```bash
git add src/domain/api.ts src/admin/Router.ts tests/import-endpoint.test.ts
git commit -m "feat(import): add operatorOverride flag for topic gate bypass (SKY-143)"
```

---

## Task 3: CuratePost Skip-Fetch When Payload Exists

Currently `curatePost` for Bluesky always fetches the live thread (line 256 of `CurationService.ts`), even if an embed payload was already captured at import time. When the CLI captures embed payload during import, the curation step should use the stored payload instead of re-fetching.

This makes the Bluesky path work like the Twitter path: use stored data when available, only fetch live when no payload exists.

**Files:**
- Modify: `src/services/CurationService.ts`
- Modify: `tests/curation.test.ts` — add test for skip-fetch

### Step 1: Write the failing test

Add to `tests/curation.test.ts`:

```ts
it.effect("curates Bluesky post with stored payload without re-fetching", () =>
  Effect.gen(function* () {
    // Pre-store a payload at "candidate" stage (simulating import with captured embed)
    yield* payloadService.capturePayload({
      postUri: testBlueskyUri,
      captureStage: "candidate",
      embedType: "external",
      embedPayload: { kind: "link", url: "https://example.com", title: "Test" }
    });

    // curatePost should succeed WITHOUT calling BlueskyClient.getPostThread
    const result = yield* curationService.curatePost(
      { postUri: testBlueskyUri, action: "curate" },
      "test-operator"
    );
    expect(result.newStatus).toBe("curated");
    // Verify: no BlueskyApiError thrown (which would happen if it tried to fetch
    // and the test has no real Bluesky backend)
  })
);
```

### Step 2: Run test to verify it fails

Run: `bun run test tests/curation.test.ts`
Expected: FAIL — curatePost tries to fetch thread from Bluesky and fails

### Step 3: Modify curatePost Bluesky path

In `src/services/CurationService.ts`, in the `action === "curate"` Bluesky path (around line 254), check for stored payload first:

```ts
// action === "curate" (Bluesky)
// Check if payload already exists (e.g., captured at import time by CLI ingest-url)
const existingPayload = yield* payloadService.getPayload(input.postUri);
const storedEmbedType = yield* curationRepo.getPostEmbedType(input.postUri);

if (existingPayload !== null && existingPayload.embedPayload != null) {
  // Payload exists from import — use stored data, skip live fetch
  // (mirrors the Twitter path at lines 214-235)
  if (existingPayload.captureStage !== "picked") {
    yield* payloadService.markPicked(input.postUri);
  }

  yield* curationRepo.updateStatus(input.postUri, "curated", curator, input.note ?? null, now);

  yield* queuePickedEnrichment(input.postUri, existingPayload.embedPayload, curator)
    .pipe(Effect.catch(() => Effect.succeed(false)));

  return { postUri: input.postUri, action: input.action, previousStatus, newStatus: "curated" as const };
}

// Guard: if the post has a known embed type but the stored payload is null,
// it cannot be curated yet — same guard as the Twitter path (line 218)
if (storedEmbedType !== null && existingPayload?.embedPayload == null && existingPayload !== null) {
  return yield* new BlueskyApiError({
    message: `Post ${input.postUri} has embed type "${storedEmbedType}" but no stored media data — cannot curate yet`
  });
}

// No stored payload — fetch live thread from Bluesky (existing behavior)
const threadResponse = yield* bskyClient.getPostThread(input.postUri, {
  depth: 0,
  parentHeight: 0
});
// ... rest of existing code unchanged
```

### Step 4: Run test to verify it passes

Run: `bun run test tests/curation.test.ts`
Expected: PASS — all existing tests still pass, new test passes

### Step 5: Type check

Run: `bunx tsc --noEmit`
Expected: 0 errors

### Step 6: Commit

```bash
git add src/services/CurationService.ts tests/curation.test.ts
git commit -m "fix(curation): skip Bluesky thread fetch when stored payload exists (SKY-143)"
```

---

## Task 4: Bluesky Normalizer for CLI

The CLI needs to fetch a Bluesky thread and normalize it to `ImportPostInput` + `ImportExpertInput`, matching the shape that `StagingOperatorClient.importPosts` expects.

**Prerequisite:** Add `"bluesky-import"` to `ExpertSource` in `src/domain/bi.ts`. The current definition is:
```ts
export const ExpertSource = Schema.Literals(["manual", "starter_pack", "list", "network", "twitter-import"]);
```
Change to:
```ts
export const ExpertSource = Schema.Literals(["manual", "starter_pack", "list", "network", "twitter-import", "bluesky-import"]);
```
Without this, the import endpoint will reject the payload with a schema validation error.

**Files:**
- Modify: `src/domain/bi.ts` — add `"bluesky-import"` to `ExpertSource`
- Create: `src/ops/BlueskyNormalizer.ts`
- Create: `tests/bluesky-normalizer.test.ts`

### Step 1: Write the failing test

```ts
// tests/bluesky-normalizer.test.ts
import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { normalizeBlueskyThread } from "../src/ops/BlueskyNormalizer";

// Minimal thread fixture matching GetPostThreadResponse shape
const threadFixture = {
  thread: {
    $type: "app.bsky.feed.defs#threadViewPost",
    post: {
      uri: "at://did:plc:abc123/app.bsky.feed.post/3xyz",
      cid: "bafyrei...",
      author: {
        did: "did:plc:abc123",
        handle: "simonevans.bsky.social",
        displayName: "Simon Evans",
        avatar: "https://cdn.bsky.app/img/avatar/plain/did:plc:abc123/abc@jpeg"
      },
      record: {
        $type: "app.bsky.feed.post",
        text: "UK grid carbon intensity hit a new low",
        createdAt: "2026-03-15T10:30:00.000Z",
        facets: [
          {
            features: [{ $type: "app.bsky.richtext.facet#link", uri: "https://carbonintensity.org.uk" }],
            index: { byteStart: 0, byteEnd: 5 }
          },
          {
            features: [{ $type: "app.bsky.richtext.facet#tag", tag: "energy" }],
            index: { byteStart: 10, byteEnd: 17 }
          }
        ]
      },
      embed: {
        $type: "app.bsky.embed.external#view",
        external: { uri: "https://carbonintensity.org.uk", title: "Carbon Intensity", description: "..." }
      },
      indexedAt: "2026-03-15T10:30:05.000Z"
    }
  }
};

describe("normalizeBlueskyThread", () => {
  it.effect("extracts post data from thread", () =>
    Effect.gen(function* () {
      const result = normalizeBlueskyThread(threadFixture as any);
      expect(result.post.uri).toBe("at://did:plc:abc123/app.bsky.feed.post/3xyz");
      expect(result.post.did).toBe("did:plc:abc123");
      expect(result.post.text).toBe("UK grid carbon intensity hit a new low");
      expect(result.post.hashtags).toEqual(["energy"]);
      expect(result.post.links.length).toBe(1);
      expect(result.post.links[0].url).toBe("https://carbonintensity.org.uk");
    })
  );

  it.effect("extracts expert data from author", () =>
    Effect.gen(function* () {
      const result = normalizeBlueskyThread(threadFixture as any);
      expect(result.expert.did).toBe("did:plc:abc123");
      expect(result.expert.handle).toBe("simonevans.bsky.social");
      expect(result.expert.source).toBe("bluesky-import");
    })
  );

  it.effect("captures embed payload", () =>
    Effect.gen(function* () {
      const result = normalizeBlueskyThread(threadFixture as any);
      expect(result.post.embedType).toBe("link");
      expect(result.post.embedPayload).toBeDefined();
      expect((result.post.embedPayload as any).kind).toBe("link");
    })
  );
});
```

### Step 2: Run test to verify it fails

Run: `bun run test tests/bluesky-normalizer.test.ts`
Expected: FAIL — module not found

### Step 3: Write implementation

```ts
// src/ops/BlueskyNormalizer.ts
import type { GetPostThreadResponse } from "../bluesky/ThreadTypes";
import type { ImportPostInput, ImportExpertInput } from "../domain/api";
import type { PostUri, Did } from "../domain/types";
import { flattenThread } from "../bluesky/ThreadFlatten";
import { buildTypedEmbed, extractEmbedKind } from "../bluesky/EmbedExtract";

/**
 * Normalize a Bluesky thread response into import-ready shapes.
 * Uses flattenThread to safely decode the Schema.Unknown thread,
 * matching the pattern in CurationService.ts.
 */
export const normalizeBlueskyThread = (
  thread: GetPostThreadResponse,
  tierDefault: string = "energy-focused"
): { post: ImportPostInput; expert: ImportExpertInput } => {
  // flattenThread safely decodes the Schema.Unknown thread field
  const flat = flattenThread(thread.thread);
  const focusPost = flat?.focus?.post;

  if (!focusPost) {
    throw new Error("Thread response missing focus post");
  }

  // focusPost.author is typed as ThreadProfileBasic (did, handle?, displayName?, avatar?)
  const author = focusPost.author;
  // focusPost.record is Schema.Unknown — needs manual access
  const record = focusPost.record as Record<string, unknown>;

  const text = typeof record.text === "string" ? record.text : "";
  const createdAtStr = typeof record.createdAt === "string" ? record.createdAt : new Date().toISOString();
  const createdAt = new Date(createdAtStr).getTime();

  // Extract links from facets
  const facets = Array.isArray(record.facets) ? record.facets : [];
  const links: Array<{ url: string; domain: string | null }> = [];
  const hashtags: string[] = [];

  for (const facet of facets) {
    const features = Array.isArray(facet?.features) ? facet.features : [];
    for (const feature of features) {
      if (feature?.$type === "app.bsky.richtext.facet#link" && typeof feature.uri === "string") {
        try {
          links.push({ url: feature.uri, domain: new URL(feature.uri).hostname });
        } catch { /* skip malformed */ }
      }
      if (feature?.$type === "app.bsky.richtext.facet#tag" && typeof feature.tag === "string") {
        hashtags.push(feature.tag);
      }
    }
  }

  // Add external link card URL to links array if embed is external
  // (mirrors TwitterNormalizer which includes card URLs in tweet.urls)
  const embed = focusPost.embed as Record<string, unknown> | null;
  if (embed && typeof embed.$type === "string" && embed.$type.includes("external")) {
    const external = embed.external as Record<string, unknown> | undefined;
    if (external && typeof external.uri === "string") {
      const alreadyInLinks = links.some((l) => l.url === external.uri);
      if (!alreadyInLinks) {
        try {
          links.push({ url: external.uri as string, domain: new URL(external.uri as string).hostname });
        } catch { /* skip malformed */ }
      }
    }
  }

  // Extract embed type and payload
  const embedType = extractEmbedKind(focusPost.embed as any);
  const embedPayload = buildTypedEmbed(focusPost.embed);

  return {
    post: {
      uri: focusPost.uri as PostUri,
      did: author.did as Did,
      text,
      createdAt,
      hashtags: hashtags.length > 0 ? hashtags : undefined,
      embedType: embedType as any,
      embedPayload: embedPayload as any,
      links: links.map((l) => ({ url: l.url, domain: l.domain }))
    } as ImportPostInput,
    expert: {
      did: author.did as Did,
      handle: author.handle ?? "unknown",
      domain: author.handle?.split(".").slice(1).join(".") ?? "bsky.social",
      source: "bluesky-import" as const,
      tier: tierDefault as any,
      displayName: author.displayName,
      avatar: author.avatar
    } as ImportExpertInput
  };
};
```

### Step 4: Run test to verify it passes

Run: `bun run test tests/bluesky-normalizer.test.ts`
Expected: PASS

Note: `buildTypedEmbed` and `extractEmbedKind` are imported from `src/bluesky/EmbedExtract.ts`. Verify these exports exist. If they are currently only used inside `CurationService.ts`, they may need to be extracted to a shared module. If so, extract them before this step.

### Step 5: Type check

Run: `bunx tsc --noEmit`
Expected: 0 errors

### Step 6: Commit

```bash
git add src/ops/BlueskyNormalizer.ts tests/bluesky-normalizer.test.ts
git commit -m "feat(ops): add Bluesky thread normalizer for CLI import (SKY-143)"
```

---

## Task 5: CLI `ingest-url` Command

Compose: parse URL → fetch (scraper or Bluesky API) → importPosts (with operatorOverride) → curatePost. Enrichment starts automatically inside curatePost.

**Files:**
- Modify: `src/ops/Cli.ts`

### Step 1: Add imports and the BlueskyClient layer for CLI

Add to the imports in `Cli.ts`:

```ts
import { Layer } from "effect";  // add Layer to the existing effect import
import { FetchHttpClient } from "effect/unstable/http";
import { BlueskyClient, makeBlueskyClient } from "../bluesky/BlueskyClient";
import { parsePostUrl } from "../domain/ingestUrl";
import { normalizeBlueskyThread } from "./BlueskyNormalizer";
```

The BlueskyClient needs `HttpClient.HttpClient`. For CLI use, provide a minimal layer using FetchHttpClient (NOT CycleTLS — that would conflict with StagingOperatorClient). Scoped via `Effect.provide()` like scraperLayer.

```ts
const blueskyCliLayer = Layer.effect(
  BlueskyClient,
  makeBlueskyClient("https://public.api.bsky.app")
).pipe(Layer.provide(FetchHttpClient.layer));
```

Add a local tier option with a default (the existing `tierOption` has no default and would force `--tier` on every invocation):

```ts
const ingestTierOption = Flag.choice("tier", expertTiers).pipe(
  Flag.withDescription("Expert tier (default: energy-focused)"),
  Flag.withDefault("energy-focused")
);
```

### Step 2: Add the ingest-url runner

```ts
import { parsePostUrl } from "../domain/ingestUrl";
import { normalizeBlueskyThread } from "./BlueskyNormalizer";

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

    const parsed = parsePostUrl(options.url);
    yield* Console.log(`Ingesting ${parsed.platform} post: ${options.url}`);

    let importInput: any;

    if (parsed.platform === "twitter") {
      // Fetch via scraper (same pattern as runTwitterImportTweet)
      const { focal, profile } = yield* Effect.gen(function* () {
        const twitter = yield* TwitterPublic;
        const tweetsSvc = yield* TwitterTweets;
        const doc = yield* tweetsSvc.getTweet(parsed.id);
        const focal = doc.tweets.find((t) => t.id === doc.focalTweetId);
        if (!focal) return { focal: null as TweetDetailNode | null, profile: null as any };
        const profile = yield* twitter.getProfile(focal.username ?? focal.userId ?? "");
        return { focal, profile };
      }).pipe(Effect.provide(scraperLayer));

      if (!focal) {
        yield* Console.log("Tweet not found");
        return;
      }

      const post = normalizeTweetDetail(focal);
      if (post === null) {
        yield* Console.log("Tweet missing userId, skipping");
        return;
      }

      const expert = normalizeProfile(profile, options.tier as ExpertTier);
      importInput = {
        experts: expert !== null ? [expert] : [],
        posts: [post],
        operatorOverride: true
      };
    } else {
      // Fetch via Bluesky public API
      const { post, expert } = yield* Effect.gen(function* () {
        const bsky = yield* BlueskyClient;
        const resolved = yield* bsky.resolveDidOrHandle(parsed.handle);
        const atUri = `at://${resolved.did}/app.bsky.feed.post/${parsed.id}`;
        const thread = yield* bsky.getPostThread(atUri, { depth: 0, parentHeight: 0 });
        return normalizeBlueskyThread(thread, options.tier);
      }).pipe(Effect.provide(blueskyCliLayer));

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

    yield* Console.log(`Done. Post URI: ${postUri}`);
  });
```

### Step 3: Add the CLI command

```ts
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
```

### Step 4: Wire into the CLI

Add `ingestUrlCommand` as a top-level subcommand of `opsCommand`:

```ts
export const opsCommand = Command.make("ops", {}, () => Effect.void).pipe(
  Command.withSubcommands([deployCommand, stageCommand, twitterCommand, ingestUrlCommand])
);
```

### Step 5: Type check

Run: `bunx tsc --noEmit`
Expected: 0 errors

### Step 6: Commit

```bash
git add src/ops/Cli.ts
git commit -m "feat(ops): add ingest-url CLI command for quick ingest (SKY-143)"
```

---

## Task 6: Integration Test

**Files:**
- Modify: `tests/ingest-url-parser.test.ts` — already covers URL parser
- The Bluesky normalizer test covers normalization
- The import endpoint test covers operatorOverride
- The curation test covers skip-fetch optimization

### Step 1: Verify all tests pass together

Run: `bun run test`
Expected: All pass

### Step 2: Type check

Run: `bunx tsc --noEmit`
Expected: 0 errors

### Step 3: Manual smoke test (optional)

```bash
# Twitter (requires scraper cookies)
bun src/scripts/ops.ts -- ingest-url "https://x.com/JesseJenkins/status/123456" --base-url "$SKYGEST_STAGING_BASE_URL"

# Bluesky
bun src/scripts/ops.ts -- ingest-url "https://bsky.app/profile/drsimevans.bsky.social/post/3lnk7z2abc" --base-url "$SKYGEST_STAGING_BASE_URL"
```

### Step 4: Final commit

```bash
git add -A
git commit -m "test: verify full suite passes with quick-ingest (SKY-143)"
```

---

## Summary of Changes

| File | Change |
|------|--------|
| `src/domain/ingestUrl.ts` | NEW — URL parser (pure function) |
| `src/domain/bi.ts` | Add `"bluesky-import"` to `ExpertSource` |
| `src/domain/api.ts` | Add `operatorOverride` to `ImportPostsInput` |
| `src/admin/Router.ts` | Respect `operatorOverride` in import handler |
| `src/services/CurationService.ts` | Skip Bluesky thread fetch when stored payload exists |
| `src/ops/BlueskyNormalizer.ts` | NEW — Bluesky thread → ImportPostInput normalizer |
| `src/ops/Cli.ts` | `ingest-url` command + BlueskyClient CLI layer |
| `tests/ingest-url-parser.test.ts` | URL parser unit tests |
| `tests/bluesky-normalizer.test.ts` | Bluesky normalizer tests |
| `tests/import-endpoint.test.ts` | operatorOverride test |
| `tests/curation.test.ts` | Skip-fetch optimization test |

## What This Does NOT Do

- No MCP tool. If MCP convenience is needed, add a Bluesky-only `ingest_bluesky_url` tool in a follow-up.
- No web share page or admin ingest-url endpoint. YAGNI for now.
- No `additionalTopics` AI-assisted topic flow. That belongs on the MCP tool if/when it ships.
- Does not change default batch import behavior. `operatorOverride` must be explicitly set.
