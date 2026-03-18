import { Either, Schema } from "effect";
import { CandidatePayloadStage } from "./candidatePayload";
import { AtUri, Did } from "./types";
import {
  decodeJsonStringEitherWith,
  encodeJsonStringWith
} from "../platform/Json";

export class BlueskyApiError extends Schema.TaggedError<BlueskyApiError>()(
  "BlueskyApiError",
  {
    message: Schema.String,
    status: Schema.optional(Schema.Number)
  }
) {}

export class DbError extends Schema.TaggedError<DbError>()("DbError", {
  message: Schema.String
}) {}

export class IngestRunNotFoundError extends Schema.TaggedError<IngestRunNotFoundError>()(
  "IngestRunNotFoundError",
  {
    runId: Schema.String
  }
) {}

export class EnrichmentRunNotFoundError extends Schema.TaggedError<EnrichmentRunNotFoundError>()(
  "EnrichmentRunNotFoundError",
  {
    runId: Schema.String
  }
) {}

export class EnrichmentPayloadMissingError extends Schema.TaggedError<EnrichmentPayloadMissingError>()(
  "EnrichmentPayloadMissingError",
  {
    postUri: AtUri
  }
) {}

export class EnrichmentPostContextMissingError extends Schema.TaggedError<EnrichmentPostContextMissingError>()(
  "EnrichmentPostContextMissingError",
  {
    postUri: AtUri
  }
) {}

export class EnrichmentPayloadNotPickedError extends Schema.TaggedError<EnrichmentPayloadNotPickedError>()(
  "EnrichmentPayloadNotPickedError",
  {
    postUri: AtUri,
    captureStage: CandidatePayloadStage
  }
) {}

export class IngestSchemaDecodeError extends Schema.TaggedError<IngestSchemaDecodeError>()(
  "IngestSchemaDecodeError",
  {
    message: Schema.String,
    operation: Schema.optional(Schema.String)
  }
) {}

export class IngestWorkflowLaunchError extends Schema.TaggedError<IngestWorkflowLaunchError>()(
  "IngestWorkflowLaunchError",
  {
    message: Schema.String,
    operation: Schema.String
  }
) {}

export class EnrichmentSchemaDecodeError extends Schema.TaggedError<EnrichmentSchemaDecodeError>()(
  "EnrichmentSchemaDecodeError",
  {
    message: Schema.String,
    operation: Schema.optional(Schema.String)
  }
) {}

export class EnrichmentWorkflowLaunchError extends Schema.TaggedError<EnrichmentWorkflowLaunchError>()(
  "EnrichmentWorkflowLaunchError",
  {
    message: Schema.String,
    operation: Schema.String
  }
) {}

export class IngestBoundaryError extends Schema.TaggedError<IngestBoundaryError>()(
  "IngestBoundaryError",
  {
    message: Schema.String,
    operation: Schema.optional(Schema.String)
  }
) {}

export class WorkflowRunCompensationError extends Schema.TaggedError<WorkflowRunCompensationError>()(
  "WorkflowRunCompensationError",
  {
    message: Schema.String,
    runId: Schema.String,
    operation: Schema.String
  }
) {}

export class StaleDispatchedIngestItemError extends Schema.TaggedError<StaleDispatchedIngestItemError>()(
  "StaleDispatchedIngestItemError",
  {
    message: Schema.String,
    did: Did,
    runId: Schema.String,
    operation: Schema.String
  }
) {}

export class StaleRunningIngestItemError extends Schema.TaggedError<StaleRunningIngestItemError>()(
  "StaleRunningIngestItemError",
  {
    message: Schema.String,
    did: Did,
    runId: Schema.String,
    operation: Schema.String
  }
) {}

export class HistoricalRunRepairError extends Schema.TaggedError<HistoricalRunRepairError>()(
  "HistoricalRunRepairError",
  {
    message: Schema.String,
    runId: Schema.String,
    did: Schema.optional(Did),
    operation: Schema.String
  }
) {}

export class GeminiApiError extends Schema.TaggedError<GeminiApiError>()(
  "GeminiApiError",
  {
    message: Schema.String,
    status: Schema.optional(Schema.Number)
  }
) {}

export class GeminiParseError extends Schema.TaggedError<GeminiParseError>()(
  "GeminiParseError",
  {
    message: Schema.String,
    rawOutput: Schema.optional(Schema.String)
  }
) {}

export const IngestErrorEnvelope = Schema.Struct({
  tag: Schema.String.pipe(Schema.minLength(1)),
  message: Schema.String,
  retryable: Schema.Boolean,
  status: Schema.optional(Schema.Number),
  did: Schema.optional(Did),
  runId: Schema.optional(Schema.String),
  operation: Schema.optional(Schema.String)
});
export type IngestErrorEnvelope = Schema.Schema.Type<typeof IngestErrorEnvelope>;

export const IngestErrorResponse = Schema.Struct({
  error: Schema.String.pipe(Schema.minLength(1)),
  message: Schema.String,
  retryable: Schema.optional(Schema.Boolean),
  status: Schema.optional(Schema.Number),
  did: Schema.optional(Did),
  runId: Schema.optional(Schema.String)
});
export type IngestErrorResponse = Schema.Schema.Type<typeof IngestErrorResponse>;

export const EnrichmentErrorEnvelope = Schema.Struct({
  tag: Schema.String.pipe(Schema.minLength(1)),
  message: Schema.String,
  retryable: Schema.Boolean,
  status: Schema.optional(Schema.Number),
  runId: Schema.optional(Schema.String),
  operation: Schema.optional(Schema.String)
});
export type EnrichmentErrorEnvelope = Schema.Schema.Type<
  typeof EnrichmentErrorEnvelope
>;

const decodeEnvelope = Schema.decodeUnknownEither(IngestErrorEnvelope);
const encodeEnvelope = encodeJsonStringWith(IngestErrorEnvelope);
const decodeEnvelopeJson = decodeJsonStringEitherWith(IngestErrorEnvelope);
const decodeEnrichmentEnvelope = Schema.decodeUnknownEither(EnrichmentErrorEnvelope);
const encodeEnrichmentEnvelope = encodeJsonStringWith(EnrichmentErrorEnvelope);
const decodeEnrichmentEnvelopeJson = decodeJsonStringEitherWith(EnrichmentErrorEnvelope);

const isTagged = (
  error: unknown,
  tag: string
): error is { readonly _tag: string } =>
  typeof error === "object" &&
  error !== null &&
  "_tag" in error &&
  error._tag === tag;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const getStringField = (value: unknown, key: string) =>
  isObject(value) && typeof value[key] === "string"
    ? value[key]
    : undefined;

const getNumberField = (value: unknown, key: string) =>
  isObject(value) && typeof value[key] === "number"
    ? value[key]
    : undefined;

const isRetryableStatus = (status: number | undefined) =>
  status === 429 || (status !== undefined && status >= 500 && status < 600);

export const legacyIngestErrorEnvelope = (message: string): IngestErrorEnvelope => ({
  tag: "LegacyError",
  message,
  retryable: false
});

export const legacyEnrichmentErrorEnvelope = (
  message: string
): EnrichmentErrorEnvelope => ({
  tag: "LegacyError",
  message,
  retryable: false
});

export const sanitizeIngestErrorEnvelope = (
  envelope: IngestErrorEnvelope
): IngestErrorEnvelope => {
  switch (envelope.tag) {
    case "BlueskyApiError":
      return {
        ...envelope,
        message: "Bluesky API request failed"
      };
    case "IngestRunNotFoundError":
    case "ExpertNotFoundError":
    case "LegacyError":
      return envelope;
    case "IngestSchemaDecodeError":
      return {
        ...envelope,
        message: "invalid ingest input"
      };
    case "IngestWorkflowLaunchError":
      return {
        ...envelope,
        message: "failed to launch ingest workflow"
      };
    case "IngestBoundaryError":
      return {
        ...envelope,
        message: "unexpected ingest boundary failure"
      };
    case "WorkflowRunCompensationError":
      return {
        ...envelope,
        message: "workflow failed before run state could converge"
      };
    case "StaleDispatchedIngestItemError":
      return {
        ...envelope,
        message: "stale dispatched ingest item was requeued"
      };
    case "StaleRunningIngestItemError":
      return {
        ...envelope,
        message: "stale running ingest item was failed"
      };
    case "HistoricalRunRepairError":
      return {
        ...envelope,
        message: "historical run required repair"
      };
    case "EnvError":
      return {
        ...envelope,
        message: "missing worker binding"
      };
    case "DbError":
    case "SqlError":
      return {
        ...envelope,
        message: "database operation failed"
      };
    default:
      return {
        ...envelope,
        message: "internal ingest failure"
      };
  }
};

export const encodeStoredIngestError = (error: IngestErrorEnvelope | null) =>
  error === null
    ? null
    : encodeEnvelope(sanitizeIngestErrorEnvelope(error));

export const decodeStoredIngestError = (value: string | null) => {
  if (value === null) {
    return null;
  }

  const decoded = decodeEnvelopeJson(value);
  if (Either.isRight(decoded)) {
    return sanitizeIngestErrorEnvelope(decoded.right);
  }

  return legacyIngestErrorEnvelope("legacy ingest failure");
};

export const encodeStoredEnrichmentError = (
  error: EnrichmentErrorEnvelope | null
) =>
  error === null
    ? null
    : encodeEnrichmentEnvelope(error);

export const decodeStoredEnrichmentError = (value: string | null) => {
  if (value === null) {
    return null;
  }

  const decoded = decodeEnrichmentEnvelopeJson(value);
  if (Either.isRight(decoded)) {
    return decoded.right;
  }

  return legacyEnrichmentErrorEnvelope("legacy enrichment failure");
};

export const toIngestErrorEnvelope = (
  error: unknown,
  overrides: {
    readonly did?: string;
    readonly runId?: string;
    readonly operation?: string;
  } = {}
): IngestErrorEnvelope => {
  const withOverrides = (envelope: IngestErrorEnvelope): IngestErrorEnvelope => ({
    ...sanitizeIngestErrorEnvelope({
      ...envelope,
      ...(overrides.did === undefined ? {} : { did: overrides.did as Did }),
      ...(overrides.runId === undefined ? {} : { runId: overrides.runId }),
      ...(overrides.operation === undefined ? {} : { operation: overrides.operation })
    })
  });

  const asEnvelope = decodeEnvelope(error);
  if (Either.isRight(asEnvelope)) {
    return withOverrides(asEnvelope.right);
  }

  if (error instanceof BlueskyApiError || isTagged(error, "BlueskyApiError")) {
    const status = getNumberField(error, "status");
    return withOverrides({
      tag: "BlueskyApiError",
      message: getStringField(error, "message") ?? "Bluesky API request failed",
      retryable: isRetryableStatus(status),
      ...(status === undefined ? {} : { status })
    });
  }

  if (error instanceof IngestRunNotFoundError || isTagged(error, "IngestRunNotFoundError")) {
    const runId = getStringField(error, "runId") ?? overrides.runId;
    return withOverrides({
      tag: "IngestRunNotFoundError",
      message: runId === undefined ? "ingest run not found" : `ingest run not found: ${runId}`,
      retryable: false,
      ...(runId === undefined ? {} : { runId })
    });
  }

  if (error instanceof IngestSchemaDecodeError || isTagged(error, "IngestSchemaDecodeError")) {
    const operation = getStringField(error, "operation") ?? overrides.operation;
    return withOverrides({
      tag: "IngestSchemaDecodeError",
      message: getStringField(error, "message") ?? "invalid ingest input",
      retryable: false,
      ...(operation === undefined ? {} : { operation })
    });
  }

  if (
    error instanceof IngestWorkflowLaunchError ||
    isTagged(error, "IngestWorkflowLaunchError")
  ) {
    const operation = getStringField(error, "operation") ?? overrides.operation;
    return withOverrides({
      tag: "IngestWorkflowLaunchError",
      message: getStringField(error, "message") ?? "failed to launch ingest workflow",
      retryable: true,
      ...(operation === undefined ? {} : { operation })
    });
  }

  if (error instanceof IngestBoundaryError || isTagged(error, "IngestBoundaryError")) {
    const operation = getStringField(error, "operation") ?? overrides.operation;
    return withOverrides({
      tag: "IngestBoundaryError",
      message: getStringField(error, "message") ?? "unexpected ingest boundary failure",
      retryable: false,
      ...(operation === undefined ? {} : { operation })
    });
  }

  if (
    error instanceof WorkflowRunCompensationError ||
    isTagged(error, "WorkflowRunCompensationError")
  ) {
    const runId = getStringField(error, "runId") ?? overrides.runId;
    const operation = getStringField(error, "operation") ?? overrides.operation;
    return withOverrides({
      tag: "WorkflowRunCompensationError",
      message: getStringField(error, "message") ?? "workflow failed before run state could converge",
      retryable: false,
      ...(runId === undefined ? {} : { runId }),
      ...(operation === undefined ? {} : { operation })
    });
  }

  if (
    error instanceof StaleDispatchedIngestItemError ||
    isTagged(error, "StaleDispatchedIngestItemError")
  ) {
    const did = getStringField(error, "did") ?? overrides.did;
    const runId = getStringField(error, "runId") ?? overrides.runId;
    const operation = getStringField(error, "operation") ?? overrides.operation;
    return withOverrides({
      tag: "StaleDispatchedIngestItemError",
      message: getStringField(error, "message") ?? "stale dispatched ingest item was requeued",
      retryable: true,
      ...(did === undefined ? {} : { did: did as Did }),
      ...(runId === undefined ? {} : { runId }),
      ...(operation === undefined ? {} : { operation })
    });
  }

  if (
    error instanceof StaleRunningIngestItemError ||
    isTagged(error, "StaleRunningIngestItemError")
  ) {
    const did = getStringField(error, "did") ?? overrides.did;
    const runId = getStringField(error, "runId") ?? overrides.runId;
    const operation = getStringField(error, "operation") ?? overrides.operation;
    return withOverrides({
      tag: "StaleRunningIngestItemError",
      message: getStringField(error, "message") ?? "stale running ingest item was failed",
      retryable: false,
      ...(did === undefined ? {} : { did: did as Did }),
      ...(runId === undefined ? {} : { runId }),
      ...(operation === undefined ? {} : { operation })
    });
  }

  if (
    error instanceof HistoricalRunRepairError ||
    isTagged(error, "HistoricalRunRepairError")
  ) {
    const did = getStringField(error, "did") ?? overrides.did;
    const runId = getStringField(error, "runId") ?? overrides.runId;
    const operation = getStringField(error, "operation") ?? overrides.operation;
    return withOverrides({
      tag: "HistoricalRunRepairError",
      message: getStringField(error, "message") ?? "historical run required repair",
      retryable: false,
      ...(did === undefined ? {} : { did: did as Did }),
      ...(runId === undefined ? {} : { runId }),
      ...(operation === undefined ? {} : { operation })
    });
  }

  if (isTagged(error, "EnvError")) {
    const missing = getStringField(error, "missing");
    return withOverrides({
      tag: "EnvError",
      message: missing === undefined ? "missing worker binding" : `missing worker binding: ${missing}`,
      retryable: false
    });
  }

  if (isTagged(error, "ExpertNotFoundError")) {
    const did = getStringField(error, "did") ?? overrides.did;
    return withOverrides({
      tag: "ExpertNotFoundError",
      message: did === undefined ? "expert not found" : `expert not found: ${did}`,
      retryable: false,
      ...(did === undefined ? {} : { did: did as Did })
    });
  }

  if (error instanceof DbError || isTagged(error, "DbError")) {
    return withOverrides({
      tag: "DbError",
      message: getStringField(error, "message") ?? "database decode or validation failure",
      retryable: false
    });
  }

  if (isTagged(error, "SqlError")) {
    return withOverrides({
      tag: "SqlError",
      message: getStringField(error, "message") ?? "database operation failed",
      retryable: false
    });
  }

  if (isObject(error) && typeof (error as any)._tag === "string") {
    return withOverrides({
      tag: (error as any)._tag,
      message: getStringField(error, "message") ?? "internal ingest failure",
      retryable: false
    });
  }

  if (error instanceof Error) {
    return withOverrides({
      tag: error.name || "Error",
      message: "internal ingest failure",
      retryable: false,
      ...(getNumberField(error, "status") === undefined ? {} : { status: getNumberField(error, "status")! })
    });
  }

  return withOverrides({
    tag: "UnknownError",
    message: "internal ingest failure",
    retryable: false
  });
};

export const ingestHttpStatusForEnvelope = (envelope: IngestErrorEnvelope): number => {
  switch (envelope.tag) {
    case "ExpertNotFoundError":
    case "IngestRunNotFoundError":
      return 404;
    case "IngestSchemaDecodeError":
      return 400;
    case "BlueskyApiError":
      return 502;
    case "IngestWorkflowLaunchError":
      return 503;
    case "IngestBoundaryError":
    case "WorkflowRunCompensationError":
    case "HistoricalRunRepairError":
    case "DbError":
    case "SqlError":
      return 500;
    default:
      return 500;
  }
};

export const toEnrichmentErrorEnvelope = (
  error: unknown,
  overrides: {
    readonly runId?: string;
    readonly operation?: string;
  } = {}
): EnrichmentErrorEnvelope => {
  const withOverrides = (
    envelope: EnrichmentErrorEnvelope
  ): EnrichmentErrorEnvelope => ({
    ...envelope,
    ...(overrides.runId === undefined ? {} : { runId: overrides.runId }),
    ...(overrides.operation === undefined
      ? {}
      : { operation: overrides.operation })
  });

  const asEnvelope = decodeEnrichmentEnvelope(error);
  if (Either.isRight(asEnvelope)) {
    return withOverrides(asEnvelope.right);
  }

  if (
    error instanceof EnrichmentRunNotFoundError ||
    isTagged(error, "EnrichmentRunNotFoundError")
  ) {
    const runId = getStringField(error, "runId") ?? overrides.runId;
    return withOverrides({
      tag: "EnrichmentRunNotFoundError",
      message:
        runId === undefined
          ? "enrichment run not found"
          : `enrichment run not found: ${runId}`,
      retryable: false,
      ...(runId === undefined ? {} : { runId })
    });
  }

  if (
    error instanceof EnrichmentPayloadMissingError ||
    isTagged(error, "EnrichmentPayloadMissingError")
  ) {
    const postUri = getStringField(error, "postUri");
    return withOverrides({
      tag: "EnrichmentPayloadMissingError",
      message:
        postUri === undefined
          ? "picked payload not found"
          : `picked payload not found: ${postUri}`,
      retryable: false
    });
  }

  if (
    error instanceof EnrichmentPostContextMissingError ||
    isTagged(error, "EnrichmentPostContextMissingError")
  ) {
    const postUri = getStringField(error, "postUri");
    return withOverrides({
      tag: "EnrichmentPostContextMissingError",
      message:
        postUri === undefined
          ? "stored post context not found"
          : `stored post context not found: ${postUri}`,
      retryable: false
    });
  }

  if (
    error instanceof EnrichmentPayloadNotPickedError ||
    isTagged(error, "EnrichmentPayloadNotPickedError") ||
    isTagged(error, "CandidatePayloadNotPickedError")
  ) {
    const postUri = getStringField(error, "postUri");
    const captureStage = getStringField(error, "captureStage");
    return withOverrides({
      tag: "EnrichmentPayloadNotPickedError",
      message:
        postUri === undefined
          ? "payload is not yet picked"
          : captureStage === undefined
            ? `payload is not yet picked: ${postUri}`
            : `payload is not yet picked: ${postUri} (${captureStage})`,
      retryable: false
    });
  }

  if (
    error instanceof EnrichmentSchemaDecodeError ||
    isTagged(error, "EnrichmentSchemaDecodeError")
  ) {
    const operation = getStringField(error, "operation") ?? overrides.operation;
    return withOverrides({
      tag: "EnrichmentSchemaDecodeError",
      message: getStringField(error, "message") ?? "invalid enrichment input",
      retryable: false,
      ...(operation === undefined ? {} : { operation })
    });
  }

  if (
    error instanceof EnrichmentWorkflowLaunchError ||
    isTagged(error, "EnrichmentWorkflowLaunchError")
  ) {
    const operation = getStringField(error, "operation") ?? overrides.operation;
    return withOverrides({
      tag: "EnrichmentWorkflowLaunchError",
      message:
        getStringField(error, "message") ?? "failed to launch enrichment workflow",
      retryable: true,
      ...(operation === undefined ? {} : { operation })
    });
  }

  if (error instanceof DbError || isTagged(error, "DbError")) {
    return withOverrides({
      tag: "DbError",
      message: getStringField(error, "message") ?? "database decode or validation failure",
      retryable: false
    });
  }

  if (isTagged(error, "SqlError")) {
    return withOverrides({
      tag: "SqlError",
      message: getStringField(error, "message") ?? "database operation failed",
      retryable: false
    });
  }

  if (isObject(error) && typeof (error as any)._tag === "string") {
    return withOverrides({
      tag: (error as any)._tag,
      message: getStringField(error, "message") ?? "internal enrichment failure",
      retryable: false
    });
  }

  if (error instanceof Error) {
    return withOverrides({
      tag: error.name || "Error",
      message: "internal enrichment failure",
      retryable: false,
      ...(getNumberField(error, "status") === undefined
        ? {}
        : { status: getNumberField(error, "status")! })
    });
  }

  return withOverrides({
    tag: "UnknownError",
    message: "internal enrichment failure",
    retryable: false
  });
};

export const toIngestErrorResponse = (error: unknown): IngestErrorResponse => {
  const envelope = toIngestErrorEnvelope(error);
  return {
    error: envelope.tag,
    message: envelope.message,
    retryable: envelope.retryable,
    ...(envelope.status === undefined ? {} : { status: envelope.status }),
    ...(envelope.did === undefined ? {} : { did: envelope.did }),
    ...(envelope.runId === undefined ? {} : { runId: envelope.runId })
  };
};
