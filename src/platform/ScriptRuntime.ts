import * as BunRuntime from "@effect/platform-bun/BunRuntime";
import * as BunServices from "@effect/platform-bun/BunServices";
import { Effect, Layer } from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import { Logging } from "./Logging";

export const scriptPlatformLayer = Layer.mergeAll(
  BunServices.layer,
  FetchHttpClient.layer,
  Logging.layer
);

export const withScriptMainFailureLogging = <A, E, R>(
  scriptName: string,
  effect: Effect.Effect<A, E, R>
) =>
  effect.pipe(
    Effect.tapError((error) =>
      Logging.logFailure("script.failed", error, { scriptName })
    )
  );

export const runScriptMain = <A, E>(
  scriptName: string,
  effect: Effect.Effect<A, E, never>
) =>
  withScriptMainFailureLogging(scriptName, effect).pipe(BunRuntime.runMain);
