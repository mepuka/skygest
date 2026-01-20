# Skygest Effect-Native Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a Cloudflare-native, Effect-native Skygest MVP with Jetstream ingestion, paper filtering, recommendation generation, and feed/MCP APIs.

**Architecture:** Jetstream DO streams commit events -> Queue -> Filter Worker -> D1. Cron dispatch -> FeedGen Queue -> Generator Worker -> KV/D1. Feed API Worker serves feed skeletons and queues postprocess work. MCP API exposes admin and experimentation endpoints. All components are modeled as Effect services/layers with Schema-validated data.

**Tech Stack:** TypeScript, Effect, @effect/platform (HttpRouter/HttpApp), @effect/sql, @effect/sql-d1, @effect/sql-sqlite-do, effect-jetstream, Cloudflare Workers/DO/Queues/D1/KV/R2 (optional).

**Skill References:** @cloudflare (workers, durable-objects, d1, kv, queues, r2).

---

### Task 1: Add Cloudflare bindings + Env service

**Files:**
- Modify: `package.json`
- Create: `wrangler.toml`
- Create: `src/platform/Env.ts`
- Test: `src/platform/Env.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
import { CloudflareEnv } from "./Env";

describe("CloudflareEnv", () => {
  it("provides bindings", async () => {
    const env = {
      FEED_DID: "did:plc:test",
      DB: {} as D1Database,
      FEED_CACHE: {} as KVNamespace,
      RAW_EVENTS: {} as Queue,
      FEED_GEN: {} as Queue,
      POSTPROCESS: {} as Queue,
      JETSTREAM_INGESTOR: {} as DurableObjectNamespace
    };

    const program = Effect.gen(function* () {
      const bindings = yield* CloudflareEnv;
      return bindings.FEED_DID;
    });

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(CloudflareEnv.layer(env)))
    );
    expect(result).toBe("did:plc:test");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test src/platform/Env.test.ts`
Expected: FAIL (module not found).

**Step 3: Write minimal implementation**

```ts
import { Context, Layer } from "effect";

export interface EnvBindings {
  readonly FEED_DID: string;
  readonly ALG_FEED_DID?: string;
  readonly PUBLIC_BSKY_API?: string;
  readonly JETSTREAM_ENDPOINT?: string;
  readonly FOLLOW_LIMIT?: string;
  readonly FEED_LIMIT?: string;
  readonly CONSENT_THRESHOLD?: string;
  readonly DB: D1Database;
  readonly FEED_CACHE: KVNamespace;
  readonly RAW_EVENTS: Queue;
  readonly FEED_GEN: Queue;
  readonly POSTPROCESS: Queue;
  readonly JETSTREAM_INGESTOR: DurableObjectNamespace;
}

export class CloudflareEnv extends Context.Tag("@skygest/CloudflareEnv")<
  CloudflareEnv,
  EnvBindings
>() {
  static layer = (env: EnvBindings) => Layer.succeed(CloudflareEnv, env);
}
```

Update `package.json`:

```json
"dependencies": {
  "@effect/platform": "^0.94.1",
  "@effect/sql": "^1.0.0",
  "@effect/sql-d1": "^1.0.0",
  "@effect/sql-sqlite-do": "^1.0.0",
  "effect": "^3.19.14",
  "effect-jetstream": "^1.0.0",
  "jose": "^5.2.2"
},
"devDependencies": {
  "@effect/language-service": "^0.71.2",
  "@effect/sql-sqlite-bun": "^1.0.0",
  "@types/bun": "latest"
}
```

Create `wrangler.toml` (feed worker template):

```toml
name = "skygest-feed"
main = "src/worker/feed.ts"
compatibility_date = "2024-04-03"

[vars]
FEED_DID = "did:plc:REPLACE_ME"
ALG_FEED_DID = "did:plc:REPLACE_ME"
PUBLIC_BSKY_API = "https://public.api.bsky.app"
JETSTREAM_ENDPOINT = "wss://jetstream1.us-east.bsky.network/subscribe"
FOLLOW_LIMIT = "5000"
FEED_LIMIT = "150"
CONSENT_THRESHOLD = "5"

[[d1_databases]]
binding = "DB"
database_name = "skygest"
database_id = "REPLACE_ME"

[[kv_namespaces]]
binding = "FEED_CACHE"
id = "REPLACE_ME"

[[queues.producers]]
queue = "raw-events"
binding = "RAW_EVENTS"

[[queues.producers]]
queue = "feed-gen"
binding = "FEED_GEN"

[[queues.producers]]
queue = "postprocess"
binding = "POSTPROCESS"

[[durable_objects.bindings]]
name = "JETSTREAM_INGESTOR"
class_name = "JetstreamIngestorDo"

[[migrations]]
tag = "v1"
new_classes = ["JetstreamIngestorDo"]
```

**Step 4: Run test to verify it passes**

Run: `bun test src/platform/Env.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add package.json wrangler.toml src/platform/Env.ts src/platform/Env.test.ts

git commit -m "feat: add cloudflare env bindings and deps"
```

---

### Task 2: App config layer

**Files:**
- Create: `src/platform/Config.ts`
- Test: `src/platform/Config.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
import { AppConfig } from "./Config";
import { CloudflareEnv } from "./Env";

describe("AppConfig", () => {
  it("loads config from provider", async () => {
    const env = {
      FEED_DID: "did:plc:test",
      ALG_FEED_DID: "did:plc:alg",
      FOLLOW_LIMIT: "5000"
    } as const;

    const program = Effect.gen(function* () {
      const cfg = yield* AppConfig;
      return cfg.feedDid;
    }).pipe(
      Effect.provide(CloudflareEnv.layer(env as any)),
      Effect.provide(AppConfig.layer)
    );

    const result = await Effect.runPromise(program);
    expect(result).toBe("did:plc:test");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test src/platform/Config.test.ts`
Expected: FAIL (module not found).

**Step 3: Write minimal implementation**

```ts
import { Config, ConfigProvider, Context, Effect, Layer } from "effect";
import { CloudflareEnv } from "./Env";

const ConfigSchema = Config.all({
  feedDid: Config.string("FEED_DID"),
  algFeedDid: Config.string("ALG_FEED_DID"),
  publicApi: Config.withDefault(
    Config.string("PUBLIC_BSKY_API"),
    "https://public.api.bsky.app"
  ),
  jetstreamEndpoint: Config.withDefault(
    Config.string("JETSTREAM_ENDPOINT"),
    "wss://jetstream1.us-east.bsky.network/subscribe"
  ),
  followLimit: Config.withDefault(Config.integer("FOLLOW_LIMIT"), 5000),
  feedLimit: Config.withDefault(Config.integer("FEED_LIMIT"), 150),
  consentThreshold: Config.withDefault(Config.integer("CONSENT_THRESHOLD"), 5)
});

export type AppConfigShape = Config.Config.Success<typeof ConfigSchema>;

export class AppConfig extends Context.Tag("@skygest/AppConfig")<
  AppConfig,
  AppConfigShape
>() {
  static layer = Layer.effect(
    AppConfig,
    Effect.gen(function* () {
      const env = yield* CloudflareEnv;
      const provider = ConfigProvider.fromMap(new Map([
        ["FEED_DID", env.FEED_DID],
        ["ALG_FEED_DID", env.ALG_FEED_DID ?? ""],
        ["PUBLIC_BSKY_API", env.PUBLIC_BSKY_API ?? ""],
        ["JETSTREAM_ENDPOINT", env.JETSTREAM_ENDPOINT ?? ""],
        ["FOLLOW_LIMIT", String(env.FOLLOW_LIMIT ?? "")],
        ["FEED_LIMIT", String(env.FEED_LIMIT ?? "")],
        ["CONSENT_THRESHOLD", String(env.CONSENT_THRESHOLD ?? "")]
      ]));
      return yield* Config.load(ConfigSchema).pipe(Effect.withConfigProvider(provider));
    })
  );
}
```

**Step 4: Run test to verify it passes**

Run: `bun test src/platform/Config.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/platform/Config.ts src/platform/Config.test.ts

git commit -m "feat: add app config layer"
```

---

### Task 3: Domain schemas + error types

**Files:**
- Create: `src/domain/types.ts`
- Create: `src/domain/errors.ts`
- Test: `src/domain/types.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, it, expect } from "bun:test";
import { Schema } from "effect";
import { Did, AtUri } from "./types";

describe("domain types", () => {
  it("brands did and at uri", () => {
    expect(Schema.decodeSync(Did)("did:plc:abc"))
      .toBe("did:plc:abc");
    expect(Schema.decodeSync(AtUri)("at://did:plc:abc/app.bsky.feed.post/123"))
      .toBe("at://did:plc:abc/app.bsky.feed.post/123");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test src/domain/types.test.ts`
Expected: FAIL (module not found).

**Step 3: Write minimal implementation**

```ts
import { Schema } from "effect";

export const Did = Schema.String.pipe(
  Schema.pattern(/^did:/),
  Schema.brand("Did")
);
export type Did = Schema.Schema.Type<typeof Did>;

export const AtUri = Schema.String.pipe(
  Schema.pattern(/^at:\/\//),
  Schema.brand("AtUri")
);
export type AtUri = Schema.Schema.Type<typeof AtUri>;

export const FeedCursor = Schema.Union(
  Schema.Number,
  Schema.Literal("eof")
);
export type FeedCursor = Schema.Schema.Type<typeof FeedCursor>;

export const FeedItem = Schema.Struct({
  post: AtUri,
  reason: Schema.optional(Schema.Unknown)
});
export type FeedItem = Schema.Schema.Type<typeof FeedItem>;

export const RawEvent = Schema.Struct({
  kind: Schema.Literal("commit"),
  operation: Schema.Union(
    Schema.Literal("create"),
    Schema.Literal("update"),
    Schema.Literal("delete")
  ),
  collection: Schema.String,
  did: Did,
  uri: AtUri,
  cid: Schema.optional(Schema.String),
  record: Schema.optional(Schema.Unknown),
  timeUs: Schema.Number
});
export type RawEvent = Schema.Schema.Type<typeof RawEvent>;

export const RawEventBatch = Schema.Struct({
  cursor: Schema.optional(Schema.Number),
  events: Schema.Array(RawEvent)
});
export type RawEventBatch = Schema.Schema.Type<typeof RawEventBatch>;

export const FeedGenMessage = Schema.Struct({
  users: Schema.Array(Did),
  batchId: Schema.Number,
  generateAgg: Schema.Boolean
});
export type FeedGenMessage = Schema.Schema.Type<typeof FeedGenMessage>;

export const PostprocessMessage = Schema.Struct({
  viewer: Did,
  accessAt: Schema.Number,
  limit: Schema.Number,
  cursorStart: Schema.Number,
  cursorEnd: Schema.Number,
  defaultFrom: Schema.optional(Schema.Number),
  recs: Schema.Array(FeedItem)
});
export type PostprocessMessage = Schema.Schema.Type<typeof PostprocessMessage>;
```

```ts
import { Schema } from "effect";

export class AuthError extends Schema.TaggedError<AuthError>()("AuthError", {
  message: Schema.String
}) {}

export class BlueskyApiError extends Schema.TaggedError<BlueskyApiError>()(
  "BlueskyApiError",
  {
    message: Schema.String,
    status: Schema.optional(Schema.Number)
  }
) {}

export class DbError extends Schema.TaggedError<DbError>()("DbError", {
  message: Schema.String
}) {}

export class QueueError extends Schema.TaggedError<QueueError>()("QueueError", {
  message: Schema.String
}) {}
```

**Step 4: Run test to verify it passes**

Run: `bun test src/domain/types.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/domain/types.ts src/domain/errors.ts src/domain/types.test.ts

git commit -m "feat: add domain schemas and errors"
```

---

### Task 4: SQL migrations and test harness

**Files:**
- Create: `src/db/migrations.ts`
- Create: `src/db/migrate.ts`
- Test: `src/db/migrations.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
import { SqlClient } from "@effect/sql";
import { SqliteClient } from "@effect/sql-sqlite-bun";
import { runMigrations } from "./migrate";

describe("migrations", () => {
  it("creates core tables", async () => {
    const program = Effect.gen(function* () {
      yield* runMigrations;
      const sql = yield* SqlClient.SqlClient;
      const rows = yield* sql<{ name: string }>
        `SELECT name FROM sqlite_master WHERE type='table' AND name='posts'`;
      return rows.length;
    });

    const result = await Effect.runPromise(
      program.pipe(
        Effect.provide(SqliteClient.layer({ filename: ":memory:" }))
      )
    );

    expect(result).toBe(1);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test src/db/migrations.test.ts`
Expected: FAIL (module not found).

**Step 3: Write minimal implementation**

```ts
import { Effect } from "effect";
import { SqlClient } from "@effect/sql";
import type { ResolvedMigration } from "@effect/sql/Migrator";

const migration1 = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`CREATE TABLE IF NOT EXISTS posts (
    uri TEXT PRIMARY KEY,
    cid TEXT NOT NULL,
    author_did TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    created_at_day TEXT NOT NULL,
    indexed_at INTEGER NOT NULL,
    search_text TEXT,
    reply_root TEXT,
    reply_parent TEXT,
    status TEXT DEFAULT 'active'
  )`;

  yield* sql`CREATE INDEX IF NOT EXISTS idx_posts_author_time
    ON posts(author_did, created_at DESC)`;

  yield* sql`CREATE TABLE IF NOT EXISTS users (
    did TEXT PRIMARY KEY,
    handle TEXT,
    display_name TEXT,
    created_at INTEGER,
    last_access_at INTEGER,
    access_count INTEGER DEFAULT 0,
    consent_accesses INTEGER DEFAULT 0,
    opt_out INTEGER DEFAULT 0,
    deactivated INTEGER DEFAULT 0
  )`;

  yield* sql`CREATE TABLE IF NOT EXISTS interactions (
    id TEXT PRIMARY KEY,
    user_did TEXT NOT NULL,
    post_uri TEXT NOT NULL,
    type TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`;

  yield* sql`CREATE TABLE IF NOT EXISTS user_access_log (
    id TEXT PRIMARY KEY,
    did TEXT NOT NULL,
    access_at INTEGER NOT NULL,
    recs_shown TEXT,
    cursor_start INTEGER,
    cursor_end INTEGER,
    default_from INTEGER
  )`;
});

export const migrations: ReadonlyArray<ResolvedMigration> = [
  [1, "init", Effect.succeed(migration1)]
];
```

```ts
import * as Migrator from "@effect/sql/Migrator";
import { Effect } from "effect";
import { migrations } from "./migrations";

export const runMigrations = Migrator.make()({
  loader: Effect.succeed(migrations)
});
```

**Step 4: Run test to verify it passes**

Run: `bun test src/db/migrations.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/db/migrations.ts src/db/migrate.ts src/db/migrations.test.ts

git commit -m "feat: add sqlite migrations"
```

---

### Task 5: Posts repository (tag + D1 layer)

**Files:**
- Create: `src/services/PostsRepo.ts`
- Create: `src/services/d1/PostsRepoD1.ts`
- Test: `src/services/d1/PostsRepoD1.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
import { SqliteClient } from "@effect/sql-sqlite-bun";
import { PostsRepo } from "../PostsRepo";
import { PostsRepoD1 } from "./PostsRepoD1";
import { runMigrations } from "../../db/migrate";

it("writes and reads posts", async () => {
  const program = Effect.gen(function* () {
    yield* runMigrations;
    const repo = yield* PostsRepo;
    yield* repo.putMany([
      {
        uri: "at://did:plc:1/app.bsky.feed.post/1",
        cid: "cid1",
        authorDid: "did:plc:1",
        createdAt: 100,
        createdAtDay: "2025-01-01",
        indexedAt: 200,
        searchText: "arxiv.org",
        replyRoot: null,
        replyParent: null,
        status: "active"
      }
    ]);
    const rows = yield* repo.listRecentByAuthor("did:plc:1", 10);
    return rows.length;
  });

  const result = await Effect.runPromise(
    program.pipe(
      Effect.provide(PostsRepoD1.layer),
      Effect.provide(SqliteClient.layer({ filename: ":memory:" }))
    )
  );

  expect(result).toBe(1);
});
```

**Step 2: Run test to verify it fails**

Run: `bun test src/services/d1/PostsRepoD1.test.ts`
Expected: FAIL (module not found).

**Step 3: Write minimal implementation**

```ts
import { Context, Effect } from "effect";

export type PaperPost = {
  readonly uri: string;
  readonly cid: string;
  readonly authorDid: string;
  readonly createdAt: number;
  readonly createdAtDay: string;
  readonly indexedAt: number;
  readonly searchText: string | null;
  readonly replyRoot: string | null;
  readonly replyParent: string | null;
  readonly status: "active" | "deleted";
};

export class PostsRepo extends Context.Tag("@skygest/PostsRepo")<
  PostsRepo,
  {
    readonly putMany: (posts: ReadonlyArray<PaperPost>) => Effect.Effect<void>;
    readonly listRecentByAuthor: (authorDid: string, limit: number) => Effect.Effect<ReadonlyArray<PaperPost>>;
    readonly markDeleted: (uri: string) => Effect.Effect<void>;
  }
>() {}
```

```ts
import { Effect, Layer } from "effect";
import { SqlClient } from "@effect/sql";
import { PostsRepo, PaperPost } from "../PostsRepo";

export const PostsRepoD1 = {
  layer: Layer.effect(PostsRepo, Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;

    const putMany = (posts: ReadonlyArray<PaperPost>) =>
      posts.length === 0
        ? Effect.void
        : sql`
            INSERT OR IGNORE INTO posts
            ${sql.insert(posts.map((p) => ({
              uri: p.uri,
              cid: p.cid,
              author_did: p.authorDid,
              created_at: p.createdAt,
              created_at_day: p.createdAtDay,
              indexed_at: p.indexedAt,
              search_text: p.searchText,
              reply_root: p.replyRoot,
              reply_parent: p.replyParent,
              status: p.status
            })))}
          `.pipe(Effect.asVoid);

    const listRecentByAuthor = (authorDid: string, limit: number) =>
      sql<PaperPost>`
        SELECT
          uri as uri,
          cid as cid,
          author_did as authorDid,
          created_at as createdAt,
          created_at_day as createdAtDay,
          indexed_at as indexedAt,
          search_text as searchText,
          reply_root as replyRoot,
          reply_parent as replyParent,
          status as status
        FROM posts
        WHERE author_did = ${authorDid} AND status != 'deleted'
        ORDER BY created_at DESC
        LIMIT ${limit}
      `;

    const markDeleted = (uri: string) =>
      sql`UPDATE posts SET status = 'deleted' WHERE uri = ${uri}`.pipe(Effect.asVoid);

    return PostsRepo.of({ putMany, listRecentByAuthor, markDeleted });
  }))
};
```

**Step 4: Run test to verify it passes**

Run: `bun test src/services/d1/PostsRepoD1.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/services/PostsRepo.ts src/services/d1/PostsRepoD1.ts src/services/d1/PostsRepoD1.test.ts

git commit -m "feat: add posts repo"
```

---

### Task 6: Users + interactions + access repos

**Files:**
- Create: `src/services/UsersRepo.ts`
- Create: `src/services/InteractionsRepo.ts`
- Create: `src/services/AccessRepo.ts`
- Create: `src/services/d1/UsersRepoD1.ts`
- Create: `src/services/d1/InteractionsRepoD1.ts`
- Create: `src/services/d1/AccessRepoD1.ts`
- Test: `src/services/d1/UsersRepoD1.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
import { SqliteClient } from "@effect/sql-sqlite-bun";
import { UsersRepo } from "../UsersRepo";
import { UsersRepoD1 } from "./UsersRepoD1";
import { runMigrations } from "../../db/migrate";

it("upserts and reads users", async () => {
  const program = Effect.gen(function* () {
    yield* runMigrations;
    const users = yield* UsersRepo;
    yield* users.upsert({
      did: "did:plc:1",
      handle: "test",
      displayName: "Test",
      createdAt: 1,
      lastAccessAt: 1,
      accessCount: 0,
      consentAccesses: 0,
      optOut: false,
      deactivated: false
    });
    const got = yield* users.get("did:plc:1");
    return got?.handle ?? "";
  });

  const result = await Effect.runPromise(
    program.pipe(
      Effect.provide(UsersRepoD1.layer),
      Effect.provide(SqliteClient.layer({ filename: ":memory:" }))
    )
  );

  expect(result).toBe("test");
});
```

**Step 2: Run test to verify it fails**

Run: `bun test src/services/d1/UsersRepoD1.test.ts`
Expected: FAIL (module not found).

**Step 3: Write minimal implementation**

```ts
import { Context, Effect } from "effect";

export type UserRow = {
  readonly did: string;
  readonly handle: string | null;
  readonly displayName: string | null;
  readonly createdAt: number | null;
  readonly lastAccessAt: number | null;
  readonly accessCount: number;
  readonly consentAccesses: number;
  readonly optOut: boolean;
  readonly deactivated: boolean;
};

export class UsersRepo extends Context.Tag("@skygest/UsersRepo")<
  UsersRepo,
  {
    readonly upsert: (user: UserRow) => Effect.Effect<void>;
    readonly get: (did: string) => Effect.Effect<UserRow | null>;
    readonly listActive: () => Effect.Effect<ReadonlyArray<string>>;
    readonly incrementAccess: (did: string, consentIncrement: number) => Effect.Effect<void>;
  }
>() {}
```

```ts
import { Context, Effect } from "effect";

export type InteractionRow = {
  readonly id: string;
  readonly userDid: string;
  readonly postUri: string;
  readonly type: "like" | "repost" | "quotepost";
  readonly createdAt: number;
};

export class InteractionsRepo extends Context.Tag("@skygest/InteractionsRepo")<
  InteractionsRepo,
  {
    readonly putMany: (rows: ReadonlyArray<InteractionRow>) => Effect.Effect<void>;
  }
>() {}
```

```ts
import { Context, Effect } from "effect";

export type AccessLog = {
  readonly id: string;
  readonly did: string;
  readonly accessAt: number;
  readonly recsShown: string;
  readonly cursorStart: number;
  readonly cursorEnd: number;
  readonly defaultFrom: number | null;
};

export class AccessRepo extends Context.Tag("@skygest/AccessRepo")<
  AccessRepo,
  {
    readonly logAccess: (log: AccessLog) => Effect.Effect<void>;
  }
>() {}
```

```ts
import { Effect, Layer } from "effect";
import { SqlClient } from "@effect/sql";
import { UsersRepo, UserRow } from "../UsersRepo";

export const UsersRepoD1 = {
  layer: Layer.effect(UsersRepo, Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;

    const upsert = (user: UserRow) =>
      sql`
        INSERT INTO users (
          did, handle, display_name, created_at, last_access_at,
          access_count, consent_accesses, opt_out, deactivated
        ) VALUES (
          ${user.did}, ${user.handle}, ${user.displayName}, ${user.createdAt}, ${user.lastAccessAt},
          ${user.accessCount}, ${user.consentAccesses}, ${user.optOut ? 1 : 0}, ${user.deactivated ? 1 : 0}
        )
        ON CONFLICT(did) DO UPDATE SET
          handle = excluded.handle,
          display_name = excluded.display_name,
          last_access_at = excluded.last_access_at,
          access_count = excluded.access_count,
          consent_accesses = excluded.consent_accesses,
          opt_out = excluded.opt_out,
          deactivated = excluded.deactivated
      `.pipe(Effect.asVoid);

    const get = (did: string) =>
      sql<UserRow>`
        SELECT
          did as did,
          handle as handle,
          display_name as displayName,
          created_at as createdAt,
          last_access_at as lastAccessAt,
          access_count as accessCount,
          consent_accesses as consentAccesses,
          opt_out as optOut,
          deactivated as deactivated
        FROM users
        WHERE did = ${did}
      `.pipe(Effect.map((rows) => rows[0] ?? null));

    const listActive = () =>
      sql<{ did: string }>`
        SELECT did as did FROM users WHERE deactivated = 0 AND opt_out = 0
      `.pipe(Effect.map((rows) => rows.map((r) => r.did)));

    const incrementAccess = (did: string, consentIncrement: number) =>
      sql`
        UPDATE users
        SET
          access_count = access_count + 1,
          consent_accesses = consent_accesses + ${consentIncrement},
          last_access_at = ${Date.now()}
        WHERE did = ${did}
      `.pipe(Effect.asVoid);

    return UsersRepo.of({ upsert, get, listActive, incrementAccess });
  }))
};
```

```ts
import { Effect, Layer } from "effect";
import { SqlClient } from "@effect/sql";
import { InteractionsRepo, InteractionRow } from "../InteractionsRepo";

export const InteractionsRepoD1 = {
  layer: Layer.effect(InteractionsRepo, Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;

    const putMany = (rows: ReadonlyArray<InteractionRow>) =>
      rows.length === 0
        ? Effect.void
        : sql`
            INSERT OR IGNORE INTO interactions
            ${sql.insert(rows.map((row) => ({
              id: row.id,
              user_did: row.userDid,
              post_uri: row.postUri,
              type: row.type,
              created_at: row.createdAt
            })))}
          `.pipe(Effect.asVoid);

    return InteractionsRepo.of({ putMany });
  }))
};
```

```ts
import { Effect, Layer } from "effect";
import { SqlClient } from "@effect/sql";
import { AccessRepo, AccessLog } from "../AccessRepo";

export const AccessRepoD1 = {
  layer: Layer.effect(AccessRepo, Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;

    const logAccess = (log: AccessLog) =>
      sql`
        INSERT INTO user_access_log (
          id, did, access_at, recs_shown, cursor_start, cursor_end, default_from
        ) VALUES (
          ${log.id}, ${log.did}, ${log.accessAt}, ${log.recsShown},
          ${log.cursorStart}, ${log.cursorEnd}, ${log.defaultFrom}
        )
      `.pipe(Effect.asVoid);

    return AccessRepo.of({ logAccess });
  }))
};
```

**Step 4: Run test to verify it passes**

Run: `bun test src/services/d1/UsersRepoD1.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/services/UsersRepo.ts src/services/InteractionsRepo.ts src/services/AccessRepo.ts \
  src/services/d1/UsersRepoD1.ts src/services/d1/InteractionsRepoD1.ts src/services/d1/AccessRepoD1.ts \
  src/services/d1/UsersRepoD1.test.ts

git commit -m "feat: add users/interactions/access repos"
```

---

### Task 7: Feed cache + candidate sessions (KV)

**Files:**
- Create: `src/services/FeedCache.ts`
- Create: `src/services/CandidateSessionsRepo.ts`
- Create: `src/services/kv/FeedCacheKv.ts`
- Create: `src/services/kv/CandidateSessionsKv.ts`
- Test: `src/services/kv/FeedCacheKv.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
import { FeedCache } from "../FeedCache";
import { FeedCacheKv } from "./FeedCacheKv";

it("stores and loads a feed", async () => {
  const program = Effect.gen(function* () {
    const cache = yield* FeedCache;
    yield* cache.putFeed("did:plc:1", "default", ["at://1"], 60);
    const got = yield* cache.getFeed("did:plc:1", "default");
    return got?.length ?? 0;
  });

  const result = await Effect.runPromise(program.pipe(Effect.provide(FeedCacheKv.layerTest)));
  expect(result).toBe(1);
});
```

**Step 2: Run test to verify it fails**

Run: `bun test src/services/kv/FeedCacheKv.test.ts`
Expected: FAIL (module not found).

**Step 3: Write minimal implementation**

```ts
import { Context, Effect } from "effect";

export class FeedCache extends Context.Tag("@skygest/FeedCache")<
  FeedCache,
  {
    readonly getFeed: (did: string, algorithm: string) => Effect.Effect<ReadonlyArray<string> | null>;
    readonly putFeed: (did: string, algorithm: string, items: ReadonlyArray<string>, ttlSeconds: number) => Effect.Effect<void>;
    readonly getMeta: (did: string, algorithm: string) => Effect.Effect<Record<string, unknown> | null>;
    readonly putMeta: (did: string, algorithm: string, meta: Record<string, unknown>, ttlSeconds: number) => Effect.Effect<void>;
  }
>() {}
```

```ts
import { Context, Effect } from "effect";

export class CandidateSessionsRepo extends Context.Tag("@skygest/CandidateSessionsRepo")<
  CandidateSessionsRepo,
  {
    readonly put: (sessionId: string, items: ReadonlyArray<string>, ttlSeconds: number) => Effect.Effect<void>;
    readonly get: (sessionId: string) => Effect.Effect<ReadonlyArray<string> | null>;
  }
>() {}
```

```ts
import { Effect, Layer } from "effect";
import { KeyValueStore } from "@effect/platform/KeyValueStore";
import { CloudflareEnv } from "../../platform/Env";
import { FeedCache } from "../FeedCache";

const key = (did: string, algorithm: string) => `feed:${did}:${algorithm}`;
const metaKey = (did: string, algorithm: string) => `feed-meta:${did}:${algorithm}`;

export const FeedCacheKv = {
  layer: Layer.effect(FeedCache, Effect.gen(function* () {
    const env = yield* CloudflareEnv;
    const store = KeyValueStore.makeStringOnly({
      get: (key) => Effect.tryPromise(() => env.FEED_CACHE.get(key)),
      set: (key, value, options) =>
        Effect.tryPromise(() =>
          env.FEED_CACHE.put(key, value, { expirationTtl: options?.timeToLive })
        ),
      remove: (key) => Effect.tryPromise(() => env.FEED_CACHE.delete(key)),
      clear: () => Effect.tryPromise(async () => {
        const list = await env.FEED_CACHE.list();
        await Promise.all(list.keys.map((k) => env.FEED_CACHE.delete(k.name)));
      }),
      size: () => Effect.succeed(0)
    });

    const getFeed = (did: string, algorithm: string) =>
      store.get(key(did, algorithm)).pipe(
        Effect.map((value) => value ? (JSON.parse(value) as ReadonlyArray<string>) : null)
      );

    const putFeed = (did: string, algorithm: string, items: ReadonlyArray<string>, ttlSeconds: number) =>
      store.set(key(did, algorithm), JSON.stringify(items), { timeToLive: ttlSeconds }).pipe(Effect.asVoid);

    const getMeta = (did: string, algorithm: string) =>
      store.get(metaKey(did, algorithm)).pipe(
        Effect.map((value) => value ? (JSON.parse(value) as Record<string, unknown>) : null)
      );

    const putMeta = (did: string, algorithm: string, meta: Record<string, unknown>, ttlSeconds: number) =>
      store.set(metaKey(did, algorithm), JSON.stringify(meta), { timeToLive: ttlSeconds }).pipe(Effect.asVoid);

    return FeedCache.of({ getFeed, putFeed, getMeta, putMeta });
  })),
  layerTest: Layer.effect(FeedCache, Effect.gen(function* () {
    const store = yield* KeyValueStore.KeyValueStore;

    const getFeed = (did: string, algorithm: string) =>
      store.get(key(did, algorithm)).pipe(
        Effect.map((value) => value ? (JSON.parse(value) as ReadonlyArray<string>) : null)
      );

    const putFeed = (did: string, algorithm: string, items: ReadonlyArray<string>, ttlSeconds: number) =>
      store.set(key(did, algorithm), JSON.stringify(items), { timeToLive: ttlSeconds }).pipe(Effect.asVoid);

    const getMeta = (did: string, algorithm: string) =>
      store.get(metaKey(did, algorithm)).pipe(
        Effect.map((value) => value ? (JSON.parse(value) as Record<string, unknown>) : null)
      );

    const putMeta = (did: string, algorithm: string, meta: Record<string, unknown>, ttlSeconds: number) =>
      store.set(metaKey(did, algorithm), JSON.stringify(meta), { timeToLive: ttlSeconds }).pipe(Effect.asVoid);

    return FeedCache.of({ getFeed, putFeed, getMeta, putMeta });
  })).pipe(Effect.provide(KeyValueStore.layerMemory))
};
```

```ts
import { Effect, Layer } from "effect";
import { KeyValueStore } from "@effect/platform/KeyValueStore";
import { CloudflareEnv } from "../../platform/Env";
import { CandidateSessionsRepo } from "../CandidateSessionsRepo";

const key = (id: string) => `candidate:${id}`;

export const CandidateSessionsKv = {
  layer: Layer.effect(CandidateSessionsRepo, Effect.gen(function* () {
    const env = yield* CloudflareEnv;
    const store = KeyValueStore.makeStringOnly({
      get: (key) => Effect.tryPromise(() => env.FEED_CACHE.get(key)),
      set: (key, value, options) =>
        Effect.tryPromise(() =>
          env.FEED_CACHE.put(key, value, { expirationTtl: options?.timeToLive })
        ),
      remove: (key) => Effect.tryPromise(() => env.FEED_CACHE.delete(key)),
      clear: () => Effect.tryPromise(async () => {
        const list = await env.FEED_CACHE.list();
        await Promise.all(list.keys.map((k) => env.FEED_CACHE.delete(k.name)));
      }),
      size: () => Effect.succeed(0)
    });

    const put = (sessionId: string, items: ReadonlyArray<string>, ttlSeconds: number) =>
      store.set(key(sessionId), JSON.stringify(items), { timeToLive: ttlSeconds }).pipe(Effect.asVoid);

    const get = (sessionId: string) =>
      store.get(key(sessionId)).pipe(
        Effect.map((value) => value ? (JSON.parse(value) as ReadonlyArray<string>) : null)
      );

    return CandidateSessionsRepo.of({ put, get });
  })),
  layerTest: Layer.effect(CandidateSessionsRepo, Effect.gen(function* () {
    const store = yield* KeyValueStore.KeyValueStore;

    const put = (sessionId: string, items: ReadonlyArray<string>, ttlSeconds: number) =>
      store.set(key(sessionId), JSON.stringify(items), { timeToLive: ttlSeconds }).pipe(Effect.asVoid);

    const get = (sessionId: string) =>
      store.get(key(sessionId)).pipe(
        Effect.map((value) => value ? (JSON.parse(value) as ReadonlyArray<string>) : null)
      );

    return CandidateSessionsRepo.of({ put, get });
  })).pipe(Effect.provide(KeyValueStore.layerMemory))
};
```

**Step 4: Run test to verify it passes**

Run: `bun test src/services/kv/FeedCacheKv.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/services/FeedCache.ts src/services/CandidateSessionsRepo.ts \
  src/services/kv/FeedCacheKv.ts src/services/kv/CandidateSessionsKv.ts \
  src/services/kv/FeedCacheKv.test.ts

git commit -m "feat: add kv feed cache and candidate sessions"
```

---

### Task 8: Bluesky client + auth service

**Files:**
- Create: `src/bluesky/BlueskyClient.ts`
- Create: `src/auth/AuthService.ts`
- Test: `src/auth/AuthService.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
import { AuthService } from "./AuthService";

const token = "eyJhbGciOiJub25lIn0." +
  "eyJpc3MiOiJkaWQ6cGxjOnRlc3QifQ." +
  "";

describe("AuthService", () => {
  it("decodes bearer token iss", async () => {
    const program = Effect.gen(function* () {
      const auth = yield* AuthService;
      return yield* auth.decodeBearer(`Bearer ${token}`);
    });

    const result = await Effect.runPromise(program.pipe(Effect.provide(AuthService.layer)));
    expect(result).toBe("did:plc:test");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test src/auth/AuthService.test.ts`
Expected: FAIL (module not found).

**Step 3: Write minimal implementation**

```ts
import { Context, Effect } from "effect";
import { decodeJwt } from "jose";

export class AuthService extends Context.Tag("@skygest/AuthService")<
  AuthService,
  {
    readonly decodeBearer: (header: string | null) => Effect.Effect<string | null>;
  }
>() {
  static layer = AuthService.of({
    decodeBearer: (header) => Effect.sync(() => {
      if (!header || !header.toLowerCase().startsWith("bearer ")) return null;
      const token = header.slice("bearer ".length).trim();
      const payload = decodeJwt(token);
      return typeof payload.iss === "string" ? payload.iss : null;
    })
  });
}
```

```ts
import { Context, Effect, Layer } from "effect";
import { FetchHttpClient, HttpClient, HttpClientResponse } from "@effect/platform";
import { Schema } from "effect";
import { BlueskyApiError } from "../domain/errors";
import { AppConfig } from "../platform/Config";

const FollowsResponse = Schema.Struct({
  cursor: Schema.optional(Schema.String),
  follows: Schema.Array(Schema.Struct({
    did: Schema.String,
    handle: Schema.optional(Schema.String)
  }))
});

export class BlueskyClient extends Context.Tag("@skygest/BlueskyClient")<
  BlueskyClient,
  {
    readonly getFollows: (did: string, cursor: string | null, limit: number) => Effect.Effect<{
      readonly dids: ReadonlyArray<string>;
      readonly cursor: string | null;
    }, BlueskyApiError>;
  }
>() {}

const makeBlueskyClient = (base: string) =>
  Effect.gen(function* () {
    const http = yield* HttpClient.HttpClient;

    const getFollows = (did: string, cursor: string | null, limit: number) =>
      http.get(`${base}/xrpc/app.bsky.graph.getFollows`, {
        urlParams: {
          actor: did,
          cursor: cursor ?? undefined,
          limit: String(limit)
        }
      }).pipe(
        Effect.flatMap(HttpClientResponse.schemaBodyJson(FollowsResponse)),
        Effect.map((body) => ({
          dids: body.follows.map((f) => f.did),
          cursor: body.cursor ?? null
        })),
        Effect.mapError((error) => BlueskyApiError.make({ message: String(error), status: 500 }))
      );

    return BlueskyClient.of({ getFollows });
  });

export const layer = Layer.effect(
  BlueskyClient,
  Effect.gen(function* () {
    const cfg = yield* AppConfig;
    return yield* makeBlueskyClient(cfg.publicApi);
  })
).pipe(Layer.provide(FetchHttpClient.layer));
```

**Step 4: Run test to verify it passes**

Run: `bun test src/auth/AuthService.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/bluesky/BlueskyClient.ts src/auth/AuthService.ts src/auth/AuthService.test.ts

git commit -m "feat: add bluesky client and auth decoder"
```

---

### Task 9: Paper filter patterns + search text

**Files:**
- Create: `src/filters/paperPatterns.ts`
- Create: `src/filters/paperFilter.ts`
- Test: `src/filters/paperFilter.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, it, expect } from "bun:test";
import { containsPaperLink, buildSearchText } from "./paperFilter";

describe("paperFilter", () => {
  it("detects arxiv links", () => {
    const record = { text: "see https://arxiv.org/abs/2401.00001" };
    const searchText = buildSearchText(record as any);
    expect(containsPaperLink(searchText)).toBe(true);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test src/filters/paperFilter.test.ts`
Expected: FAIL (module not found).

**Step 3: Write minimal implementation**

```ts
// Copy the arrays from .reference/PaperSkygest/preprint_feed/server/patterns.py
export const paperPatterns = [
  "https?://[^\\s<>\"]+\\.pdf(?:[?#][^\\s<>\"]*)?\\b",
  "arxiv\\.org/(?:abs|pdf)/\\d{4}\\.\\d{4,5}",
  "doi\\.org/10\\.\\d{4,}/",
  "openreview\\.net/forum\\?id=",
  "proceedings\\.neurips\\.cc/"
  // ... keep full list from patterns.py
];

export const contentPatterns = [
  "new (?:paper|preprint|work|research|study)",
  "our (?:paper|work|research|study|findings)",
  "arxiv|biorxiv|medrxiv",
  "paper link"
  // ... keep full list from patterns.py
];

export const pdfExclusions = new Set([
  "courtlistener.com",
  "justia.com",
  "casetext.com"
  // ... keep full list from patterns.py
]);

export const compiledPaperPatterns = paperPatterns.map((p) => new RegExp(p, "i"));
export const compiledContentPatterns = contentPatterns.map((p) => new RegExp(p, "i"));
```

```ts
import { compiledPaperPatterns, compiledContentPatterns, pdfExclusions } from "./paperPatterns";

export const buildSearchText = (record: Record<string, any>): string => {
  const text = String(record.text ?? "").toLowerCase();
  const urls = Array.isArray(record.urls) ? record.urls.map((u: string) => u.toLowerCase()).join(" ") : "";
  const tags = Array.isArray(record.tags) ? record.tags.map((t: string) => t.toLowerCase()).join(" ") : "";
  const labels = Array.isArray(record.label_values) ? record.label_values.map((t: string) => t.toLowerCase()).join(" ") : "";
  const embed = record.embed ?? {};
  const external = embed.external ?? {};
  const externalUri = String(external.uri ?? "").toLowerCase();
  const externalTitle = String(external.title ?? "").toLowerCase();
  const externalDescription = String(external.description ?? "").toLowerCase();
  const quoted = embed.record ?? {};
  const quotedText = String(quoted.text ?? "").toLowerCase();
  const quotedUri = String(quoted.uri ?? "").toLowerCase();

  return [
    text,
    urls,
    tags,
    labels,
    externalUri,
    externalTitle,
    externalDescription,
    quotedText,
    quotedUri
  ].join(" ");
};

export const containsPaperLink = (searchText: string): boolean => {
  for (const pattern of compiledPaperPatterns) {
    const match = pattern.exec(searchText);
    if (!match) continue;
    if (match[0].includes(".pdf")) {
      const excluded = Array.from(pdfExclusions).some((domain) => match[0].includes(domain));
      if (excluded) continue;
    }
    return true;
  }

  let matches = 0;
  for (const pattern of compiledContentPatterns) {
    if (pattern.test(searchText)) {
      matches += 1;
      if (matches >= 3) return true;
    }
  }

  return false;
};
```

**Step 4: Run test to verify it passes**

Run: `bun test src/filters/paperFilter.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/filters/paperPatterns.ts src/filters/paperFilter.ts src/filters/paperFilter.test.ts

git commit -m "feat: add paper filtering logic"
```

---

### Task 10: Jetstream ingestion service + DO

**Files:**
- Create: `src/ingest/JetstreamCursorStore.ts`
- Create: `src/ingest/JetstreamIngestor.ts`
- Create: `src/ingest/IngestorDo.ts`
- Test: `src/ingest/JetstreamCursorStore.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
import { SqliteClient } from "@effect/sql-sqlite-bun";
import { SqlClient } from "@effect/sql";
import { JetstreamCursorStore } from "./JetstreamCursorStore";

it("stores cursor", async () => {
  const program = Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`CREATE TABLE IF NOT EXISTS jetstream_state (id TEXT PRIMARY KEY, cursor INTEGER)`;
    const store = yield* JetstreamCursorStore;
    yield* store.setCursor(123);
    return yield* store.getCursor();
  });

  const result = await Effect.runPromise(
    program.pipe(
      Effect.provide(JetstreamCursorStore.layer),
      Effect.provide(SqliteClient.layer({ filename: ":memory:" }))
    )
  );

  expect(result).toBe(123);
});
```

**Step 2: Run test to verify it fails**

Run: `bun test src/ingest/JetstreamCursorStore.test.ts`
Expected: FAIL (module not found).

**Step 3: Write minimal implementation**

```ts
import { Context, Effect, Layer } from "effect";
import { SqlClient } from "@effect/sql";

export class JetstreamCursorStore extends Context.Tag("@skygest/JetstreamCursorStore")<
  JetstreamCursorStore,
  {
    readonly getCursor: () => Effect.Effect<number | null>;
    readonly setCursor: (cursor: number) => Effect.Effect<void>;
  }
>() {}

export const layer = Layer.effect(JetstreamCursorStore, Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const getCursor = () =>
    sql<{ cursor: number }>`SELECT cursor FROM jetstream_state WHERE id = 'main'`
      .pipe(Effect.map((rows) => rows[0]?.cursor ?? null));

  const setCursor = (cursor: number) =>
    sql`
      INSERT INTO jetstream_state (id, cursor) VALUES ('main', ${cursor})
      ON CONFLICT(id) DO UPDATE SET cursor = excluded.cursor
    `.pipe(Effect.asVoid);

  return JetstreamCursorStore.of({ getCursor, setCursor });
}));
```

```ts
import { Duration, Effect, Stream } from "effect";
import { Jetstream, JetstreamConfig, JetstreamMessage } from "effect-jetstream";
import { CloudflareEnv, EnvBindings } from "../platform/Env";
import { AppConfig } from "../platform/Config";
import { JetstreamCursorStore, layer as CursorLayer } from "./JetstreamCursorStore";
import { RawEvent, RawEventBatch } from "../domain/types";

const toRawEvent = (event: JetstreamMessage.JetstreamMessage): RawEvent | null => {
  if (event._tag === "CommitCreate" || event._tag === "CommitUpdate" || event._tag === "CommitDelete") {
    return {
      kind: "commit",
      operation: event.commit.operation,
      collection: event.commit.collection,
      did: event.did,
      uri: `at://${event.did}/${event.commit.collection}/${event.commit.rkey}`,
      cid: event.commit.cid,
      record: event.commit.record,
      timeUs: event.time_us
    };
  }
  return null;
};

export const runIngestor = Effect.gen(function* () {
  const cfg = yield* AppConfig;
  const env = yield* CloudflareEnv;
  const cursorStore = yield* JetstreamCursorStore;

  const startCursor = yield* cursorStore.getCursor();
  const config = JetstreamConfig.JetstreamConfig.make({
    endpoint: cfg.jetstreamEndpoint,
    wantedCollections: ["app.bsky.feed.post", "app.bsky.feed.like", "app.bsky.feed.repost"],
    cursor: startCursor ?? undefined
  });

  const streamEffect = Effect.gen(function* () {
    const jetstream = yield* Jetstream.Jetstream;
    yield* jetstream.stream.pipe(
      Stream.map(toRawEvent),
      Stream.filter((event): event is RawEvent => event !== null),
      Stream.groupedWithin(200, Duration.seconds(2)),
      Stream.mapEffect((chunk) => {
        const events = Array.from(chunk);
        const cursor = events.at(-1)?.timeUs;
        const payload: RawEventBatch = { cursor, events };
        return Effect.tryPromise(() => env.RAW_EVENTS.send(payload, { contentType: "json" })).pipe(
          Effect.tap(() => cursor ? cursorStore.setCursor(cursor) : Effect.void)
        );
      }),
      Stream.runDrain
    );
  });

  yield* streamEffect.pipe(Effect.provide(Jetstream.live(config)));
}).pipe(Effect.provide(CursorLayer));
```

```ts
import { DurableObject } from "cloudflare:workers";
import { Effect } from "effect";
import { runIngestor } from "./JetstreamIngestor";
import { CloudflareEnv, EnvBindings } from "../platform/Env";
import { AppConfig } from "../platform/Config";
import { SqliteClient } from "@effect/sql-sqlite-do";
import { Jetstream } from "effect-jetstream";

export class JetstreamIngestorDo extends DurableObject {
  constructor(state: DurableObjectState, env: EnvBindings) {
    super(state, env);
    state.blockConcurrencyWhile(async () => {
      this.state.storage.sql.exec("CREATE TABLE IF NOT EXISTS jetstream_state (id TEXT PRIMARY KEY, cursor INTEGER)");
    });
  }

  async fetch(): Promise<Response> {
    this.ctx.waitUntil(
      Effect.runPromise(
        runIngestor.pipe(
          Effect.provide(CloudflareEnv.layer(this.env)),
          Effect.provide(AppConfig.layer),
          Effect.provide(SqliteClient.layer({ db: this.ctx.storage.sql }))
        )
      )
    );

    return new Response("ok");
  }
}
```

**Step 4: Run test to verify it passes**

Run: `bun test src/ingest/JetstreamCursorStore.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/ingest/JetstreamCursorStore.ts src/ingest/JetstreamIngestor.ts src/ingest/IngestorDo.ts \
  src/ingest/JetstreamCursorStore.test.ts

git commit -m "feat: add jetstream ingestor service and DO"
```

---

### Task 11: Filter worker (raw events -> D1)

**Files:**
- Create: `src/filter/FilterWorker.ts`
- Test: `src/filter/FilterWorker.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, it, expect } from "bun:test";
import { Effect, Layer } from "effect";
import { processBatch } from "./FilterWorker";
import { PostsRepo } from "../services/PostsRepo";
import { InteractionsRepo } from "../services/InteractionsRepo";
import { RawEventBatch } from "../domain/types";

it("filters paper posts", async () => {
  let inserted = 0;
  const PostsTest = Layer.succeed(PostsRepo, {
    putMany: () => Effect.sync(() => void (inserted += 1)),
    listRecentByAuthor: () => Effect.succeed([]),
    markDeleted: () => Effect.void
  });
  const InteractionsTest = Layer.succeed(InteractionsRepo, { putMany: () => Effect.void });

  const batch: RawEventBatch = {
    cursor: 1,
    events: [
      {
        kind: "commit",
        operation: "create",
        collection: "app.bsky.feed.post",
        did: "did:plc:1",
        uri: "at://did:plc:1/app.bsky.feed.post/1",
        cid: "cid",
        record: { text: "https://arxiv.org/abs/2401.00001" },
        timeUs: 1
      }
    ]
  };

  const result = await Effect.runPromise(
    processBatch(batch).pipe(
      Effect.provide(PostsTest),
      Effect.provide(InteractionsTest)
    )
  );

  expect(inserted).toBe(1);
  expect(result).toBeUndefined();
});
```

**Step 2: Run test to verify it fails**

Run: `bun test src/filter/FilterWorker.test.ts`
Expected: FAIL (module not found).

**Step 3: Write minimal implementation**

```ts
import { Effect } from "effect";
import { RawEventBatch } from "../domain/types";
import { PostsRepo } from "../services/PostsRepo";
import { InteractionsRepo } from "../services/InteractionsRepo";
import { buildSearchText, containsPaperLink } from "../filters/paperFilter";

export const processBatch = (batch: RawEventBatch) =>
  Effect.gen(function* () {
    const posts = yield* PostsRepo;
    const interactions = yield* InteractionsRepo;

    const paperPosts = batch.events
      .filter((e) => e.collection === "app.bsky.feed.post" && e.operation === "create" && e.record)
      .map((e) => {
        const record = e.record as Record<string, unknown>;
        const searchText = buildSearchText(record as any);
        return {
          event: e,
          searchText
        };
      })
      .filter((p) => containsPaperLink(p.searchText))
      .map((p) => ({
        uri: p.event.uri,
        cid: p.event.cid ?? "",
        authorDid: p.event.did,
        createdAt: Math.floor(p.event.timeUs / 1000),
        createdAtDay: new Date(Math.floor(p.event.timeUs / 1000)).toISOString().slice(0, 10),
        indexedAt: Date.now(),
        searchText: p.searchText,
        replyRoot: null,
        replyParent: null,
        status: "active" as const
      }));

    yield* posts.putMany(paperPosts);
    yield* interactions.putMany([]);
  });
```

**Step 4: Run test to verify it passes**

Run: `bun test src/filter/FilterWorker.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/filter/FilterWorker.ts src/filter/FilterWorker.test.ts

git commit -m "feat: add filter worker"
```

---

### Task 12: Recommendation dispatch + generator

**Files:**
- Create: `src/generator/DispatchWorker.ts`
- Create: `src/generator/GeneratorWorker.ts`
- Test: `src/generator/GeneratorWorker.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, it, expect } from "bun:test";
import { Effect, Layer } from "effect";
import { GeneratorWorker } from "./GeneratorWorker";
import { FeedCache } from "../services/FeedCache";
import { PostsRepo } from "../services/PostsRepo";
import { BlueskyClient } from "../bluesky/BlueskyClient";
import { FeedGenMessage } from "../domain/types";

it("builds a feed and writes cache", async () => {
  let stored = 0;
  const FeedCacheTest = Layer.succeed(FeedCache, {
    getFeed: () => Effect.succeed(null),
    putFeed: () => Effect.sync(() => void (stored += 1)),
    getMeta: () => Effect.succeed(null),
    putMeta: () => Effect.void
  });
  const PostsTest = Layer.succeed(PostsRepo, {
    putMany: () => Effect.void,
    listRecentByAuthor: () => Effect.succeed([
      {
        uri: "at://did:plc:1/app.bsky.feed.post/1",
        cid: "cid",
        authorDid: "did:plc:1",
        createdAt: 100,
        createdAtDay: "2025-01-01",
        indexedAt: 200,
        searchText: "arxiv",
        replyRoot: null,
        replyParent: null,
        status: "active"
      }
    ]),
    markDeleted: () => Effect.void
  });
  const BlueskyTest = Layer.succeed(BlueskyClient, {
    getFollows: () => Effect.succeed({ dids: ["did:plc:1"], cursor: null })
  });

  const message: FeedGenMessage = { users: ["did:plc:viewer"], batchId: 1, generateAgg: false };
  await Effect.runPromise(
    GeneratorWorker.process(message).pipe(
      Effect.provide(FeedCacheTest),
      Effect.provide(PostsTest),
      Effect.provide(BlueskyTest)
    )
  );

  expect(stored).toBe(1);
});
```

**Step 2: Run test to verify it fails**

Run: `bun test src/generator/GeneratorWorker.test.ts`
Expected: FAIL (module not found).

**Step 3: Write minimal implementation**

```ts
import { Effect } from "effect";
import { UsersRepo } from "../services/UsersRepo";
import { CloudflareEnv, EnvBindings } from "../platform/Env";

export const DispatchWorker = {
  run: Effect.gen(function* () {
    const users = yield* UsersRepo;
    const env = yield* CloudflareEnv;
    const dids = yield* users.listActive();

    const batchSize = 20;
    let batchId = 0;
    for (let i = 0; i < dids.length; i += batchSize) {
      batchId += 1;
      const usersBatch = dids.slice(i, i + batchSize);
      const payload = { users: usersBatch, batchId, generateAgg: batchId === 1 };
      yield* Effect.tryPromise(() => env.FEED_GEN.send(payload, { contentType: "json" }));
    }
  })
};
```

```ts
import { Effect } from "effect";
import { FeedGenMessage } from "../domain/types";
import { FeedCache } from "../services/FeedCache";
import { PostsRepo } from "../services/PostsRepo";
import { BlueskyClient } from "../bluesky/BlueskyClient";

const buildFeed = (items: ReadonlyArray<{ uri: string }>) => items.map((p) => p.uri);

export const GeneratorWorker = {
  process: (message: FeedGenMessage) =>
    Effect.gen(function* () {
      const cache = yield* FeedCache;
      const posts = yield* PostsRepo;
      const bluesky = yield* BlueskyClient;

      for (const user of message.users) {
        const follows = yield* bluesky.getFollows(user, null, 100);
        const followPosts = yield* Effect.forEach(
          follows.dids,
          (did) => posts.listRecentByAuthor(did, 10),
          { concurrency: 10 }
        );
        const flattened = followPosts.flat();
        const feed = buildFeed(flattened)
          .slice(0, 150);
        yield* cache.putFeed(user, "default", feed, 60 * 15);
      }
    })
};
```

**Step 4: Run test to verify it passes**

Run: `bun test src/generator/GeneratorWorker.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/generator/DispatchWorker.ts src/generator/GeneratorWorker.ts src/generator/GeneratorWorker.test.ts

git commit -m "feat: add dispatch and generator workers"
```

---

### Task 13: Feed API + postprocess worker

**Files:**
- Create: `src/feed/FeedRouter.ts`
- Create: `src/postprocess/PostprocessWorker.ts`
- Test: `src/feed/FeedRouter.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, it, expect } from "bun:test";
import * as HttpApp from "@effect/platform/HttpApp";
import { app } from "./FeedRouter";

it("serves health", async () => {
  const handler = HttpApp.toWebHandler(app);
  const res = await handler(new Request("http://localhost/xrpc/app.bsky.feed.describeFeedGenerator"));
  expect(res.status).toBe(200);
});
```

**Step 2: Run test to verify it fails**

Run: `bun test src/feed/FeedRouter.test.ts`
Expected: FAIL (module not found).

**Step 3: Write minimal implementation**

```ts
import * as HttpRouter from "@effect/platform/HttpRouter";
import * as HttpServerRequest from "@effect/platform/HttpServerRequest";
import * as HttpServerResponse from "@effect/platform/HttpServerResponse";
import { Effect, Schema } from "effect";
import { FeedCache } from "../services/FeedCache";
import { AppConfig } from "../platform/Config";
import { AuthService } from "../auth/AuthService";

const FeedQuery = Schema.Struct({
  limit: Schema.NumberFromString,
  cursor: Schema.optional(Schema.Union(Schema.NumberFromString, Schema.Literal("eof"))),
  feed: Schema.optional(Schema.String)
});

export const app = HttpRouter.empty.pipe(
  HttpRouter.get("/xrpc/app.bsky.feed.describeFeedGenerator", Effect.gen(function* () {
    const cfg = yield* AppConfig;
    return HttpServerResponse.unsafeJson({
      did: cfg.feedDid,
      feeds: [{
        uri: `at://${cfg.feedDid}/app.bsky.feed.generator/skygest`,
        cid: "",
        name: "Skygest",
        description: "Paper Skygest"
      }]
    });
  })),
  HttpRouter.get("/xrpc/app.bsky.feed.getFeedSkeleton", Effect.gen(function* () {
    const cfg = yield* AppConfig;
    const cache = yield* FeedCache;
    const auth = yield* AuthService;
    const params = yield* HttpServerRequest.schemaSearchParams(FeedQuery);
    if (params.cursor === "eof") {
      return HttpServerResponse.unsafeJson({ cursor: "eof", feed: [] });
    }
    const header = (yield* HttpServerRequest.HttpServerRequest).headers["authorization"] ?? null;
    const did = yield* auth.decodeBearer(header);
    const feed = did ? (yield* cache.getFeed(did, "default")) ?? [] : [];
    const sliced = feed.slice(Number(params.cursor ?? 0), Number(params.cursor ?? 0) + params.limit);
    const nextCursor = Number(params.cursor ?? 0) + params.limit;
    return HttpServerResponse.unsafeJson({ cursor: sliced.length > 0 ? String(nextCursor) : "eof", feed: sliced.map((post) => ({ post })) });
  }))
);
```

```ts
import { Effect } from "effect";
import { PostprocessMessage } from "../domain/types";
import { AccessRepo } from "../services/AccessRepo";
import { UsersRepo } from "../services/UsersRepo";

export const processPostprocess = (msg: PostprocessMessage) =>
  Effect.gen(function* () {
    const access = yield* AccessRepo;
    const users = yield* UsersRepo;
    yield* access.logAccess({
      id: crypto.randomUUID(),
      did: msg.viewer,
      accessAt: msg.accessAt,
      recsShown: JSON.stringify(msg.recs),
      cursorStart: msg.cursorStart,
      cursorEnd: msg.cursorEnd,
      defaultFrom: msg.defaultFrom ?? null
    });
    const consentIncrement = msg.recs.length > 0 ? 1 : 0;
    yield* users.incrementAccess(msg.viewer, consentIncrement);
  });
```

**Step 4: Run test to verify it passes**

Run: `bun test src/feed/FeedRouter.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/feed/FeedRouter.ts src/postprocess/PostprocessWorker.ts src/feed/FeedRouter.test.ts

git commit -m "feat: add feed router and postprocess worker"
```

---

### Task 14: MCP router + worker entrypoints

**Files:**
- Create: `src/mcp/Router.ts`
- Create: `src/worker/feed.ts`
- Create: `src/worker/filter.ts`
- Create: `src/worker/generator.ts`
- Create: `src/worker/dispatch.ts`
- Create: `src/worker/postprocess.ts`
- Create: `wrangler.filter.toml`
- Create: `wrangler.generator.toml`
- Create: `wrangler.dispatch.toml`
- Create: `wrangler.postprocess.toml`
- Test: `src/worker/feed.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, it, expect } from "bun:test";
import { fetch } from "./feed";

it("exports fetch", () => {
  expect(fetch).toBeDefined();
});
```

**Step 2: Run test to verify it fails**

Run: `bun test src/worker/feed.test.ts`
Expected: FAIL (module not found).

**Step 3: Write minimal implementation**

```ts
import * as HttpRouter from "@effect/platform/HttpRouter";
import * as HttpServerResponse from "@effect/platform/HttpServerResponse";

export const app = HttpRouter.empty.pipe(
  HttpRouter.get("/mcp/health", HttpServerResponse.text("ok"))
);
```

```ts
import { Effect } from "effect";
import * as HttpApp from "@effect/platform/HttpApp";
import * as HttpRouter from "@effect/platform/HttpRouter";
import { app as feedApp } from "../feed/FeedRouter";
import { app as mcpApp } from "../mcp/Router";
import { CloudflareEnv, EnvBindings } from "../platform/Env";
import { AppConfig } from "../platform/Config";
import { AuthService } from "../auth/AuthService";
import { FeedCacheKv } from "../services/kv/FeedCacheKv";
import { PostsRepoD1 } from "../services/d1/PostsRepoD1";
import { UsersRepoD1 } from "../services/d1/UsersRepoD1";
import { InteractionsRepoD1 } from "../services/d1/InteractionsRepoD1";
import { AccessRepoD1 } from "../services/d1/AccessRepoD1";
import { D1Client } from "@effect/sql-d1";

const app = feedApp.pipe(HttpRouter.mount("/mcp", mcpApp));

export const fetch = (request: Request, env: EnvBindings, ctx: ExecutionContext) =>
  HttpApp.toWebHandler(
    app.pipe(
      Effect.provide(CloudflareEnv.layer(env)),
      Effect.provide(AppConfig.layer),
      Effect.provide(FeedCacheKv.layer),
      Effect.provide(AuthService.layer),
      Effect.provide(PostsRepoD1.layer),
      Effect.provide(UsersRepoD1.layer),
      Effect.provide(InteractionsRepoD1.layer),
      Effect.provide(AccessRepoD1.layer),
      Effect.provide(D1Client.layer({ db: env.DB }))
    )
  )(request);
```

```ts
import { Effect } from "effect";
import { processBatch } from "../filter/FilterWorker";
import { CloudflareEnv, EnvBindings } from "../platform/Env";
import { PostsRepoD1 } from "../services/d1/PostsRepoD1";
import { InteractionsRepoD1 } from "../services/d1/InteractionsRepoD1";
import { D1Client } from "@effect/sql-d1";

export const queue = (batch: MessageBatch, env: EnvBindings, ctx: ExecutionContext) =>
  ctx.waitUntil(
    Promise.all(batch.messages.map(async (msg) => {
      await Effect.runPromise(
        processBatch(msg.body).pipe(
          Effect.provide(CloudflareEnv.layer(env)),
          Effect.provide(PostsRepoD1.layer),
          Effect.provide(InteractionsRepoD1.layer),
          Effect.provide(D1Client.layer({ db: env.DB }))
        )
      );
      msg.ack();
    }))
  );
```

```ts
import { Effect } from "effect";
import { GeneratorWorker } from "../generator/GeneratorWorker";
import { CloudflareEnv, EnvBindings } from "../platform/Env";
import { AppConfig } from "../platform/Config";
import { FeedCacheKv } from "../services/kv/FeedCacheKv";
import { PostsRepoD1 } from "../services/d1/PostsRepoD1";
import { BlueskyClient } from "../bluesky/BlueskyClient";
import { D1Client } from "@effect/sql-d1";

export const queue = (batch: MessageBatch, env: EnvBindings, ctx: ExecutionContext) =>
  ctx.waitUntil(
    Promise.all(batch.messages.map(async (msg) => {
      await Effect.runPromise(
        GeneratorWorker.process(msg.body).pipe(
          Effect.provide(CloudflareEnv.layer(env)),
          Effect.provide(AppConfig.layer),
          Effect.provide(FeedCacheKv.layer),
          Effect.provide(PostsRepoD1.layer),
          Effect.provide(BlueskyClient.layer),
          Effect.provide(D1Client.layer({ db: env.DB }))
        )
      );
      msg.ack();
    }))
  );
```

```ts
import { Effect } from "effect";
import { DispatchWorker } from "../generator/DispatchWorker";
import { CloudflareEnv, EnvBindings } from "../platform/Env";
import { UsersRepoD1 } from "../services/d1/UsersRepoD1";
import { D1Client } from "@effect/sql-d1";

export const scheduled = (event: ScheduledEvent, env: EnvBindings, ctx: ExecutionContext) =>
  ctx.waitUntil(
    Effect.runPromise(
      DispatchWorker.run.pipe(
        Effect.provide(CloudflareEnv.layer(env)),
        Effect.provide(UsersRepoD1.layer),
        Effect.provide(D1Client.layer({ db: env.DB }))
      )
    )
  );
```

```ts
import { Effect } from "effect";
import { processPostprocess } from "../postprocess/PostprocessWorker";
import { CloudflareEnv, EnvBindings } from "../platform/Env";
import { UsersRepoD1 } from "../services/d1/UsersRepoD1";
import { AccessRepoD1 } from "../services/d1/AccessRepoD1";
import { D1Client } from "@effect/sql-d1";

export const queue = (batch: MessageBatch, env: EnvBindings, ctx: ExecutionContext) =>
  ctx.waitUntil(
    Promise.all(batch.messages.map(async (msg) => {
      await Effect.runPromise(
        processPostprocess(msg.body).pipe(
          Effect.provide(CloudflareEnv.layer(env)),
          Effect.provide(UsersRepoD1.layer),
          Effect.provide(AccessRepoD1.layer),
          Effect.provide(D1Client.layer({ db: env.DB }))
        )
      );
      msg.ack();
    }))
  );
```

Create worker configs (queue consumers use separate scripts):

```toml
# wrangler.filter.toml
name = "skygest-filter"
main = "src/worker/filter.ts"
compatibility_date = "2024-04-03"

[[d1_databases]]
binding = "DB"
database_name = "skygest"
database_id = "REPLACE_ME"

[[queues.consumers]]
queue = "raw-events"
max_batch_size = 50
max_batch_timeout = 5
max_retries = 5
```

```toml
# wrangler.generator.toml
name = "skygest-generator"
main = "src/worker/generator.ts"
compatibility_date = "2024-04-03"

[vars]
FEED_DID = "did:plc:REPLACE_ME"
ALG_FEED_DID = "did:plc:REPLACE_ME"
PUBLIC_BSKY_API = "https://public.api.bsky.app"
JETSTREAM_ENDPOINT = "wss://jetstream1.us-east.bsky.network/subscribe"
FOLLOW_LIMIT = "5000"
FEED_LIMIT = "150"
CONSENT_THRESHOLD = "5"

[[d1_databases]]
binding = "DB"
database_name = "skygest"
database_id = "REPLACE_ME"

[[kv_namespaces]]
binding = "FEED_CACHE"
id = "REPLACE_ME"

[[queues.consumers]]
queue = "feed-gen"
max_batch_size = 10
max_batch_timeout = 5
max_retries = 5
```

```toml
# wrangler.dispatch.toml
name = "skygest-dispatch"
main = "src/worker/dispatch.ts"
compatibility_date = "2024-04-03"

[[d1_databases]]
binding = "DB"
database_name = "skygest"
database_id = "REPLACE_ME"

[triggers]
crons = ["*/20 * * * *"]
```

```toml
# wrangler.postprocess.toml
name = "skygest-postprocess"
main = "src/worker/postprocess.ts"
compatibility_date = "2024-04-03"

[[d1_databases]]
binding = "DB"
database_name = "skygest"
database_id = "REPLACE_ME"

[[queues.consumers]]
queue = "postprocess"
max_batch_size = 10
max_batch_timeout = 5
max_retries = 5
```

**Step 4: Run test to verify it passes**

Run: `bun test src/worker/feed.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/mcp/Router.ts src/worker/feed.ts src/worker/filter.ts src/worker/generator.ts \
  src/worker/dispatch.ts src/worker/postprocess.ts src/worker/feed.test.ts \
  wrangler.filter.toml wrangler.generator.toml wrangler.dispatch.toml wrangler.postprocess.toml

git commit -m "feat: add mcp router and worker entrypoints"
```

---

## Verification

- `bun test`
- `bun run typecheck`
- Local dev (feed worker): `bunx wrangler dev`
- Queue workers: `bunx wrangler dev -c wrangler.filter.toml` (repeat per worker)
