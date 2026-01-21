import { Effect, Fiber, Option, Ref } from "effect";

export type IngestorSupervisor<E = unknown> = {
  readonly ensureRunning: Effect.Effect<Option.Option<Fiber.RuntimeFiber<void, E>>>;
};

export const makeIngestorSupervisor = <E>(ingestor: Effect.Effect<void, E>) =>
  Effect.gen(function* () {
    const fiberRef = yield* Ref.make<Option.Option<Fiber.RuntimeFiber<void, E>>>(
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
