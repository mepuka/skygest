import { describe, expect, it } from "@effect/vitest";
import { vi } from "vitest";
import { MissingOperatorScopeError } from "../src/auth/AuthService";
import {
  operatorRequestAction,
  requiredOperatorScopes,
  scheduleDeniedOperatorRequestLog,
  toAuthErrorResponse
} from "../src/worker/operatorAuth";

describe("operator request policies", () => {
  it("assigns read scopes to MCP and admin read routes", () => {
    expect(
      requiredOperatorScopes(
        new Request("https://skygest.local/mcp", { method: "POST" })
      )
    ).toEqual(["mcp:read"]);
    expect(
      requiredOperatorScopes(
        new Request("https://skygest.local/admin/experts", { method: "GET" })
      )
    ).toEqual(["experts:read"]);
    expect(
      requiredOperatorScopes(
        new Request("https://skygest.local/admin/ingest/runs/run-1", {
          method: "GET"
        })
      )
    ).toEqual(["ops:read"]);
    expect(
      requiredOperatorScopes(
        new Request("https://skygest.local/admin/ingest/runs/run-1/items", {
          method: "GET"
        })
      )
    ).toEqual(["ops:read"]);
    expect(
      requiredOperatorScopes(
        new Request("https://skygest.local/admin/enrichment/runs", {
          method: "GET"
        })
      )
    ).toEqual(["ops:read"]);
    expect(
      requiredOperatorScopes(
        new Request("https://skygest.local/admin/enrichment/runs/run-1", {
          method: "GET"
        })
      )
    ).toEqual(["ops:read"]);
    expect(
      requiredOperatorScopes(
        new Request("https://skygest.local/admin/data-layer/agents", {
          method: "GET"
        })
      )
    ).toEqual(["ops:read"]);
    expect(
      requiredOperatorScopes(
        new Request(
          "https://skygest.local/admin/data-layer/agents/https%3A%2F%2Fid.skygest.io%2Fagent%2Fag_TEST01",
          {
            method: "GET"
          }
        )
      )
    ).toEqual(["ops:read"]);
    expect(
      requiredOperatorScopes(
        new Request(
          "https://skygest.local/admin/data-layer/audit/https%3A%2F%2Fid.skygest.io%2Fagent%2Fag_TEST01",
          {
            method: "GET"
          }
        )
      )
    ).toEqual(["ops:read"]);
  });

  it("assigns write scopes to expert, ingest, staging, and data-layer mutations", () => {
    expect(
      requiredOperatorScopes(
        new Request("https://skygest.local/admin/experts", { method: "POST" })
      )
    ).toEqual(["experts:write"]);
    expect(
      requiredOperatorScopes(
        new Request(
          "https://skygest.local/admin/experts/did%3Aplc%3Aexpert/activate",
          { method: "POST" }
        )
      )
    ).toEqual(["experts:write"]);
    expect(
      requiredOperatorScopes(
        new Request("https://skygest.local/admin/curation/curate", {
          method: "POST"
        })
      )
    ).toEqual(["curation:write"]);
    expect(
      requiredOperatorScopes(
        new Request("https://skygest.local/admin/ingest/repair", {
          method: "POST"
        })
      )
    ).toEqual(["ops:refresh"]);
    expect(
      requiredOperatorScopes(
        new Request("https://skygest.local/admin/enrichment/start", {
          method: "POST"
        })
      )
    ).toEqual(["ops:refresh"]);
    expect(
      requiredOperatorScopes(
        new Request("https://skygest.local/admin/enrichment/runs/run-1/retry", {
          method: "POST"
        })
      )
    ).toEqual(["ops:refresh"]);
    expect(
      requiredOperatorScopes(
        new Request("https://skygest.local/admin/enrichment/repair", {
          method: "POST"
        })
      )
    ).toEqual(["ops:refresh"]);
    expect(
      requiredOperatorScopes(
        new Request("https://skygest.local/admin/ops/migrate", {
          method: "POST"
        })
      )
    ).toEqual(["ops:refresh"]);
    expect(
      requiredOperatorScopes(
        new Request("https://skygest.local/admin/ops/entity-experts/backfill", {
          method: "POST"
        })
      )
    ).toEqual(["ops:refresh"]);
    expect(
      requiredOperatorScopes(
        new Request("https://skygest.local/admin/ops/entity-posts/backfill", {
          method: "POST"
        })
      )
    ).toEqual(["ops:refresh"]);
    expect(
      requiredOperatorScopes(
        new Request("https://skygest.local/admin/ops/entity-topics/backfill", {
          method: "POST"
        })
      )
    ).toEqual(["ops:refresh"]);
    expect(
      requiredOperatorScopes(
        new Request("https://skygest.local/admin/ops/entity-reindex/drain", {
          method: "POST"
        })
      )
    ).toEqual(["ops:refresh"]);
    expect(
      requiredOperatorScopes(
        new Request("https://skygest.local/admin/data-layer/agents", {
          method: "POST"
        })
      )
    ).toEqual(["ops:refresh"]);
    expect(
      requiredOperatorScopes(
        new Request(
          "https://skygest.local/admin/data-layer/agents/https%3A%2F%2Fid.skygest.io%2Fagent%2Fag_TEST01",
          {
            method: "PUT"
          }
        )
      )
    ).toEqual(["ops:refresh"]);
    expect(
      requiredOperatorScopes(
        new Request(
          "https://skygest.local/admin/data-layer/agents/https%3A%2F%2Fid.skygest.io%2Fagent%2Fag_TEST01",
          {
            method: "DELETE"
          }
        )
      )
    ).toEqual(["ops:refresh"]);
  });

  it("classifies audited operator actions consistently", () => {
    expect(
      operatorRequestAction(
        new Request("https://skygest.local/mcp", { method: "POST" })
      )
    ).toBe("mcp_read");
    expect(
      operatorRequestAction(
        new Request("https://skygest.local/admin/experts", { method: "GET" })
      )
    ).toBe("list_experts");
    expect(
      operatorRequestAction(
        new Request("https://skygest.local/admin/curation/curate", {
          method: "POST"
        })
      )
    ).toBe("curate_post");
    expect(
      operatorRequestAction(
        new Request("https://skygest.local/admin/ingest/repair", {
          method: "POST"
        })
      )
    ).toBe("repair_ingest");
    expect(
      operatorRequestAction(
        new Request("https://skygest.local/admin/enrichment/start", {
          method: "POST"
        })
      )
    ).toBe("start_enrichment");
    expect(
      operatorRequestAction(
        new Request("https://skygest.local/admin/enrichment/runs/run-1/retry", {
          method: "POST"
        })
      )
    ).toBe("retry_enrichment");
    expect(
      operatorRequestAction(
        new Request("https://skygest.local/admin/enrichment/repair", {
          method: "POST"
        })
      )
    ).toBe("repair_enrichment");
    expect(
      operatorRequestAction(
        new Request("https://skygest.local/admin/ops/entity-experts/backfill", {
          method: "POST"
        })
      )
    ).toBe("entity_experts_backfill");
    expect(
      operatorRequestAction(
        new Request("https://skygest.local/admin/ops/entity-posts/backfill", {
          method: "POST"
        })
      )
    ).toBe("entity_posts_backfill");
    expect(
      operatorRequestAction(
        new Request("https://skygest.local/admin/ops/entity-topics/backfill", {
          method: "POST"
        })
      )
    ).toBe("entity_topics_backfill");
    expect(
      operatorRequestAction(
        new Request("https://skygest.local/admin/ops/entity-reindex/drain", {
          method: "POST"
        })
      )
    ).toBe("entity_reindex_drain");
    expect(
      operatorRequestAction(
        new Request(
          "https://skygest.local/admin/data-layer/audit/https%3A%2F%2Fid.skygest.io%2Fagent%2Fag_TEST01",
          {
            method: "GET"
          }
        )
      )
    ).toBe("list_data_layer_audit");
    expect(
      operatorRequestAction(
        new Request(
          "https://skygest.local/admin/data-layer/agents/https%3A%2F%2Fid.skygest.io%2Fagent%2Fag_TEST01",
          {
            method: "PUT"
          }
        )
      )
    ).toBe("update_data_layer_entity");
  });

  it("maps missing scopes to a forbidden response", async () => {
    const response = toAuthErrorResponse(
      new MissingOperatorScopeError({ missingScopes: ["ops:refresh"] })
    );
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toEqual({
      error: "Forbidden",
      message: "forbidden"
    });
  });

  it("schedules denial logs on waitUntil without blocking the caller", async () => {
    let resolveLog: (() => void) | undefined;
    const logger = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveLog = resolve;
        })
    );
    const waitUntil = vi.fn();
    const ctx = { waitUntil };

    scheduleDeniedOperatorRequestLog(
      new Request("https://skygest.local/admin/enrichment/start", {
        method: "POST"
      }),
      new MissingOperatorScopeError({ missingScopes: ["ops:refresh"] }),
      ctx,
      logger
    );

    expect(logger).toHaveBeenCalledTimes(1);
    expect(waitUntil).toHaveBeenCalledTimes(1);

    const scheduledTask = waitUntil.mock.calls[0]?.[0] as Promise<void>;
    let settled = false;
    void scheduledTask.then(() => {
      settled = true;
    });

    await Promise.resolve();
    expect(settled).toBe(false);

    resolveLog?.();
    await scheduledTask;

    expect(settled).toBe(true);
  });
});
