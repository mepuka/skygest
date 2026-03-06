import { Duration, Effect, Option, Schema, Stream } from "effect";
import { Jetstream, JetstreamConfig, JetstreamMessage } from "effect-jetstream";
import { slimPostRecordFromUnknown } from "../bluesky/PostRecord";
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
          record: slimPostRecordFromUnknown(event.commit.record),
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

export const annotateIngestorLogs = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(
    Effect.annotateLogs({ component: "ingest", queue: "RAW_EVENTS" })
  );

const loadWantedDids = (db: D1Database, shard: number) =>
  Effect.promise(async () => {
    const result = await db.prepare(
      "SELECT did FROM experts WHERE active = 1 AND shard = ? ORDER BY added_at ASC, did ASC"
    ).bind(shard).all<{ did: string }>();

    return (result.results ?? []).map((row) => row.did);
  });

export const runIngestor = (shard: number) => Effect.gen(function* () {
  const cfg = yield* AppConfig;
  const env = yield* CloudflareEnv;
  const cursorStore = yield* JetstreamCursorStore;
  const rawEvents = env.RAW_EVENTS;
  const wantedDids = yield* loadWantedDids(env.DB, shard);

  if (!rawEvents) {
    return yield* Effect.dieMessage("RAW_EVENTS queue binding is missing");
  }

  if (wantedDids.length === 0) {
    yield* Effect.logInfo("no active experts configured for shard").pipe(
      Effect.annotateLogs({ shard })
    );
    return yield* Effect.never;
  }

  const startCursor = yield* cursorStore.getCursor();
  const config = JetstreamConfig.JetstreamConfig.make({
    endpoint: cfg.jetstreamEndpoint,
    wantedCollections: ["app.bsky.feed.post"],
    wantedDids,
    cursor: startCursor ?? undefined
  });

  const streamEffect = Effect.gen(function* () {
    const jetstream = yield* Jetstream.Jetstream;
    yield* jetstream.stream.pipe(
      Stream.filterMapEffect(toRawEvent),
      Stream.groupedWithin(25, Duration.seconds(2)),
      Stream.mapEffect((chunk) => {
        const events = Array.from(chunk);
        const cursor = events.at(-1)?.timeUs;
        const payload: RawEventBatch = { cursor, events };
        return Effect.promise(() => rawEvents.send(payload, { contentType: "json" })).pipe(
          Effect.tap(() =>
            Effect.logInfo("raw events batch sent").pipe(
              Effect.annotateLogs({
                batchSize: events.length,
                cursor: cursor ?? null
              })
            )
          ),
          Effect.tap(() => (cursor === undefined ? Effect.void : cursorStore.setCursor(cursor))),
          Effect.asVoid
        );
      }),
      Stream.runDrain
    );
  });

  yield* streamEffect.pipe(
    annotateIngestorLogs,
    Effect.withSpan("jetstream.stream"),
    Effect.provide(Jetstream.live(config))
  );
});
