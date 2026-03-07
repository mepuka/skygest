import { Effect, Layer } from "effect";
import { SqlClient } from "@effect/sql";
import { IngestLeaseRepo } from "../IngestLeaseRepo";

type LeaseRow = {
  readonly owner: string;
  readonly expiresAt: number;
};

export const IngestLeaseRepoD1 = {
  layer: Layer.effect(IngestLeaseRepo, Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;

    const getLease = (name: string) =>
      sql<LeaseRow>`
        SELECT
          owner as owner,
          expires_at as expiresAt
        FROM ingest_leases
        WHERE name = ${name}
        LIMIT 1
      `.pipe(Effect.map((rows) => rows[0] ?? null));

    const tryAcquire = (name: string, owner: string, now: number, expiresAt: number) =>
      Effect.gen(function* () {
        yield* sql`
          INSERT INTO ingest_leases (name, owner, expires_at)
          VALUES (${name}, ${owner}, ${expiresAt})
          ON CONFLICT(name) DO UPDATE SET
            owner = excluded.owner,
            expires_at = excluded.expires_at
          WHERE ingest_leases.expires_at <= ${now}
        `.pipe(Effect.asVoid);

        const lease = yield* getLease(name);
        return lease?.owner === owner && lease.expiresAt === expiresAt;
      });

    const renew = (name: string, owner: string, expiresAt: number) =>
      Effect.gen(function* () {
        yield* sql`
          UPDATE ingest_leases
          SET expires_at = ${expiresAt}
          WHERE name = ${name}
            AND owner = ${owner}
        `.pipe(Effect.asVoid);

        const lease = yield* getLease(name);
        return lease?.owner === owner && lease.expiresAt === expiresAt;
      });

    const release = (name: string, owner: string) =>
      sql`
        DELETE FROM ingest_leases
        WHERE name = ${name}
          AND owner = ${owner}
      `.pipe(Effect.asVoid);

    return IngestLeaseRepo.of({
      tryAcquire,
      renew,
      release
    });
  }))
};
