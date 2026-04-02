/**
 * Effect 4 stub for `BunContext.layer` which was removed.
 *
 * In tests that don't actually spawn child processes, we provide an empty
 * ChildProcessSpawner that throws on any call. Tests that mock `WranglerCli`
 * or `StagingOperatorClient` never hit the real spawner.
 */
import { ChildProcessSpawner } from "effect/unstable/process";
import { Effect, Layer } from "effect";

export const layer = Layer.succeed(
  ChildProcessSpawner.ChildProcessSpawner,
  ChildProcessSpawner.make((_command) =>
    Effect.die(new Error("ChildProcessSpawner stub: not implemented in tests"))
  )
);
