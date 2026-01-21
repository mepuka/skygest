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
