import { Cause, Effect, Exit, Layer, ManagedRuntime, Option } from "effect";
import { IngestBoundaryError } from "../domain/errors";

type BoundaryOptions = {
  readonly operation?: string;
};

const throwFailureCause = (
  cause: Cause.Cause<unknown>,
  options?: BoundaryOptions
): never => {
  const failure = Cause.findErrorOption(cause);
  if (Option.isSome(failure)) {
    throw failure.value;
  }

  throw new IngestBoundaryError({
    message: Cause.pretty(cause),
    ...(options?.operation === undefined ? {} : { operation: options.operation })
  });
};

export const makeManagedRuntime = <R, E>(
  layer: Layer.Layer<R, E, never>
) => ManagedRuntime.make(layer);

/**
 * Workflow / Durable Object entrypoints cannot preserve the full Effect
 * environment type across their external async boundaries yet. Keep that
 * environment-erasing cast in one place so the rest of the call sites stay
 * honest about where the boundary is.
 */
export const atRuntimeBoundary = <A, E, R>(
  effect: Effect.Effect<A, E, R>
): Effect.Effect<A, E, never> =>
  effect as Effect.Effect<A, E, never>;

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
      atRuntimeBoundary(effect),
      options
    )
  );

/**
 * Caches a layer and its ManagedRuntime per `env` reference identity.
 * Within a Cloudflare Worker isolate the `env` object is stable across
 * requests for the same deployment, so Effect layer memoization applies.
 *
 * The returned function accepts an `env` and a request handler that
 * receives the shared runtime.
 */
export const makeSharedRuntime = <Env extends object, R, E>(
  buildLayer: (env: Env) => Layer.Layer<R, E, never>
) => {
  let cached: {
    readonly env: Env;
    readonly runtime: ManagedRuntime.ManagedRuntime<R, E>;
  } | null = null;

  const getRuntime = (env: Env): ManagedRuntime.ManagedRuntime<R, E> => {
    if (cached !== null && cached.env === env) {
      return cached.runtime;
    }

    const layer = buildLayer(env);
    const runtime = ManagedRuntime.make(layer);
    cached = { env, runtime };
    return runtime;
  };

  return {
    getRuntime,
    runScoped: <A>(
      env: Env,
      effect: Effect.Effect<A, unknown, R>,
      options?: BoundaryOptions
    ): Promise<A> =>
      runScopedWithRuntime(getRuntime(env), effect, options)
  };
};
