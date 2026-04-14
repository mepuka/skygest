import { Effect, Stream } from "effect";
import {
  ChildProcess,
  ChildProcessSpawner
} from "effect/unstable/process";
import { CommandExecutionError } from "../domain/errors";
import { stringifyUnknown } from "./Json";

export const runCommandCollectingOutput = (
  commandText: string,
  command: ChildProcess.Command
): Effect.Effect<
  string,
  CommandExecutionError,
  ChildProcessSpawner.ChildProcessSpawner
> =>
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const handle = yield* spawner.spawn(command);
    const output = yield* Stream.decodeText(handle.all).pipe(Stream.mkString);
    const exitCode = yield* handle.exitCode;

    if (exitCode !== 0) {
      return yield* new CommandExecutionError({
        command: commandText,
        message: output.trim().length > 0
          ? output.trim()
          : `command exited with status ${String(exitCode)}`,
        exitCode
      });
    }

    return output;
  }).pipe(
    Effect.scoped,
    Effect.mapError((error) =>
      error instanceof CommandExecutionError
        ? error
        : new CommandExecutionError({
            command: commandText,
            message: stringifyUnknown(error)
          })
    )
  );
