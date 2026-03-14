import { Effect } from "effect";
import type { HttpErrorEnvelope } from "../domain/api";
import {
  internalServerError,
  type InternalServerError,
  type NotFoundError,
  serviceUnavailableError,
  type ServiceUnavailableError,
  type UpstreamFailureError,
  upstreamFailureError
} from "../domain/api";
import { stringifyUnknown } from "../platform/Json";

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const httpErrorKinds = new Set([
  "BadRequest",
  "Unauthorized",
  "Forbidden",
  "NotFound",
  "Conflict",
  "UpstreamFailure",
  "ServiceUnavailable",
  "InternalServerError"
] as const);

export const isTaggedError = (
  error: unknown,
  tag: string
): error is { readonly _tag: string } =>
  isObject(error) &&
  typeof error._tag === "string" &&
  error._tag === tag;

export const getStringField = (value: unknown, key: string) =>
  isObject(value) && typeof value[key] === "string"
    ? value[key]
    : undefined;

const getErrorTag = (error: unknown) => {
  if (isObject(error) && typeof error.error === "string") {
    return error.error;
  }

  return getStringField(error, "_tag");
};

export const isHttpEnvelope = (
  error: unknown
): error is HttpErrorEnvelope =>
  isObject(error) &&
  typeof error.error === "string" &&
  httpErrorKinds.has(error.error as HttpErrorEnvelope["error"]) &&
  typeof error.message === "string";

const sanitizeInternalEnvelope = (
  error: InternalServerError
): InternalServerError =>
  internalServerError("internal error", error.retryable);

const passThroughEnvelope = (
  error: HttpErrorEnvelope
): HttpErrorEnvelope =>
  error.error === "InternalServerError"
    ? sanitizeInternalEnvelope(error)
    : error;

export type HttpErrorMappingOptions = {
  readonly route: string;
  readonly operation?: string;
  readonly classify?: (
    error: unknown
  ) =>
    | HttpErrorEnvelope
    | NotFoundError
    | UpstreamFailureError
    | ServiceUnavailableError
    | undefined;
  readonly internalMessage?: string;
};

export const mapHttpError = (
  error: unknown,
  options: HttpErrorMappingOptions
): HttpErrorEnvelope => {
  if (isHttpEnvelope(error)) {
    return passThroughEnvelope(error);
  }

  const classified = options.classify?.(error);
  if (classified !== undefined) {
    return passThroughEnvelope(classified);
  }

  return internalServerError(
    options.internalMessage ?? "internal error"
  );
};

const getLogAnnotation = (value: string | undefined) =>
  value ?? "unknown";

export const logHttpFailure = (
  error: unknown,
  options: HttpErrorMappingOptions
) =>
  Effect.logError("http request failed").pipe(
    Effect.annotateLogs({
      route: options.route,
      operation: getLogAnnotation(
        options.operation ?? getStringField(error, "operation")
      ),
      did: getLogAnnotation(getStringField(error, "did")),
      runId: getLogAnnotation(getStringField(error, "runId")),
      errorTag: getLogAnnotation(getErrorTag(error)),
      errorMessage: stringifyUnknown(error)
    })
  );

export const withHttpErrorMapping = <A, R>(
  effect: Effect.Effect<A, unknown, R>,
  options: HttpErrorMappingOptions
) =>
  effect.pipe(
    Effect.tapError((error) => logHttpFailure(error, options)),
    Effect.mapError((error) => mapHttpError(error, options))
  );

export const toUpstreamFailure = (
  message = "upstream request failed"
) =>
  (error: unknown): UpstreamFailureError | undefined =>
    isTaggedError(error, "HandleResolutionError") ||
      isTaggedError(error, "ProfileLookupError") ||
      isTaggedError(error, "BlueskyApiError")
      ? upstreamFailureError(message, true)
      : undefined;

export const toWorkflowLaunchUnavailable = (
  error: unknown
): ServiceUnavailableError | undefined =>
  isTaggedError(error, "IngestWorkflowLaunchError")
    ? serviceUnavailableError("failed to launch ingest workflow", true)
    : undefined;
