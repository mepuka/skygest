import { Duration, Effect, Option, Schema, Stream } from "effect";
import { Jetstream, JetstreamConfig, JetstreamMessage } from "effect-jetstream";
import { CloudflareEnv } from "../platform/Env";
import { AppConfig } from "../platform/Config";
import { JetstreamCursorStore } from "./JetstreamCursorStore";
import { AtUri, Did, RawEvent, RawEventBatch } from "../domain/types";

const toRawEvent = (event: JetstreamMessage.JetstreamMessage) => {
  if (event._tag === "CommitCreate" || event._tag === "CommitUpdate") {
    return Option.some(
      Effect.gen(function* () {
        const did = yield* Schema.decodeUnknown(Did)(event.did);
        const uri = yield* Schema.decodeUnknown(AtUri)(
          `at://${event.did}/${event.commit.collection}/${event.commit.rkey}`
        );

        const rawEvent: RawEvent = {
          kind: "commit",
          operation: event.commit.operation,
          collection: event.commit.collection,
          did,
          uri,
          cid: event.commit.cid,
          record: event.commit.record,
          timeUs: event.time_us
        };

        return rawEvent;
      })
    );
  }

  if (event._tag === "CommitDelete") {
    return Option.some(
      Effect.gen(function* () {
        const did = yield* Schema.decodeUnknown(Did)(event.did);
        const uri = yield* Schema.decodeUnknown(AtUri)(
          `at://${event.did}/${event.commit.collection}/${event.commit.rkey}`
        );

        const rawEvent: RawEvent = {
          kind: "commit",
          operation: event.commit.operation,
          collection: event.commit.collection,
          did,
          uri,
          timeUs: event.time_us
        };

        return rawEvent;
      })
    );
  }

  return Option.none();
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
      Stream.filterMapEffect(toRawEvent),
      Stream.groupedWithin(200, Duration.seconds(2)),
      Stream.mapEffect((chunk) => {
        const events = Array.from(chunk);
        const cursor = events.at(-1)?.timeUs;
        const payload: RawEventBatch = { cursor, events };
        return Effect.promise(() => env.RAW_EVENTS.send(payload, { contentType: "json" })).pipe(
          Effect.tap(() => (cursor === undefined ? Effect.void : cursorStore.setCursor(cursor))),
          Effect.asVoid
        );
      }),
      Stream.runDrain
    );
  });

  yield* streamEffect.pipe(Effect.provide(Jetstream.live(config)));
});
