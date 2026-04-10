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

export const runScriptMain = <A, E>(
  scriptName: string,
  effect: Effect.Effect<A, E, never>
) =>
  effect.pipe(
    Effect.tapError((error) => Logging.logFailure("script failed", error, { scriptName })),
    BunRuntime.runMain
  );
