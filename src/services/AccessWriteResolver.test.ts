import { it, expect } from "bun:test";
import { Effect, Layer, RequestResolver } from "effect";
import { AccessRepo, type AccessLog } from "./AccessRepo";
import { AccessWriteResolver, LogAccess } from "./AccessWriteResolver";

it("batches access log writes", async () => {
  let calls = 0;
  let count = 0;

  const AccessTest = Layer.succeed(AccessRepo, {
    logAccess: () => Effect.void,
    logAccessMany: (logs: ReadonlyArray<AccessLog>) =>
      Effect.sync(() => {
        calls += 1;
        count += logs.length;
      })
  });

  const resolver = RequestResolver.contextFromServices(AccessRepo)(AccessWriteResolver);
  const logs: ReadonlyArray<AccessLog> = [
    {
      id: "1",
      did: "did:plc:1",
      accessAt: 1,
      recsShown: "[]",
      cursorStart: 0,
      cursorEnd: 1,
      defaultFrom: 0
    },
    {
      id: "2",
      did: "did:plc:2",
      accessAt: 2,
      recsShown: "[]",
      cursorStart: 1,
      cursorEnd: 2,
      defaultFrom: null
    }
  ];

  await Effect.runPromise(
    Effect.forEach(
      logs,
      (log) => Effect.request(new LogAccess({ log }), resolver),
      { concurrency: "unbounded", batching: "inherit", discard: true }
    ).pipe(
      Effect.withRequestBatching(true),
      Effect.withRequestCaching(false),
      Effect.provide(AccessTest)
    )
  );

  expect(calls).toBe(1);
  expect(count).toBe(2);
});
