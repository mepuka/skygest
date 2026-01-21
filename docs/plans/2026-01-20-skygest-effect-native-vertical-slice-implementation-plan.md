# Skygest Effect-Native Vertical Slice Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build an end-to-end Jetstream ingestion → D1 → global feed skeleton slice on Cloudflare using Effect services/layers.

**Architecture:** A Jetstream Durable Object streams commit events into a Queue. A Filter worker consumes batches and writes paper posts into D1. A Feed API worker serves a global feed skeleton from D1 with a timestamp cursor.

**Tech Stack:** TypeScript, Effect, @effect/platform (HttpRouter/HttpApp), @effect/sql, @effect/sql-d1, @effect/sql-sqlite-bun (tests), effect-jetstream, Cloudflare Workers/DO/Queues/D1.

**Skill References:** @cloudflare (workers, durable-objects, queues, d1).

---

### Task 0: Effect solutions guidance (preflight)

**Files:**
- None

**Step 1: List Effect solution topics**

Run: `effect-solutions list`
Expected: list of topics (quick-start, services-and-layers, testing, etc.).

**Step 2: Show relevant topics**

Run: `effect-solutions show basics services-and-layers testing`
Expected: guidance for Tags/Layers, Effect composition, and testing patterns.

---

### Task 1: Cloudflare bindings + Env service + wrangler configs

**Files:**
- Modify: `package.json`
- Modify: `tsconfig.json`
- Create: `wrangler.toml`
- Create: `wrangler.filter.toml`
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
      JETSTREAM_ENDPOINT: "wss://example",
      DB: {} as D1Database,
      RAW_EVENTS: {} as Queue,
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
  readonly JETSTREAM_ENDPOINT: string;
  readonly DB: D1Database;
  readonly RAW_EVENTS: Queue;
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
"devDependencies": {
  "@cloudflare/workers-types": "^4.20260120.0",
  "@effect/language-service": "^0.71.2",
  "@effect/sql-sqlite-bun": "^1.0.0",
  "@types/bun": "latest"
}
```

Update `tsconfig.json`:

```json
"types": ["@cloudflare/workers-types"]
```

Create `wrangler.toml`:

```toml
name = "skygest-feed"
main = "src/worker/feed.ts"
compatibility_date = "2024-04-03"

[vars]
FEED_DID = "did:plc:REPLACE_ME"
JETSTREAM_ENDPOINT = "wss://jetstream1.us-east.bsky.network/subscribe"

[[d1_databases]]
binding = "DB"
database_name = "skygest"
database_id = "REPLACE_ME"

[[queues.producers]]
queue = "raw-events"
binding = "RAW_EVENTS"

[[durable_objects.bindings]]
name = "JETSTREAM_INGESTOR"
class_name = "JetstreamIngestorDo"

[[migrations]]
tag = "v1"
new_classes = ["JetstreamIngestorDo"]
```

Create `wrangler.filter.toml`:

```toml
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

**Step 4: Run test to verify it passes**

Run: `bun test src/platform/Env.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add package.json tsconfig.json wrangler.toml wrangler.filter.toml src/platform/Env.ts src/platform/Env.test.ts

git commit -m "feat: add cloudflare env bindings and configs"
```

---

### Task 2: App config layer

**Files:**
- Create: `src/platform/Config.ts`
- Test: `src/platform/Config.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, it, expect } from "bun:test";
import { Effect, Layer } from "effect";
import { AppConfig } from "./Config";

describe("AppConfig", () => {
  it("loads config from layer", async () => {
    const program = Effect.gen(function* () {
      const cfg = yield* AppConfig;
      return cfg.feedDid;
    });

    const result = await Effect.runPromise(
      program.pipe(
        Effect.provide(Layer.succeed(AppConfig, {
          feedDid: "did:plc:test",
          jetstreamEndpoint: "wss://example"
        }))
      )
    );

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
  jetstreamEndpoint: Config.withDefault(
    Config.string("JETSTREAM_ENDPOINT"),
    "wss://jetstream1.us-east.bsky.network/subscribe"
  )
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
        ["JETSTREAM_ENDPOINT", env.JETSTREAM_ENDPOINT]
      ]));
      return yield* Config.load(ConfigSchema).pipe(
        Effect.withConfigProvider(provider)
      );
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

### Task 3: Domain types for raw events

**Files:**
- Create: `src/domain/types.ts`
- Test: `src/domain/types.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, it, expect } from "bun:test";
import { Schema } from "effect";
import { RawEvent } from "./types";

describe("RawEvent", () => {
  it("decodes commit event", () => {
    const value = Schema.decodeSync(RawEvent)({
      kind: "commit",
      operation: "create",
      collection: "app.bsky.feed.post",
      did: "did:plc:1",
      uri: "at://did:plc:1/app.bsky.feed.post/1",
      cid: "cid",
      record: { text: "hello" },
      timeUs: 123
    });

    expect(value.uri).toBe("at://did:plc:1/app.bsky.feed.post/1");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test src/domain/types.test.ts`
Expected: FAIL (module not found).

**Step 3: Write minimal implementation**

```ts
import { Schema } from "effect";

export const RawEvent = Schema.Struct({
  kind: Schema.Literal("commit"),
  operation: Schema.Union(
    Schema.Literal("create"),
    Schema.Literal("update"),
    Schema.Literal("delete")
  ),
  collection: Schema.String,
  did: Schema.String,
  uri: Schema.String,
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
```

**Step 4: Run test to verify it passes**

Run: `bun test src/domain/types.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/domain/types.ts src/domain/types.test.ts

git commit -m "feat: add raw event schemas"
```

---

### Task 4: D1 migrations + migrate helper

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
  it("creates posts table", async () => {
    const program = Effect.gen(function* () {
      yield* runMigrations;
      const sql = yield* SqlClient.SqlClient;
      const rows = yield* sql<{ name: string }>
        `SELECT name FROM sqlite_master WHERE type='table' AND name='posts'`;
      return rows.length;
    });

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(SqliteClient.layer({ filename: ":memory:" })))
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
    indexed_at INTEGER NOT NULL,
    search_text TEXT,
    reply_root TEXT,
    reply_parent TEXT,
    status TEXT DEFAULT 'active'
  )`;

  yield* sql`CREATE INDEX IF NOT EXISTS idx_posts_created_at
    ON posts(created_at DESC)`;
});

export const migrations: ReadonlyArray<ResolvedMigration> = [
  [1, "init", migration1]
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

git commit -m "feat: add D1 migrations"
```

---

### Task 5: Posts repository (global feed)

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

it("lists recent posts with cursor", async () => {
  const program = Effect.gen(function* () {
    yield* runMigrations;
    const repo = yield* PostsRepo;
    yield* repo.putMany([
      {
        uri: "at://did:plc:1/app.bsky.feed.post/1",
        cid: "cid1",
        authorDid: "did:plc:1",
        createdAt: 200,
        indexedAt: 250,
        searchText: "arxiv",
        replyRoot: null,
        replyParent: null,
        status: "active"
      },
      {
        uri: "at://did:plc:2/app.bsky.feed.post/2",
        cid: "cid2",
        authorDid: "did:plc:2",
        createdAt: 100,
        indexedAt: 150,
        searchText: "arxiv",
        replyRoot: null,
        replyParent: null,
        status: "active"
      }
    ]);
    const first = yield* repo.listRecent(null, 10);
    const older = yield* repo.listRecent(150, 10);
    return { first, older };
  });

  const result = await Effect.runPromise(
    program.pipe(
      Effect.provide(PostsRepoD1.layer),
      Effect.provide(SqliteClient.layer({ filename: ":memory:" }))
    )
  );

  expect(result.first[0]?.createdAt).toBe(200);
  expect(result.older.length).toBe(1);
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
    readonly listRecent: (cursor: number | null, limit: number) => Effect.Effect<ReadonlyArray<PaperPost>>;
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
              indexed_at: p.indexedAt,
              search_text: p.searchText,
              reply_root: p.replyRoot,
              reply_parent: p.replyParent,
              status: p.status
            })))}
          `.pipe(Effect.asVoid);

    const listRecent = (cursor: number | null, limit: number) =>
      cursor === null
        ? sql<PaperPost>`
            SELECT
              uri as uri,
              cid as cid,
              author_did as authorDid,
              created_at as createdAt,
              indexed_at as indexedAt,
              search_text as searchText,
              reply_root as replyRoot,
              reply_parent as replyParent,
              status as status
            FROM posts
            WHERE status != 'deleted'
            ORDER BY created_at DESC, uri DESC
            LIMIT ${limit}
          `
        : sql<PaperPost>`
            SELECT
              uri as uri,
              cid as cid,
              author_did as authorDid,
              created_at as createdAt,
              indexed_at as indexedAt,
              search_text as searchText,
              reply_root as replyRoot,
              reply_parent as replyParent,
              status as status
            FROM posts
            WHERE status != 'deleted' AND created_at < ${cursor}
            ORDER BY created_at DESC, uri DESC
            LIMIT ${limit}
          `;

    const markDeleted = (uri: string) =>
      sql`UPDATE posts SET status = 'deleted' WHERE uri = ${uri}`.pipe(Effect.asVoid);

    return PostsRepo.of({ putMany, listRecent, markDeleted });
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

### Task 6: Paper filter patterns + search text

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
export const paperPatterns = [
  "https?://[^\\s<>\"]+\\.pdf(?:[?#][^\\s<>\"]*)?\\b",
  "arxiv\\.org/(?:abs|pdf)/\\d{4}\\.\\d{4,5}",
  "doi\\.org/10\\.\\d{4,}/"
];

export const compiledPaperPatterns = paperPatterns.map((p) => new RegExp(p, "i"));
```

```ts
import { compiledPaperPatterns } from "./paperPatterns";

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

export const containsPaperLink = (searchText: string): boolean =>
  compiledPaperPatterns.some((pattern) => pattern.test(searchText));
```

**Step 4: Run test to verify it passes**

Run: `bun test src/filters/paperFilter.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/filters/paperPatterns.ts src/filters/paperFilter.ts src/filters/paperFilter.test.ts

git commit -m "feat: add paper filter"
```

---

### Task 7: Filter worker (raw events → D1)

**Files:**
- Create: `src/filter/FilterWorker.ts`
- Test: `src/filter/FilterWorker.test.ts`

**Step 1: Write the failing test**

```ts
import { it, expect } from "bun:test";
import { Effect, Layer } from "effect";
import { processBatch } from "./FilterWorker";
import { PostsRepo } from "../services/PostsRepo";
import { RawEventBatch } from "../domain/types";

it("filters paper posts", async () => {
  let inserted = 0;
  let deleted = 0;
  const PostsTest = Layer.succeed(PostsRepo, {
    putMany: () => Effect.sync(() => void (inserted += 1)),
    listRecent: () => Effect.succeed([]),
    markDeleted: () => Effect.sync(() => void (deleted += 1))
  });

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

  await Effect.runPromise(processBatch(batch).pipe(Effect.provide(PostsTest)));

  expect(inserted).toBe(1);
  expect(deleted).toBe(0);
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
import { buildSearchText, containsPaperLink } from "../filters/paperFilter";

export const processBatch = (batch: RawEventBatch) =>
  Effect.gen(function* () {
    const posts = yield* PostsRepo;

    const paperPosts = batch.events
      .filter((e) => e.collection === "app.bsky.feed.post" && e.operation !== "delete" && e.record)
      .map((e) => {
        const record = e.record as Record<string, unknown>;
        const searchText = buildSearchText(record as any);
        return { event: e, searchText };
      })
      .filter((p) => containsPaperLink(p.searchText))
      .map((p) => ({
        uri: p.event.uri,
        cid: p.event.cid ?? "",
        authorDid: p.event.did,
        createdAt: Math.floor(p.event.timeUs / 1000),
        indexedAt: Date.now(),
        searchText: p.searchText,
        replyRoot: null,
        replyParent: null,
        status: "active" as const
      }));

    yield* posts.putMany(paperPosts);

    for (const event of batch.events) {
      if (event.operation === "delete") {
        yield* posts.markDeleted(event.uri);
      }
    }
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

### Task 8: Jetstream cursor store + ingestor DO

**Files:**
- Create: `src/ingest/JetstreamCursorStore.ts`
- Create: `src/ingest/JetstreamIngestor.ts`
- Create: `src/ingest/IngestorDo.ts`
- Test: `src/ingest/JetstreamCursorStore.test.ts`

**Step 1: Write the failing test**

```ts
import { it, expect } from "bun:test";
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
import { CloudflareEnv } from "../platform/Env";
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
    wantedCollections: ["app.bsky.feed.post"],
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

export class JetstreamIngestorDo extends DurableObject<EnvBindings> {
  constructor(ctx: DurableObjectState, env: EnvBindings) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS jetstream_state (id TEXT PRIMARY KEY, cursor INTEGER)");
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

git commit -m "feat: add jetstream ingestor DO"
```

---

### Task 9: Feed router (global feed skeleton)

**Files:**
- Create: `src/feed/FeedRouter.ts`
- Test: `src/feed/FeedRouter.test.ts`

**Step 1: Write the failing test**

```ts
import { it, expect } from "bun:test";
import { Effect, Layer } from "effect";
import * as HttpApp from "@effect/platform/HttpApp";
import { app } from "./FeedRouter";
import { PostsRepo } from "../services/PostsRepo";
import { AppConfig } from "../platform/Config";

it("serves feed skeleton", async () => {
  const PostsTest = Layer.succeed(PostsRepo, {
    putMany: () => Effect.void,
    listRecent: () => Effect.succeed([
      {
        uri: "at://did:plc:1/app.bsky.feed.post/1",
        cid: "cid",
        authorDid: "did:plc:1",
        createdAt: 200,
        indexedAt: 210,
        searchText: "arxiv",
        replyRoot: null,
        replyParent: null,
        status: "active"
      }
    ]),
    markDeleted: () => Effect.void
  });
  const ConfigTest = Layer.succeed(AppConfig, {
    feedDid: "did:plc:test",
    jetstreamEndpoint: "wss://example"
  });

  const handler = HttpApp.toWebHandler(app.pipe(
    Effect.provide(PostsTest),
    Effect.provide(ConfigTest)
  ));

  const res = await handler(new Request("http://localhost/xrpc/app.bsky.feed.getFeedSkeleton?limit=1"));
  const body = await res.json();

  expect(res.status).toBe(200);
  expect(body.feed.length).toBe(1);
  expect(body.cursor).toBe("200");
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
import { PostsRepo } from "../services/PostsRepo";
import { AppConfig } from "../platform/Config";

const FeedQuery = Schema.Struct({
  limit: Schema.optional(Schema.NumberFromString),
  cursor: Schema.optional(Schema.NumberFromString)
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
    const posts = yield* PostsRepo;
    const params = yield* HttpServerRequest.schemaSearchParams(FeedQuery);
    const limit = params.limit ?? 50;
    const cursor = params.cursor ?? null;

    const rows = yield* posts.listRecent(cursor, limit);
    const last = rows.at(-1);

    return HttpServerResponse.unsafeJson({
      cursor: last ? String(last.createdAt) : "eof",
      feed: rows.map((post) => ({ post: post.uri }))
    });
  }))
);
```

**Step 4: Run test to verify it passes**

Run: `bun test src/feed/FeedRouter.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/feed/FeedRouter.ts src/feed/FeedRouter.test.ts

git commit -m "feat: add feed router"
```

---

### Task 10: Worker entrypoints (feed + filter)

**Files:**
- Create: `src/worker/feed.ts`
- Create: `src/worker/filter.ts`
- Test: `src/worker/feed.test.ts`

**Step 1: Write the failing test**

```ts
import { it, expect } from "bun:test";
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
import { Effect } from "effect";
import * as HttpApp from "@effect/platform/HttpApp";
import * as HttpRouter from "@effect/platform/HttpRouter";
import { app as feedApp } from "../feed/FeedRouter";
import { CloudflareEnv, EnvBindings } from "../platform/Env";
import { AppConfig } from "../platform/Config";
import { PostsRepoD1 } from "../services/d1/PostsRepoD1";
import { D1Client } from "@effect/sql-d1";
import { JetstreamIngestorDo } from "../ingest/IngestorDo";

const app = feedApp.pipe(HttpRouter.mount("/", feedApp));

export { JetstreamIngestorDo };

export const fetch = (request: Request, env: EnvBindings, ctx: ExecutionContext) => {
  const url = new URL(request.url);
  if (url.pathname === "/internal/ingest/start") {
    const id = env.JETSTREAM_INGESTOR.idFromName("main");
    const stub = env.JETSTREAM_INGESTOR.get(id);
    return stub.fetch("https://ingest/start");
  }

  return HttpApp.toWebHandler(
    app.pipe(
      Effect.provide(CloudflareEnv.layer(env)),
      Effect.provide(AppConfig.layer),
      Effect.provide(PostsRepoD1.layer),
      Effect.provide(D1Client.layer({ db: env.DB }))
    )
  )(request);
};
```

```ts
import { Effect } from "effect";
import { processBatch } from "../filter/FilterWorker";
import { PostsRepoD1 } from "../services/d1/PostsRepoD1";
import { D1Client } from "@effect/sql-d1";

export const queue = (batch: MessageBatch, env: EnvBindings, ctx: ExecutionContext) =>
  ctx.waitUntil(
    Promise.all(batch.messages.map(async (msg) => {
      await Effect.runPromise(
        processBatch(msg.body).pipe(
          Effect.provide(PostsRepoD1.layer),
          Effect.provide(D1Client.layer({ db: env.DB }))
        )
      );
      msg.ack();
    }))
  );
```

**Step 4: Run test to verify it passes**

Run: `bun test src/worker/feed.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/worker/feed.ts src/worker/filter.ts src/worker/feed.test.ts

git commit -m "feat: add feed and filter worker entrypoints"
```

---

## Verification

- `bun test`
- `bun run typecheck`
- Local dev (feed worker): `bunx wrangler dev`
- Filter worker: `bunx wrangler dev -c wrangler.filter.toml`
