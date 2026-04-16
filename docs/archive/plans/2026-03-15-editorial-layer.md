# Editorial Layer — Infrastructure Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build the editorial infrastructure — domain model, storage, admin write surface, public read API, and frontend display — so that any future curation approach (agent skills, workflows, manual operation) can write picks and have them appear in the frontend.

**Scope:** Infrastructure only. No agent flows, no AI bindings, no workflow definitions. Those will be defined separately as skills once this foundation is proven.

**Architecture:** Single canonical editorial pick per post. Writes via `/admin/editorial/*` with `OperatorIdentity`. Reads via `/api/posts/curated` (public) and `list_editorial_picks` MCP tool (operator). Topic filtering derived from post's existing `post_topics`. Frontend falls back to chronological when no curated picks exist.

**Tech Stack:** Effect.ts services, D1 (SQLite), `@effect/platform` HttpApi, React + `@effect-atom/atom`

---

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Write surface | `/admin/editorial/*` with `OperatorIdentity` | MCP is `mcp:read` scoped; admin already has identity propagation. MCP gets read-only `list_editorial_picks` only |
| Topic filtering | Derived via shared `topicFilterExists()` SQL fragment + separate LEFT JOIN for aggregation | Picks don't store `topic_slug`. Curated and chronological feeds reuse the same D1 query helper to avoid semantic drift |
| Topic expansion | Reuse one ontology-side `resolveCanonicalTopicSlugs()` helper | `KnowledgeQueryService` and `EditorialService` should not each carry their own topic expansion implementation |
| Pick uniqueness | `post_uri` is PK (single canonical pick per post) | No multi-curator ambiguity. `curator` recorded for attribution/audit. Last write wins |
| Removal | By `post_uri` only | Follows from single-pick-per-post model |
| API shape | `/api/posts/curated` in the `posts` group with `{ items, page }` envelope | Preserves existing page contract. Response schemas registered in `PublicReadRequestSchemas` / `PublicReadResponseSchemas` |
| Response type | `Schema.extend(KnowledgePostResult, ...)` | Additive editorial fields, frontend can render with same `PostCard` |
| Score type | Branded `EditorialScore` (0–100 real) | Tight domain modeling, consistent with codebase conventions |
| Category type | `EditorialPickCategory` literal union stored as-is (not raw string) | Validated at schema boundary |
| Policy location | Limit clamping and expiry defaults live in `EditorialService`; repo receives concrete query inputs | Keeps persistence declarative and pushes product/runtime policy to the service layer |
| Time source | Use `Clock.currentTimeMillis`, not `Date.now()` | Keeps Cloudflare/JS runtime details out of business logic and matches Effect style |
| Layer boundary | `EditorialRepoD1` is a repo layer; `EditorialService` is an orchestration layer | Matches the existing `queryRepositoriesLayer` / `queryLayer` split in `Layer.ts` |
| Admin schema registration | `AdminRequestSchemas` / `AdminResponseSchemas` in `api.ts` | Matches existing admin endpoint organization |
| Shared-secret auth | Add `editorial:read`, `editorial:write` to `operatorScopes` in `AuthService.ts` | Without this, staging (shared-secret mode) would 403 on editorial routes |
| feed.ts routing | No new branch — `/admin/editorial/*` already handled by existing `/admin` catch-all at `feed.ts:57` | Avoids routing duplication and auth/routing drift |

---

## Phase 1: Foundation — Domain Model, Storage, Repository

### Task 1.1: Editorial Domain Schemas

**Files:**
- Create: `src/domain/editorial.ts`

**Step 1: Write the domain schemas**

```typescript
// src/domain/editorial.ts
import { Schema } from "effect";
import { AtUri } from "./types";
import { KnowledgePostResult } from "./bi";

// --- Branded score ---

export const EditorialScore = Schema.Number.pipe(
  Schema.greaterThanOrEqualTo(0),
  Schema.lessThanOrEqualTo(100),
  Schema.brand("EditorialScore")
);
export type EditorialScore = Schema.Schema.Type<typeof EditorialScore>;

// --- Enums ---

export const EditorialPickCategory = Schema.Literal(
  "breaking",
  "analysis",
  "discussion",
  "data",
  "opinion"
);
export type EditorialPickCategory = Schema.Schema.Type<typeof EditorialPickCategory>;

export const EditorialPickStatus = Schema.Literal("active", "expired", "retracted");
export type EditorialPickStatus = Schema.Schema.Type<typeof EditorialPickStatus>;

// --- Storage record (matches D1 row) ---

export const EditorialPickRecord = Schema.Struct({
  postUri: AtUri,
  score: EditorialScore,
  reason: Schema.String,
  category: Schema.NullOr(EditorialPickCategory),
  curator: Schema.String,
  status: EditorialPickStatus,
  pickedAt: Schema.Number,
  expiresAt: Schema.NullOr(Schema.Number)
});
export type EditorialPickRecord = Schema.Schema.Type<typeof EditorialPickRecord>;

// --- Admin write inputs (served on /admin/editorial/*) ---

export const SubmitEditorialPickInput = Schema.Struct({
  postUri: AtUri,
  score: EditorialScore,
  reason: Schema.String.pipe(Schema.minLength(1)),
  category: Schema.optional(EditorialPickCategory),
  expiresInHours: Schema.optional(Schema.Number.pipe(Schema.greaterThan(0)))
});
export type SubmitEditorialPickInput = Schema.Schema.Type<typeof SubmitEditorialPickInput>;

export const RemoveEditorialPickInput = Schema.Struct({
  postUri: AtUri
});
export type RemoveEditorialPickInput = Schema.Schema.Type<typeof RemoveEditorialPickInput>;

// --- Query inputs ---

export const ListEditorialPicksInput = Schema.Struct({
  minScore: Schema.optional(EditorialScore),
  since: Schema.optional(Schema.Number),
  limit: Schema.optional(Schema.Number)
});
export type ListEditorialPicksInput = Schema.Schema.Type<typeof ListEditorialPicksInput>;

export const GetCuratedFeedInput = Schema.Struct({
  topic: Schema.optional(Schema.String),
  minScore: Schema.optional(EditorialScore),
  since: Schema.optional(Schema.Number),
  limit: Schema.optional(Schema.Number)
});
export type GetCuratedFeedInput = Schema.Schema.Type<typeof GetCuratedFeedInput>;

// --- Outputs ---

export const EditorialPickOutput = Schema.Struct({
  postUri: AtUri,
  score: EditorialScore,
  reason: Schema.String,
  category: Schema.NullOr(EditorialPickCategory),
  curator: Schema.String,
  pickedAt: Schema.Number
});
export type EditorialPickOutput = Schema.Schema.Type<typeof EditorialPickOutput>;

export const SubmitEditorialPickOutput = Schema.Struct({
  postUri: AtUri,
  created: Schema.Boolean
});
export type SubmitEditorialPickOutput = Schema.Schema.Type<typeof SubmitEditorialPickOutput>;

export const RemoveEditorialPickOutput = Schema.Struct({
  postUri: AtUri,
  removed: Schema.Boolean
});
export type RemoveEditorialPickOutput = Schema.Schema.Type<typeof RemoveEditorialPickOutput>;

export const EditorialPicksOutput = Schema.Struct({
  items: Schema.Array(EditorialPickOutput)
});
export type EditorialPicksOutput = Schema.Schema.Type<typeof EditorialPicksOutput>;

// --- Curated post (extends KnowledgePostResult with editorial fields) ---

export const CuratedPostResult = Schema.extend(
  KnowledgePostResult,
  Schema.Struct({
    editorialScore: EditorialScore,
    editorialReason: Schema.String,
    editorialCategory: Schema.NullOr(EditorialPickCategory)
  })
);
export type CuratedPostResult = Schema.Schema.Type<typeof CuratedPostResult>;
```

`ListEditorialPicksInput` / `GetCuratedFeedInput` are service-level/domain inputs, so `minScore` stays branded here. URL params in `domain/api.ts` should compose `Schema.NumberFromString` with `EditorialScore` rather than widening back to raw `number`.

**Step 2: Verify it compiles**

Run: `bunx tsc --noEmit -p tsconfig.json`
Expected: Clean

**Step 3: Commit**

```bash
git add src/domain/editorial.ts
git commit -m "feat(editorial): add domain schemas — branded EditorialScore, typed category, single-pick-per-post model"
```

---

### Task 1.2: D1 Migration — editorial_picks table

**Files:**
- Modify: `src/db/migrations.ts`

**Step 1: Add migration 11**

```typescript
const migration11: D1Migration = {
  id: 11,
  name: "editorial_picks",
  statements: [
    `CREATE TABLE IF NOT EXISTS editorial_picks (
      post_uri    TEXT PRIMARY KEY,
      score       REAL NOT NULL,
      reason      TEXT NOT NULL,
      category    TEXT,
      curator     TEXT NOT NULL,
      status      TEXT NOT NULL DEFAULT 'active',
      picked_at   INTEGER NOT NULL,
      expires_at  INTEGER,
      FOREIGN KEY (post_uri) REFERENCES posts(uri)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_editorial_picks_active_score
      ON editorial_picks(status, score DESC, picked_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_editorial_picks_expires
      ON editorial_picks(expires_at)
      WHERE expires_at IS NOT NULL AND status = 'active'`
  ]
};
```

`post_uri` is the sole PK. No `topic_slug` column. Update `migrations` array to include `migration11`.

**Step 2: Write migration test**

```typescript
// tests/editorial.test.ts
import { Effect } from "effect";
import { describe, expect, it } from "@effect/vitest";
import { makeBiLayer, seedKnowledgeBase, withTempSqliteFile } from "./support/runtime";
import { SqlClient } from "@effect/sql";

describe("editorial_picks migration", () => {
  it.live("creates the editorial_picks table with post_uri as PK", () =>
    Effect.promise(() =>
      withTempSqliteFile(async (filename) => {
        const layer = makeBiLayer({ filename });
        await Effect.runPromise(
          seedKnowledgeBase().pipe(Effect.provide(layer))
        );
        await Effect.runPromise(
          Effect.gen(function* () {
            const sql = yield* SqlClient.SqlClient;
            const tables = yield* sql`
              SELECT name FROM sqlite_master
              WHERE type='table' AND name='editorial_picks'
            `;
            expect(tables).toHaveLength(1);
            const info = yield* sql`PRAGMA table_info(editorial_picks)`;
            const pkCol = (info as any[]).find((c: any) => c.pk === 1);
            expect(pkCol?.name).toBe("post_uri");
          }).pipe(Effect.provide(layer))
        );
      })
    )
  );
});
```

**Step 3: Run test, Step 4: Commit**

```bash
bun run test -- tests/editorial.test.ts
git add src/db/migrations.ts tests/editorial.test.ts
git commit -m "feat(editorial): add editorial_picks migration — post_uri PK, no topic_slug column"
```

---

### Task 1.3: EditorialRepo — Service Interface

**Files:**
- Create: `src/services/EditorialRepo.ts`

```typescript
import { Context, Effect } from "effect";
import type { SqlError } from "@effect/sql/SqlError";
import type { DbError } from "../domain/errors";
import type {
  EditorialPickRecord,
  CuratedPostResult,
  GetCuratedFeedInput,
  ListEditorialPicksInput
} from "../domain/editorial";
import type { TopicSlug } from "../domain/bi";

export class EditorialRepo extends Context.Tag("@skygest/EditorialRepo")<
  EditorialRepo,
  {
    readonly upsertPick: (
      pick: EditorialPickRecord
    ) => Effect.Effect<boolean, SqlError | DbError>;

    readonly retractPick: (
      postUri: string
    ) => Effect.Effect<boolean, SqlError | DbError>;

    readonly listPicks: (
      input: ListEditorialPicksInput
    ) => Effect.Effect<ReadonlyArray<EditorialPickRecord>, SqlError | DbError>;

    /**
     * Curated feed: JOIN editorial_picks → posts → experts, with topic
     * filtering via EXISTS predicate on post_topics (same pattern as
     * executeRecentPostsQuery in KnowledgeRepoD1) and a separate LEFT JOIN
     * on post_topics for aggregating ALL topic slugs into topicsCsv.
     * topicSlugs is pre-resolved by the service layer via ontology expansion.
     */
    readonly getCuratedFeed: (
      input: GetCuratedFeedInput & {
        readonly topicSlugs?: ReadonlyArray<TopicSlug>;
      }
    ) => Effect.Effect<ReadonlyArray<CuratedPostResult>, SqlError | DbError>;

    readonly expireStale: (
      now: number
    ) => Effect.Effect<number, SqlError | DbError>;
  }
>() {}
```

**Commit**

---

### Task 1.4: EditorialRepoD1 — D1 Implementation

**Files:**
- Create: `src/services/d1/EditorialRepoD1.ts`
- Create: `src/services/d1/queryFragments.ts`
- Modify: `src/services/d1/KnowledgeRepoD1.ts` — replace local `topicFilterExists` with shared helper

Follow `KnowledgeRepoD1.ts` and `PublicationsRepoD1.ts` patterns. Use `decodeWithDbError` for schema validation. Conditional WHERE via `sql.join(" AND ", false)`.

**Raw row schemas:** DB rows use `Schema.Number` for score (not branded). Define `EditorialPickRowSchema` and `CuratedPostRowSchema` with raw types inside the D1 file, then decode through the branded domain schemas via `decodeWithDbError`. This matches how `KnowledgeRepoD1` uses `PostRowSchema` (raw) → `KnowledgePostResultSchema` (domain).

**Shared D1 helper:** move `topicFilterExists(sql, topicSlugs)` out of `KnowledgeRepoD1.ts` into `src/services/d1/queryFragments.ts` and have both repos import it. The curated feed must not copy that predicate inline.

**Critical: getCuratedFeed query must mirror executeRecentPostsQuery pattern exactly:**

```typescript
const getCuratedFeed = (input) => {
  if (input.topicSlugs?.length === 0) {
    return Effect.succeed([]);
  }

  const conditions = [
    sql`p.status = 'active'`,
    sql`ep.status = 'active'`,
    input.since === undefined ? null : sql`ep.picked_at >= ${input.since}`,
    input.minScore === undefined ? null : sql`ep.score >= ${input.minScore}`,
    // Topic filtering via shared EXISTS helper
    input.topicSlugs === undefined
      ? null
      : topicFilterExists(sql, input.topicSlugs)
  ].filter(isDefined);

  return sql<any>`
    SELECT
      p.uri AS uri,
      p.did AS did,
      e.handle AS handle,
      e.avatar AS avatar,
      COALESCE(e.tier, 'independent') AS tier,
      p.text AS text,
      p.created_at AS createdAt,
      group_concat(DISTINCT pt.topic_slug) AS topicsCsv,
      ep.score AS editorialScore,
      ep.reason AS editorialReason,
      ep.category AS editorialCategory
    FROM editorial_picks ep
    JOIN posts p ON p.uri = ep.post_uri
    JOIN experts e ON e.did = p.did
    LEFT JOIN post_topics pt ON pt.post_uri = p.uri
    WHERE ${sql.join(" AND ", false)(conditions)}
    GROUP BY p.uri, p.did, e.handle, e.avatar, e.tier, p.text, p.created_at,
             ep.score, ep.reason, ep.category
    ORDER BY ep.score DESC, ep.picked_at DESC
    LIMIT ${input.limit}
  `;
};
```

Key detail: topic filtering uses `EXISTS` on a **separate subquery** (`filter_pt`), not a WHERE on the LEFT JOIN (`pt`). The LEFT JOIN with `group_concat(DISTINCT pt.topic_slug)` aggregates **all** of the post's topics regardless of filter. This matches the existing `KnowledgeRepoD1` query shape. Also: the repo should not invent its own default page size. `EditorialService` clamps and supplies a concrete limit before calling the repo.

**Tests:**

```typescript
describe("EditorialRepoD1", () => {
  it.live("upsertPick inserts new pick, returns true", () => /* ... */);
  it.live("upsertPick overwrites existing, returns false", () => /* ... */);
  it.live("retractPick sets status to retracted", () => /* ... */);
  it.live("retractPick returns false for non-existent post", () => /* ... */);
  it.live("getCuratedFeed joins picks with posts/experts and returns all topics", () => /* ... */);
  it.live("getCuratedFeed topic filter uses EXISTS and still returns full topic list", () =>
    // Insert pick for a post that has topics ["solar", "hydrogen"]
    // Query with topicSlugs=["solar"]
    // Verify post is returned with topics=["solar","hydrogen"] (not just ["solar"])
  );
  it.live("expireStale expires picks past their expires_at", () => /* ... */);
});
```

**Commit**

---

### Task 1.5: EditorialService

**Files:**
- Create: `src/services/EditorialService.ts`
- Modify: `src/services/OntologyCatalog.ts` — add shared `resolveCanonicalTopicSlugs(topic)` helper
- Modify: `src/services/KnowledgeQueryService.ts` — replace private topic resolver with ontology helper
- Modify: `src/platform/Config.ts` — add `editorialDefaultExpiryHours`
- Modify: `src/platform/Config.test.ts`
- Modify: `src/platform/Env.ts`

**Error type for unknown post URI:**

Add to `src/domain/editorial.ts`:
```typescript
export class EditorialPostNotFoundError extends Schema.TaggedError<EditorialPostNotFoundError>()(
  "EditorialPostNotFoundError",
  { postUri: AtUri }
) {}
```

**Repo addition — postExists:**

Add to `EditorialRepo`:
```typescript
readonly postExists: (
  postUri: string
) => Effect.Effect<boolean, SqlError | DbError>;
```

Implementation in `EditorialRepoD1`: `SELECT 1 FROM posts WHERE uri = ? AND status = 'active' LIMIT 1`.

**Service:**

```typescript
import { Clock, Context, Effect, Layer } from "effect";
import { clampLimit } from "../platform/Limit";

export class EditorialService extends Context.Tag("@skygest/EditorialService")<
  EditorialService,
  {
    readonly submitPick: (
      input: SubmitEditorialPickInput,
      curator: string
    ) => Effect.Effect<SubmitEditorialPickOutput, SqlError | DbError | EditorialPostNotFoundError>;

    readonly retractPick: (
      postUri: string
    ) => Effect.Effect<RemoveEditorialPickOutput, SqlError | DbError>;

    readonly listPicks: (
      input: ListEditorialPicksInput
    ) => Effect.Effect<ReadonlyArray<EditorialPickOutput>, SqlError | DbError>;

    readonly getCuratedFeed: (
      input: GetCuratedFeedInput
    ) => Effect.Effect<ReadonlyArray<CuratedPostResult>, SqlError | DbError>;

    readonly expireStale: () => Effect.Effect<number, SqlError | DbError>;
  }
>() {
  static readonly layer = Layer.effect(EditorialService, Effect.gen(function* () {
    const repo = yield* EditorialRepo;
    const config = yield* AppConfig;
    const ontology = yield* OntologyCatalog;

    const clampEditorialLimit = (limit: number | undefined) =>
      clampLimit(limit, config.mcpLimitDefault, config.mcpLimitMax);

    const submitPick = Effect.fn("EditorialService.submitPick")(
      function* (input: SubmitEditorialPickInput, curator: string) {
        // Validate post exists before upserting pick
        const exists = yield* repo.postExists(input.postUri);
        if (!exists) {
          yield* Effect.fail(
            EditorialPostNotFoundError.make({ postUri: input.postUri })
          );
        }
        const now = yield* Clock.currentTimeMillis;
        const defaultExpiryHours = Math.max(1, config.editorialDefaultExpiryHours);
        const expiresAt = input.expiresInHours !== undefined
          ? now + input.expiresInHours * 60 * 60 * 1000
          : now + defaultExpiryHours * 60 * 60 * 1000;
        const created = yield* repo.upsertPick({
          postUri: input.postUri,
          score: input.score,
          reason: input.reason,
          category: input.category ?? null,
          curator,
          status: "active",
          pickedAt: now,
          expiresAt
        });
        return { postUri: input.postUri, created };
      }
    );

    const listPicks = Effect.fn("EditorialService.listPicks")(
      function* (input: ListEditorialPicksInput) {
        return yield* repo.listPicks({
          ...input,
          limit: clampEditorialLimit(input.limit)
        });
      }
    );

    const getCuratedFeed = Effect.fn("EditorialService.getCuratedFeed")(
      function* (input: GetCuratedFeedInput) {
        const topicSlugs = yield* ontology.resolveCanonicalTopicSlugs(input.topic);
        return yield* repo.getCuratedFeed({
          ...input,
          limit: clampEditorialLimit(input.limit),
          ...(topicSlugs === undefined ? {} : { topicSlugs })
        });
      }
    );

    const expireStale = Effect.fn("EditorialService.expireStale")(function* () {
      const now = yield* Clock.currentTimeMillis;
      return yield* repo.expireStale(now);
    });

    // retractPick delegates directly to repo
  }));
}
```

`EditorialService` is where editorial policy lives: clamped limits, default expiry, and current time. `EditorialRepoD1` stays focused on persistence and row decoding.

**OntologyCatalog change:** extend the service with a reusable helper so topic resolution is defined once:

```typescript
readonly resolveCanonicalTopicSlugs: (
  topic: string | undefined
) => Effect.Effect<ReadonlyArray<TopicSlug> | undefined>;
```

Implementation should delegate to the existing `expandTopics([topic], "descendants")` behavior.

**KnowledgeQueryService refactoring:** Replace the private `resolveTopicSlugs` at `KnowledgeQueryService.ts:91-100` with calls to `ontology.resolveCanonicalTopicSlugs(topic)`. This affects at least 6 methods that currently call the private helper: `searchPosts`, `searchPostsPage`, `getRecentPosts`, `getRecentPostsPage`, `getPostLinks`, `getPostLinksPage`. Each call site changes from `yield* resolveTopicSlugs(input.topic)` to `yield* ontology.resolveCanonicalTopicSlugs(input.topic)`. The private function is then deleted.

**Config change:** add a new config entry:

```typescript
editorialDefaultExpiryHours: Config.withDefault(
  Config.integer("EDITORIAL_DEFAULT_EXPIRY_HOURS"),
  24
)
```

Thread `EDITORIAL_DEFAULT_EXPIRY_HOURS` through all four locations:

1. `AppConfigShape` — flows automatically from `RawConfigSchema`
2. `EnvBindings` in `Env.ts` — add `EDITORIAL_DEFAULT_EXPIRY_HOURS?: string`
3. **Entries array** in `Config.ts:49-60` — add `["EDITORIAL_DEFAULT_EXPIRY_HOURS", env.EDITORIAL_DEFAULT_EXPIRY_HOURS]` (commonly missed)
4. `testConfig()` in `tests/support/runtime.ts:22-34` — add `editorialDefaultExpiryHours: 24`

**Admin error mapper update** in `admin/Router.ts`:

Add to `withAdminErrors` classify function (alongside existing `ExpertNotFoundError` check):
```typescript
if (isTaggedError(error, "EditorialPostNotFoundError")) {
  const postUri = getStringField(error, "postUri");
  return notFoundError(
    postUri === undefined ? "post not found" : `post not found: ${postUri}`
  );
}
```

This maps `EditorialPostNotFoundError` → HTTP 404, not a generic 500.

**Commit**

---

### Task 1.6: Wire into Layer + Test Runtime

**Files:**
- Modify: `src/edge/Layer.ts` — add `EditorialRepoD1.layer` + `EditorialService.layer`
- Modify: `tests/support/runtime.ts` — add to `makeBiLayer`

In `buildSharedWorkerParts`, add:
```typescript
const editorialRepoLayer = EditorialRepoD1.layer.pipe(Layer.provideMerge(baseLayer));
const editorialServiceLayer = EditorialService.layer.pipe(
  Layer.provideMerge(Layer.mergeAll(editorialRepoLayer, configLayer, ontologyLayer))
);
```

Add `editorialRepoLayer` to `queryRepositoriesLayer`.

Add `editorialServiceLayer` to `queryLayer` and `adminLayer`.

Do **not** add `editorialServiceLayer` to `queryRepositoriesLayer`; keep the existing repo/service split intact.

Run: `bun run test` — all pass.

**Commit**

---

## Phase 2: Write Surface — Admin Endpoints

Editorial writes go on `/admin/editorial/*`. The existing `/admin` catch-all in `feed.ts:57` already routes all `/admin` paths to `handleAdminRequest` — **no new routing branch needed**.

### Task 2.1: Shared-Secret Scope Allowlist

**Files:**
- Modify: `src/auth/AuthService.ts:91`

**Step 1: Add editorial scopes to `operatorScopes`**

The shared-secret identity (`requireSharedSecret`) copies `operatorScopes` into the identity's scopes at `AuthService.ts:225`. Without editorial scopes here, staging would 403.

```typescript
const operatorScopes: ReadonlyArray<string> = [
  "mcp:read",
  "experts:read",
  "experts:write",
  "ops:read",
  "ops:refresh",
  "editorial:read",
  "editorial:write"
];
```

**Step 2: Commit**

```bash
git commit -am "feat(editorial): add editorial scopes to shared-secret operator allowlist"
```

---

### Task 2.2: Admin API Schemas

**Files:**
- Modify: `src/domain/api.ts`

**Step 1: Add URL params schema for list picks**

```typescript
const OptionalEditorialScoreFromString = Schema.optional(
  Schema.compose(Schema.NumberFromString, EditorialScore)
);

// Near other admin schemas
export const ListEditorialPicksUrlParams = Schema.Struct({
  minScore: OptionalEditorialScoreFromString,
  since: OptionalNumberFromString,
  limit: OptionalNumberFromString
});
export type ListEditorialPicksUrlParams = Schema.Schema.Type<typeof ListEditorialPicksUrlParams>;
```

**Step 2: Register in AdminRequestSchemas / AdminResponseSchemas**

```typescript
export const AdminRequestSchemas = {
  addExpert: AddExpertInput,
  listExperts: ListExpertsUrlParams,
  setExpertActive: SetExpertActiveInput,
  expertPath: ExpertDidPathParams,
  // --- editorial ---
  submitEditorialPick: SubmitEditorialPickInput,
  retractEditorialPick: RemoveEditorialPickInput,
  listEditorialPicks: ListEditorialPicksUrlParams
} as const;

export const AdminResponseSchemas = {
  addExpert: AdminExpertResult,
  listExperts: ExpertListOutput,
  setExpertActive: SetExpertActiveResult,
  migrate: Schema.Struct({ ok: Schema.Literal(true) }),
  bootstrapExperts: BootstrapExpertsResult,
  loadSmokeFixture: LoadSmokeFixtureResult,
  refreshProfiles: RefreshProfilesResult,
  seedPublications: SeedPublicationsResult,
  // --- editorial ---
  submitEditorialPick: SubmitEditorialPickOutput,
  retractEditorialPick: RemoveEditorialPickOutput,
  listEditorialPicks: EditorialPicksOutput
} as const;
```

Import editorial types from `../domain/editorial`, including `EditorialScore` for `OptionalEditorialScoreFromString`.

**Step 3: Commit**

```bash
git commit -am "feat(editorial): register editorial schemas in AdminRequestSchemas/AdminResponseSchemas"
```

---

### Task 2.3: Operator Request Policies

**Files:**
- Modify: `src/worker/operatorAuth.ts`

Add scope policies for editorial routes. These are evaluated by the existing `/admin` routing in `feed.ts:57` — no new routing needed.

```typescript
if (request.method === "POST" && pathname === "/admin/editorial/pick") {
  return { action: "submit_editorial_pick", scopes: ["editorial:write"] };
}
if (request.method === "POST" && pathname === "/admin/editorial/retract") {
  return { action: "retract_editorial_pick", scopes: ["editorial:write"] };
}
if (request.method === "GET" && pathname === "/admin/editorial/picks") {
  return { action: "list_editorial_picks", scopes: ["editorial:read"] };
}
```

**Commit**

---

### Task 2.4: Admin Router — Editorial Group

**Files:**
- Modify: `src/admin/Router.ts`

**Step 1: Add editorial group to AdminApi**

```typescript
.add(
  HttpApiGroup.make("editorial")
    .add(
      HttpApiEndpoint.post("submitPick", "/admin/editorial/pick")
        .setPayload(AdminRequestSchemas.submitEditorialPick)
        .addSuccess(AdminResponseSchemas.submitEditorialPick)
    )
    .add(
      HttpApiEndpoint.post("retractPick", "/admin/editorial/retract")
        .setPayload(AdminRequestSchemas.retractEditorialPick)
        .addSuccess(AdminResponseSchemas.retractEditorialPick)
    )
    .add(
      HttpApiEndpoint.get("listPicks", "/admin/editorial/picks")
        .setUrlParams(AdminRequestSchemas.listEditorialPicks)
        .addSuccess(AdminResponseSchemas.listEditorialPicks)
    )
)
```

**Step 2: Add handlers**

```typescript
HttpApiBuilder.group(AdminApi, "editorial", (handlers) =>
  handlers
    .handle("submitPick", ({ payload }) =>
      withAdminErrors("/admin/editorial/pick", Effect.gen(function* () {
        const actor = yield* OperatorIdentity;
        const editorial = yield* EditorialService;
        return yield* editorial.submitPick(
          payload,
          actor.email ?? actor.subject ?? "operator"
        );
      }))
    )
    .handle("retractPick", ({ payload }) =>
      withAdminErrors("/admin/editorial/retract", Effect.gen(function* () {
        const editorial = yield* EditorialService;
        return yield* editorial.retractPick(payload.postUri);
      }))
    )
    .handle("listPicks", ({ urlParams }) =>
      withAdminErrors("/admin/editorial/picks", Effect.gen(function* () {
        const editorial = yield* EditorialService;
        const items = yield* editorial.listPicks(urlParams);
        return { items };
      }))
    )
)
```

Curator identity: `actor.email ?? actor.subject ?? "operator"` — extracted from `AccessIdentity`, not hardcoded. In shared-secret mode this resolves to `"staging-operator@skygest.local"` per `AuthService.ts:222`.

**Step 3: Add to AdminHandlers Layer.mergeAll**

The new editorial group handler must be added to the existing `AdminHandlers = Layer.mergeAll(...)`.

**Step 4: Tests**

```typescript
describe("admin editorial endpoints", () => {
  it.live("POST /admin/editorial/pick submits a pick with operator identity", () => /* ... */);
  it.live("POST /admin/editorial/retract retracts a pick", () => /* ... */);
  it.live("GET /admin/editorial/picks lists active picks", () => /* ... */);
});
```

**Note:** No changes to `feed.ts` needed. The existing `/admin` catch-all at `feed.ts:57` already authorizes and routes all `/admin/*` paths to `handleAdminRequest`.

**Commit**

```bash
git commit -am "feat(editorial): add admin editorial endpoints — submitPick, retractPick, listPicks"
```

---

### Task 2.5: MCP Read-Only Tool — list_editorial_picks

**Files:**
- Modify: `src/mcp/Toolkit.ts`
- Modify: `src/mcp/Router.ts` — widen layer type to include `EditorialService`

Add ONE new read-only tool (no write tools on MCP):

```typescript
export const ListEditorialPicksTool = Tool.make("list_editorial_picks", {
  description: "List current editorial picks for the curated feed, optionally filtered by minimum score.",
  parameters: ListEditorialPicksInput.fields,
  success: EditorialPicksOutput,
  failure: McpToolQueryError
})
  .annotate(Tool.Title, "List Editorial Picks")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);
```

Add to `KnowledgeMcpToolkit`. Add handler in `KnowledgeMcpHandlers`.

Update `mcp/Router.ts`: **All three** type signatures that constrain on `KnowledgeQueryService` must be widened to also require `EditorialService`:

1. `makeMcpLayer` (line 9–10):
```typescript
const makeMcpLayer = (
  serviceLayer: Layer.Layer<KnowledgeQueryService | EditorialService, any, never>
): Layer.Layer<HttpLayerRouter.HttpRouter, any, never> => ...
```

2. `handleMcpRequestWithLayer` (line 25–27):
```typescript
export const handleMcpRequestWithLayer = async (
  request: Request,
  layer: Layer.Layer<KnowledgeQueryService | EditorialService, any, never>
): Promise<Response> => ...
```

3. `makeCachedMcpHandler` (line 38–39) — its generic `buildLayer` callback return type must also widen:
```typescript
const makeCachedMcpHandler = <Env extends object>(
  buildLayer: (env: Env) => Layer.Layer<KnowledgeQueryService | EditorialService, any, never>
) => ...
```

Without widening all three, the cached production handler and `createMcpClient` test helper will not compile.

Update `makeQueryLayer` in `Layer.ts` to include `EditorialService` (already done in Task 1.6).

Update tool list test: 9 tools total (8 existing + 1 new read tool).

**Commit**

```bash
git commit -am "feat(editorial): add list_editorial_picks MCP read tool (mcp:read compatible)"
```

---

## Phase 3: Public Curated Feed API

### Task 3.1: API Schemas

**Files:**
- Modify: `src/domain/api.ts`

**Step 1: Add URL params**

```typescript
export const GetCuratedFeedUrlParams = Schema.Struct({
  topic: OptionalString,
  minScore: OptionalEditorialScoreFromString,
  since: OptionalNumberFromString,
  limit: OptionalNumberFromString
});
export type GetCuratedFeedUrlParams = Schema.Schema.Type<typeof GetCuratedFeedUrlParams>;
```

**Step 2: Add response schema**

```typescript
export const CuratedPostsPageOutput = Schema.Struct({
  items: Schema.Array(CuratedPostResult),
  page: ApiPage
});
export type CuratedPostsPageOutput = Schema.Schema.Type<typeof CuratedPostsPageOutput>;
```

**Step 3: Register in PublicReadRequestSchemas / PublicReadResponseSchemas**

```typescript
export const PublicReadRequestSchemas = {
  // ... existing ...
  curatedFeed: GetCuratedFeedUrlParams
} as const;

export const PublicReadResponseSchemas = {
  // ... existing ...
  curatedPostsPage: CuratedPostsPageOutput
} as const;
```

**Commit**

---

### Task 3.2: Curated Feed Endpoint + Handler

**Files:**
- Modify: `src/api/PublicReadApi.ts` — add to `posts` group
- Modify: `src/api/Router.ts` — add handler

**Step 1: Add endpoint**

In the `posts` group of `PublicReadApi`:
```typescript
.add(
  HttpApiEndpoint.get("curated", "/posts/curated")
    .setUrlParams(PublicReadRequestSchemas.curatedFeed)
    .addSuccess(PublicReadResponseSchemas.curatedPostsPage)
)
```

**Step 2: Add handler**

In the `posts` group handler:
```typescript
.handle("curated", ({ urlParams }) =>
  withReadErrors("/api/posts/curated", Effect.flatMap(EditorialService, (editorial) =>
    editorial.getCuratedFeed({
      topic: urlParams.topic,
      minScore: urlParams.minScore,
      since: urlParams.since,
      limit: urlParams.limit
    })
  )).pipe(
    Effect.map((items) => ({
      items: Array.from(items),
      page: { nextCursor: null }
    } satisfies CuratedPostsPageOutput))
  )
)
```

Note: `nextCursor: null` — curated feed is score-ordered, cursor pagination deferred. Offset pagination can be added if needed.

**Step 3: Tests**

Verify `/api/posts/curated` returns the same base post fields as `/api/posts/recent` plus `editorialScore`, `editorialReason`, `editorialCategory`. Verify topic filtering matches `/api/posts/recent` behavior (same topics returned for same topic filter).

**Commit**

```bash
git commit -am "feat(editorial): add /api/posts/curated endpoint under posts group with paged envelope"
```

---

## Phase 4: Frontend Integration

### Task 4.1: Frontend Types

**Files:**
- Modify: `src/web/lib/api.ts` — re-export `CuratedPostResult`
- Modify: `src/web/lib/types.ts` — export `EditorialPickCategory`

```typescript
// src/web/lib/api.ts — add:
export type { CuratedPostResult } from "../../domain/editorial";

// src/web/lib/types.ts — add:
export type { EditorialPickCategory } from "../../domain/editorial";
```

---

### Task 4.2: Curated Feed Atom + Fallback

**Files:**
- Modify: `src/web/lib/atoms.ts`

**Single effectful atom with sequential fallback:**

```typescript
export const feedAtom = SkygestApi.runtime.atom((get) => {
  const topic = get(selectedTopicAtom) ?? undefined;
  return Effect.gen(function* () {
    const client = yield* SkygestApi;
    const curated = yield* client.posts.curated({
      urlParams: topic !== undefined ? { topic, limit: 30 } : { limit: 30 }
    });
    if (curated.items.length > 0) {
      return { mode: "curated" as const, items: curated.items };
    }

    const chronological = yield* client.posts.recent({
      urlParams: topic !== undefined ? { topic, limit: 30 } : { limit: 30 }
    });

    return { mode: "chronological" as const, items: chronological.items };
  }).pipe(Effect.withSpan("web.feedAtom"));
});
```

Shell reads `feedAtom`. This preserves the fallback behavior without intentionally firing both requests on every render.

---

### Task 4.3: EditorialBadge Component

**Files:**
- Create: `src/web/components/EditorialBadge.tsx`

```tsx
import type { EditorialPickCategory } from "../lib/types.ts";

interface EditorialBadgeProps {
  readonly category: EditorialPickCategory | null;
}

const CATEGORY_LABELS: Record<EditorialPickCategory, string> = {
  breaking: "Breaking",
  analysis: "Analysis",
  discussion: "Discussion",
  data: "Data",
  opinion: "Opinion"
};

export function EditorialBadge({ category }: EditorialBadgeProps) {
  if (!category || !(category in CATEGORY_LABELS)) return null;
  return (
    <span className="font-ui text-[10px] font-semibold tracking-[0.05em] uppercase text-accent bg-accent-tint px-[6px] py-[2px] rounded-sm">
      {CATEGORY_LABELS[category]}
    </span>
  );
}
```

---

### Task 4.4: PostCard — Optional Editorial Props

**Files:**
- Modify: `src/web/components/PostCard.tsx`

Add optional editorial props to `PostCardProps`:

```typescript
import type { CuratedPostResult } from "../lib/api.ts";

interface PostCardProps {
  // ... existing props ...
  readonly editorialScore?: CuratedPostResult["editorialScore"] | undefined;
  readonly editorialReason?: CuratedPostResult["editorialReason"] | undefined;
  readonly editorialCategory?: CuratedPostResult["editorialCategory"] | undefined;
}
```

Render `EditorialBadge` inside the card when `editorialCategory` is present. Place it after the `AttributionRow`, before the body text:

```tsx
{editorialCategory && (
  <EditorialBadge category={editorialCategory} />
)}
```

The badge is additive — chronological posts pass no editorial props and nothing renders. No changes to `AttributionRow.tsx` needed.

---

### Task 4.5: Shell — Use feedAtom

**Files:**
- Modify: `src/web/components/Shell.tsx`

Replace direct `postsAtom` usage with `feedAtom`:

```typescript
const feed = useAtomValue(feedAtom);
// feed.mode is "curated" | "chronological"
// feed.items is the post array

// When mode is "curated", pass editorial fields to PostCard:
<PostCard
  key={post.uri}
  post={post}
  link={linksMap.get(post.uri) ?? null}
  publicationIndex={pubIndex}
  topicEntries={resolveTopicEntries(post.topics)}
  editorialScore={"editorialScore" in post ? post.editorialScore : undefined}
  editorialReason={"editorialReason" in post ? post.editorialReason : undefined}
  editorialCategory={"editorialCategory" in post ? post.editorialCategory : undefined}
/>
```

The section label changes from "Recent" to "Curated" when `feed.mode === "curated"`.

**Typecheck + build:**

Run: `bun run typecheck:web && bun run build:web`

---

## Out of Scope (Future — Separate Plans)

These build on the infrastructure but are intentionally excluded:

- **Agent curation flows** — skill-based approach, defined separately once infrastructure is proven
- **CurationWorkflow** — requires `AI` binding, new workflow binding, `StagingOpsService` integration
- **Article content fetching** — KV-cached lazy enrichment, new MCP read tool
- **Engagement signals** — new `posts` columns, Bluesky API enrichment
- **Discussion threading** — `editorial_threads` tables, admin CRUD
- **MCP write scopes** — `mcp:write` scope + identity propagation, deferred until agent identity model exists

---

## Milestone Summary

| Phase | Deliverable | Key Files |
|-------|-------------|-----------|
| 1 | Domain + Storage + Repo + Service | `editorial.ts`, `migrations.ts`, `EditorialRepo.ts`, `EditorialRepoD1.ts`, `queryFragments.ts`, `EditorialService.ts`, `OntologyCatalog.ts`, `Config.ts`, `Layer.ts` |
| 2 | Auth scopes + Admin write endpoints + MCP read tool | `AuthService.ts`, `api.ts`, `operatorAuth.ts`, `admin/Router.ts`, `mcp/Toolkit.ts`, `mcp/Router.ts` |
| 3 | `/api/posts/curated` endpoint | `api.ts`, `PublicReadApi.ts`, `api/Router.ts` |
| 4 | Frontend curated feed | `types.ts`, `api.ts`, `atoms.ts`, `EditorialBadge.tsx`, `PostCard.tsx`, `Shell.tsx` |

---

## Verification Checklist

After each phase:

1. `bun run test` — all tests pass
2. `bunx tsc --noEmit` — clean typecheck
3. `bun run build:web` — frontend builds (after Phase 4)
4. Deploy to staging: `bunx wrangler deploy --config wrangler.agent.toml --env staging`
5. Smoke test

After Phase 2:
- Submit a pick via `POST /admin/editorial/pick` with shared-secret header on staging
- Verify curator resolves to `"staging-operator@skygest.local"`
- Verify `GET /admin/editorial/picks` returns the pick
- Verify `list_editorial_picks` MCP tool returns the pick (via MCP client)

After Phase 3:
- `curl /api/posts/curated` returns posts with `editorialScore`, `editorialReason`, `editorialCategory`
- `curl /api/posts/curated?topic=solar` filters identically to `/api/posts/recent?topic=solar` (same posts returned, but ordered by score)
- Posts in curated response carry their full topic list (not just the filtered topic)

After Phase 4:
- Frontend shows curated posts when picks exist
- Falls back to chronological when no picks
- Editorial badge displays category on curated posts

---

## Done Criteria

The infrastructure is complete when:
1. An operator can submit, list, and retract editorial picks via `/admin/editorial/*`
2. An MCP client can read picks via `list_editorial_picks` tool
3. The public API serves curated posts at `/api/posts/curated` with correct topic filtering
4. The frontend displays curated posts with editorial badges, falling back to chronological
5. All of the above works on staging with shared-secret auth
