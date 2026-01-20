# Skygest Effect-Native Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement the Effect-native Skygest agentic personalization MVP on Cloudflare (MCP server, ingestion, filtering, and feed publishing) with strict type safety and declarative Effect services/layers.

**Architecture:** Split-pipeline design: Jetstream DO -> Queue -> Filter Worker -> D1/Vectorize, plus MCP HTTP server for tool calls and feed publishing. All I/O and business logic is modeled as Effect services with Layer-based dependency injection.

**Tech Stack:** TypeScript, Effect, @effect/platform, @effect/sql-d1, @effect/sql-sqlite-do, effect-jetstream, Cloudflare Workers/DO/Queues/D1/KV/Vectorize.

---

### Task 1: Scaffold core domain schemas and error types

**Files:**
- Create: `src/domain/types.ts`
- Create: `src/domain/errors.ts`
- Test: `src/domain/types.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, it, expect } from "bun:test";
import { Schema } from "effect";
import { CandidateSessionId } from "./types";

describe("domain types", () => {
  it("brands candidate session ids", () => {
    const value = Schema.decodeSync(CandidateSessionId)("sess-123");
    expect(value).toBe("sess-123");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test src/domain/types.test.ts`  
Expected: FAIL (module not found).

**Step 3: Write minimal implementation**

```ts
import { Schema } from "effect";

export const CandidateSessionId = Schema.String.pipe(Schema.brand("CandidateSessionId"));
```

**Step 4: Run test to verify it passes**

Run: `bun test src/domain/types.test.ts`  
Expected: PASS.

**Step 5: Commit**

```bash
git add src/domain/types.ts src/domain/types.test.ts

git commit -m "feat: add core domain types"
```

---

### Task 2: Define repository interfaces (Effect services)

**Files:**
- Create: `src/services/PostsRepo.ts`
- Create: `src/services/ProfilesRepo.ts`
- Create: `src/services/PreferencesRepo.ts`
- Create: `src/services/CurationEventsRepo.ts`
- Create: `src/services/CandidateSessionsRepo.ts`

**Step 1: Write the failing test**

```ts
import { describe, it, expect } from "bun:test";
import { PostsRepo } from "./PostsRepo";

describe("PostsRepo tag", () => {
  it("exposes a tag", () => {
    expect(PostsRepo.key).toBeDefined();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test src/services/PostsRepo.test.ts`  
Expected: FAIL (module not found).

**Step 3: Write minimal implementation**

```ts
import { Context, Effect } from "effect";

export class PostsRepo extends Context.Tag("@skygest/PostsRepo")<
  PostsRepo,
  {
    readonly putPost: (post: unknown) => Effect.Effect<void>;
  }
>() {}
```

**Step 4: Run test to verify it passes**

Run: `bun test src/services/PostsRepo.test.ts`  
Expected: PASS.

**Step 5: Commit**

```bash
git add src/services/PostsRepo.ts src/services/PostsRepo.test.ts

git commit -m "feat: add repo service tags"
```

---

### Task 3: Implement D1 repo layers

**Files:**
- Create: `src/services/d1/PostsRepoD1.ts`
- Create: `src/services/d1/CurationEventsRepoD1.ts`
- Create: `src/services/d1/ProfilesRepoD1.ts`
- Create: `src/services/d1/PreferencesRepoD1.ts`

**Step 1: Write the failing test**

```ts
import { describe, it, expect } from "bun:test";
import { Effect, Layer } from "effect";
import { PostsRepo } from "../PostsRepo";
import { PostsRepoD1 } from "./PostsRepoD1";

describe("PostsRepoD1 layer", () => {
  it("provides PostsRepo", async () => {
    const program = Effect.gen(function* () {
      yield* PostsRepo;
      return true;
    });
    const result = await Effect.runPromise(program.pipe(Effect.provide(PostsRepoD1.layerTest)));
    expect(result).toBe(true);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test src/services/d1/PostsRepoD1.test.ts`  
Expected: FAIL (module not found).

**Step 3: Write minimal implementation**

```ts
import { Effect, Layer } from "effect";
import { PostsRepo } from "../PostsRepo";

export const PostsRepoD1 = {
  layerTest: Layer.succeed(PostsRepo, { putPost: () => Effect.void })
};
```

**Step 4: Run test to verify it passes**

Run: `bun test src/services/d1/PostsRepoD1.test.ts`  
Expected: PASS.

**Step 5: Commit**

```bash
git add src/services/d1/PostsRepoD1.ts src/services/d1/PostsRepoD1.test.ts

git commit -m "feat: add d1 repo layers"
```

---

### Task 4: Candidate sessions KV layer

**Files:**
- Create: `src/services/kv/CandidateSessionsKv.ts`
- Test: `src/services/kv/CandidateSessionsKv.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
import { CandidateSessionsRepo } from "../CandidateSessionsRepo";
import { CandidateSessionsKv } from "./CandidateSessionsKv";

describe("CandidateSessionsKv", () => {
  it("stores and loads a session", async () => {
    const program = Effect.gen(function* () {
      const repo = yield* CandidateSessionsRepo;
      yield* repo.put("sess-1", ["at://1", "at://2"]);
      const got = yield* repo.get("sess-1");
      return got?.length ?? 0;
    });

    const result = await Effect.runPromise(program.pipe(Effect.provide(CandidateSessionsKv.layerTest)));
    expect(result).toBe(2);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test src/services/kv/CandidateSessionsKv.test.ts`  
Expected: FAIL (module not found).

**Step 3: Write minimal implementation**

```ts
import { Effect, Layer } from "effect";
import { CandidateSessionsRepo } from "../CandidateSessionsRepo";

const store = new Map<string, string[]>();

export const CandidateSessionsKv = {
  layerTest: Layer.succeed(CandidateSessionsRepo, {
    put: (id, uris) => Effect.sync(() => void store.set(id, uris)),
    get: (id) => Effect.sync(() => store.get(id))
  })
};
```

**Step 4: Run test to verify it passes**

Run: `bun test src/services/kv/CandidateSessionsKv.test.ts`  
Expected: PASS.

**Step 5: Commit**

```bash
git add src/services/kv/CandidateSessionsKv.ts src/services/kv/CandidateSessionsKv.test.ts

git commit -m "feat: add kv candidate sessions layer"
```

---

### Task 5: MCP HTTP Router skeleton

**Files:**
- Create: `src/mcp/Router.ts`
- Create: `src/mcp/Handlers.ts`
- Test: `src/mcp/Router.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
import * as HttpApp from "@effect/platform/HttpApp";
import { Router } from "./Router";

it("builds a web handler", async () => {
  const handler = HttpApp.toWebHandler(Router.app);
  const res = await handler(new Request("http://localhost/health"));
  expect(res.status).toBe(200);
});
```

**Step 2: Run test to verify it fails**

Run: `bun test src/mcp/Router.test.ts`  
Expected: FAIL (module not found).

**Step 3: Write minimal implementation**

```ts
import * as HttpRouter from "@effect/platform/HttpRouter";
import * as HttpServerResponse from "@effect/platform/HttpServerResponse";

export const app = HttpRouter.empty.pipe(
  HttpRouter.get("/health", HttpServerResponse.text("ok"))
);
```

**Step 4: Run test to verify it passes**

Run: `bun test src/mcp/Router.test.ts`  
Expected: PASS.

**Step 5: Commit**

```bash
git add src/mcp/Router.ts src/mcp/Router.test.ts

git commit -m "feat: add mcp router skeleton"
```

---

### Task 6: Jetstream DO skeleton

**Files:**
- Create: `src/ingest/IngestorDo.ts`
- Test: `src/ingest/IngestorDo.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, it, expect } from "bun:test";
import { IngestorDo } from "./IngestorDo";

describe("IngestorDo", () => {
  it("exports a class", () => {
    expect(IngestorDo).toBeDefined();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test src/ingest/IngestorDo.test.ts`  
Expected: FAIL (module not found).

**Step 3: Write minimal implementation**

```ts
export class IngestorDo {
  constructor(_state: DurableObjectState, _env: unknown) {}
}
```

**Step 4: Run test to verify it passes**

Run: `bun test src/ingest/IngestorDo.test.ts`  
Expected: PASS.

**Step 5: Commit**

```bash
git add src/ingest/IngestorDo.ts src/ingest/IngestorDo.test.ts

git commit -m "feat: add ingest DO skeleton"
```

---

### Task 7: Filter worker skeleton

**Files:**
- Create: `src/filter/FilterWorker.ts`
- Test: `src/filter/FilterWorker.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, it, expect } from "bun:test";
import { processBatch } from "./FilterWorker";

it("exports processBatch", () => {
  expect(processBatch).toBeDefined();
});
```

**Step 2: Run test to verify it fails**

Run: `bun test src/filter/FilterWorker.test.ts`  
Expected: FAIL (module not found).

**Step 3: Write minimal implementation**

```ts
import { Effect } from "effect";

export const processBatch = () => Effect.void;
```

**Step 4: Run test to verify it passes**

Run: `bun test src/filter/FilterWorker.test.ts`  
Expected: PASS.

**Step 5: Commit**

```bash
git add src/filter/FilterWorker.ts src/filter/FilterWorker.test.ts

git commit -m "feat: add filter worker skeleton"
```

---

### Task 8: Feed endpoint skeleton

**Files:**
- Create: `src/feed/FeedRouter.ts`
- Test: `src/feed/FeedRouter.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, it, expect } from "bun:test";
import * as HttpApp from "@effect/platform/HttpApp";
import { app } from "./FeedRouter";

it("serves feed health", async () => {
  const handler = HttpApp.toWebHandler(app);
  const res = await handler(new Request("http://localhost/feed/health"));
  expect(res.status).toBe(200);
});
```

**Step 2: Run test to verify it fails**

Run: `bun test src/feed/FeedRouter.test.ts`  
Expected: FAIL (module not found).

**Step 3: Write minimal implementation**

```ts
import * as HttpRouter from "@effect/platform/HttpRouter";
import * as HttpServerResponse from "@effect/platform/HttpServerResponse";

export const app = HttpRouter.empty.pipe(
  HttpRouter.get("/feed/health", HttpServerResponse.text("ok"))
);
```

**Step 4: Run test to verify it passes**

Run: `bun test src/feed/FeedRouter.test.ts`  
Expected: PASS.

**Step 5: Commit**

```bash
git add src/feed/FeedRouter.ts src/feed/FeedRouter.test.ts

git commit -m "feat: add feed router skeleton"
```

---

### Task 9: Wiring root entrypoints

**Files:**
- Create: `src/index.ts`
- Modify: `index.ts`

**Step 1: Write the failing test**

```ts
import { describe, it, expect } from "bun:test";
import { handler } from "./index";

it("exports handler", () => {
  expect(handler).toBeDefined();
});
```

**Step 2: Run test to verify it fails**

Run: `bun test src/index.test.ts`  
Expected: FAIL (module not found).

**Step 3: Write minimal implementation**

```ts
import * as HttpApp from "@effect/platform/HttpApp";
import { app as mcpApp } from "./mcp/Router";

export const handler = HttpApp.toWebHandler(mcpApp);
```

**Step 4: Run test to verify it passes**

Run: `bun test src/index.test.ts`  
Expected: PASS.

**Step 5: Commit**

```bash
git add src/index.ts src/index.test.ts index.ts

git commit -m "feat: add root handler"
```

---

### Task 10: Documentation and validation

**Files:**
- Modify: `docs/plans/2026-01-20-skygest-effect-native-design.md`

**Step 1: Update design doc**

Add a section: "Implementation Plan" with file layout and entrypoint notes.

**Step 2: Commit**

```bash
git add docs/plans/2026-01-20-skygest-effect-native-design.md

git commit -m "docs: add implementation notes"
```

---

## Verification

Run full suite:
- `bun test` (expected: some tests may be missing initially; ensure created tests pass)
- `bun run typecheck` (optional)

---

Plan complete and saved to `docs/plans/2026-01-20-skygest-effect-native-implementation-plan.md`.

Two execution options:

1) Subagent-Driven (this session) - I dispatch a fresh subagent per task, review between tasks, fast iteration

2) Parallel Session (separate) - Open new session with executing-plans, batch execution with checkpoints

Which approach?
