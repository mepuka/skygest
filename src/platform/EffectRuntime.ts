import { Cause, Effect, Exit, Layer, ManagedRuntime, Option } from "effect";
import { IngestBoundaryError } from "../domain/errors";

type BoundaryOptions = {
  readonly operation?: string;
};

const throwFailureCause = (
  cause: Cause.Cause<unknown>,
  options?: BoundaryOptions
): never => {
  const failure = Cause.failureOption(cause);
  if (Option.isSome(failure)) {
    throw failure.value;
  }

  throw IngestBoundaryError.make({
    message: Cause.pretty(cause),
    ...(options?.operation === undefined ? {} : { operation: options.operation })
  });
};

export const makeManagedRuntime = <R, E>(
  layer: Layer.Layer<R, E, never>
) => ManagedRuntime.make(layer);

export const withManagedRuntime = async <R, E, A>(
  layer: Layer.Layer<R, E, never>,
  f: (runtime: ManagedRuntime.ManagedRuntime<R, E>) => Promise<A>
): Promise<A> => {
  const runtime = makeManagedRuntime(layer);

  try {
    return await f(runtime);
  } finally {
    await runtime.dispose();
  }
};

export const runScopedWithRuntime = async <A, E, R, ER>(
  runtime: ManagedRuntime.ManagedRuntime<R, ER>,
  effect: Effect.Effect<A, E, R>,
  options?: BoundaryOptions
): Promise<A> => {
  const exit = await runtime.runPromiseExit(Effect.scoped(effect));

  return Exit.match(exit, {
    onSuccess: (value) => value,
    onFailure: (cause) => throwFailureCause(cause, options)
  });
};

export const runScopedWithLayer = async <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  layer: Layer.Layer<any, any, never>,
  options?: BoundaryOptions
): Promise<A> =>
  withManagedRuntime(layer, (runtime) =>
    runScopedWithRuntime(
      runtime,
      effect as Effect.Effect<A, E, never>,
      options
    )
  );
