# MCP Auth Simplification + Capability Routing Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Simplify auth to bearer-token only, add MCP request classification for capability-aware tool/prompt visibility, and expose write tools (`curate_post`, `submit_editorial_pick`) through scoped MCP toolkits.

**Architecture:** Replace the dual-mode auth (CF Access JWT + shared secret) with a single `Authorization: Bearer <token>` path. The bearer token is validated server-side using timing-safe comparison against the `OPERATOR_SECRET` Worker secret. Remove `jose` dependency, CF Access config, and auth mode switching. Add an MCP request classifier that inspects the JSON-RPC envelope to determine capability profile (read-only, curation-write, editorial-write, workflow-write). Cache MCP handlers by env + capability profile. Pass `operatorIdentityContext(identity)` to `webHandler.handler(request, context)` — confirmed that `HttpLayerRouter.toWebHandler` merges request-time context into the runtime context, so `OperatorIdentity` is available inside MCP tool handlers without modifying `registerToolkitWithDisplayText`.

**Tech Stack:** Effect (`Context.Tag`, `Layer.effect`, `Schema`), Cloudflare Workers (`crypto.subtle.timingSafeEqual`), existing `OperatorIdentity` from `src/http/Identity.ts`.

**Auth decision:** Bearer-token only. Single operator. See `project_auth_decision.md` memory.

**Review findings addressed:**
- Critical: Timing-safe comparison via `crypto.subtle.timingSafeEqual`
- Critical: Request body clone order explicit (clone for classifier, original to MCP handler)
- Critical: `registerToolkitWithDisplayText` does NOT need modification — `HttpLayerRouter.toWebHandler.handler(request, context)` already merges request-time context into runtime context (verified in `@effect/platform` source: `HttpApp.toWebHandlerRuntime`)
- Important: `/admin/ops/stats` scope enforcement added
- Important: Legacy header deprecation log via `Effect.logWarning`
- Important: `AccessIdentity` simplified — no code reads `issuer`/`audience`/`payload`
- Important: Tool counts adjusted to 12/13/13/14 (`get_post_enrichments` is SKY-77, not in scope)
- Suggestion: Staging ops guard uses `ENABLE_STAGING_OPS` env var instead of `operatorAuthMode`
- Suggestion: File named `RequestAuth.ts` per MCP workflow plan
- Suggestion: Test infrastructure includes identity helpers

---

### Task 1: Migrate Auth to Bearer Token Only

**Files:**
- Modify: `src/auth/AuthService.ts`
- Modify: `src/platform/Config.ts`
- Modify: `src/platform/Env.ts`
- Modify: `src/worker/operatorAuth.ts`
- Modify: `src/worker/feed.ts`
- Modify: `src/admin/Router.ts`
- Modify: `src/edge/Layer.ts`
- Modify: `tests/support/runtime.ts`
- Test: `tests/operator-auth.test.ts`
- Remove dependency: `jose` from `package.json`

**What to do:**

1. **Simplify `AuthService`** — remove `jose` import, `createRemoteJWKSet`/`jwtVerify`, and all CF Access error classes (`MissingAccessJwtError`, `InvalidAccessJwtError`, `ForbiddenAccessJwtError`, `InvalidAuthConfigError`). Keep `MissingOperatorSecretError` and `InvalidOperatorSecretError`.

   Replace the dual-mode `requireOperator` with a single bearer-token path:

   ```ts
   const extractToken = (headers: Headers): string | null => {
     const auth = headers.get("authorization");
     if (auth !== null && auth.startsWith("Bearer ")) {
       return auth.slice(7).trim();
     }
     // Legacy fallback (deprecated)
     const legacy = headers.get("x-skygest-operator-secret");
     if (legacy !== null && legacy.trim().length > 0) {
       return legacy.trim();
     }
     return null;
   };
   ```

   **Timing-safe comparison** — use `crypto.subtle.timingSafeEqual` (available in CF Workers):

   ```ts
   const timingSafeCompare = async (a: string, b: string): Promise<boolean> => {
     const encoder = new TextEncoder();
     const aBytes = encoder.encode(a);
     const bBytes = encoder.encode(b);
     if (aBytes.byteLength !== bBytes.byteLength) return false;
     return crypto.subtle.timingSafeEqual(aBytes, bBytes);
   };
   ```

   Wrap in `Effect.tryPromise` inside the `requireOperator` method.

   **Legacy header deprecation:** When the token is extracted from `x-skygest-operator-secret`, log a warning:

   ```ts
   yield* Effect.logWarning("x-skygest-operator-secret header is deprecated, use Authorization: Bearer");
   ```

   **Simplify `AccessIdentity`** — no code reads `issuer`, `audience`, or `payload` outside AuthService. Simplify to:

   ```ts
   export type AccessIdentity = {
     readonly subject: string | null;
     readonly email: string | null;
     readonly scopes: ReadonlyArray<string>;
   };
   ```

   Remove `requireAccess`, `requireScopes`, `requireOperatorScopes`. Keep only `requireOperator` which returns `AccessIdentity` with all `operatorScopes`.

2. **Simplify `AppConfig`** — remove `operatorAuthMode`, `accessTeamDomain`, `accessAud`. Remove `OperatorAuthMode` type. Add `enableStagingOps: Config.withDefault(Config.boolean("ENABLE_STAGING_OPS"), false)` to replace the auth-mode-based staging guard.

3. **Simplify `Env.ts`** — remove `OPERATOR_AUTH_MODE`, `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD` from `EnvBindings`. Add `ENABLE_STAGING_OPS?: string`.

4. **Update staging ops guard** — in `src/admin/Router.ts`, change `ensureStagingOpsEnabled` from checking `operatorAuthMode !== "shared-secret"` to checking `config.enableStagingOps !== true`. In `src/worker/feed.ts`, replace `isSharedSecretMode(env)` with checking `env.ENABLE_STAGING_OPS === "true"`.

5. **Update `operatorAuth.ts`** — remove CF Access error class imports and handlers from `toAuthErrorResponse` and `logDeniedOperatorRequest`. Add `/admin/ops/stats` scope entry:

   ```ts
   if (request.method === "GET" && pathname === "/admin/ops/stats") {
     return { action: "ops_stats", scopes: ["ops:read"] };
   }
   ```

6. **Update `edge/Layer.ts`** — `authLayer` uses simplified `AuthService.layer`.

7. **Update `tests/support/runtime.ts`** — remove `operatorAuthMode`, `accessTeamDomain`, `accessAud` from test config. Add `enableStagingOps: false`.

8. **Remove `jose`** — `bun remove jose`.

**Tests:**
- `Authorization: Bearer <valid>` → 200
- `Authorization: Bearer <invalid>` → 401
- Legacy `x-skygest-operator-secret: <valid>` → 200 (with deprecation warning)
- Missing token → 401
- `/admin/ops/stats` without `ops:read` → 403

**Commit:**
```bash
git commit -m "feat(auth): simplify to bearer-token only, remove CF Access JWT (SKY-29)"
```

---

### Task 2: MCP Request Classifier

**Files:**
- Create: `src/mcp/RequestAuth.ts`
- Test: `tests/mcp-request-auth.test.ts`

**What to do:**

Create a pure module that classifies MCP JSON-RPC requests.

```ts
// src/mcp/RequestAuth.ts

export type McpCapabilityProfile =
  | "read-only"
  | "curation-write"
  | "editorial-write"
  | "workflow-write";
```

The classifier function takes a **cloned** request (caller must clone before passing):

```ts
export const classifyMcpRequest = async (
  request: Request
): Promise<McpRequestClassification>
```

It reads the JSON body, extracts the method and tool/prompt name, maps to scopes.

**Request body handling:** The caller in `Router.ts` or `feed.ts` must clone the request BEFORE classification:

```ts
const classifierRequest = request.clone();  // clone for classifier
const classification = await classifyMcpRequest(classifierRequest);
// pass original `request` to MCP handler (body unconsumed)
```

**Capability profile determination** — for `tools/list` and `prompts/list`, the profile is determined by the caller's scopes (from `AccessIdentity`), not by the request content:

```ts
export const profileForIdentity = (identity: AccessIdentity): McpCapabilityProfile => {
  const has = (scope: string) => identity.scopes.includes(scope);
  if (has("curation:write") && has("editorial:write")) return "workflow-write";
  if (has("curation:write")) return "curation-write";
  if (has("editorial:write")) return "editorial-write";
  return "read-only";
};
```

Since the single operator has all scopes, `profileForIdentity` will return `"workflow-write"`. But the structure supports future multi-user scenarios.

**Tests:**
- `tools/call` with `curate_post` → requires `curation:write`
- `tools/call` with `search_posts` → no extra scope
- `prompts/get` with `curate-session` → requires `curation:write` + `editorial:write`
- `tools/list` → no extra scope, profile from identity
- Non-JSON-RPC body → defaults to `read-only`
- `profileForIdentity` with all scopes → `workflow-write`
- `profileForIdentity` with only `mcp:read` → `read-only`

**Commit:**
```bash
git commit -m "feat(mcp): add request classifier for capability-aware routing (SKY-29)"
```

---

### Task 3: Capability-Scoped MCP Toolkits

**Files:**
- Modify: `src/mcp/Toolkit.ts`
- Modify: `src/mcp/Router.ts`
- Modify: `src/mcp/OutputSchemas.ts`
- Modify: `src/mcp/Fmt.ts`
- Modify: `src/domain/editorial.ts`
- Modify: `tests/support/runtime.ts`
- Test: `tests/mcp-write-tools.test.ts`

**What to do:**

1. **Split toolkits by capability profile** in `Toolkit.ts`:
   - `ReadOnlyMcpToolkit` — current 12 read tools (no change)
   - `CurationWriteMcpToolkit` — read-only + `curate_post` (13 total)
   - `EditorialWriteMcpToolkit` — read-only + `submit_editorial_pick` (13 total)
   - `WorkflowWriteMcpToolkit` — read-only + `curate_post` + `submit_editorial_pick` (14 total)

   Note: `get_post_enrichments` (SKY-77) is not in scope. Current read-only count stays at 12.

2. **Re-enable `curate_post` handler** — remove the exclusion note. The handler uses `yield* OperatorIdentity` for the actor string (not a separate McpIdentity). `OperatorIdentity` is available because `webHandler.handler(request, operatorIdentityContext(identity))` merges it into the runtime context.

3. **Add `submit_editorial_pick` tool + handler** — MCP-compatible input with `FlexibleNumber` for score/expiresInHours. `SubmitEditorialPickMcpInput` in `src/domain/editorial.ts`.

4. **Add formatters** in `Fmt.ts` — `formatCuratePostResult`, `formatSubmitPickResult`.

5. **Add output schema** in `OutputSchemas.ts` — `SubmitEditorialPickMcpOutput`.

6. **Update `Router.ts`**:
   - Accept `identity: AccessIdentity` parameter from `feed.ts`
   - Use `profileForIdentity(identity)` to select toolkit variant
   - Cache handlers by `env + McpCapabilityProfile` (4 possible cache entries)
   - Pass `operatorIdentityContext(identity)` as the context arg to `webHandler.handler(request, context)`
   - **Do NOT modify `registerToolkitWithDisplayText.ts`** — context merging is handled by the runtime

7. **Update test support** — add identity helpers to `tests/support/runtime.ts`:

   ```ts
   export const readOnlyIdentity: AccessIdentity = {
     subject: "test-reader", email: null, scopes: ["mcp:read"]
   };
   export const workflowIdentity: AccessIdentity = {
     subject: "test-operator", email: "op@test.com",
     scopes: ["mcp:read", "curation:write", "editorial:write"]
   };
   ```

**Tests:**
- Read-only profile sees 12 tools (no write tools)
- Curation-write profile sees 13 tools (includes `curate_post`)
- Workflow-write profile sees 14 tools (includes both write tools)
- `curate_post` handler records correct curator from `OperatorIdentity`
- `submit_editorial_pick` handler records correct curator from `OperatorIdentity`

**Commit:**
```bash
git commit -m "feat(mcp): capability-scoped toolkits with curate_post and submit_editorial_pick (SKY-29, SKY-76)"
```

---

### Task 4: Prompts + Glossary Alignment

**Files:**
- Modify: `src/mcp/prompts.ts`
- Modify: `src/mcp/glossary.ts`
- Test: `tests/mcp.test.ts`

**What to do:**

1. **Add `curate-session` prompt** — uses pipeline vocabulary (Candidate → Enriching → Reviewable → Accepted). Only visible on `workflow-write` profile. This means prompts must also be split by profile, similar to toolkits. The `PromptsLayer` in `Router.ts` should vary by capability profile.

2. **Make `hours` parameter optional** in `curate-digest` and `curate-session`:

   ```ts
   hours: Schema.optional(Schema.String.annotations({
     description: "Hours to look back (default: 24)"
   }))
   ```

3. **Update `curate-digest`** — on read-only profile, text says "produce brief recommendations only." On workflow-write, references write tools with pipeline transition names.

4. **Update glossary** — add:
   - Pipeline stages: Discovered, Candidate, Enriching, Reviewable, Accepted, Rejected, Retracted, Expired
   - Enrichment readiness: none, pending, complete, failed, needs-review
   - Write tools: `curate_post` (Candidate → Enriching/Rejected), `submit_editorial_pick` (Reviewable → Accepted)
   - Decision audit: all transitions logged to `curation_decisions`

5. **Prompt visibility** — `curate-session` only on `workflow-write`. Existing prompts on all profiles.

**Tests:**
- Read-only profile has 3 prompts
- Workflow-write profile has 4 prompts (includes `curate-session`)
- `hours` parameter omitted → prompt uses "24" default in text

**Commit:**
```bash
git commit -m "feat(mcp): add curate-session prompt and align glossary with pipeline vocabulary (SKY-79, SKY-82)"
```

---

## Verification Checklist

1. `bun run typecheck` — clean
2. `bun run test` — all pass
3. `jose` removed from `package.json`
4. `Authorization: Bearer` header works for all admin + MCP routes
5. Legacy `x-skygest-operator-secret` still works with deprecation warning
6. Token comparison uses `crypto.subtle.timingSafeEqual`
7. Missing/invalid token returns 401
8. `/admin/ops/stats` requires `ops:read` scope
9. Staging ops routes gated by `ENABLE_STAGING_OPS` env var (not auth mode)
10. Read-only MCP caller sees 12 tools, 3 prompts
11. Workflow-write MCP caller sees 14 tools, 4 prompts
12. `curate_post` records correct actor from `OperatorIdentity`
13. `submit_editorial_pick` records correct actor from `OperatorIdentity`
14. MCP handler cache keyed by env + capability profile (not identity)
15. `registerToolkitWithDisplayText` unchanged — context merging handled by runtime
16. Request body: clone for classifier, original to MCP handler
17. `AccessIdentity` simplified to `{ subject, email, scopes }`
18. Glossary documents pipeline stages, readiness values, write tools
19. `curate-session` prompt uses pipeline vocabulary throughout

## Issues Resolved

- **SKY-29** — MCP boundary auth + capability routing (Tasks 1-2)
- **SKY-76** — Request-scoped actor context + scoped write toolkits (Task 3)
- **SKY-79** — Domain glossary and ontology alignment (Task 4)
- **SKY-82** — Verification prompt packs (Task 4)
