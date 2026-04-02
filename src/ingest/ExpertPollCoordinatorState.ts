import { Schema } from "effect";
import { ReconcileDepth as ReconcileDepthSchema } from "../domain/polling";
import type { PollMode, ReconcileDepth } from "../domain/polling";
import {
  IngestErrorEnvelope,
  legacyIngestErrorEnvelope
} from "../domain/errors";
import type { IngestErrorEnvelope as IngestErrorEnvelopeValue } from "../domain/errors";
import { Did } from "../domain/types";
import type { Did as DidValue } from "../domain/types";

const DEFAULT_BACKFILL_TOTAL_POSTS = 300;

const BackfillTaskKey = Schema.String.pipe(Schema.pattern(/^backfill:.+/u));
const ReconcileTaskKey = Schema.String.pipe(
  Schema.pattern(/^reconcile:.+:(recent|deep)$/u)
);

export const TaskTotalsSchema = Schema.Struct({
  attemptCount: Schema.NonNegativeInt,
  pagesFetched: Schema.NonNegativeInt,
  postsSeen: Schema.NonNegativeInt,
  postsStored: Schema.NonNegativeInt,
  postsDeleted: Schema.NonNegativeInt
});
type TaskTotals = Schema.Schema.Type<typeof TaskTotalsSchema>;

const emptyTotals = (): TaskTotals => ({
  attemptCount: 0,
  pagesFetched: 0,
  postsSeen: 0,
  postsStored: 0,
  postsDeleted: 0
});

export const HeadTaskSchema = Schema.Struct({
  key: Schema.Literal("head"),
  mode: Schema.Literal("head"),
  runIds: Schema.Array(Schema.String),
  requestedAt: Schema.NonNegativeInt,
  totals: TaskTotalsSchema
});
export type HeadTask = Schema.Schema.Type<typeof HeadTaskSchema>;

export const BackfillTaskSchema = Schema.Struct({
  key: BackfillTaskKey,
  mode: Schema.Literal("backfill"),
  runIds: Schema.Tuple(Schema.String),
  requestedAt: Schema.NonNegativeInt,
  maxAgeDays: Schema.optionalKey(Schema.NonNegativeInt),
  remainingMaxPosts: Schema.NonNegativeInt,
  totals: TaskTotalsSchema
});
export type BackfillTask = Schema.Schema.Type<typeof BackfillTaskSchema>;

export const ReconcileTaskSchema = Schema.Struct({
  key: ReconcileTaskKey,
  mode: Schema.Literal("reconcile"),
  runIds: Schema.Tuple(Schema.String),
  requestedAt: Schema.NonNegativeInt,
  depth: ReconcileDepthSchema,
  cursor: Schema.NullOr(Schema.String),
  totals: TaskTotalsSchema
});
export type ReconcileTask = Schema.Schema.Type<typeof ReconcileTaskSchema>;

export const CoordinatorTaskSchema = Schema.Union(
  HeadTaskSchema,
  BackfillTaskSchema,
  ReconcileTaskSchema
);
export type CoordinatorTask = Schema.Schema.Type<typeof CoordinatorTaskSchema>;

export const ExpertPollCoordinatorStateSchema = Schema.Struct({
  current: Schema.NullOr(CoordinatorTaskSchema),
  pending: Schema.Array(CoordinatorTaskSchema),
  lastCompletedRunId: Schema.NullOr(Schema.String),
  lastFailure: Schema.NullOr(IngestErrorEnvelope)
});
export type ExpertPollCoordinatorState = Schema.Schema.Type<
  typeof ExpertPollCoordinatorStateSchema
>;

export const ExpertPollCoordinatorStoredStateSchema = Schema.Struct({
  did: Schema.NullOr(Did),
  state: ExpertPollCoordinatorStateSchema
});
export type ExpertPollCoordinatorStoredState = {
  readonly did: DidValue | null;
  readonly state: ExpertPollCoordinatorState;
};

export const ExpertPollCoordinatorStoredStateCompatSchema = Schema.Struct({
  did: Schema.NullOr(Did),
  state: Schema.Struct({
    current: Schema.NullOr(CoordinatorTaskSchema),
    pending: Schema.Array(CoordinatorTaskSchema),
    lastCompletedRunId: Schema.NullOr(Schema.String),
    lastFailure: Schema.NullOr(Schema.Union(IngestErrorEnvelope, Schema.String))
  })
});

type ExpertPollCoordinatorStoredStateCompat = Schema.Schema.Type<
  typeof ExpertPollCoordinatorStoredStateCompatSchema
>;

export const normalizeStoredCoordinatorState = (
  state: ExpertPollCoordinatorStoredStateCompat
): ExpertPollCoordinatorStoredState => ({
  did: state.did,
  state: {
    ...state.state,
    lastFailure: typeof state.state.lastFailure === "string"
      ? legacyIngestErrorEnvelope(state.state.lastFailure)
      : state.state.lastFailure
  }
});

export const EnqueueHeadCoordinatorInputSchema = Schema.Struct({
  did: Did,
  runId: Schema.String
});
export type EnqueueHeadCoordinatorInput = {
  readonly did: DidValue;
  readonly runId: string;
};

export const EnqueueBackfillCoordinatorInputSchema = Schema.Struct({
  did: Did,
  runId: Schema.String,
  maxPosts: Schema.optionalKey(Schema.NonNegativeInt),
  maxAgeDays: Schema.optionalKey(Schema.NonNegativeInt)
});
export type EnqueueBackfillCoordinatorInput = {
  readonly did: DidValue;
  readonly runId: string;
  readonly maxPosts?: number;
  readonly maxAgeDays?: number;
};

export const EnqueueReconcileCoordinatorInputSchema = Schema.Struct({
  did: Did,
  runId: Schema.String,
  depth: Schema.optionalKey(ReconcileDepthSchema)
});
export type EnqueueReconcileCoordinatorInput = {
  readonly did: DidValue;
  readonly runId: string;
  readonly depth?: ReconcileDepth;
};

export const emptyCoordinatorState = (): ExpertPollCoordinatorState => ({
  current: null,
  pending: [],
  lastCompletedRunId: null,
  lastFailure: null
});

const findTask = (
  state: ExpertPollCoordinatorState,
  predicate: (task: CoordinatorTask) => boolean
) => {
  const current = state.current;
  if (current !== null && predicate(current)) {
    return { location: "current" as const, task: current };
  }

  const index = state.pending.findIndex(predicate);
  return index >= 0
    ? { location: "pending" as const, index, task: state.pending[index]! }
    : null;
};

const updateFoundTask = (
  state: ExpertPollCoordinatorState,
  found: ReturnType<typeof findTask>,
  update: (task: CoordinatorTask) => CoordinatorTask
): ExpertPollCoordinatorState => {
  if (found === null) {
    return state;
  }

  if (found.location === "current") {
    return {
      ...state,
      current: update(found.task)
    };
  }

  return {
    ...state,
    pending: state.pending.map((task, index) =>
      index === found.index ? update(task) : task
    )
  };
};

const appendHeadRunId = (task: HeadTask, runId: string): HeadTask =>
  task.runIds.includes(runId)
    ? task
    : {
        ...task,
        runIds: [...task.runIds, runId]
      };

const makeHeadTask = (runId: string, requestedAt: number): HeadTask => ({
  key: "head",
  mode: "head",
  runIds: [runId],
  requestedAt,
  totals: emptyTotals()
});

const makeBackfillTask = (
  runId: string,
  requestedAt: number,
  options: {
    readonly maxPosts?: number;
    readonly maxAgeDays?: number;
  }
): BackfillTask => {
  const task = {
    key: `backfill:${runId}`,
    mode: "backfill",
    runIds: [runId],
    requestedAt,
    remainingMaxPosts: options.maxPosts ?? DEFAULT_BACKFILL_TOTAL_POSTS,
    totals: emptyTotals()
  } satisfies Omit<BackfillTask, "maxAgeDays">;

  return options.maxAgeDays === undefined
    ? task
    : {
        ...task,
        maxAgeDays: options.maxAgeDays
      };
};

const makeReconcileTask = (
  runId: string,
  requestedAt: number,
  depth: ReconcileDepth
): ReconcileTask => ({
  key: `reconcile:${runId}:${depth}`,
  mode: "reconcile",
  runIds: [runId],
  requestedAt,
  depth,
  cursor: null,
  totals: emptyTotals()
});

export const enqueueHeadTask = (
  state: ExpertPollCoordinatorState,
  runId: string,
  requestedAt: number
) => {
  const found = findTask(state, (task) => task.mode === "head");
  if (found !== null) {
    return {
      state: updateFoundTask(state, found, (task) =>
        appendHeadRunId(task as HeadTask, runId)
      ),
      coalesced: true
    };
  }

  return {
    state: {
      ...state,
      pending: [...state.pending, makeHeadTask(runId, requestedAt)]
    },
    coalesced: false
  };
};

export const enqueueBackfillTask = (
  state: ExpertPollCoordinatorState,
  runId: string,
  requestedAt: number,
  options: {
    readonly maxPosts?: number;
    readonly maxAgeDays?: number;
  }
) => {
  const found = findTask(
    state,
    (task) => task.mode === "backfill" && task.runIds[0] === runId
  );
  if (found !== null) {
    return {
      state,
      deduped: true
    };
  }

  return {
    state: {
      ...state,
      pending: [...state.pending, makeBackfillTask(runId, requestedAt, options)]
    },
    deduped: false
  };
};

export const enqueueReconcileTask = (
  state: ExpertPollCoordinatorState,
  runId: string,
  requestedAt: number,
  depth: ReconcileDepth
) => {
  const found = findTask(
    state,
    (task) =>
      task.mode === "reconcile" &&
      task.runIds[0] === runId &&
      task.depth === depth
  );
  if (found !== null) {
    return {
      state,
      deduped: true
    };
  }

  return {
    state: {
      ...state,
      pending: [...state.pending, makeReconcileTask(runId, requestedAt, depth)]
    },
    deduped: false
  };
};

export const takeNextTask = (state: ExpertPollCoordinatorState) => {
  if (state.current !== null || state.pending.length === 0) {
    return {
      state,
      task: null
    };
  }

  const [task, ...pending] = state.pending;
  return {
    state: {
      ...state,
      current: task!,
      pending
    },
    task: task!
  };
};

export const clearCurrentTask = (state: ExpertPollCoordinatorState) => ({
  ...state,
  current: null
});

export const insertContinuationTask = (
  state: ExpertPollCoordinatorState,
  task: CoordinatorTask
) => {
  const headCount = state.pending.findIndex((pending) => pending.mode !== "head");
  const insertAt = headCount === -1 ? state.pending.length : headCount;

  return {
    ...state,
    pending: [
      ...state.pending.slice(0, insertAt),
      task,
      ...state.pending.slice(insertAt)
    ]
  };
};

export const withUpdatedCurrentTask = (
  state: ExpertPollCoordinatorState,
  update: (task: CoordinatorTask) => CoordinatorTask
) =>
  state.current === null
    ? state
    : {
        ...state,
        current: update(state.current)
      };

export const recordCoordinatorFailure = (
  state: ExpertPollCoordinatorState,
  error: IngestErrorEnvelopeValue
) => ({
  ...state,
  current: null,
  lastFailure: error
});

export const recordCoordinatorCompletion = (
  state: ExpertPollCoordinatorState,
  runId: string
) => ({
  ...state,
  current: null,
  lastCompletedRunId: runId
});

export const mergeTaskTotals = (
  task: CoordinatorTask,
  result: {
    readonly attemptCount: number;
    readonly pagesFetched: number;
    readonly postsSeen: number;
    readonly postsStored: number;
    readonly postsDeleted: number;
  }
): CoordinatorTask => ({
  ...task,
  totals: {
    attemptCount: task.totals.attemptCount + result.attemptCount,
    pagesFetched: task.totals.pagesFetched + result.pagesFetched,
    postsSeen: task.totals.postsSeen + result.postsSeen,
    postsStored: task.totals.postsStored + result.postsStored,
    postsDeleted: task.totals.postsDeleted + result.postsDeleted
  }
}) as CoordinatorTask;

export const updateTaskCursor = (
  task: CoordinatorTask,
  cursor: string | null
): CoordinatorTask => {
  if (task.mode !== "reconcile") {
    return task;
  }

  return {
    ...task,
    cursor
  };
};

export const updateBackfillRemaining = (
  task: CoordinatorTask,
  processedRecords: number
): CoordinatorTask => {
  if (task.mode !== "backfill") {
    return task;
  }

  return {
    ...task,
    remainingMaxPosts: Math.max(0, task.remainingMaxPosts - processedRecords)
  };
};

export const isTerminalTask = (task: CoordinatorTask, completed: boolean) =>
  task.mode === "head" ? true : completed;

export const taskMode = (task: CoordinatorTask): PollMode => task.mode;
