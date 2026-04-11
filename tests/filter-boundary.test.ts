import { describe, expect, it } from "@effect/vitest";
import { vi } from "vitest";
import type { WorkflowFilterEnvBindings } from "../src/platform/Env";
import { handleFetchWithBoundary } from "../src/worker/filter";

vi.mock("cloudflare:workers", () => ({
  WorkerEntrypoint: class {}
}));

vi.mock("../src/enrichment/Router", () => ({
  handleEnrichmentRequest: vi.fn()
}));

vi.mock("../src/ingest/Router", () => ({
  handleIngestRequest: vi.fn(),
  makeWorkflowIngestLayer: vi.fn()
}));

vi.mock("../src/enrichment/EnrichmentRunWorkflow", () => ({
  EnrichmentRunWorkflow: class {}
}));

vi.mock("../src/ingest/ExpertPollCoordinatorDo", () => ({
  ExpertPollCoordinatorDo: class {},
  ExpertPollCoordinatorDoIsolated: class {}
}));

vi.mock("../src/ingest/IngestRunWorkflow", () => ({
  IngestRunWorkflow: class {}
}));

const emptyEnv = {} as WorkflowFilterEnvBindings;

const makeRequest = (path = "/health") =>
  new Request(`http://localhost${path}`);

describe("ingest worker top-level error boundary", () => {
  it("sanitizes raw Error throws into a scrubbed 500 envelope", async () => {
    const sensitive = "sensitive-ingest-worker-detail";
    const response = await handleFetchWithBoundary(
      makeRequest(),
      emptyEnv,
      undefined,
      () => {
        throw new Error(sensitive);
      }
    );

    expect(response.status).toBe(500);
    expect(response.headers.get("content-type")).toBe("application/json");

    const bodyText = await response.text();
    expect(bodyText).not.toContain(sensitive);

    const body = JSON.parse(bodyText) as {
      readonly error: string;
      readonly message: string;
    };
    expect(body.error).toBe("InternalServerError");
    expect(body.message).toBe("internal error");
  });

  it("returns the handler response unchanged on the happy path", async () => {
    const expected = new Response(
      JSON.stringify({ status: "ok" }),
      { status: 200, headers: { "content-type": "application/json" } }
    );

    const response = await handleFetchWithBoundary(
      makeRequest(),
      emptyEnv,
      undefined,
      async () => expected
    );

    expect(response).toBe(expected);
    expect(response.status).toBe(200);
  });
});
