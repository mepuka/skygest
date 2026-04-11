import { describe, expect, it } from "@effect/vitest";
import { vi } from "vitest";
import type { AgentWorkerEnvBindings } from "../src/platform/Env";
import { handleFetchWithBoundary } from "../src/worker/feed";

vi.mock("../src/admin/Router", () => ({
  handleAdminRequest: vi.fn()
}));

vi.mock("../src/api/Router", () => ({
  handleApiRequest: vi.fn()
}));

vi.mock("../src/data-layer/Router", () => ({
  handleDataLayerRequest: vi.fn()
}));

vi.mock("../src/mcp/Router", () => ({
  handleMcpRequest: vi.fn()
}));

const emptyEnv = {} as AgentWorkerEnvBindings;

const makeRequest = (path = "/health") =>
  new Request(`http://localhost${path}`);

describe("agent worker top-level error boundary", () => {
  it("sanitizes raw Error throws into a scrubbed 500 envelope", async () => {
    const sensitive = "sensitive-agent-worker-detail";
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
