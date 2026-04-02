import { describe, expect, it } from "@effect/vitest";
import {
  BlueskyApiError,
  DbError,
  HistoricalRunRepairError,
  IngestBoundaryError,
  IngestRunNotFoundError,
  IngestSchemaDecodeError,
  IngestWorkflowLaunchError,
  StaleDispatchedIngestItemError,
  StaleRunningIngestItemError,
  WorkflowRunCompensationError,
  decodeStoredIngestError,
  encodeStoredIngestError,
  ingestHttpStatusForEnvelope,
  toIngestErrorEnvelope,
  toIngestErrorResponse
} from "../src/domain/errors";
import type { Did } from "../src/domain/types";

const did = "did:plc:expert-a" as Did;

describe("ingest error envelopes", () => {
  it("round-trips structured envelopes through D1 text storage", () => {
    const envelope = toIngestErrorEnvelope(
      new IngestWorkflowLaunchError({
        message: "workflow create failed",
        operation: "IngestWorkflowLauncher.start"
      }),
      {
        did,
        runId: "run-1"
      }
    );

    expect(decodeStoredIngestError(encodeStoredIngestError(envelope))).toEqual(envelope);
  });

  it("normalizes legacy plain-text failures without a migration", () => {
    expect(decodeStoredIngestError("legacy failure text")).toEqual({
      tag: "LegacyError",
      message: "legacy ingest failure",
      retryable: false
    });
  });

  it("maps envelopes to the admin HTTP error contract", () => {
    const response = toIngestErrorResponse(
      new IngestWorkflowLaunchError({
        message: "workflow create failed",
        operation: "IngestWorkflowLauncher.start"
      })
    );

    expect(response).toEqual({
      error: "IngestWorkflowLaunchError",
      message: "failed to launch ingest workflow",
      retryable: true
    });
  });
});

describe("toIngestErrorEnvelope domain error classification", () => {
  it("DbError => non-retryable", () => {
    const envelope = toIngestErrorEnvelope(
      new DbError({ message: "decode failed" })
    );
    expect(envelope.tag).toBe("DbError");
    expect(envelope.retryable).toBe(false);
    expect(envelope.message).toBe("database operation failed");
  });

  it("SqlError (duck-typed) => non-retryable", () => {
    const envelope = toIngestErrorEnvelope({
      _tag: "SqlError",
      message: "D1 execution failed"
    });
    expect(envelope.tag).toBe("SqlError");
    expect(envelope.retryable).toBe(false);
    expect(envelope.message).toBe("database operation failed");
  });

  it("BlueskyApiError with 429 => retryable", () => {
    const envelope = toIngestErrorEnvelope(
      new BlueskyApiError({ message: "rate limited", status: 429 })
    );
    expect(envelope.tag).toBe("BlueskyApiError");
    expect(envelope.retryable).toBe(true);
    expect(envelope.status).toBe(429);
    expect(envelope.message).toBe("Bluesky API request failed");
  });

  it("BlueskyApiError with 404 => non-retryable", () => {
    const envelope = toIngestErrorEnvelope(
      new BlueskyApiError({ message: "not found", status: 404 })
    );
    expect(envelope.tag).toBe("BlueskyApiError");
    expect(envelope.retryable).toBe(false);
    expect(envelope.status).toBe(404);
    expect(envelope.message).toBe("Bluesky API request failed");
  });

  it("BlueskyApiError without status => non-retryable", () => {
    const envelope = toIngestErrorEnvelope(
      new BlueskyApiError({ message: "parse failure" })
    );
    expect(envelope.tag).toBe("BlueskyApiError");
    expect(envelope.retryable).toBe(false);
    expect(envelope.status).toBeUndefined();
    expect(envelope.message).toBe("Bluesky API request failed");
  });

  it("IngestRunNotFoundError", () => {
    const envelope = toIngestErrorEnvelope(
      new IngestRunNotFoundError({ runId: "run-42" })
    );
    expect(envelope.tag).toBe("IngestRunNotFoundError");
    expect(envelope.retryable).toBe(false);
    expect(envelope.runId).toBe("run-42");
  });

  it("IngestBoundaryError", () => {
    const envelope = toIngestErrorEnvelope(
      new IngestBoundaryError({ message: "boundary fail", operation: "test" })
    );
    expect(envelope.tag).toBe("IngestBoundaryError");
    expect(envelope.retryable).toBe(false);
    expect(envelope.operation).toBe("test");
    expect(envelope.message).toBe("unexpected ingest boundary failure");
  });

  it("StaleDispatchedIngestItemError => retryable", () => {
    const envelope = toIngestErrorEnvelope(
      new StaleDispatchedIngestItemError({
        message: "stale",
        did,
        runId: "run-1",
        operation: "test"
      })
    );
    expect(envelope.tag).toBe("StaleDispatchedIngestItemError");
    expect(envelope.retryable).toBe(true);
    expect(envelope.did).toBe(did);
  });

  it("StaleRunningIngestItemError => non-retryable", () => {
    const envelope = toIngestErrorEnvelope(
      new StaleRunningIngestItemError({
        message: "stale running",
        did,
        runId: "run-1",
        operation: "test"
      })
    );
    expect(envelope.tag).toBe("StaleRunningIngestItemError");
    expect(envelope.retryable).toBe(false);
  });

  it("WorkflowRunCompensationError", () => {
    const envelope = toIngestErrorEnvelope(
      new WorkflowRunCompensationError({
        message: "compensation fail",
        runId: "run-1",
        operation: "test"
      })
    );
    expect(envelope.tag).toBe("WorkflowRunCompensationError");
    expect(envelope.retryable).toBe(false);
    expect(envelope.runId).toBe("run-1");
  });

  it("HistoricalRunRepairError", () => {
    const envelope = toIngestErrorEnvelope(
      new HistoricalRunRepairError({
        message: "repair fail",
        runId: "run-1",
        did,
        operation: "test"
      })
    );
    expect(envelope.tag).toBe("HistoricalRunRepairError");
    expect(envelope.retryable).toBe(false);
    expect(envelope.did).toBe(did);
    expect(envelope.message).toBe("historical run required repair");
  });

  it("EnvError duck-typed object", () => {
    const envelope = toIngestErrorEnvelope({
      _tag: "EnvError",
      missing: "API_KEY"
    });
    expect(envelope.tag).toBe("EnvError");
    expect(envelope.retryable).toBe(false);
    expect(envelope.message).toBe("missing worker binding");
  });

  it("unknown tagged error preserves _tag", () => {
    const envelope = toIngestErrorEnvelope({
      _tag: "CustomVendorError",
      message: "something broke"
    });
    expect(envelope.tag).toBe("CustomVendorError");
    expect(envelope.retryable).toBe(false);
    expect(envelope.message).toBe("internal ingest failure");
  });

  it("plain Error", () => {
    const envelope = toIngestErrorEnvelope(new Error("oops"));
    expect(envelope.tag).toBe("Error");
    expect(envelope.retryable).toBe(false);
    expect(envelope.message).toBe("internal ingest failure");
  });

  it("non-Error unknown", () => {
    const envelope = toIngestErrorEnvelope("raw string");
    expect(envelope.tag).toBe("UnknownError");
    expect(envelope.retryable).toBe(false);
    expect(envelope.message).toBe("internal ingest failure");
  });

  it("override precedence for did, runId, operation", () => {
    const envelope = toIngestErrorEnvelope(
      new IngestBoundaryError({ message: "fail", operation: "original" }),
      { did, runId: "override-run", operation: "override-op" }
    );
    expect(envelope.did).toBe(did);
    expect(envelope.runId).toBe("override-run");
    expect(envelope.operation).toBe("override-op");
  });
});

describe("ingestHttpStatusForEnvelope", () => {
  const envelope = (tag: string) => ({
    tag,
    message: "test",
    retryable: false
  });

  it("maps ExpertNotFoundError to 404", () => {
    expect(ingestHttpStatusForEnvelope(envelope("ExpertNotFoundError"))).toBe(404);
  });

  it("maps IngestRunNotFoundError to 404", () => {
    expect(ingestHttpStatusForEnvelope(envelope("IngestRunNotFoundError"))).toBe(404);
  });

  it("maps IngestSchemaDecodeError to 400", () => {
    expect(ingestHttpStatusForEnvelope(envelope("IngestSchemaDecodeError"))).toBe(400);
  });

  it("maps DbError to 500", () => {
    expect(ingestHttpStatusForEnvelope(envelope("DbError"))).toBe(500);
  });

  it("maps BlueskyApiError to 502", () => {
    expect(ingestHttpStatusForEnvelope(envelope("BlueskyApiError"))).toBe(502);
  });

  it("maps IngestWorkflowLaunchError to 503", () => {
    expect(ingestHttpStatusForEnvelope(envelope("IngestWorkflowLaunchError"))).toBe(503);
  });

  it("maps SqlError to 500", () => {
    expect(ingestHttpStatusForEnvelope(envelope("SqlError"))).toBe(500);
  });

  it("maps unknown tags to 500", () => {
    expect(ingestHttpStatusForEnvelope(envelope("SomethingElse"))).toBe(500);
  });
});
