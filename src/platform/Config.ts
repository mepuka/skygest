import { Array, Config, ConfigProvider, Context, Effect, Layer, Option } from "effect";
import { CloudflareEnv } from "./Env";

const ConfigSchema = Config.all({
  feedDid: Config.string("FEED_DID"),
  algFeedDid: Config.string("ALG_FEED_DID"),
  publicApi: Config.withDefault(
    Config.string("PUBLIC_BSKY_API"),
    "https://public.api.bsky.app"
  ),
  jetstreamEndpoint: Config.withDefault(
    Config.string("JETSTREAM_ENDPOINT"),
    "wss://jetstream1.us-east.bsky.network/subscribe"
  ),
  followLimit: Config.withDefault(Config.integer("FOLLOW_LIMIT"), 5000),
  feedLimit: Config.withDefault(Config.integer("FEED_LIMIT"), 150),
  consentThreshold: Config.withDefault(Config.integer("CONSENT_THRESHOLD"), 5)
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
      const entries = Array.filterMap(
        [
          ["FEED_DID", env.FEED_DID],
          ["ALG_FEED_DID", env.ALG_FEED_DID],
          ["PUBLIC_BSKY_API", env.PUBLIC_BSKY_API],
          ["JETSTREAM_ENDPOINT", env.JETSTREAM_ENDPOINT],
          ["FOLLOW_LIMIT", env.FOLLOW_LIMIT],
          ["FEED_LIMIT", env.FEED_LIMIT],
          ["CONSENT_THRESHOLD", env.CONSENT_THRESHOLD]
        ] as const,
        ([key, value]) =>
          value == null
            ? Option.none()
            : Option.some([key, String(value)] as const)
      );
      const provider = ConfigProvider.fromMap(new Map(entries));
      return yield* provider.load(ConfigSchema);
    })
  );
}
