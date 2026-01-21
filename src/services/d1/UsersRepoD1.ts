import { Effect, Layer } from "effect";
import { SqlClient } from "@effect/sql";
import { UsersRepo, type UserRow } from "../UsersRepo";

type UserRowDb = Omit<UserRow, "optOut" | "deactivated"> & {
  readonly optOut: number;
  readonly deactivated: number;
};

const toUserRow = (row: UserRowDb): UserRow => ({
  ...row,
  optOut: row.optOut === 1,
  deactivated: row.deactivated === 1
});

export const UsersRepoD1 = {
  layer: Layer.effect(UsersRepo, Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;

    const upsert = (user: UserRow) =>
      sql`
        INSERT INTO users (
          did, handle, display_name, created_at, last_access_at,
          access_count, consent_accesses, opt_out, deactivated
        ) VALUES (
          ${user.did}, ${user.handle}, ${user.displayName}, ${user.createdAt}, ${user.lastAccessAt},
          ${user.accessCount}, ${user.consentAccesses}, ${user.optOut ? 1 : 0}, ${user.deactivated ? 1 : 0}
        )
        ON CONFLICT(did) DO UPDATE SET
          handle = excluded.handle,
          display_name = excluded.display_name,
          last_access_at = excluded.last_access_at,
          access_count = excluded.access_count,
          consent_accesses = excluded.consent_accesses,
          opt_out = excluded.opt_out,
          deactivated = excluded.deactivated
      `.pipe(Effect.asVoid);

    const get = (did: string) =>
      sql<UserRowDb>`
        SELECT
          did as did,
          handle as handle,
          display_name as displayName,
          created_at as createdAt,
          last_access_at as lastAccessAt,
          access_count as accessCount,
          consent_accesses as consentAccesses,
          opt_out as optOut,
          deactivated as deactivated
        FROM users
        WHERE did = ${did}
      `.pipe(Effect.map((rows) => (rows[0] ? toUserRow(rows[0]) : null)));

    const listActive = () =>
      sql<{ did: string }>`
        SELECT did as did FROM users WHERE deactivated = 0 AND opt_out = 0
      `.pipe(Effect.map((rows) => rows.map((row) => row.did)));

    const incrementAccess = (did: string, consentIncrement: number) => {
      const now = Date.now();
      return sql`
        UPDATE users
        SET
          access_count = access_count + 1,
          consent_accesses = consent_accesses + ${consentIncrement},
          last_access_at = ${now}
        WHERE did = ${did}
      `.pipe(Effect.asVoid);
    };

    return UsersRepo.of({ upsert, get, listActive, incrementAccess });
  }))
};
