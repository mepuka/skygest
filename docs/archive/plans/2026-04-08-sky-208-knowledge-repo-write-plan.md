# SKY-208 KnowledgeRepo Write Plan Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Finish the remaining `SKY-208` cleanup by removing the highest-risk duplication between the `KnowledgeRepoD1` transaction path and the raw D1 batch path without forcing a premature single-write-path rewrite.

**Architecture:** Keep both execution modes, but make them consume the same write plan for the core upsert/delete sequence. The current main branch already shares discovered-publication row preparation; this slice should extend that pattern to the post row, FTS delete/rebuild, and delete-path sequencing so schema or SQL changes no longer drift between the two implementations.

**Tech Stack:** Effect, Effect Schema, `effect/unstable/sql`, `@effect/sql-d1`, Bun, Vitest

---

### Task 1: Add Regression Coverage For Remaining Drift Surface

**Files:**
- Modify: `tests/repositories.test.ts`
- Read: `tests/support/runtime.ts`
- Read: `src/services/d1/KnowledgeRepoD1.ts`

**Step 1: Write the failing test**

Add a test that exercises `KnowledgeRepo.upsertPosts()` through the current transaction-backed test runtime and verifies all of these after a re-upsert of the same URI with a new `ingestId`:

```ts
it.effect("re-upsert rebuilds search state and replaces old topic/link rows", () =>
  Effect.gen(function* () {
    yield* runMigrations;
    yield* bootstrapExperts(seedManifest, 1, 1_710_000_000_000);

    const repo = yield* KnowledgeRepo;
    const sql = yield* SqlClient.SqlClient;

    // Seed one post with one text body, topic, and discovered link.
    // Re-upsert same URI with changed text/topic/link and a new ingestId.
    // Assert:
    // - old topic rows are gone
    // - old link rows are gone
    // - search uses the new text / topic state
    // - discovered publication rows still exist for the replacement link domain
  }).pipe(Effect.provide(makeBiLayer()))
);
```

**Step 2: Run test to verify it fails**

Run: `bun run test tests/repositories.test.ts`

Expected: the new test should fail until the duplicated write sequence is actually unified.

**Step 3: Add delete-path coverage if the first test does not cover it**

If the upsert regression still leaves delete drift unguarded, add a second test that verifies `markDeleted()` removes FTS visibility and child rows for the deleted URI while preserving idempotent re-delete behavior.

**Step 4: Re-run the targeted tests**

Run: `bun run test tests/repositories.test.ts`

Expected: the new regression coverage is in place and still failing for the right reason before implementation.

### Task 2: Extract A Shared KnowledgeRepo Write Plan

**Files:**
- Modify: `src/services/d1/KnowledgeRepoD1.ts`
- Read: `src/platform/Json.ts`
- Read: `src/services/d1/schemaDecode.ts`

**Step 1: Introduce a shared plan shape for single-post writes**

Create a small internal helper structure for the remaining duplicated write contract. It should cover:

- delete existing FTS row by URI
- upsert the `posts` row
- clear topic/link rows
- insert topic/link/publication rows
- rebuild FTS row

Keep this repo-local. Do not create new domain schemas for this internal persistence plan.

**Step 2: Route the raw D1 batch path through the shared plan**

Refactor `makeUpsertStatements()` and `makeDeleteStatements()` so they are fed by the same shared plan data rather than rebuilding the SQL contract inline.

**Step 3: Route the `sql.withTransaction` path through the same plan**

Replace the remaining inline transaction sequence in `upsertOne()` / `markDeletedOne()` with helpers that consume the same plan. It is fine if the final execution helpers differ (`db.prepare(...).bind(...)` vs tagged `sql\`\``), but the logical write plan must come from one source.

**Step 4: Keep the current constraints**

- Do not remove the two execution modes.
- Do not expand the repo error model in this slice.
- Do not broaden this into unrelated search/query cleanup.

### Task 3: Verify The Shared Plan Preserves Existing Behavior

**Files:**
- Modify if needed: `tests/repositories.test.ts`
- Verify: `tests/import-endpoint.test.ts`
- Verify: `tests/editorial.test.ts`
- Verify: `tests/staging-ops.test.ts`
- Verify: `tests/embed-type-ingest.test.ts`

**Step 1: Run the focused repo tests**

Run: `bun run test tests/repositories.test.ts`

Expected: new regression coverage and existing repository tests pass.

**Step 2: Run the main KnowledgeRepo consumer tests**

Run:

```bash
bun run test tests/import-endpoint.test.ts tests/editorial.test.ts tests/staging-ops.test.ts tests/embed-type-ingest.test.ts
```

Expected: no behavior regression in importer, editorial, staging ops, or embed persistence flows.

**Step 3: Run typecheck**

Run: `bunx tsc --noEmit`

Expected: pass, aside from any pre-existing advisory `TS44` messages already present on `main`.

**Step 4: Commit**

```bash
git add docs/plans/2026-04-08-sky-208-knowledge-repo-write-plan.md tests/repositories.test.ts src/services/d1/KnowledgeRepoD1.ts
git commit -m "refactor: reduce KnowledgeRepo write path drift"
```
