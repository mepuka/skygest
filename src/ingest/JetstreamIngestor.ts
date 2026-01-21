import { Duration, Effect, Stream } from "effect";
import { Jetstream, JetstreamConfig, JetstreamMessage } from "effect-jetstream";
import { CloudflareEnv } from "../platform/Env";
import { AppConfig } from "../platform/Config";
import { JetstreamCursorStore } from "./JetstreamCursorStore";
import { RawEvent, RawEventBatch } from "../domain/types";

const toRawEvent = (event: JetstreamMessage.JetstreamMessage): RawEvent | null => {
  if (event._tag === "CommitCreate" || event._tag === "CommitUpdate") {
    return {
      kind: "commit",
      operation: event.commit.operation,
      collection: event.commit.collection,
      did: event.did,
      uri: `at://${event.did}/${event.commit.collection}/${event.commit.rkey}`,
      cid: event.commit.cid,
      record: event.commit.record,
      timeUs: event.time_us
    };
  }

  if (event._tag === "CommitDelete") {
    return {
      kind: "commit",
      operation: event.commit.operation,
      collection: event.commit.collection,
      did: event.did,
      uri: `at://${event.did}/${event.commit.collection}/${event.commit.rkey}`,
      timeUs: event.time_us
    };
  }

  return null;
};

export const runIngestor = Effect.gen(function* () {
  const cfg = yield* AppConfig;
  const env = yield* CloudflareEnv;
  const cursorStore = yield* JetstreamCursorStore;

  const startCursor = yield* cursorStore.getCursor();
  const config = JetstreamConfig.JetstreamConfig.make({
    endpoint: cfg.jetstreamEndpoint,
    wantedCollections: ["app.bsky.feed.post"],
    cursor: startCursor ?? undefined
  });

  const streamEffect = Effect.gen(function* () {
    const jetstream = yield* Jetstream.Jetstream;
    yield* jetstream.stream.pipe(
      Stream.map(toRawEvent),
      Stream.filter((event): event is RawEvent => event !== null),
      Stream.groupedWithin(200, Duration.seconds(2)),
      Stream.mapEffect((chunk) => {
        const events = Array.from(chunk);
        const cursor = events.at(-1)?.timeUs;
        const payload: RawEventBatch = { cursor, events };
        return Effect.tryPromise({
          try: () => env.RAW_EVENTS.send(payload, { contentType: "json" })
        }).pipe(
          Effect.tap(() => (cursor === undefined ? Effect.void : cursorStore.setCursor(cursor)))
        );
      }),
      Stream.runDrain
    );
  });

  yield* streamEffect.pipe(Effect.provide(Jetstream.live(config)));
}).pipe(Effect.provide(JetstreamCursorStore.layer));
