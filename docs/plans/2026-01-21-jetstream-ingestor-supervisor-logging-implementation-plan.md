# Jetstream Ingestor Supervisor + Logging Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Keep the Jetstream ingestor running via an Effect-native supervisor with a 20s DO alarm heartbeat and standardize JSON console logging.

**Architecture:** Introduce a small Effect supervisor that starts the ingestor fiber and reports whether a new fiber was started. `JetstreamIngestorDoV2` schedules a 20s alarm and calls `ensureRunning` from both `fetch()` and `alarm()`; when a new fiber starts, the DO attaches `waitUntil(Fiber.join(...))` to keep it alive. Logging is centralized with a `Logging` layer that provides `Logger.json` and a minimum log level, and is wired into worker entrypoints and the ingestor pipeline.

**Tech Stack:** TypeScript, Effect (Logger, Fiber, Schedule), Cloudflare Durable Objects (alarms), Bun tests.

**Skill References:** @cloudflare (durable-objects), Effect logging docs.

---

### Task 1: Add JSON logging layer + helper

**Files:**
- Create: `src/platform/Logging.ts`
- Test: `src/platform/Logging.test.ts`

**Step 1: Write the failing test**

```ts
import { it, expect } from "bun:test";
import { Effect, HashMap, Logger, LogLevel, Option } from "effect";
import { Logging } from "./Logging";

it("adds log annotations from context", async () => {
  const seen: Array<Logger.Options<unknown>> = [];
  const capture = Logger.make((options) => {
    seen.push(options);
  });

  await Effect.runPromise(
    Effect.log("hello").pipe(
      Logging.withContext({ component: "test" }),
      Effect.provide(Logger.replace(Logger.defaultLogger, capture)),
      Effect.provide(Logger.minimumLogLevel(LogLevel.Info))
    )
  );

  const annotation = Option.getOrUndefined(
    HashMap.get("component")(seen[0]!.annotations)
  );
  expect(annotation).toBe("test");
});
```

**Step 2: Run test to verify it fails**

Run: `bun test src/platform/Logging.test.ts`  
Expected: FAIL (module not found).

**Step 3: Write minimal implementation**

```ts
import { Effect, Layer, Logger, LogLevel } from "effect";

export const Logging = {
  layer: Layer.mergeAll(
    Logger.json,
    Logger.minimumLogLevel(LogLevel.Info)
  ),
  withContext:
    (annotations: Record<string, string | number | boolean>) =>
    <A, E, R>(effect: Effect.Effect<A, E, R>) =>
      effect.pipe(Effect.annotateLogs(annotations))
};
```

**Step 4: Run test to verify it passes**

Run: `bun test src/platform/Logging.test.ts`  
Expected: PASS.

**Step 5: Commit**

```bash
git add src/platform/Logging.ts src/platform/Logging.test.ts
git commit -m "feat: add json logging layer"
```

---

### Task 2: Add ingestor supervisor helper (Effect-native)

**Files:**
- Create: `src/ingest/IngestorSupervisor.ts`
- Test: `src/ingest/IngestorSupervisor.test.ts`

**Step 1: Write the failing tests**

```ts
import { it, expect } from "bun:test";
import { Effect, Option } from "effect";
import { makeIngestorSupervisor } from "./IngestorSupervisor";

it("starts ingestor once while running", async () => {
  let starts = 0;
  const ingestor = Effect.sync(() => {
    starts += 1;
  }).pipe(Effect.flatMap(() => Effect.never));

  const supervisor = await Effect.runPromise(makeIngestorSupervisor(ingestor));
  const first = await Effect.runPromise(supervisor.ensureRunning);
  const second = await Effect.runPromise(supervisor.ensureRunning);

  expect(starts).toBe(1);
  expect(Option.isSome(first)).toBe(true);
  expect(Option.isNone(second)).toBe(true);
});

it("restarts ingestor after completion", async () => {
  let starts = 0;
  const ingestor = Effect.sync(() => {
    starts += 1;
  });

  const supervisor = await Effect.runPromise(makeIngestorSupervisor(ingestor));
  const first = await Effect.runPromise(supervisor.ensureRunning);
  const second = await Effect.runPromise(supervisor.ensureRunning);

  expect(starts).toBe(2);
  expect(Option.isSome(first)).toBe(true);
  expect(Option.isSome(second)).toBe(true);
});
```

**Step 2: Run tests to verify they fail**

Run: `bun test src/ingest/IngestorSupervisor.test.ts`  
Expected: FAIL (module not found).

**Step 3: Write minimal implementation**

```ts
import { Effect, Fiber, Option, Ref } from "effect";

export type IngestorSupervisor = {
  readonly ensureRunning: Effect.Effect<Option.Option<Fiber.RuntimeFiber<void, unknown>>>;
};

export const makeIngestorSupervisor = (ingestor: Effect.Effect<void>) =>
  Effect.gen(function* () {
    const fiberRef = yield* Ref.make<Option.Option<Fiber.RuntimeFiber<void, unknown>>>(Option.none());

    const ensureRunning = Effect.gen(function* () {
      const current = yield* Ref.get(fiberRef);
      if (Option.isSome(current)) {
        const polled = yield* Fiber.poll(current.value);
        if (Option.isNone(polled)) {
          return Option.none();
        }
      }

      const fiber = yield* Effect.forkDaemon(ingestor);
      yield* Ref.set(fiberRef, Option.some(fiber));
      return Option.some(fiber);
    });

    return { ensureRunning } as const;
  });
```

**Step 4: Run tests to verify they pass**

Run: `bun test src/ingest/IngestorSupervisor.test.ts`  
Expected: PASS.

**Step 5: Commit**

```bash
git add src/ingest/IngestorSupervisor.ts src/ingest/IngestorSupervisor.test.ts
git commit -m "feat: add ingestor supervisor helper"
```

---

### Task 3: Wire supervisor + alarm into Jetstream ingestor DO

**Files:**
- Modify: `src/ingest/IngestorDo.ts`
- Test: `src/ingest/IngestorDo.test.ts`

**Step 1: Write the failing test**

```ts
import { it, expect, mock } from "bun:test";
import { Effect } from "effect";
import type { EnvBindings } from "../platform/Env";

it("schedules alarm and starts ingestor", async () => {
  let starts = 0;
  mock.module("./JetstreamIngestor", () => ({
    runIngestor: Effect.sync(() => {
      starts += 1;
    }).pipe(Effect.flatMap(() => Effect.never))
  }));
  mock.module("cloudflare:workers", () => ({
    DurableObject: class {
      constructor(ctx: DurableObjectState, env: EnvBindings) {
        (this as any).ctx = ctx;
        (this as any).env = env;
      }
    }
  }));

  const alarms: number[] = [];
  const waitUntilCalls: Array<Promise<unknown>> = [];
  const ctx = {
    storage: {
      sql: { exec: () => ({}) },
      setAlarm: (ts: number) => {
        alarms.push(ts);
        return Promise.resolve();
      },
      getAlarm: () => Promise.resolve(null)
    },
    waitUntil: (promise: Promise<unknown>) => {
      waitUntilCalls.push(promise);
    },
    blockConcurrencyWhile: (fn: () => void | Promise<void>) => Promise.resolve(fn())
  } as unknown as DurableObjectState;

  const env: EnvBindings = {
    FEED_DID: "did:plc:test",
    ALG_FEED_DID: "did:plc:alg",
    DB: {} as D1Database,
    FEED_CACHE: {} as KVNamespace,
    RAW_EVENTS: {} as Queue,
    FEED_GEN: {} as Queue,
    POSTPROCESS: {} as Queue,
    JETSTREAM_INGESTOR: {} as DurableObjectNamespace
  };

  const originalNow = Date.now;
  Date.now = () => 1000;
  const { JetstreamIngestorDoV2 } = await import("./IngestorDo");
  const instance = new JetstreamIngestorDoV2(ctx, env);
  await instance.alarm();
  Date.now = originalNow;

  expect(starts).toBe(1);
  expect(alarms[0]).toBe(1000 + 20000);
  expect(waitUntilCalls.length).toBe(1);
});
```

**Step 2: Run test to verify it fails**

Run: `bun test src/ingest/IngestorDo.test.ts`  
Expected: FAIL (missing alarm handler / supervisor wiring).

**Step 3: Write minimal implementation**

Update `src/ingest/IngestorDo.ts` to:

- Create a `supervisor` field via `makeIngestorSupervisor`.
- Add `scheduleAlarm()` to call `this.ctx.storage.setAlarm(Date.now() + 20000)`.
- Add `ensureIngestor()` that calls `supervisor.ensureRunning` and, when `Option.some(fiber)` is returned, uses `this.ctx.waitUntil(Effect.runPromise(Fiber.join(fiber)))`.
- Wrap `runIngestor` with retry/backoff and log failures:

```ts
const retryPolicy = Schedule.exponential("1 second").pipe(
  Schedule.jittered,
  Schedule.tapOutput((delay) =>
    Effect.logWarning(`ingestor retrying in ${delay}`)
  )
);

const ingestor = runIngestor.pipe(
  Effect.tapErrorCause((cause) =>
    Effect.logError(`ingestor failed: ${Cause.pretty(cause)}`)
  ),
  Effect.retry(retryPolicy)
);
```

- Call `scheduleAlarm()` + `ensureIngestor()` from both `fetch()` and `alarm()`.

**Step 4: Run test to verify it passes**

Run: `bun test src/ingest/IngestorDo.test.ts`  
Expected: PASS.

**Step 5: Commit**

```bash
git add src/ingest/IngestorDo.ts src/ingest/IngestorDo.test.ts
git commit -m "feat: supervise ingestor with alarm heartbeat"
```

---

### Task 4: Wire logging into ingestor pipeline and worker entrypoints

**Files:**
- Modify: `src/ingest/JetstreamIngestor.ts`
- Modify: `src/worker/feed.ts`
- Modify: `src/worker/generator.ts`
- Modify: `src/worker/filter.ts`
- Modify: `src/worker/postprocess.ts`
- Modify: `src/worker/dispatch.ts`
- Modify: `src/feed/FeedRouter.ts`

**Step 1: Write the failing test**

Create `src/ingest/JetstreamIngestor.test.ts`:

```ts
import { it, expect } from "bun:test";
import { Effect, HashMap, Logger, LogLevel, Option } from "effect";
import { annotateIngestorLogs } from "./JetstreamIngestor";

it("annotates ingestor logs", async () => {
  const seen: Array<Logger.Options<unknown>> = [];
  const capture = Logger.make((options) => {
    seen.push(options);
  });

  await Effect.runPromise(
    Effect.log("ingest-start").pipe(
      annotateIngestorLogs,
      Effect.provide(Logger.replace(Logger.defaultLogger, capture)),
      Effect.provide(Logger.minimumLogLevel(LogLevel.Info))
    )
  );

  const component = Option.getOrUndefined(
    HashMap.get("component")(seen[0]!.annotations)
  );
  expect(component).toBe("ingest");
});
```

**Step 2: Run test to verify it fails**

Run: `bun test src/ingest/JetstreamIngestor.test.ts`  
Expected: FAIL (missing log annotations).

**Step 3: Write minimal implementation**

- Export a helper in `src/ingest/JetstreamIngestor.ts`:

```ts
export const annotateIngestorLogs = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(
    Effect.annotateLogs({ component: "ingest", queue: "RAW_EVENTS" })
  );
```

- Wrap the `Stream` pipeline in `runIngestor` with spans and annotations:
  - `Effect.withSpan("jetstream.stream")`
  - `annotateIngestorLogs`
  - `Effect.tap` to log batch sizes and cursor updates.
- Add `Logging.layer` to worker entrypoints by merging it into `appLayer` or `baseLayer`.
- Replace `console.log` in `src/feed/FeedRouter.ts` with `Effect.logInfo` and relevant annotations.

**Step 4: Run test to verify it passes**

Run: `bun test src/ingest/JetstreamIngestor.test.ts`  
Expected: PASS.

**Step 5: Commit**

```bash
git add src/ingest/JetstreamIngestor.ts src/worker/feed.ts src/worker/generator.ts \
  src/worker/filter.ts src/worker/postprocess.ts src/worker/dispatch.ts \
  src/feed/FeedRouter.ts src/ingest/JetstreamIngestor.test.ts
git commit -m "feat: add structured logging across workers"
```
