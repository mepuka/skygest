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
  await new Promise((resolve) => setTimeout(resolve, 0));
  Date.now = originalNow;

  expect(starts).toBe(1);
  expect(alarms[0]).toBe(1000 + 20000);
  expect(waitUntilCalls.length).toBe(1);
});
