import { Context, Effect, Layer } from "effect";
import { MissingOperatorSecretEnvError } from "./Errors";

export class OperatorSecret extends Context.Tag("@skygest/OperatorSecret")<
  OperatorSecret,
  {
    readonly value: string;
  }
>() {
  static readonly live = Layer.effect(
    OperatorSecret,
    Effect.gen(function* () {
      const value = process.env.SKYGEST_OPERATOR_SECRET?.trim();

      if (!value) {
        return yield* MissingOperatorSecretEnvError.make({
          envVar: "SKYGEST_OPERATOR_SECRET"
        });
      }

      return OperatorSecret.of({ value });
    })
  );
}
