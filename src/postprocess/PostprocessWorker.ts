import { Array, Effect, RequestResolver, Schema } from "effect";
import { FeedItem as FeedItemSchema, PostprocessMessage } from "../domain/types";
import type { FeedItem as FeedItemType } from "../domain/types";
import { AccessRepo } from "../services/AccessRepo";
import { UsersRepo } from "../services/UsersRepo";
import { DbError } from "../domain/errors";
import { AccessWriteResolver, LogAccess } from "../services/AccessWriteResolver";
import { IncrementAccess, UsersWriteResolver } from "../services/UsersWriteResolver";

const FeedItemsJson = Schema.parseJson(Schema.Array(FeedItemSchema));

const encodeRecs = (recs: ReadonlyArray<FeedItemType>) =>
  Schema.encode(FeedItemsJson)(recs).pipe(
    Effect.mapError((error) => DbError.make({ message: String(error) }))
  );

const accessResolver = RequestResolver.contextFromServices(AccessRepo)(AccessWriteResolver);
const usersResolver = RequestResolver.contextFromServices(UsersRepo)(UsersWriteResolver);

const toAccessLog = (msg: PostprocessMessage) =>
  encodeRecs(msg.recs).pipe(
    Effect.map((recsShown) => ({
      id: crypto.randomUUID(),
      did: msg.viewer,
      accessAt: msg.accessAt,
      recsShown,
      cursorStart: msg.cursorStart,
      cursorEnd: msg.cursorEnd,
      defaultFrom: msg.defaultFrom ?? null
    }))
  );

const toIncrement = (msg: PostprocessMessage) => ({
  did: msg.viewer,
  accessIncrement: 1,
  consentIncrement: msg.recs.length > 0 ? 1 : 0,
  lastAccessAt: msg.accessAt
});

export const processPostprocessBatch = (messages: ReadonlyArray<PostprocessMessage>) =>
  Effect.gen(function* () {
    const logs = yield* Effect.forEach(messages, toAccessLog, { concurrency: "unbounded" });
    const logRequests = Array.map(logs, (log) => new LogAccess({ log }));
    const incrementRequests = Array.map(messages, (msg) => new IncrementAccess(toIncrement(msg)));

    yield* Effect.forEach(
      logRequests,
      (req) => Effect.request(req, accessResolver),
      { concurrency: "unbounded", batching: "inherit", discard: true }
    );
    yield* Effect.forEach(
      incrementRequests,
      (req) => Effect.request(req, usersResolver),
      { concurrency: "unbounded", batching: "inherit", discard: true }
    );
  }).pipe(
    Effect.withRequestBatching(true),
    Effect.withRequestCaching(false)
  );

export const processPostprocess = (msg: PostprocessMessage) =>
  processPostprocessBatch([msg]);
