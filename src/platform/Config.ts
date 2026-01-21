import { Config, ConfigProvider, Context, Effect, Layer } from "effect";
import { CloudflareEnv } from "./Env";

const ConfigSchema = Config.all({
  feedDid: Config.string("FEED_DID"),
  jetstreamEndpoint: Config.withDefault(
    Config.string("JETSTREAM_ENDPOINT"),
    "wss://jetstream1.us-east.bsky.network/subscribe"
  )
});

export type AppConfigShape = Config.Config.Success<typeof ConfigSchema>;

export class AppConfig extends Context.Tag("@skygest/AppConfig")<
  AppConfig,
  AppConfigShape
>() {
  static layer = Layer.effect(
    AppConfig,
    Effect.gen(function* () {
      const env = yield* CloudflareEnv;
      const provider = ConfigProvider.fromMap(new Map([
        ["FEED_DID", env.FEED_DID],
        ["JETSTREAM_ENDPOINT", env.JETSTREAM_ENDPOINT]
      ]));
      return yield* provider.load(ConfigSchema);
    })
  );
}
