import { Effect, Layer } from "effect";
import {
  CookieManager,
  GuestAuth,
  UserAuth,
  ScraperStrategy,
  TwitterConfig,
  TwitterHttpClient,
  TwitterPublic,
  TwitterTweets
} from "@pooks/twitter-scraper";

/**
 * Cookie manager layer that loads auth cookies from the scraper's fixture file.
 * Uses CookieManager.liveLayer as the base, then restores serialized cookies
 * from disk via the CookieManager's own restoreSerializedCookies method.
 */
const cookieFixturePath = (process.env.TWITTER_SCRAPER_PATH ?? "../better_twitter_scraper") +
  "/tests/live-auth-cookies.local.json";

const cookieManagerLayer = Layer.effectDiscard(
  Effect.gen(function* () {
    const cookies = yield* CookieManager;
    const text = yield* Effect.tryPromise(() => Bun.file(cookieFixturePath).text());
    const raw = JSON.parse(text) as ReadonlyArray<{ name: string; value: string }>;
    yield* cookies.restoreSerializedCookies(raw);
  })
).pipe(Layer.provideMerge(CookieManager.liveLayer));

/**
 * Twitter scraper layer stack for CLI commands.
 *
 * Uses CycleTLS for TLS fingerprinting, loads auth cookies from the local
 * fixture file, and provides both guest and user auth for full API access.
 *
 * IMPORTANT: This layer provides HttpClient.HttpClient via CycleTLS, which
 * conflicts with StagingOperatorClient's FetchHttpClient. Provide this layer
 * only within twitter command Effects, NOT in the shared CLI layer.
 */
export const scraperLayer = Layer.mergeAll(
  TwitterPublic.layer,
  TwitterTweets.layer
).pipe(
  Layer.provideMerge(ScraperStrategy.standardLayer),
  Layer.provideMerge(UserAuth.liveLayer),
  Layer.provideMerge(GuestAuth.liveLayer),
  Layer.provideMerge(TwitterHttpClient.cycleTlsLayer()),
  Layer.provideMerge(cookieManagerLayer),
  Layer.provideMerge(TwitterConfig.testLayer())
);
