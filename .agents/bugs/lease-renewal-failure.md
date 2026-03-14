# Bug: Poller lease renewal fails on every run

## Symptom

Every poll/backfill request returns:
```json
{"error":"PollerBusyError","message":"poller lease could not be renewed"}
```

This happens even when the `ingest_leases` table is empty and no other poller is running.

## Observations

1. The cron-triggered head poll at 15:55 UTC **did successfully poll all 150 experts** —
   sync state shows `last_polled_at` set, `last_error = NULL`, PDS URLs resolved.
   So the poller worked at least once.

2. After that successful run, every subsequent attempt (manual or cron) fails with the
   lease renewal error.

3. The table is empty between attempts — the `release()` call in `ensuring` runs.

4. The error message is "poller lease could not be renewed" (not "already held"), meaning
   `tryAcquire` succeeds but the first `refreshLease()` call fails.

## Root Cause Hypothesis

In `PollCoordinator.ts`, the flow is:

```
tryAcquire(name, owner, startedAt, expiresAt)  → succeeds
  └─ forEach(experts, (expert) =>
       refreshLease()                           → FAILS HERE
       └─ renew(name, owner, Date.now() + TTL)
```

The `renew` function in `IngestLeaseRepoD1.ts`:

```ts
const renew = (name, owner, expiresAt) => {
  yield* sql`UPDATE ingest_leases SET expires_at = ${expiresAt}
             WHERE name = ${name} AND owner = ${owner}`;
  const lease = yield* getLease(name);
  return lease?.owner === owner && lease.expiresAt === expiresAt;
};
```

### Likely issue: `@effect/sql-d1` column aliasing or type mismatch

The `getLease` query uses:
```sql
SELECT owner as owner, expires_at as expiresAt FROM ingest_leases WHERE name = ?
```

Possible failures:
1. **Column alias `expires_at as expiresAt`** may not produce a camelCase key in the
   result object. D1's SQL API may return `{ owner: "...", expires_at: 1234 }` instead
   of `{ owner: "...", expiresAt: 1234 }`. Then `lease.expiresAt` is `undefined` and
   the `=== expiresAt` check fails.

2. **Integer precision**: `expires_at` stores a millisecond timestamp (~13 digits).
   D1 uses 64-bit integers, but the comparison `lease.expiresAt === expiresAt` uses
   JS strict equality. If there's any numeric coercion issue, this could fail.

3. **`@effect/sql` tagged template behavior**: The `SqlClient` from `@effect/sql-d1`
   may handle column aliasing differently than expected.

## Reproduction

```bash
# 1. Confirm table is empty
wrangler d1 execute skygest-staging --command "SELECT * FROM ingest_leases" --remote

# 2. Trigger poll
curl -X POST -H "x-skygest-operator-secret: $SECRET" \
  -H "Content-Type: application/json" -d '{}' \
  "$INGEST_URL/admin/ingest/poll"

# Result: {"error":"PollerBusyError","message":"poller lease could not be renewed"}
```

## Fix Options

### Option A: Fix the aliasing (most likely fix)
Use raw column names instead of aliases in `getLease`:
```ts
const getLease = (name: string) =>
  sql<LeaseRow>`SELECT owner, expires_at FROM ingest_leases WHERE name = ${name} LIMIT 1`
    .pipe(Effect.map((rows) => {
      const row = rows[0];
      return row ? { owner: row.owner, expiresAt: row.expires_at } : null;
    }));
```

### Option B: Don't verify after update
The renew SQL is a conditional update (`WHERE name = ? AND owner = ?`). If it matched
a row, the update succeeded. Check `changes` count instead of re-reading:
```ts
const renew = (name, owner, expiresAt) =>
  sql`UPDATE ingest_leases SET expires_at = ${expiresAt}
      WHERE name = ${name} AND owner = ${owner}`
    .pipe(Effect.map((result) => result.changes > 0));
```

### Option C: Make refreshLease non-fatal on first call
Since `tryAcquire` just succeeded, the first `refreshLease` is redundant. Skip it
or make it a no-op for the first expert.

## Impact

- **Backfill blocked**: Cannot run initial backfill to populate the knowledge base
- **Cron polling broken**: After the first successful run, no subsequent polls work
- **Staging is deployed but not ingesting**

## Environment

- Workers deployed to staging (ingest + agent)
- D1 staging has 150 experts, sync state tables, PDS URLs resolved
- Cron temporarily disabled to avoid interference during debugging
- 2 smoke fixture posts are the only data in D1
