import { Result, Schema } from "effect";
import { CandidatePayloadStage } from "./candidatePayload";
import { ChartAssetId } from "./data-layer/post-ids";
import { DataLayerRegistryDiagnostic } from "./data-layer/registry";
import { DateLike, Did, PostUri, TranscriptR2Key } from "./types";
import {
  decodeJsonStringEitherWith,
  encodeJsonStringWith
} from "../platform/Json";

export class BlueskyApiError extends Schema.TaggedErrorClass<BlueskyApiError>()(
  "BlueskyApiError",
  {
    message: Schema.String,
    status: Schema.optionalKey(Schema.Number)
  }
) {}

export class DbError extends Schema.TaggedErrorClass<DbError>()("DbError", {
  message: Schema.String
}) {}

export class CommandExecutionError extends Schema.TaggedErrorClass<CommandExecutionError>()(
  "CommandExecutionError",
  {
    command: Schema.String,
    message: Schema.String,
    exitCode: Schema.optionalKey(Schema.Number)
  }
) {}

export class SearchDbScriptError extends Schema.TaggedErrorClass<SearchDbScriptError>()(
  "SearchDbScriptError",
  {
    operation: Schema.String,
    message: Schema.String
  }
) {}

export class IngestRunNotFoundError extends Schema.TaggedErrorClass<IngestRunNotFoundError>()(
  "IngestRunNotFoundError",
  {
    runId: Schema.String
  }
) {}

export class EnrichmentRunNotFoundError extends Schema.TaggedErrorClass<EnrichmentRunNotFoundError>()(
  "EnrichmentRunNotFoundError",
  {
    runId: Schema.String
  }
) {}

export class EnrichmentPayloadMissingError extends Schema.TaggedErrorClass<EnrichmentPayloadMissingError>()(
  "EnrichmentPayloadMissingError",
  {
    postUri: PostUri
  }
) {}

export class EnrichmentQualityGateError extends Schema.TaggedErrorClass<EnrichmentQualityGateError>()(
  "EnrichmentQualityGateError",
  {
    postUri: PostUri,
    reason: Schema.String
  }
) {}

export class EnrichmentPostContextMissingError extends Schema.TaggedErrorClass<EnrichmentPostContextMissingError>()(
  "EnrichmentPostContextMissingError",
  {
    postUri: PostUri
  }
) {}

export class EnrichmentPayloadNotPickedError extends Schema.TaggedErrorClass<EnrichmentPayloadNotPickedError>()(
  "EnrichmentPayloadNotPickedError",
  {
    postUri: PostUri,
    captureStage: CandidatePayloadStage
  }
) {}

export class IngestSchemaDecodeError extends Schema.TaggedErrorClass<IngestSchemaDecodeError>()(
  "IngestSchemaDecodeError",
  {
    message: Schema.String,
    operation: Schema.optionalKey(Schema.String)
  }
) {}

export class IngestWorkflowLaunchError extends Schema.TaggedErrorClass<IngestWorkflowLaunchError>()(
  "IngestWorkflowLaunchError",
  {
    message: Schema.String,
    operation: Schema.String
  }
) {}

export class EnrichmentSchemaDecodeError extends Schema.TaggedErrorClass<EnrichmentSchemaDecodeError>()(
  "EnrichmentSchemaDecodeError",
  {
    message: Schema.String,
    operation: Schema.optionalKey(Schema.String)
  }
) {}

export class DataLayerRegistryLoadError extends Schema.TaggedErrorClass<DataLayerRegistryLoadError>()(
  "DataLayerRegistryLoadError",
  {
    message: Schema.String,
    root: Schema.String,
    diagnostic: DataLayerRegistryDiagnostic
  }
) {}

export class InvalidObservationWindowError extends Schema.TaggedErrorClass<InvalidObservationWindowError>()(
  "InvalidObservationWindowError",
  {
    message: Schema.String,
    observedSince: DateLike,
    observedUntil: DateLike
  }
) {}

export class EnrichmentWorkflowLaunchError extends Schema.TaggedErrorClass<EnrichmentWorkflowLaunchError>()(
  "EnrichmentWorkflowLaunchError",
  {
    message: Schema.String,
    operation: Schema.String
  }
) {}

export class EnrichmentWorkflowControlError extends Schema.TaggedErrorClass<EnrichmentWorkflowControlError>()(
  "EnrichmentWorkflowControlError",
  {
    message: Schema.String,
    runId: Schema.String,
    operation: Schema.String
  }
) {}

export class EnrichmentRetryNotAllowedError extends Schema.TaggedErrorClass<EnrichmentRetryNotAllowedError>()(
  "EnrichmentRetryNotAllowedError",
  {
    runId: Schema.String,
    status: Schema.String
  }
) {}

export class HistoricalEnrichmentRepairError extends Schema.TaggedErrorClass<HistoricalEnrichmentRepairError>()(
  "HistoricalEnrichmentRepairError",
  {
    message: Schema.String,
    runId: Schema.String,
    operation: Schema.String
  }
) {}

export class IngestBoundaryError extends Schema.TaggedErrorClass<IngestBoundaryError>()(
  "IngestBoundaryError",
  {
    message: Schema.String,
    operation: Schema.optionalKey(Schema.String)
  }
) {}

export class WorkflowRunCompensationError extends Schema.TaggedErrorClass<WorkflowRunCompensationError>()(
  "WorkflowRunCompensationError",
  {
    message: Schema.String,
    runId: Schema.String,
    operation: Schema.String
  }
) {}

export class StaleDispatchedIngestItemError extends Schema.TaggedErrorClass<StaleDispatchedIngestItemError>()(
  "StaleDispatchedIngestItemError",
  {
    message: Schema.String,
    did: Did,
    runId: Schema.String,
    operation: Schema.String
  }
) {}

export class StaleRunningIngestItemError extends Schema.TaggedErrorClass<StaleRunningIngestItemError>()(
  "StaleRunningIngestItemError",
  {
    message: Schema.String,
    did: Did,
    runId: Schema.String,
    operation: Schema.String
  }
) {}

export class HistoricalRunRepairError extends Schema.TaggedErrorClass<HistoricalRunRepairError>()(
  "HistoricalRunRepairError",
  {
    message: Schema.String,
    runId: Schema.String,
    did: Schema.optionalKey(Did),
    operation: Schema.String
  }
) {}

export class CoordinatorDidMismatchError extends Schema.TaggedErrorClass<CoordinatorDidMismatchError>()(
  "CoordinatorDidMismatchError",
  {
    message: Schema.String,
    expectedDid: Did,
    actualDid: Did
  }
) {}

export class GeminiApiError extends Schema.TaggedErrorClass<GeminiApiError>()(
  "GeminiApiError",
  {
    message: Schema.String,
    status: Schema.optionalKey(Schema.Number)
  }
) {}

export class GeminiParseError extends Schema.TaggedErrorClass<GeminiParseError>()(
  "GeminiParseError",
  {
    message: Schema.String,
    rawOutput: Schema.optionalKey(Schema.String)
  }
) {}

export class EnrichmentAssetFetchError extends Schema.TaggedErrorClass<EnrichmentAssetFetchError>()(
  "EnrichmentAssetFetchError",
  {
    assetKey: ChartAssetId,
    message: Schema.String,
    status: Schema.optionalKey(Schema.Number),
    operation: Schema.String
  }
) {}

export class TranscriptStorageError extends Schema.TaggedErrorClass<TranscriptStorageError>()(
  "TranscriptStorageError",
  {
    operation: Schema.String,
    message: Schema.String,
    key: Schema.optionalKey(TranscriptR2Key)
  }
) {}

export class TranscriptNotFoundError extends Schema.TaggedErrorClass<TranscriptNotFoundError>()(
  "TranscriptNotFoundError",
  {
    key: TranscriptR2Key
  }
) {}

export class PodcastStorageCoordinationError extends Schema.TaggedErrorClass<PodcastStorageCoordinationError>()(
  "PodcastStorageCoordinationError",
  {
    operation: Schema.String,
    message: Schema.String,
    transcriptKey: Schema.optionalKey(TranscriptR2Key)
  }
) {}

export class EnrichmentDependencyPendingError extends Schema.TaggedErrorClass<EnrichmentDependencyPendingError>()(
  "EnrichmentDependencyPendingError",
  {
    dependency: Schema.String,
    postUri: Schema.optionalKey(PostUri),
    operation: Schema.optionalKey(Schema.String)
  }
) {}

export class ResolverSourceAttributionMissingError extends Schema.TaggedErrorClass<ResolverSourceAttributionMissingError>()(
  "ResolverSourceAttributionMissingError",
  {
    postUri: PostUri
  }
) {}

export class OntologyDecodeError extends Schema.TaggedErrorClass<OntologyDecodeError>()(
  "OntologyDecodeError",
  {
    source: Schema.String,
    path: Schema.String,
    message: Schema.String
  }
) {}

export class VocabularyLoadError extends Schema.TaggedErrorClass<VocabularyLoadError>()(
  "VocabularyLoadError",
  {
    facet: Schema.String,
    path: Schema.String,
    issues: Schema.Array(Schema.String)
  }
) {}

export class VocabularyCollisionError extends Schema.TaggedErrorClass<VocabularyCollisionError>()(
  "VocabularyCollisionError",
  {
    facet: Schema.String,
    normalizedSurfaceForm: Schema.String,
    canonicalA: Schema.String,
    canonicalB: Schema.String
  }
) {}

export class EnergyProfileManifestLoadError extends Schema.TaggedErrorClass<EnergyProfileManifestLoadError>()(
  "EnergyProfileManifestLoadError",
  {
    message: Schema.String,
    path: Schema.String,
    issues: Schema.Array(Schema.String)
  }
) {}

export class EnergyProfilePipelineError extends Schema.TaggedErrorClass<EnergyProfilePipelineError>()(
  "EnergyProfilePipelineError",
  {
    operation: Schema.String,
    path: Schema.String,
    message: Schema.String
  }
) {}

export class DataLayerSpineManifestLoadError extends Schema.TaggedErrorClass<DataLayerSpineManifestLoadError>()(
  "DataLayerSpineManifestLoadError",
  {
    message: Schema.String,
    path: Schema.String,
    issues: Schema.Array(Schema.String)
  }
) {}

export class DataLayerSpineGenerationError extends Schema.TaggedErrorClass<DataLayerSpineGenerationError>()(
  "DataLayerSpineGenerationError",
  {
    operation: Schema.String,
    path: Schema.String,
    message: Schema.String
  }
) {}

export class GitSnapshotFetchError extends Schema.TaggedErrorClass<GitSnapshotFetchError>()(
  "GitSnapshotFetchError",
  {
    operation: Schema.String,
    message: Schema.String,
    path: Schema.optionalKey(Schema.String),
    repo: Schema.optionalKey(Schema.String),
    commit: Schema.optionalKey(Schema.String)
  }
) {}

export class SeriesDatasetAuditIoError extends Schema.TaggedErrorClass<SeriesDatasetAuditIoError>()(
  "SeriesDatasetAuditIoError",
  {
    operation: Schema.String,
    path: Schema.String,
    message: Schema.String
  }
) {}

export class SeriesDatasetAuditDecodeError extends Schema.TaggedErrorClass<SeriesDatasetAuditDecodeError>()(
  "SeriesDatasetAuditDecodeError",
  {
    path: Schema.String,
    message: Schema.String,
    issues: Schema.Array(Schema.String)
  }
) {}

export class AiSearchError extends Schema.TaggedErrorClass<AiSearchError>()(
  "AiSearchError",
  {
    operation: Schema.Literals(["upload", "search", "get", "delete"]),
    instance: Schema.String,
    message: Schema.String,
    status: Schema.optionalKey(Schema.Number),
    key: Schema.optionalKey(Schema.String)
  }
) {}

export class RdfMappingError extends Schema.TaggedErrorClass<RdfMappingError>()(
  "RdfMappingError",
  {
    direction: Schema.Literals(["forward", "reverse"]),
    entity: Schema.String,
    iri: Schema.optionalKey(Schema.String),
    message: Schema.String
  }
) {}

export class FacetDecompositionError extends Schema.TaggedErrorClass<FacetDecompositionError>()(
  "FacetDecompositionError",
  {
    postUri: PostUri,
    lane: Schema.optionalKey(
      Schema.Literals([
        "shared-evidence",
        "item-evidence",
        "item-bind",
        "agent-narrowing"
      ])
    ),
    facet: Schema.optionalKey(Schema.String),
    reason: Schema.String
  }
) {}

export const PartialVariableFacetConflict = Schema.Struct({
  facet: Schema.String,
  values: Schema.Tuple([Schema.String, Schema.String])
});
export type PartialVariableFacetConflict = Schema.Schema.Type<
  typeof PartialVariableFacetConflict
>;

export class PartialVariableJoinConflictError extends Schema.TaggedErrorClass<PartialVariableJoinConflictError>()(
  "PartialVariableJoinConflictError",
  {
    message: Schema.String,
    conflicts: Schema.Array(PartialVariableFacetConflict)
  }
) {}

export class ResolverWorkflowLaunchError extends Schema.TaggedErrorClass<ResolverWorkflowLaunchError>()(
  "ResolverWorkflowLaunchError",
  {
    message: Schema.String,
    operation: Schema.String
  }
) {}

export class ResolverClientError extends Schema.TaggedErrorClass<ResolverClientError>()(
  "ResolverClientError",
  {
    message: Schema.String,
    status: Schema.Number,
    postUri: Schema.optionalKey(PostUri),
    operation: Schema.optionalKey(Schema.String)
  }
) {}

export const IngestErrorEnvelope = Schema.Struct({
  tag: Schema.String.pipe(Schema.check(Schema.isMinLength(1))),
  message: Schema.String,
  retryable: Schema.Boolean,
  status: Schema.optionalKey(Schema.Number),
  did: Schema.optionalKey(Did),
  runId: Schema.optionalKey(Schema.String),
  operation: Schema.optionalKey(Schema.String),
  detail: Schema.optionalKey(Schema.String)
});
export type IngestErrorEnvelope = Schema.Schema.Type<typeof IngestErrorEnvelope>;

export const IngestErrorResponse = Schema.Struct({
  error: Schema.String.pipe(Schema.check(Schema.isMinLength(1))),
  message: Schema.String,
  retryable: Schema.optionalKey(Schema.Boolean),
  status: Schema.optionalKey(Schema.Number),
  did: Schema.optionalKey(Did),
  runId: Schema.optionalKey(Schema.String)
});
export type IngestErrorResponse = Schema.Schema.Type<typeof IngestErrorResponse>;

export const EnrichmentErrorEnvelope = Schema.Struct({
  tag: Schema.String.pipe(Schema.check(Schema.isMinLength(1))),
  message: Schema.String,
  retryable: Schema.Boolean,
  status: Schema.optionalKey(Schema.Number),
  runId: Schema.optionalKey(Schema.String),
  operation: Schema.optionalKey(Schema.String),
  detail: Schema.optionalKey(Schema.String)
});
export type EnrichmentErrorEnvelope = Schema.Schema.Type<
  typeof EnrichmentErrorEnvelope
>;

const decodeEnvelope = Schema.decodeUnknownResult(IngestErrorEnvelope);
const encodeEnvelope = encodeJsonStringWith(IngestErrorEnvelope);
const decodeEnvelopeJson = decodeJsonStringEitherWith(IngestErrorEnvelope);
const decodeEnrichmentEnvelope = Schema.decodeUnknownResult(EnrichmentErrorEnvelope);
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

const extractSqlErrorDetail = (error: unknown): string | undefined => {
  if (!isObject(error)) return undefined;
  const msg = getStringField(error, "message");
  const reason = isObject((error as any).reason) ? (error as any).reason : undefined;
  if (reason) {
    const reasonMsg = getStringField(reason, "message");
    const causeMsg = reason.cause instanceof Error ? reason.cause.message : undefined;
    return reasonMsg ?? causeMsg ?? msg;
  }
  const cause = (error as any).cause;
  if (cause instanceof Error) return cause.message;
  return msg;
};

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
      return {
        ...envelope,
        message: "database operation failed"
      };
    case "SqlError":
      return envelope;
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
  if (Result.isSuccess(decoded)) {
    return sanitizeIngestErrorEnvelope(decoded.success);
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
  if (Result.isSuccess(decoded)) {
    return decoded.success;
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
  if (Result.isSuccess(asEnvelope)) {
    return withOverrides(asEnvelope.success);
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

  if (
    error instanceof CoordinatorDidMismatchError ||
    isTagged(error, "CoordinatorDidMismatchError")
  ) {
    const actualDid = getStringField(error, "actualDid") ?? overrides.did;
    return withOverrides({
      tag: "CoordinatorDidMismatchError",
      message: getStringField(error, "message") ?? "coordinator did mismatch",
      retryable: false,
      ...(actualDid === undefined ? {} : { did: actualDid as Did })
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
    const detail = extractSqlErrorDetail(error);
    return withOverrides({
      tag: "SqlError",
      message: getStringField(error, "message") ?? "database operation failed",
      retryable: false,
      ...(detail ? { detail } : {})
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
    case "CoordinatorDidMismatchError":
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
  if (Result.isSuccess(asEnvelope)) {
    return withOverrides(asEnvelope.success);
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

  if (
    error instanceof EnrichmentWorkflowControlError ||
    isTagged(error, "EnrichmentWorkflowControlError")
  ) {
    const runId = getStringField(error, "runId") ?? overrides.runId;
    const operation = getStringField(error, "operation") ?? overrides.operation;
    return withOverrides({
      tag: "EnrichmentWorkflowControlError",
      message:
        getStringField(error, "message") ?? "failed to control enrichment workflow",
      retryable: true,
      ...(runId === undefined ? {} : { runId }),
      ...(operation === undefined ? {} : { operation })
    });
  }

  if (
    error instanceof EnrichmentRetryNotAllowedError ||
    isTagged(error, "EnrichmentRetryNotAllowedError")
  ) {
    const runId = getStringField(error, "runId") ?? overrides.runId;
    const status = getStringField(error, "status");
    return withOverrides({
      tag: "EnrichmentRetryNotAllowedError",
      message:
        runId === undefined
          ? "enrichment retry not allowed"
          : status === undefined
            ? `enrichment retry not allowed: ${runId}`
            : `enrichment retry not allowed: ${runId} (${status})`,
      retryable: false,
      ...(runId === undefined ? {} : { runId })
    });
  }

  if (
    error instanceof HistoricalEnrichmentRepairError ||
    isTagged(error, "HistoricalEnrichmentRepairError")
  ) {
    const runId = getStringField(error, "runId") ?? overrides.runId;
    const operation = getStringField(error, "operation") ?? overrides.operation;
    return withOverrides({
      tag: "HistoricalEnrichmentRepairError",
      message:
        getStringField(error, "message") ?? "historical enrichment run required repair",
      retryable: false,
      ...(runId === undefined ? {} : { runId }),
      ...(operation === undefined ? {} : { operation })
    });
  }

  if (error instanceof GeminiApiError || isTagged(error, "GeminiApiError")) {
    const status = getNumberField(error, "status");
    return withOverrides({
      tag: "GeminiApiError",
      message: getStringField(error, "message") ?? "Gemini API request failed",
      retryable: isRetryableStatus(status),
      ...(status === undefined ? {} : { status })
    });
  }

  if (error instanceof GeminiParseError || isTagged(error, "GeminiParseError")) {
    return withOverrides({
      tag: "GeminiParseError",
      message: getStringField(error, "message") ?? "Gemini response could not be parsed",
      retryable: false
    });
  }

  if (
    error instanceof EnrichmentAssetFetchError ||
    isTagged(error, "EnrichmentAssetFetchError")
  ) {
    const status = getNumberField(error, "status");
    const operation = getStringField(error, "operation") ?? overrides.operation;
    return withOverrides({
      tag: "EnrichmentAssetFetchError",
      message: getStringField(error, "message") ?? "failed to fetch enrichment asset",
      retryable: isRetryableStatus(status),
      ...(status === undefined ? {} : { status }),
      ...(operation === undefined ? {} : { operation })
    });
  }

  if (
    error instanceof EnrichmentDependencyPendingError ||
    isTagged(error, "EnrichmentDependencyPendingError")
  ) {
    const dependency = getStringField(error, "dependency") ?? "dependency";
    const postUri = getStringField(error, "postUri");
    const operation = getStringField(error, "operation") ?? overrides.operation;
    return withOverrides({
      tag: "EnrichmentDependencyPendingError",
      message:
        postUri === undefined
          ? `${dependency} enrichment is not ready yet`
          : `${dependency} enrichment is not ready yet for ${postUri}`,
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
    const detail = extractSqlErrorDetail(error);
    return withOverrides({
      tag: "SqlError",
      message: getStringField(error, "message") ?? "database operation failed",
      retryable: false,
      ...(detail ? { detail } : {})
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
