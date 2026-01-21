# Skygest Effect Request Batching Design

**Goal**
Introduce first-class Effect Request/RequestResolver batching for write paths, while keeping read paths simple. This replaces imperative loops with declarative Match + pipe pipelines and batches D1 writes per queue batch.

**Architecture**
- Add `PutPost` and `DeletePost` Request types for write intents.
- Add a `PostsWriteResolver` using `RequestResolver.fromEffectTagged` to group requests by tag and execute batched SQL via `PostsRepo`.
- Refactor `FilterWorker` to convert raw events into requests using `Match` and `Array.filterMap`, then execute with `Effect.request` and `Effect.forEach` under `Effect.withRequestBatching(true)`.

**Components & Data Flow**
1) **Request Types**
   - `PutPost` carries a `PaperPost`.
   - `DeletePost` carries a `uri`.
   - Both have `void` success and `never` error for now.

2) **PostsWriteResolver**
   - Uses `RequestResolver.fromEffectTagged` to group requests by `_tag`.
   - `PutPost` group calls `PostsRepo.putMany` once.
   - `DeletePost` group calls `PostsRepo.markDeletedMany` once.
   - Returns an array of `void` results with matching cardinality.

3) **FilterWorker**
   - Converts events to `Option<PostsWriteRequest>` with `Match.value` and `Option` pipelines.
   - Uses `Array.filterMap` to drop non-matching events.
   - Executes requests with `Effect.request(req, PostsWriteResolver)` and `Effect.forEach` with unbounded concurrency.
   - Enables batching explicitly (`Effect.withRequestBatching(true)`), disables caching for writes.

**Error Handling**
- Resolver failures complete all requests in that batch with the same cause.
- Queue messages are only acked on success; failed batches retry.
- Writes remain idempotent via `INSERT OR IGNORE` and `UPDATE ... WHERE uri IN (...)`.

**Testing**
- Add resolver tests to assert single `putMany` / `markDeletedMany` calls per batch.
- Update `FilterWorker` tests to include delete events and verify batched calls.
- Add a D1 test for `markDeletedMany`.

