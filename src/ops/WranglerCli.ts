import { ChildProcess as Command, ChildProcessSpawner as CommandExecutor } from "effect/unstable/process";
import { Context, Effect, Layer } from "effect";
import { stringifyUnknown } from "../platform/Json";
import { WranglerDeployError } from "./Errors";

export class WranglerCli extends Context.Tag("@skygest/WranglerCli")<
  WranglerCli,
  {
    readonly deploy: (
      configFile: string,
      env: string
    ) => Effect.Effect<void, WranglerDeployError>;
  }
>() {
  static readonly live = Layer.effect(
    WranglerCli,
    Effect.gen(function* () {
      const executor = yield* CommandExecutor.CommandExecutor;

      const deploy = Effect.fn("WranglerCli.deploy")(function* (
        configFile: string,
        env: string
      ) {
        const commandText = `bunx wrangler deploy --config ${configFile} --env ${env}`;
        const exitCode = yield* executor.exitCode(
          Command.make(
            "bunx",
            "wrangler",
            "deploy",
            "--config",
            configFile,
            "--env",
            env
          ).pipe(
            Command.stdout("inherit"),
            Command.stderr("inherit")
          )
        ).pipe(
          Effect.mapError((error) =>
            WranglerDeployError.make({
              command: commandText,
              message: stringifyUnknown(error)
            })
          )
        );

        if (exitCode !== 0) {
          return yield* WranglerDeployError.make({
            command: commandText,
            message: `wrangler exited with status ${String(exitCode)}`
          });
        }
      });

      return WranglerCli.of({
        deploy
      });
    })
  );
}
