import { Effect, Schema } from "effect";
import { FeedItem as FeedItemSchema, PostprocessMessage } from "../domain/types";
import type { FeedItem as FeedItemType } from "../domain/types";
import { AccessRepo } from "../services/AccessRepo";
import { UsersRepo } from "../services/UsersRepo";
import { DbError } from "../domain/errors";

const FeedItemsJson = Schema.parseJson(Schema.Array(FeedItemSchema));

const encodeRecs = (recs: ReadonlyArray<FeedItemType>) =>
  Schema.encode(FeedItemsJson)(recs).pipe(
    Effect.mapError((error) => DbError.make({ message: String(error) }))
  );

export const processPostprocess = Effect.fn("PostprocessWorker.process")(function* (msg: PostprocessMessage) {
  const access = yield* AccessRepo;
  const users = yield* UsersRepo;
  const recsShown = yield* encodeRecs(msg.recs);

  yield* access.logAccess({
    id: crypto.randomUUID(),
    did: msg.viewer,
    accessAt: msg.accessAt,
    recsShown,
    cursorStart: msg.cursorStart,
    cursorEnd: msg.cursorEnd,
    defaultFrom: msg.defaultFrom ?? null
  });

  const consentIncrement = msg.recs.length > 0 ? 1 : 0;
  yield* users.incrementAccess(msg.viewer, consentIncrement);
});
