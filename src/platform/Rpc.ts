import { Cause, Effect, Exit, Layer, Option } from "effect";
import { atRuntimeBoundary, makeSharedRuntime } from "./EffectRuntime";

export type RpcSuccess<A> = {
  readonly ok: true;
  readonly value: A;
};

export type RpcFailure<E> = {
  readonly ok: false;
  readonly error: E;
};

export type RpcResult<A, E> = RpcSuccess<A> | RpcFailure<E>;

const rpcSuccess = <A>(value: A): RpcSuccess<A> => ({
  ok: true,
  value
});

const rpcFailure = <E>(error: E): RpcFailure<E> => ({
  ok: false,
  error
});

const toRuntimeError = (cause: Cause.Cause<unknown>): unknown => {
  const failure = Cause.findErrorOption(cause);
  return Option.isSome(failure)
    ? failure.value
    : new Error(Cause.pretty(cause));
};

export const makeEffectRpc = <Env extends object, R, E>(
  buildLayer: (env: Env) => Layer.Layer<R, E, never>
) => {
  const sharedRuntime = makeSharedRuntime(buildLayer);

  const run = <A, E1, RpcError>(
    env: Env,
    effect: Effect.Effect<A, E1, R>,
    mapError: (error: unknown) => RpcError
  ): Promise<RpcResult<A, RpcError>> =>
    sharedRuntime
      .getRuntime(env)
      .runPromiseExit(Effect.scoped(atRuntimeBoundary(effect)))
      .then((exit) =>
        Exit.match(exit, {
          onSuccess: rpcSuccess,
          onFailure: (cause) =>
            rpcFailure(mapError(toRuntimeError(cause)))
        })
      );

  return { run };
};
