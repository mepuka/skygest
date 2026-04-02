import { ChildProcessSpawner } from "effect/unstable/process";
import { Effect, Layer, Logger, LogLevel, Runtime } from "effect";
import { runOpsCli } from "../ops/Cli";
import { OperatorSecret } from "../ops/OperatorSecret";
import { StagingOperatorClient } from "../ops/StagingOperatorClient";
import { WranglerCli } from "../ops/WranglerCli";

// TODO(effect4): BunContext.layer was removed; provide individual platform layers
const bunLayer = ChildProcessSpawner.layer;
const wranglerLayer = WranglerCli.live.pipe(Layer.provideMerge(bunLayer));
const liveLayer = Layer.mergeAll(
  bunLayer,
  wranglerLayer,
  OperatorSecret.live,
  StagingOperatorClient.live
);

// TODO(effect4): BunRuntime.runMain replaced with Runtime.makeRunMain
const runMain = Runtime.makeRunMain(({ fiber, teardown }) => {
  fiber.addObserver((exit) => teardown(exit));
});

Effect.suspend(() => runOpsCli(process.argv)).pipe(
  Effect.provide(liveLayer),
  Logger.withMinimumLogLevel(LogLevel.Info),
  runMain
);
