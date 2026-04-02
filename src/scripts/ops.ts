import { ChildProcessSpawner } from "effect/unstable/process";
import { Effect, Layer, Runtime } from "effect";
import { runOpsCli } from "../ops/Cli";
import { OperatorSecret } from "../ops/OperatorSecret";
import { StagingOperatorClient } from "../ops/StagingOperatorClient";
import { WranglerCli } from "../ops/WranglerCli";

// TODO(effect4): provide a real ChildProcessSpawner implementation for Bun
const wranglerLayer = WranglerCli.live;
const liveLayer = Layer.mergeAll(
  wranglerLayer,
  OperatorSecret.live
).pipe(
  Layer.provideMerge(StagingOperatorClient.live)
);

const runMain = Runtime.makeRunMain(({ fiber, teardown }) => {
  fiber.addObserver((exit) => teardown(exit, (code) => process.exit(code)));
});

Effect.suspend(() => runOpsCli(process.argv)).pipe(
  Effect.provide(liveLayer),
  runMain
);
