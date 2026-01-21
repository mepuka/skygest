import { Effect, Layer } from "effect";
import { SqlClient } from "@effect/sql";
import { AccessRepo, type AccessLog } from "../AccessRepo";

export const AccessRepoD1 = {
  layer: Layer.effect(AccessRepo, Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;

    const logAccess = (log: AccessLog) =>
      sql`
        INSERT INTO user_access_log (
          id, did, access_at, recs_shown, cursor_start, cursor_end, default_from
        ) VALUES (
          ${log.id}, ${log.did}, ${log.accessAt}, ${log.recsShown},
          ${log.cursorStart}, ${log.cursorEnd}, ${log.defaultFrom}
        )
      `.pipe(Effect.asVoid);

    const logAccessMany = (logs: ReadonlyArray<AccessLog>) =>
      logs.length === 0
        ? Effect.void
        : sql`
            INSERT INTO user_access_log (
              id, did, access_at, recs_shown, cursor_start, cursor_end, default_from
            ) ${sql.insert(logs.map((log) => ({
              id: log.id,
              did: log.did,
              access_at: log.accessAt,
              recs_shown: log.recsShown,
              cursor_start: log.cursorStart,
              cursor_end: log.cursorEnd,
              default_from: log.defaultFrom
            })))}
          `.pipe(Effect.asVoid);

    return AccessRepo.of({ logAccess, logAccessMany });
  }))
};
