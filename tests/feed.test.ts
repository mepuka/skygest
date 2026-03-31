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
  handleMcpRequest: vi.fn()
}));

vi.mock("../src/ingest/ExpertPollCoordinatorDo", () => ({
  ExpertPollCoordinatorDo: class {}
}));

vi.mock("../src/ingest/IngestRunWorkflow", () => ({
  IngestRunWorkflow: class {}
}));

describe("worker feed routing", () => {
  it("returns JSON 404 for staging ops when shared-secret mode is disabled", async () => {
    const { fetch } = await import("../src/worker/feed");
    const response = await fetch(
      new Request("https://skygest.local/admin/ops/migrate", {
        method: "POST"
      }),
      {
        DB: {} as D1Database,
        OPERATOR_AUTH_MODE: "access"
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
});
