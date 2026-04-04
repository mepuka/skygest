import { describe, expect, it } from "vitest";
import { classifyMcpRequest, profileForIdentity } from "../src/mcp/RequestAuth";

// ---------------------------------------------------------------------------
// Helper — build a JSON-RPC request for testing
// ---------------------------------------------------------------------------

const makeJsonRpcRequest = (method: string, params?: Record<string, unknown>) =>
  new Request("https://test.dev/mcp", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", method, params: params ?? {}, id: 1 }),
  });

// ---------------------------------------------------------------------------
// classifyMcpRequest
// ---------------------------------------------------------------------------

describe("classifyMcpRequest", () => {
  it("tools/call with import_posts requires ops:refresh", async () => {
    const req = makeJsonRpcRequest("tools/call", { name: "import_posts" });
    const result = await classifyMcpRequest(req);
    expect(result).toEqual({
      method: "tools/call",
      toolOrPromptName: "import_posts",
      requiredScopes: ["ops:refresh"],
    });
  });

  it("tools/call with curate_post requires curation:write", async () => {
    const req = makeJsonRpcRequest("tools/call", { name: "curate_post" });
    const result = await classifyMcpRequest(req);
    expect(result).toEqual({
      method: "tools/call",
      toolOrPromptName: "curate_post",
      requiredScopes: ["curation:write"],
    });
  });

  it("tools/call with bulk_curate requires curation:write", async () => {
    const req = makeJsonRpcRequest("tools/call", { name: "bulk_curate" });
    const result = await classifyMcpRequest(req);
    expect(result).toEqual({
      method: "tools/call",
      toolOrPromptName: "bulk_curate",
      requiredScopes: ["curation:write"],
    });
  });

  it("tools/call with submit_editorial_pick requires editorial:write", async () => {
    const req = makeJsonRpcRequest("tools/call", { name: "submit_editorial_pick" });
    const result = await classifyMcpRequest(req);
    expect(result).toEqual({
      method: "tools/call",
      toolOrPromptName: "submit_editorial_pick",
      requiredScopes: ["editorial:write"],
    });
  });

  it("tools/call with bulk_start_enrichment requires curation:write", async () => {
    const req = makeJsonRpcRequest("tools/call", { name: "bulk_start_enrichment" });
    const result = await classifyMcpRequest(req);
    expect(result).toEqual({
      method: "tools/call",
      toolOrPromptName: "bulk_start_enrichment",
      requiredScopes: ["curation:write"],
    });
  });

  it("tools/call with get_pipeline_status requires ops:read", async () => {
    const req = makeJsonRpcRequest("tools/call", { name: "get_pipeline_status" });
    const result = await classifyMcpRequest(req);
    expect(result).toEqual({
      method: "tools/call",
      toolOrPromptName: "get_pipeline_status",
      requiredScopes: ["ops:read"],
    });
  });

  it("tools/call with search_posts requires no extra scopes", async () => {
    const req = makeJsonRpcRequest("tools/call", { name: "search_posts" });
    const result = await classifyMcpRequest(req);
    expect(result).toEqual({
      method: "tools/call",
      toolOrPromptName: "search_posts",
      requiredScopes: [],
    });
  });

  it("prompts/get with curate-session requires curation + editorial scopes", async () => {
    const req = makeJsonRpcRequest("prompts/get", { name: "curate-session" });
    const result = await classifyMcpRequest(req);
    expect(result).toEqual({
      method: "prompts/get",
      toolOrPromptName: "curate-session",
      requiredScopes: ["curation:write", "editorial:write"],
    });
  });

  it("prompts/get with curate-digest requires no extra scopes", async () => {
    const req = makeJsonRpcRequest("prompts/get", { name: "curate-digest" });
    const result = await classifyMcpRequest(req);
    expect(result).toEqual({
      method: "prompts/get",
      toolOrPromptName: "curate-digest",
      requiredScopes: [],
    });
  });

  it("tools/list returns null toolOrPromptName and no required scopes", async () => {
    const req = makeJsonRpcRequest("tools/list");
    const result = await classifyMcpRequest(req);
    expect(result).toEqual({
      method: "tools/list",
      toolOrPromptName: null,
      requiredScopes: [],
    });
  });

  it("non-JSON body returns unknown classification", async () => {
    const req = new Request("https://test.dev/mcp", {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "not json at all",
    });
    const result = await classifyMcpRequest(req);
    expect(result).toEqual({
      method: "unknown",
      toolOrPromptName: null,
      requiredScopes: [],
    });
  });

  it("JSON body missing method field returns unknown", async () => {
    const req = new Request("https://test.dev/mcp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1 }),
    });
    const result = await classifyMcpRequest(req);
    expect(result).toEqual({
      method: "unknown",
      toolOrPromptName: null,
      requiredScopes: [],
    });
  });
});

// ---------------------------------------------------------------------------
// profileForIdentity
// ---------------------------------------------------------------------------

describe("profileForIdentity", () => {
  it("mcp:read + ops:refresh yields ops-refresh", () => {
    expect(
      profileForIdentity({ scopes: ["mcp:read", "ops:refresh"] }),
    ).toBe("ops-refresh");
  });

  it("both curation:write and editorial:write yields workflow-write", () => {
    expect(
      profileForIdentity({
        scopes: ["mcp:read", "curation:write", "editorial:write"],
      }),
    ).toBe("workflow-write");
  });

  it("mcp:read + ops:read yields ops-read", () => {
    expect(
      profileForIdentity({ scopes: ["mcp:read", "ops:read"] }),
    ).toBe("ops-read");
  });

  it("only mcp:read yields read-only", () => {
    expect(
      profileForIdentity({ scopes: ["mcp:read"] }),
    ).toBe("read-only");
  });

  it("mcp:read + curation:write yields curation-write", () => {
    expect(
      profileForIdentity({ scopes: ["mcp:read", "curation:write"] }),
    ).toBe("curation-write");
  });

  it("mcp:read + curation:write + ops:read yields ops-curation-write", () => {
    expect(
      profileForIdentity({ scopes: ["mcp:read", "curation:write", "ops:read"] }),
    ).toBe("ops-curation-write");
  });

  it("mcp:read + editorial:write yields editorial-write", () => {
    expect(
      profileForIdentity({ scopes: ["mcp:read", "editorial:write"] }),
    ).toBe("editorial-write");
  });

  it("mcp:read + editorial:write + ops:read yields ops-editorial-write", () => {
    expect(
      profileForIdentity({ scopes: ["mcp:read", "editorial:write", "ops:read"] }),
    ).toBe("ops-editorial-write");
  });

  it("mcp:read + curation:write + editorial:write + ops:read yields ops-workflow-write", () => {
    expect(
      profileForIdentity({
        scopes: ["mcp:read", "curation:write", "editorial:write", "ops:read"],
      }),
    ).toBe("ops-workflow-write");
  });

  it("workflow scopes + ops:refresh yields workflow-write-refresh", () => {
    expect(
      profileForIdentity({
        scopes: ["mcp:read", "curation:write", "editorial:write", "ops:refresh"],
      }),
    ).toBe("workflow-write-refresh");
  });

  it("workflow scopes + ops:read + ops:refresh yields ops-workflow-write-refresh", () => {
    expect(
      profileForIdentity({
        scopes: [
          "mcp:read",
          "curation:write",
          "editorial:write",
          "ops:read",
          "ops:refresh"
        ],
      }),
    ).toBe("ops-workflow-write-refresh");
  });

  it("empty scopes yields read-only", () => {
    expect(
      profileForIdentity({ scopes: [] }),
    ).toBe("read-only");
  });
});
