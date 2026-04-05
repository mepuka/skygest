import { describe, expect, it } from "@effect/vitest";
import { vi } from "vitest";

vi.mock("../src/admin/Router", () => ({
  handleAdminRequest: vi.fn()
}));

vi.mock("../src/api/Router", () => ({
  handleApiRequest: vi.fn()
}));

vi.mock("../src/ingest/Router", () => ({
  handleIngestRequest: vi.fn()
}));

vi.mock("../src/mcp/Router", () => ({
  handleMcpRequest: vi.fn().mockResolvedValue(
    new Response(null, { status: 200 })
  )
}));

vi.mock("../src/ingest/ExpertPollCoordinatorDo", () => ({
  ExpertPollCoordinatorDo: class {}
}));

vi.mock("../src/ingest/IngestRunWorkflow", () => ({
  IngestRunWorkflow: class {}
}));

const makeEnv = (overrides: Record<string, unknown> = {}) =>
  ({
    DB: {} as D1Database,
    OPERATOR_SECRET: "test-secret",
    ...overrides
  }) as any;

const authHeaders = { Authorization: "Bearer test-secret" };

describe("worker feed routing", () => {
  it("returns JSON 404 for staging ops when ENABLE_STAGING_OPS is not set", async () => {
    const { fetch } = await import("../src/worker/feed");
    const response = await fetch(
      new Request("https://skygest.local/admin/ops/migrate", {
        method: "POST"
      }),
      {
        DB: {} as D1Database
      } as any
    );
    const body = await response.json() as {
      readonly error: string;
      readonly message: string;
    };

    expect(response.status).toBe(404);
    expect(body).toEqual({
      error: "NotFound",
      message: "not found"
    });
  }, 10_000);

  it("returns 202 for JSON-RPC notification requests to /mcp", async () => {
    const { handleMcpRequest } = await import("../src/mcp/Router");
    (handleMcpRequest as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(null, { status: 200 })
    );

    const { fetch } = await import("../src/worker/feed");
    const response = await fetch(
      new Request("https://skygest.local/mcp", {
        method: "POST",
        headers: { ...authHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })
      }),
      makeEnv()
    );

    expect(response.status).toBe(202);
    expect(await response.text()).toBe("");
  }, 10_000);

  it("returns normal response for JSON-RPC requests with id to /mcp", async () => {
    const { handleMcpRequest } = await import("../src/mcp/Router");
    const jsonBody = JSON.stringify({ jsonrpc: "2.0", result: { ok: true }, id: 1 });
    (handleMcpRequest as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(jsonBody, {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    );

    const { fetch } = await import("../src/worker/feed");
    const response = await fetch(
      new Request("https://skygest.local/mcp", {
        method: "POST",
        headers: { ...authHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", method: "tools/list", id: 1 })
      }),
      makeEnv()
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ jsonrpc: "2.0", result: { ok: true }, id: 1 });
  }, 10_000);

  it("does not buffer streamed responses for non-notification requests", async () => {
    const { handleMcpRequest } = await import("../src/mcp/Router");
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"jsonrpc":"2.0"'));
        controller.enqueue(new TextEncoder().encode(',"result":{"ok":true},"id":2}'));
        controller.close();
      }
    });
    (handleMcpRequest as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(stream, { status: 200 })
    );

    const { fetch } = await import("../src/worker/feed");
    const response = await fetch(
      new Request("https://skygest.local/mcp", {
        method: "POST",
        headers: { ...authHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", method: "tools/call", id: 2 })
      }),
      makeEnv()
    );

    expect(response.status).toBe(200);
    // The response body should be the original stream, not buffered
    expect(response.body).toBeInstanceOf(ReadableStream);
  }, 10_000);
});
