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

    return AccessRepo.of({ logAccess });
  }))
};
