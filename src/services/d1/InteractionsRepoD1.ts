import { Effect, Layer } from "effect";
import { SqlClient } from "@effect/sql";
import { InteractionsRepo, type InteractionRow } from "../InteractionsRepo";

export const InteractionsRepoD1 = {
  layer: Layer.effect(InteractionsRepo, Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;

    const putMany = (rows: ReadonlyArray<InteractionRow>) =>
      rows.length === 0
        ? Effect.void
        : sql`
            INSERT OR IGNORE INTO interactions
            ${sql.insert(rows.map((row) => ({
              id: row.id,
              user_did: row.userDid,
              post_uri: row.postUri,
              type: row.type,
              created_at: row.createdAt
            })))}
          `.pipe(Effect.asVoid);

    return InteractionsRepo.of({ putMany });
  }))
};
