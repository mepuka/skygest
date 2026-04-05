/**
 * Per-key all-at-once config validation.
 *
 * Resolves every key independently via Effect.result and aggregates
 * all failures into a single ConfigValidationError.
 */
import { Config, ConfigProvider, Effect, Result, Schema } from "effect";

export class ConfigValidationError extends Schema.TaggedErrorClass<ConfigValidationError>()(
  "ConfigValidationError",
  {
    failures: Schema.Array(Schema.Struct({
      key: Schema.String,
      message: Schema.String
    })),
    successes: Schema.Array(Schema.String)
  }
) {
  get summary(): string {
    const failLines = this.failures
      .map((f) => `  ${f.key}: ${f.message}`)
      .join("\n");
    const successLines = this.successes
      .map((s) => `  ${s}: OK`)
      .join("\n");
    return [
      `Config validation: ${this.failures.length} key(s) failed`,
      "",
      "Failed:",
      failLines,
      ...(this.successes.length > 0 ? ["", "Resolved:", successLines] : [])
    ].join("\n");
  }
}

/**
 * Validate a flat record of named Config keys against a provider.
 * Resolves EVERY key independently and reports ALL failures at once.
 */
export const validateKeys = <
  Keys extends Record<string, Config.Config<unknown>>
>(
  keys: Keys,
  provider: ConfigProvider.ConfigProvider
): Effect.Effect<
  { [K in keyof Keys]: Config.Success<Keys[K]> },
  ConfigValidationError
> =>
  Effect.gen(function* () {
    const entries = Object.entries(keys);

    const results = yield* Effect.all(
      entries.map(([name, config]) =>
        Effect.result(
          (config as Config.Config<unknown>).parse(provider)
        ).pipe(
          Effect.map((result) => ({ name, result }))
        )
      ),
      { concurrency: "unbounded" }
    );

    const failures: Array<{ key: string; message: string }> = [];
    const successes: Array<string> = [];
    const resolved: Array<[string, unknown]> = [];

    for (const { name, result } of results) {
      if (Result.isSuccess(result)) {
        successes.push(name);
        resolved.push([name, result.success]);
      } else {
        failures.push({
          key: name,
          message: String(result.failure)
        });
      }
    }

    if (failures.length > 0) {
      return yield* new ConfigValidationError({ failures, successes });
    }

    return Object.fromEntries(resolved) as {
      [K in keyof Keys]: Config.Success<Keys[K]>;
    };
  });
