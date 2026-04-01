# Canonical Domain Model and State Machine

**Status:** Decision record (SKY-80)
**Date:** 2026-03-31

## Purpose

Map existing codebase objects to the brief pipeline vocabulary. Define state transitions and service ownership. Close the two smallest structural gaps without triggering a migration wave.

This document is the reference that every other issue uses to declare which object it touches and which state transition it owns.

## The Brief Pipeline

A post moves through seven stages. Five already exist under different names. One (Reviewable) is computed. One (the audit trail) is new.

```
Discovered → Candidate → Enriching → Reviewable → Accepted
                                    ↘ Rejected
                          Accepted  → Retracted / Expired
```

## Vocabulary Mapping

| Pipeline Stage | Current Implementation | Tables | State Signal |
|---|---|---|---|
| **Discovered** | `KnowledgePost` with no curation record | `posts` | `posts.status = 'active'`, no row in `post_curation` |
| **Candidate** | `CurationRecord` with status="flagged" | `posts` + `post_curation` | `post_curation.status = 'flagged'` |
| **Enriching** | Curated post with active enrichment run | `post_payloads` + `post_enrichment_runs` | `post_curation.status = 'curated'` AND `post_enrichment_runs.status IN ('queued','running')` |
| **Reviewable** | Enrichment complete, no editorial pick | `post_payloads` + `post_enrichment_runs` | `post_curation.status = 'curated'` AND all runs `'complete'`, no row in `editorial_picks` |
| **Accepted** | `EditorialPickRecord` with status="active" | `editorial_picks` | `editorial_picks.status = 'active'` |
| **Rejected** | `CurationRecord` with status="rejected" | `post_curation` | `post_curation.status = 'rejected'` |
| **Retracted** | `EditorialPickRecord` with status="retracted" | `editorial_picks` | `editorial_picks.status = 'retracted'` |
| **Expired** | `EditorialPickRecord` with status="expired" | `editorial_picks` | `editorial_picks.status = 'expired'` |

**Key insight:** There is no single "brief status" column. A post's pipeline stage is derived by reading across `post_curation`, `post_enrichment_runs`, and `editorial_picks`. The Reviewable stage is computed, not stored.

## Service Ownership

Each state transition has exactly one owning service.

| Transition | Owner | Trigger |
|---|---|---|
| Discovered → Candidate | `CurationService.flagBatch()` | Automatic, during ingest post-processing |
| Candidate → Enriching | `CurationService.curatePost(action: "curate")` | Manual, curator decision |
| Candidate → Rejected | `CurationService.curatePost(action: "reject")` | Manual, curator decision |
| Enriching → Reviewable | `EnrichmentRunsRepo.markComplete()` | Automatic, enrichment workflow finishes |
| Enriching → Failed | `EnrichmentRunsRepo.markFailed()` | Automatic, enrichment errors |
| Reviewable → Accepted | `EditorialService.submitPick()` | Manual, curator decision |
| Accepted → Retracted | `EditorialService.retractPick()` | Manual, curator decision |
| Accepted → Expired | `EditorialService.expireStale()` | Automatic, time-based |

No service boundaries move. No new services created (except `DecisionLog`, below).

## Gap 1: Reviewable Is Computed, Not Stored

"Reviewable" is not a status in any table. It is a derived state:

```
Reviewable = post_curation.status = 'curated'
           AND post_enrichment_runs has at least one run for this post
           AND all runs are 'complete'
           AND no active editorial pick exists
```

This is what SKY-78 (candidate readiness scoring) and SKY-77 (enrichment read model) will implement. The readiness model distinguishes:

- `none` — not curated, no enrichment queued
- `pending` — enrichment queued or running
- `complete` — all enrichments finished successfully
- `failed` — at least one enrichment failed
- `needs-review` — enrichment flagged for manual review

No new table or column needed. Readiness is computed at query time from existing state.

## Gap 2: Decision Audit Trail

When a curator rejects a post, the rejection is stored as a status change in `post_curation`. But only the latest decision survives — if a post is flagged, rejected, re-flagged, then curated, the rejection history is gone. Same for editorial retract → re-pick.

### Solution: Append-Only Decisions Table

One new table. No changes to existing tables. `post_curation` and `editorial_picks` remain the source of truth for current state. The decisions table is the audit trail.

#### Migration (#17)

```sql
CREATE TABLE IF NOT EXISTS curation_decisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_uri TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('flag', 'curate', 'reject', 'pick', 'retract', 'expire')),
  actor TEXT NOT NULL,
  note TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (post_uri) REFERENCES posts(uri)
);
CREATE INDEX IF NOT EXISTS idx_curation_decisions_post_uri
  ON curation_decisions(post_uri);
```

#### Domain Schema

In `src/domain/curation.ts`:

```ts
export const DecisionAction = Schema.Literal(
  "flag", "curate", "reject", "pick", "retract", "expire"
);
export type DecisionAction = Schema.Schema.Type<typeof DecisionAction>;

export const CurationDecision = Schema.Struct({
  postUri: AtUri,
  action: DecisionAction,
  actor: Schema.String,
  note: Schema.NullOr(Schema.String),
  createdAt: Schema.Number
});
export type CurationDecision = Schema.Schema.Type<typeof CurationDecision>;
```

#### Service

New `DecisionLog` service following the standard `Context.Tag` + `Layer.effect` pattern:

```ts
// src/services/DecisionLog.ts
export class DecisionLog extends Context.Tag("@skygest/DecisionLog")<
  DecisionLog,
  {
    readonly record: (
      decision: Omit<CurationDecision, "createdAt">
    ) => Effect.Effect<void, SqlError>;
  }
>() {}
```

The service stamps `createdAt` via `Clock.currentTimeMillis`. Callers pass `postUri`, `action`, `actor`, and optional `note`.

#### Repo

New `src/services/d1/DecisionLogD1.ts`. Single `INSERT INTO curation_decisions` — append-only, no upsert, no update, no delete.

#### Composition

Each service that owns a state transition adds an explicit `yield* decisionLog.record(...)` call inside its `Effect.gen` block, after the primary mutation succeeds:

```ts
// In CurationService.curatePost(), after updateStatus:
yield* decisionLog.record({
  postUri: input.postUri,
  action: input.action,
  actor: curator,
  note: input.note ?? null
});
```

This follows the existing codebase pattern: `Effect.gen` + `yield*` with `Effect.fn` for tracing. No combinators, no middleware, no magic. Six call sites total:

1. `CurationService.flagBatch()` — action: "flag", actor: "system"
2. `CurationService.curatePost()` — action: "curate" or "reject"
3. `EditorialService.submitPick()` — action: "pick"
4. `EditorialService.retractPick()` — action: "retract"
5. `EditorialService.expireStale()` — action: "expire", actor: "system"

`DecisionLog` is added to the layer graph alongside `CurationRepo`. Services that need it add it as a dependency.

## What This Does NOT Include

- No table renames or column renames
- No new "brief status" column — pipeline stage stays computed
- No BriefDraft intermediate stage — `candidate → picked` remains the staging model
- No ActorContext service — curator string remains ad-hoc until auth scoping (SKY-29/76) lands
- No changes to enrichment coupling — enrichment is still triggered by `curatePost(action: "curate")`

## Issue Cross-Reference

Every active issue should reference which object and transition it touches:

| Issue | Object | Transition |
|---|---|---|
| SKY-16 | BriefDraft (enrichment payload) | Enriching → Reviewable (vision) |
| SKY-17 | BriefDraft (enrichment payload) | Enriching → Reviewable (source-attribution) |
| SKY-41 | BriefDraft (enrichment payload) | Enriching → Reviewable vs Failed (gate) |
| SKY-42 | BriefDraft (enrichment payload) | Measures Enriching → Reviewable quality |
| SKY-48 | BriefDraft (enrichment payload) | Measures source-attribution quality |
| SKY-71 | ReviewDecision | Audit trail for all transitions |
| SKY-75 | Candidate → Accepted | End-to-end orchestration via MCP |
| SKY-77 | Reviewable (computed) | Exposes readiness via shared read model |
| SKY-78 | Reviewable (computed) | Computes readiness as scoring signal |
| SKY-79 | Vocabulary | Aligns glossary with pipeline terms |
| SKY-80 | All | This document |
| SKY-81 | Candidate + Reviewable | Surfaces readiness in review queue |
