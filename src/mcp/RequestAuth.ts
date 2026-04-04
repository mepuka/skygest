// ---------------------------------------------------------------------------
// MCP Request Classification — pure functions, no Effect service
// ---------------------------------------------------------------------------

/**
 * Capability profile derived from an identity's scopes.
 * Determines which toolkit variant (tool subset) the caller sees.
 */
export type McpCapabilityProfile =
  | "read-only"
  | "ops-read"
  | "ops-refresh"
  | "ops-read-refresh"
  | "curation-write"
  | "ops-curation-write"
  | "curation-write-refresh"
  | "ops-curation-write-refresh"
  | "editorial-write"
  | "ops-editorial-write"
  | "editorial-write-refresh"
  | "ops-editorial-write-refresh"
  | "workflow-write"
  | "ops-workflow-write"
  | "workflow-write-refresh"
  | "ops-workflow-write-refresh";

/**
 * Classification of an incoming MCP JSON-RPC request.
 * Used by the capability router to enforce scope requirements.
 */
export type McpRequestClassification = {
  readonly method: string;
  readonly toolOrPromptName: string | null;
  readonly requiredScopes: ReadonlyArray<string>;
};

// ---------------------------------------------------------------------------
// Scope mapping tables
// ---------------------------------------------------------------------------

const TOOL_SCOPES: Record<string, ReadonlyArray<string>> = {
  get_pipeline_status: ["ops:read"],
  import_posts: ["ops:refresh"],
  curate_post: ["curation:write"],
  bulk_curate: ["curation:write"],
  submit_editorial_pick: ["editorial:write"],
  start_enrichment: ["curation:write"],
  bulk_start_enrichment: ["curation:write"],
};

const PROMPT_SCOPES: Record<string, ReadonlyArray<string>> = {
  "curate-session": ["curation:write", "editorial:write"],
};

const UNKNOWN: McpRequestClassification = {
  method: "unknown",
  toolOrPromptName: null,
  requiredScopes: [],
};

// ---------------------------------------------------------------------------
// classifyMcpRequest
// ---------------------------------------------------------------------------

/**
 * Classify an MCP JSON-RPC request for capability routing.
 *
 * Takes a **cloned** `Request` (the caller is responsible for cloning before
 * passing it here, since `.json()` consumes the body).
 *
 * Extracts the JSON-RPC `method` and, for `tools/call` or `prompts/get`,
 * the `params.name`. Maps tool/prompt names to their required scopes.
 *
 * On any parse failure (non-JSON body, missing fields) returns a safe
 * fallback with `method: "unknown"` and empty scopes.
 */
export const classifyMcpRequest = async (
  request: Request,
): Promise<McpRequestClassification> => {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return UNKNOWN;
  }

  if (typeof body !== "object" || body === null) {
    return UNKNOWN;
  }

  const record = body as Record<string, unknown>;
  const method = record.method;

  if (typeof method !== "string") {
    return UNKNOWN;
  }

  // Extract tool or prompt name for methods that carry one
  if (method === "tools/call" || method === "prompts/get") {
    const params = record.params;
    if (typeof params === "object" && params !== null) {
      const name = (params as Record<string, unknown>).name;
      if (typeof name === "string") {
        const scopeTable = method === "tools/call" ? TOOL_SCOPES : PROMPT_SCOPES;
        const requiredScopes = scopeTable[name] ?? [];
        return { method, toolOrPromptName: name, requiredScopes };
      }
    }
    // params.name missing — still record the method
    return { method, toolOrPromptName: null, requiredScopes: [] };
  }

  // All other methods (tools/list, prompts/list, initialize, etc.)
  return { method, toolOrPromptName: null, requiredScopes: [] };
};

// ---------------------------------------------------------------------------
// profileForIdentity
// ---------------------------------------------------------------------------

type BaseCapabilityProfile =
  | "read-only"
  | "curation-write"
  | "editorial-write"
  | "workflow-write";

const applyOpsScopes = (
  base: BaseCapabilityProfile,
  hasOpsRead: boolean,
  hasOpsRefresh: boolean
): McpCapabilityProfile => {
  switch (base) {
    case "read-only":
      if (hasOpsRead && hasOpsRefresh) return "ops-read-refresh";
      if (hasOpsRead) return "ops-read";
      if (hasOpsRefresh) return "ops-refresh";
      return "read-only";
    case "curation-write":
      if (hasOpsRead && hasOpsRefresh) return "ops-curation-write-refresh";
      if (hasOpsRead) return "ops-curation-write";
      if (hasOpsRefresh) return "curation-write-refresh";
      return "curation-write";
    case "editorial-write":
      if (hasOpsRead && hasOpsRefresh) return "ops-editorial-write-refresh";
      if (hasOpsRead) return "ops-editorial-write";
      if (hasOpsRefresh) return "editorial-write-refresh";
      return "editorial-write";
    case "workflow-write":
      if (hasOpsRead && hasOpsRefresh) return "ops-workflow-write-refresh";
      if (hasOpsRead) return "ops-workflow-write";
      if (hasOpsRefresh) return "workflow-write-refresh";
      return "workflow-write";
  }
};

/**
 * Determine which capability profile an identity qualifies for based on
 * its scopes.
 *
 * - `ops:read` adds the pipeline-status tool to the matching profile
 * - `ops:refresh` adds the import_posts tool to the matching profile
 * - Both `curation:write` AND `editorial:write` -> `"workflow-write"`
 * - Only `curation:write`                       -> `"curation-write"`
 * - Only `editorial:write`                      -> `"editorial-write"`
 * - Neither                                     -> `"read-only"`
 */
export const profileForIdentity = (
  identity: { readonly scopes: ReadonlyArray<string> },
): McpCapabilityProfile => {
  const hasCuration = identity.scopes.includes("curation:write");
  const hasEditorial = identity.scopes.includes("editorial:write");
  const hasOpsRead = identity.scopes.includes("ops:read");
  const hasOpsRefresh = identity.scopes.includes("ops:refresh");

  if (hasCuration && hasEditorial) {
    return applyOpsScopes("workflow-write", hasOpsRead, hasOpsRefresh);
  }
  if (hasCuration) {
    return applyOpsScopes("curation-write", hasOpsRead, hasOpsRefresh);
  }
  if (hasEditorial) {
    return applyOpsScopes("editorial-write", hasOpsRead, hasOpsRefresh);
  }
  return applyOpsScopes("read-only", hasOpsRead, hasOpsRefresh);
};
