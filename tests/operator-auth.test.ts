import { describe, expect, it } from "@effect/vitest";
import {
  operatorRequestAction,
  requiredOperatorScopes
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
  });

  it("assigns write scopes to expert, ingest, and staging mutations", () => {
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
  });
});
