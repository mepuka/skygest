import { Effect } from "effect";
import type { AccessIdentity } from "../auth/AuthService";

type MutationLogValue = string | number | boolean | null | undefined;
export type MutationLogAnnotations = Readonly<Record<string, MutationLogValue>>;

type MutationAuditOptions<A, E> = {
  readonly label: string;
  readonly actor: AccessIdentity;
  readonly action: string;
  readonly annotations?: MutationLogAnnotations;
  readonly onSuccess?: (result: A) => MutationLogAnnotations;
  readonly onFailure?: (error: E) => MutationLogAnnotations;
};

const MISSING_ANNOTATION_VALUE = "<missing>";

const toErrorAnnotations = (error: unknown): MutationLogAnnotations => {
  const result: Record<string, string | number | boolean> = {};

  if (typeof error === "object" && error !== null) {
    if ("_tag" in error && typeof error._tag === "string") {
      result.errorTag = error._tag;
    }

    if ("status" in error && typeof error.status === "number") {
      result.errorStatus = error.status;
    }

    if ("message" in error && typeof error.message === "string" && error.message.length > 0) {
      result.errorMessage = error.message;
    }
  }

  if (error instanceof Error && result.errorMessage === undefined) {
    result.errorMessage = error.message;
  }

  if (result.errorTag === undefined && error instanceof Error) {
    result.errorTag = error.name;
  }

  if (result.errorMessage === undefined) {
    result.errorMessage = String(error);
  }

  return result;
};

const makeAnnotations = (
  actor: AccessIdentity,
  annotations: MutationLogAnnotations
) => {
  const result: Record<string, string | number | boolean> = {};

  for (const [key, value] of Object.entries({
    ...annotations,
    actorSubject: actor.subject ?? MISSING_ANNOTATION_VALUE,
    actorEmail: actor.email ?? MISSING_ANNOTATION_VALUE
  })) {
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      result[key] = value;
    }
  }

  return result;
};

export const logMutationSuccess = (
  label: string,
  actor: AccessIdentity,
  annotations: MutationLogAnnotations
) =>
  Effect.logInfo(label).pipe(
    Effect.annotateLogs(makeAnnotations(actor, {
      ...annotations,
      outcome: "success"
    }))
  );

export const logMutationFailure = (
  label: string,
  actor: AccessIdentity,
  annotations: MutationLogAnnotations,
  error?: unknown
) =>
  Effect.logError(label).pipe(
    Effect.annotateLogs(makeAnnotations(actor, {
      ...annotations,
      ...(error === undefined ? {} : toErrorAnnotations(error)),
      outcome: "failure"
    }))
  );

export const withMutationAudit =
  <A, E, R>({
    label,
    actor,
    action,
    annotations,
    onSuccess,
    onFailure
  }: MutationAuditOptions<A, E>) =>
  (program: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
    program.pipe(
      Effect.tap((result) =>
        logMutationSuccess(label, actor, {
          ...(annotations ?? {}),
          ...(onSuccess === undefined ? {} : onSuccess(result)),
          action
        })
      ),
      Effect.tapError((error) =>
        logMutationFailure(label, actor, {
          ...(annotations ?? {}),
          ...(onFailure === undefined ? {} : onFailure(error)),
          action
        }, error)
      )
    );
