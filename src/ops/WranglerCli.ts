import { ChildProcess as Command, ChildProcessSpawner as CPS } from "effect/unstable/process";
import { ServiceMap, Effect, Layer } from "effect";
import { stringifyUnknown } from "../platform/Json";
import { WranglerDeployError } from "./Errors";

export class WranglerCli extends ServiceMap.Service<
  WranglerCli,
  {
    readonly deploy: (
      configFile: string,
      env: string
    ) => Effect.Effect<void, WranglerDeployError>;
  }
>()("@skygest/WranglerCli") {
  static readonly live = Layer.effect(
    WranglerCli,
    Effect.gen(function* () {
      const spawner = yield* CPS.ChildProcessSpawner;

      const deploy = (
        configFile: string,
        env: string
      ) => Effect.gen(function* () {
        const commandText = `bunx wrangler deploy --config ${configFile} --env ${env}`;
        const cmd = Command.make("bunx", [
          "wrangler",
          "deploy",
          "--config",
          configFile,
          "--env",
          env
        ]);
        const exitCode = yield* spawner.exitCode(cmd).pipe(
          Effect.mapError((error) =>
            new WranglerDeployError({
              command: commandText,
              message: stringifyUnknown(error)
            })
          )
        );

        if (exitCode !== 0) {
          return yield* Effect.fail(new WranglerDeployError({
            command: commandText,
            message: `wrangler exited with status ${String(exitCode)}`
          }));
        }
      });

      return {
        deploy
      };
    })
  );
}
