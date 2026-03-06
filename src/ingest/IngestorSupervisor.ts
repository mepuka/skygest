import { Effect, Fiber, Option, Ref } from "effect";

export type IngestorSupervisor<E = unknown> = {
  readonly ensureRunning: Effect.Effect<Option.Option<Fiber.RuntimeFiber<void, E>>>;
  readonly replaceIngestor: (ingestor: Effect.Effect<void, E>) => Effect.Effect<void>;
};

export const makeIngestorSupervisor = <E>(ingestor: Effect.Effect<void, E>) =>
  Effect.gen(function* () {
    const fiberRef = yield* Ref.make<Option.Option<Fiber.RuntimeFiber<void, E>>>(
      Option.none()
    );
    const ingestorRef = yield* Ref.make(ingestor);

    const ensureRunning = Effect.gen(function* () {
      const current = yield* Ref.get(fiberRef);
      if (Option.isSome(current)) {
        const polled = yield* Fiber.poll(current.value);
        if (Option.isNone(polled)) {
          return Option.none();
        }

        yield* Ref.set(fiberRef, Option.none());
      }

      const nextIngestor = yield* Ref.get(ingestorRef);
      const fiber = yield* Effect.forkDaemon(nextIngestor);
      yield* Ref.set(fiberRef, Option.some(fiber));
      return Option.some(fiber);
    });

    const replaceIngestor = (nextIngestor: Effect.Effect<void, E>) =>
      Effect.gen(function* () {
        const current = yield* Ref.get(fiberRef);

        yield* Ref.set(ingestorRef, nextIngestor);
        if (Option.isSome(current)) {
          yield* Fiber.interrupt(current.value);
        }
        yield* Ref.set(fiberRef, Option.none());
      });

    return { ensureRunning, replaceIngestor } as const;
  });
