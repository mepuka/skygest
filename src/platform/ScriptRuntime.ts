import * as BunRuntime from "@effect/platform-bun/BunRuntime";
import * as BunServices from "@effect/platform-bun/BunServices";
import { Effect, Layer } from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import { stringifyUnknown } from "./Json";
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
    Effect.tapError((error) =>
      Effect.logError(`${scriptName} failed`).pipe(
        Effect.annotateLogs({
          scriptName,
          errorTag: (error as { readonly _tag?: string })._tag ?? "unknown",
          message: stringifyUnknown(error)
        })
      )
    ),
    BunRuntime.runMain
  );
