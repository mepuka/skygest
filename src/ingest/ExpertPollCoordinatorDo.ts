import { DurableObject } from "cloudflare:workers";
import { Effect, Result, ManagedRuntime, Schema } from "effect";
import type { Did as DidValue } from "../domain/types";
import {
  CoordinatorDidMismatchError,
  IngestSchemaDecodeError,
  toIngestErrorEnvelope
} from "../domain/errors";
import type { WorkflowIngestEnvBindings } from "../platform/Env";
import {
  atRuntimeBoundary,
  makeManagedRuntime,
  runScopedWithRuntime
} from "../platform/EffectRuntime";
import { formatSchemaParseError } from "../platform/Json";
import { IngestRunItemsRepo } from "../services/IngestRunItemsRepo";
import { ExpertPollExecutor } from "./ExpertPollExecutor";
import {
  clearCurrentTask,
  EnqueueBackfillCoordinatorInputSchema,
  EnqueueHeadCoordinatorInputSchema,
  EnqueueReconcileCoordinatorInputSchema,
  emptyCoordinatorState,
  enqueueBackfillTask,
  enqueueHeadTask,
  enqueueReconcileTask,
  insertContinuationTask,
  mergeTaskTotals,
  normalizeStoredCoordinatorState,
  recordCoordinatorCompletion,
  recordCoordinatorFailure,
  takeNextTask,
  taskMode,
  updateBackfillRemaining,
  updateTaskCursor,
  ExpertPollCoordinatorStoredStateCompatSchema,
  type ExpertPollCoordinatorStoredState,
  type EnqueueBackfillCoordinatorInput,
  type EnqueueHeadCoordinatorInput,
  type EnqueueReconcileCoordinatorInput
} from "./ExpertPollCoordinatorState";
import { makeWorkflowIngestLayer } from "./Router";

const STATE_KEY = "expert-poll-coordinator-state";
const HEAD_CHUNK_MAX_PAGES = 2;
const BULK_CHUNK_MAX_PAGES = 2;
const BULK_CHUNK_MAX_POSTS = 200;
const RECENT_RECONCILE_MAX_AGE_DAYS = 90;
const DEEP_RECONCILE_MAX_AGE_DAYS = 180;

const emptyStoredState = (): ExpertPollCoordinatorStoredState => ({
  did: null,
  state: emptyCoordinatorState()
});

export class ExpertPollCoordinatorDo extends DurableObject<WorkflowIngestEnvBindings> {
  private runtime: ManagedRuntime.ManagedRuntime<any, any> | undefined;

  private getRuntime() {
    this.runtime ??= makeManagedRuntime(makeWorkflowIngestLayer(this.env));
    return this.runtime;
  }

  private runEffect = async <A, E, R>(
    effect: Effect.Effect<A, E, R>,
    operation = "ExpertPollCoordinatorDo.alarm"
  ) =>
    runScopedWithRuntime(
      this.getRuntime(),
      atRuntimeBoundary(effect),
      { operation }
    );

  private logEffect = (
    level: "info" | "error",
    event: string,
    annotations: Record<string, string | number | boolean>
  ) =>
    (level === "error" ? Effect.logError(event) : Effect.logInfo(event)).pipe(
      Effect.annotateLogs(annotations)
    );

  private decode<S extends Schema.Decoder<unknown>>(
    schema: S,
    input: unknown,
    operation: string
  ): S["Type"] {
    const decoded = Schema.decodeUnknownResult(schema)(input);
    if (Result.isSuccess(decoded)) {
      return decoded.success;
    }

    throw new IngestSchemaDecodeError({
      message: formatSchemaParseError(decoded.failure),
      operation
    });
  }

  private async loadStoredState(): Promise<ExpertPollCoordinatorStoredState> {
    const stored = await this.ctx.storage.get<ExpertPollCoordinatorStoredState>(STATE_KEY);
    return stored === undefined
      ? emptyStoredState()
      : normalizeStoredCoordinatorState(
          this.decode(
            ExpertPollCoordinatorStoredStateCompatSchema,
            stored,
            "ExpertPollCoordinatorDo.loadStoredState"
          )
        );
  }

  private async saveStoredState(state: ExpertPollCoordinatorStoredState) {
    await this.ctx.storage.put(STATE_KEY, state);
  }

  private async setAlarmIfPending(state: ExpertPollCoordinatorStoredState) {
    if (state.state.current !== null || state.state.pending.length > 0) {
      const currentAlarm = await this.ctx.storage.getAlarm();

      if (currentAlarm === null) {
        // 2-second gap between chunk alarms to reduce D1 write burst pressure
        await this.ctx.storage.setAlarm(Date.now() + 2000);
      }
    }
  }

  private ensureDidConsistency(
    state: ExpertPollCoordinatorStoredState,
    did: DidValue
  ): ExpertPollCoordinatorStoredState {
    if (state.did === null) {
      return {
        ...state,
        did
      };
    }

    if (state.did !== did) {
      throw new CoordinatorDidMismatchError({
        message: `ExpertPollCoordinatorDo did mismatch: expected ${state.did}, got ${did}`,
        expectedDid: state.did,
        actualDid: did
      });
    }

    return state;
  }

  async enqueueHead(input: EnqueueHeadCoordinatorInput) {
    const decoded = this.decode(
      EnqueueHeadCoordinatorInputSchema,
      input,
      "ExpertPollCoordinatorDo.enqueueHead"
    );
    const stored = this.ensureDidConsistency(await this.loadStoredState(), decoded.did);
    const next = enqueueHeadTask(stored.state, decoded.runId, Date.now());
    const updated = {
      ...stored,
      state: next.state
    };
    await this.saveStoredState(updated);
    await this.setAlarmIfPending(updated);
    return {
      accepted: true,
      coalesced: next.coalesced
    };
  }

  async enqueueBackfill(input: EnqueueBackfillCoordinatorInput) {
    const decoded = this.decode(
      EnqueueBackfillCoordinatorInputSchema,
      input,
      "ExpertPollCoordinatorDo.enqueueBackfill"
    );
    const stored = this.ensureDidConsistency(await this.loadStoredState(), decoded.did);
    const next = enqueueBackfillTask(stored.state, decoded.runId, Date.now(), {
      ...(decoded.maxPosts === undefined ? {} : { maxPosts: decoded.maxPosts }),
      ...(decoded.maxAgeDays === undefined ? {} : { maxAgeDays: decoded.maxAgeDays })
    });
    const updated = {
      ...stored,
      state: next.state
    };
    await this.saveStoredState(updated);
    await this.setAlarmIfPending(updated);
    return {
      accepted: true,
      deduped: next.deduped
    };
  }

  async enqueueReconcile(input: EnqueueReconcileCoordinatorInput) {
    const decoded = this.decode(
      EnqueueReconcileCoordinatorInputSchema,
      input,
      "ExpertPollCoordinatorDo.enqueueReconcile"
    );
    const stored = this.ensureDidConsistency(await this.loadStoredState(), decoded.did);
    const next = enqueueReconcileTask(
      stored.state,
      decoded.runId,
      Date.now(),
      decoded.depth ?? "recent"
    );
    const updated = {
      ...stored,
      state: next.state
    };
    await this.saveStoredState(updated);
    await this.setAlarmIfPending(updated);
    return {
      accepted: true,
      deduped: next.deduped
    };
  }

  async getStatus() {
    const stored = await this.loadStoredState();
    return stored.state;
  }

  override async alarm() {
    const stored = await this.loadStoredState();
    const claimed = takeNextTask(stored.state);
    if (claimed.task === null || stored.did === null) {
      return;
    }
    const did = stored.did;
    const runId = claimed.task.runIds[0] ?? "unknown-run";

    await this.saveStoredState({
      ...stored,
      state: claimed.state
    });

    const startedAt = Date.now();

    await this.runEffect(
      Effect.gen(function* () {
        const items = yield* IngestRunItemsRepo;
        yield* Effect.forEach(
          claimed.task!.runIds,
            (runId) =>
              items.markRunning({
                runId,
                did,
                mode: taskMode(claimed.task!),
                startedAt,
                lastProgressAt: startedAt
              }),
          { discard: true }
        );
      })
    );

    await this.runEffect(
      this.logEffect("info", "expert-poll-coordinator-claimed", {
        did,
        runId,
        mode: claimed.task.mode,
        runCount: claimed.task.runIds.length
      }),
      "ExpertPollCoordinatorDo.log:claimed"
    );

    try {
      const execution = await this.runEffect(
        Effect.gen(function* () {
          const executor = yield* ExpertPollExecutor;

          if (claimed.task!.mode === "head") {
            return yield* executor.runDid(
              did,
              { mode: "head" },
              { maxPages: HEAD_CHUNK_MAX_PAGES }
            );
          }

          if (claimed.task!.mode === "backfill") {
            return yield* executor.runDid(
              did,
              {
                mode: "backfill",
                maxPosts: claimed.task!.remainingMaxPosts,
                ...(claimed.task!.maxAgeDays === undefined
                  ? {}
                  : { maxAgeDays: claimed.task!.maxAgeDays })
              },
              {
                maxPages: BULK_CHUNK_MAX_PAGES,
                maxPosts: Math.min(BULK_CHUNK_MAX_POSTS, claimed.task!.remainingMaxPosts),
                ...(claimed.task!.maxAgeDays === undefined
                  ? {}
                  : { maxAgeDays: claimed.task!.maxAgeDays })
              }
            );
          }

          return yield* executor.runDid(
            did,
            {
              mode: "reconcile",
              depth: claimed.task!.depth
            },
            {
              initialCursor: claimed.task!.cursor,
              maxPages: BULK_CHUNK_MAX_PAGES,
              maxPosts: BULK_CHUNK_MAX_POSTS,
              maxAgeDays: claimed.task!.depth === "deep"
                ? DEEP_RECONCILE_MAX_AGE_DAYS
                : RECENT_RECONCILE_MAX_AGE_DAYS
            }
          );
        })
      );

      const latest = await this.loadStoredState();
      const task = latest.state.current?.key === claimed.task.key
        ? latest.state.current
        : claimed.task;
      const progressedTask = updateBackfillRemaining(
        updateTaskCursor(
          mergeTaskTotals(task, {
            attemptCount: 1,
            pagesFetched: execution.pagesFetched,
            postsSeen: execution.postsSeen,
            postsStored: execution.postsStored,
            postsDeleted: execution.postsDeleted
          }),
          execution.nextCursor
        ),
        execution.processedRecords
      );
      const finishedAt = Date.now();

      await this.runEffect(
        Effect.gen(function* () {
          const items = yield* IngestRunItemsRepo;

          yield* Effect.forEach(
            progressedTask.runIds,
            (runId) =>
              items.markProgress({
                runId,
                did,
                mode: taskMode(progressedTask),
                attemptCount: progressedTask.totals.attemptCount,
                pagesFetched: progressedTask.totals.pagesFetched,
                postsSeen: progressedTask.totals.postsSeen,
                postsStored: progressedTask.totals.postsStored,
                postsDeleted: progressedTask.totals.postsDeleted,
                lastProgressAt: finishedAt
              }),
            { discard: true }
          );

          if (execution.completed || claimed.task.mode === "head") {
            yield* Effect.forEach(
              progressedTask.runIds,
                (runId) =>
                  items.markComplete({
                    runId,
                    did,
                    mode: taskMode(progressedTask),
                    finishedAt,
                    attemptCount: progressedTask.totals.attemptCount,
                  pagesFetched: progressedTask.totals.pagesFetched,
                  postsSeen: progressedTask.totals.postsSeen,
                  postsStored: progressedTask.totals.postsStored,
                  postsDeleted: progressedTask.totals.postsDeleted
                }),
              { discard: true }
            );
          }
        })
      );

      let nextState: ExpertPollCoordinatorStoredState = {
        did: latest.did,
        state: clearCurrentTask(latest.state)
      };

      if (execution.completed || claimed.task.mode === "head") {
        nextState = {
          ...nextState,
          state: recordCoordinatorCompletion(
            nextState.state,
            progressedTask.runIds[progressedTask.runIds.length - 1]!
          )
        };
      } else {
        nextState = {
          ...nextState,
          state: insertContinuationTask(nextState.state, progressedTask)
        };
      }

      await this.saveStoredState(nextState);
      await this.setAlarmIfPending(nextState);

      await this.runEffect(
        this.logEffect("info", "expert-poll-coordinator-completed-chunk", {
          did,
          runId,
          mode: claimed.task.mode,
          completed: execution.completed || claimed.task.mode === "head",
          pagesFetched: execution.pagesFetched,
          postsSeen: execution.postsSeen,
          postsStored: execution.postsStored,
          postsDeleted: execution.postsDeleted
        }),
        "ExpertPollCoordinatorDo.log:completed"
      );
    } catch (error) {
      const latest = await this.loadStoredState();
      const task = latest.state.current?.key === claimed.task.key
        ? latest.state.current
        : claimed.task;
      const envelope = toIngestErrorEnvelope(error, {
        did,
        runId: task.runIds[0],
        operation: "ExpertPollCoordinatorDo.alarm"
      });
      const finishedAt = Date.now();

      await this.runEffect(
        Effect.gen(function* () {
          const items = yield* IngestRunItemsRepo;

          yield* Effect.forEach(
            task.runIds,
            (runId) =>
              items.markFailed({
                runId,
                did,
                mode: taskMode(task),
                finishedAt,
                error: envelope,
                attemptCount: task.totals.attemptCount + 1,
                pagesFetched: task.totals.pagesFetched,
                postsSeen: task.totals.postsSeen,
                postsStored: task.totals.postsStored,
                postsDeleted: task.totals.postsDeleted
              }),
            { discard: true }
          );
        })
      );

      const nextState: ExpertPollCoordinatorStoredState = {
        did: latest.did,
        state: recordCoordinatorFailure(
          clearCurrentTask(latest.state),
          envelope
        )
      };

      await this.saveStoredState(nextState);
      await this.setAlarmIfPending(nextState);

      await this.runEffect(
        this.logEffect("error", "expert-poll-coordinator-failed", {
          did,
          runId,
          mode: task.mode,
          errorTag: envelope.tag,
          retryable: envelope.retryable
        }),
        "ExpertPollCoordinatorDo.log:failed"
      );
    }
  }
}

/** Transfer-destination class for worker isolation migration.
 *  Shares the same implementation; the separate class name avoids
 *  transferring into the ingest worker's existing ExpertPollCoordinatorDo. */
export class ExpertPollCoordinatorDoIsolated extends ExpertPollCoordinatorDo {}
