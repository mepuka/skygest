import { Config, Context, Effect, Layer, Redacted } from "effect";
import { MissingOperatorSecretEnvError } from "./Errors";

export class OperatorSecret extends Context.Tag("@skygest/OperatorSecret")<
  OperatorSecret,
  {
    readonly value: Redacted.Redacted<string>;
  }
>() {
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

      return OperatorSecret.of({ value });
    })
  );
}
