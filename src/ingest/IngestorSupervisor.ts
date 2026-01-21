import { Effect, Fiber, Option, Ref } from "effect";

export type IngestorSupervisor = {
  readonly ensureRunning: Effect.Effect<Option.Option<Fiber.RuntimeFiber<void, unknown>>>;
};

export const makeIngestorSupervisor = (ingestor: Effect.Effect<void>) =>
  Effect.gen(function* () {
    const fiberRef = yield* Ref.make<Option.Option<Fiber.RuntimeFiber<void, unknown>>>(
      Option.none()
    );

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
