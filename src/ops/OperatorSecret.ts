import { Config, ConfigProvider, ServiceMap, Effect, Layer, Redacted } from "effect";
import { MissingOperatorSecretEnvError } from "./Errors";

const SecretConfig = Config.redacted("SKYGEST_OPERATOR_SECRET");

export class OperatorSecret extends ServiceMap.Service<
  OperatorSecret,
  {
    readonly value: Redacted.Redacted<string>;
  }
>()("@skygest/OperatorSecret") {
  static readonly live = Layer.effect(
    OperatorSecret,
    Effect.gen(function* () {
      const provider = ConfigProvider.fromEnv();
      const value = yield* SecretConfig.parse(provider).pipe(
        Effect.mapError(() =>
          new MissingOperatorSecretEnvError({
            envVar: "SKYGEST_OPERATOR_SECRET"
          })
        )
      );

      if (Redacted.value(value).trim().length === 0) {
        return yield* Effect.fail(new MissingOperatorSecretEnvError({
          envVar: "SKYGEST_OPERATOR_SECRET"
        }));
      }

      return { value };
    })
  );
}
