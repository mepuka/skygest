import { Config, ServiceMap, Effect, Layer, Redacted } from "effect";
import { MissingOperatorSecretEnvError } from "./Errors";

export class OperatorSecret extends ServiceMap.Service<
  OperatorSecret,
  {
    readonly value: Redacted.Redacted<string>;
  }
>()("@skygest/OperatorSecret") {
  static readonly live = Layer.effect(
    OperatorSecret,
    Effect.gen(function* () {
      const value = yield* Config.redacted("SKYGEST_OPERATOR_SECRET").pipe(
        Effect.mapError(() =>
          MissingOperatorSecretEnvError.make({
            envVar: "SKYGEST_OPERATOR_SECRET"
          })
        )
      );

      if (Redacted.value(value).trim().length === 0) {
        return yield* MissingOperatorSecretEnvError.make({
          envVar: "SKYGEST_OPERATOR_SECRET"
        });
      }

      return { value };
    })
  );
}
