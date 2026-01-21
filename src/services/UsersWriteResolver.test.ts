import { it, expect } from "bun:test";
import { Effect, Layer, RequestResolver } from "effect";
import { UsersRepo, type AccessIncrement } from "./UsersRepo";
import { IncrementAccess, UsersWriteResolver } from "./UsersWriteResolver";

it("batches access increments by did", async () => {
  let calls = 0;
  let received: ReadonlyArray<AccessIncrement> = [];

  const UsersTest = Layer.succeed(UsersRepo, {
    upsert: () => Effect.void,
    get: () => Effect.succeed(null),
    listActive: () => Effect.succeed([]),
    incrementAccess: () => Effect.void,
    incrementAccessMany: (increments: ReadonlyArray<AccessIncrement>) =>
      Effect.sync(() => {
        calls += 1;
        received = increments;
      })
  });

  const resolver = RequestResolver.contextFromServices(UsersRepo)(UsersWriteResolver);
  const requests = [
    new IncrementAccess({
      did: "did:plc:1",
      accessIncrement: 1,
      consentIncrement: 1,
      lastAccessAt: 10
    }),
    new IncrementAccess({
      did: "did:plc:1",
      accessIncrement: 1,
      consentIncrement: 0,
      lastAccessAt: 5
    }),
    new IncrementAccess({
      did: "did:plc:2",
      accessIncrement: 1,
      consentIncrement: 1,
      lastAccessAt: 7
    })
  ];

  await Effect.runPromise(
    Effect.forEach(
      requests,
      (req) => Effect.request(req, resolver),
      { concurrency: "unbounded", batching: "inherit", discard: true }
    ).pipe(
      Effect.withRequestBatching(true),
      Effect.withRequestCaching(false),
      Effect.provide(UsersTest)
    )
  );

  expect(calls).toBe(1);

  const byDid = Object.fromEntries(
    received.map((entry) => [entry.did, entry])
  );

  expect(byDid["did:plc:1"]).toEqual({
    did: "did:plc:1",
    accessIncrement: 2,
    consentIncrement: 1,
    lastAccessAt: 10
  });
  expect(byDid["did:plc:2"]).toEqual({
    did: "did:plc:2",
    accessIncrement: 1,
    consentIncrement: 1,
    lastAccessAt: 7
  });
});
