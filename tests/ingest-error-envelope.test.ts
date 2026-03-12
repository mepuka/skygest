import { describe, expect, it } from "@effect/vitest";
import {
  IngestWorkflowLaunchError,
  decodeStoredIngestError,
  encodeStoredIngestError,
  toIngestErrorEnvelope,
  toIngestErrorResponse
} from "../src/domain/errors";
import type { Did } from "../src/domain/types";

const did = "did:plc:expert-a" as Did;

describe("ingest error envelopes", () => {
  it("round-trips structured envelopes through D1 text storage", () => {
    const envelope = toIngestErrorEnvelope(
      IngestWorkflowLaunchError.make({
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
      message: "legacy failure text",
      retryable: false
    });
  });

  it("maps envelopes to the admin HTTP error contract", () => {
    const response = toIngestErrorResponse(
      IngestWorkflowLaunchError.make({
        message: "workflow create failed",
        operation: "IngestWorkflowLauncher.start"
      })
    );

    expect(response).toEqual({
      error: "IngestWorkflowLaunchError",
      message: "workflow create failed",
      retryable: true
    });
  });
});
