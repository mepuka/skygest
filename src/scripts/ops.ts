import { BunContext, BunRuntime } from "@effect/platform-bun";
import { Effect, Layer, Logger, LogLevel } from "effect";
import { runOpsCli } from "../ops/Cli";
import { OperatorSecret } from "../ops/OperatorSecret";
import { StagingOperatorClient } from "../ops/StagingOperatorClient";
import { WranglerCli } from "../ops/WranglerCli";

const bunLayer = BunContext.layer;
const wranglerLayer = WranglerCli.live.pipe(Layer.provideMerge(bunLayer));
const liveLayer = Layer.mergeAll(
  bunLayer,
  wranglerLayer,
  OperatorSecret.live,
  StagingOperatorClient.live
);

Effect.suspend(() => runOpsCli(process.argv)).pipe(
  Effect.provide(liveLayer),
  Logger.withMinimumLogLevel(LogLevel.Info),
  BunRuntime.runMain
);
