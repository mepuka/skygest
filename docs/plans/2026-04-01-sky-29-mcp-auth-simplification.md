# MCP Auth Simplification + Capability Routing Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Simplify auth to bearer-token only, add MCP request classification for capability-aware tool/prompt visibility, and expose write tools (`curate_post`, `submit_editorial_pick`) through scoped MCP toolkits.

**Architecture:** Replace the dual-mode auth (CF Access JWT + shared secret) with a single `Authorization: Bearer <token>` path. The bearer token is validated server-side against the `OPERATOR_SECRET` Worker secret. Remove `jose` dependency, CF Access config, and auth mode switching. Add an MCP request classifier that inspects the JSON-RPC envelope to determine capability profile (read-only, curation-write, editorial-write, workflow-write). Cache MCP handlers by env + capability profile.

**Tech Stack:** Effect (`Context.Tag`, `Layer.effect`, `Schema`), Cloudflare Workers, existing `OperatorIdentity` from `src/http/Identity.ts`.

**Auth decision:** Bearer-token only. Single operator. See `project_auth_decision.md` memory.

---

### Task 1: Migrate Auth to Bearer Token Only

**Files:**
- Modify: `src/auth/AuthService.ts`
- Modify: `src/platform/Config.ts`
- Modify: `src/platform/Env.ts`
- Modify: `src/worker/operatorAuth.ts`
- Modify: `src/worker/feed.ts`
- Modify: `src/worker/filter.ts`
- Modify: `src/edge/Layer.ts`
- Test: `tests/operator-auth.test.ts`
- Remove dependency: `jose` from `package.json`

**What to do:**

1. **Simplify `AuthService`** — remove `jose` import, remove `createRemoteJWKSet`/`jwtVerify`, remove `MissingAccessJwtError`/`InvalidAccessJwtError`/`ForbiddenAccessJwtError`/`InvalidAuthConfigError`. Keep `MissingOperatorSecretError` and `InvalidOperatorSecretError`. Replace the dual-mode `requireOperator` with a single path that reads `Authorization: Bearer <token>` header:

   ```ts
   const AUTHORIZATION_HEADER = "authorization";
   const BEARER_PREFIX = "Bearer ";
   ```

   The `requireOperator` method:
   - Extracts the `Authorization` header
   - Checks it starts with `Bearer `
   - Compares the token against `Redacted.value(config.operatorSecret)`
   - Returns an `AccessIdentity` with all `operatorScopes`

   Keep the `AccessIdentity` type unchanged — it's used in 8+ files. Just remove the `issuer`, `audience`, and `payload` fields since they're CF Access concepts. Actually — check if any code reads those fields. If not, simplify the type. If yes, keep compatible values.

2. **Simplify `AppConfig`** — remove `operatorAuthMode`, `accessTeamDomain`, `accessAud` config entries. Remove `OperatorAuthMode` type. Keep `operatorSecret`.

3. **Simplify `Env.ts`** — remove `OPERATOR_AUTH_MODE`, `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD` from `EnvBindings`.

4. **Update `operatorAuth.ts`** — the `authorizeOperator` function and `requiredOperatorScopes` stay the same. Just update error handling to remove CF Access error types.

5. **Update `feed.ts` and `filter.ts`** — no structural changes needed if `authorizeOperator` signature stays the same.

6. **Update `edge/Layer.ts`** — `authLayer` construction should use the simplified `AuthService.layer`.

7. **Remove `jose` from `package.json`** — run `bun remove jose`.

8. **Update `operatorAuth.ts` error handling** — `toAuthErrorResponse` and `logDeniedOperatorRequest` reference CF Access error classes. Update to only handle `MissingOperatorSecretError` and `InvalidOperatorSecretError`.

**Backward compatibility for ops CLI:**

The ops CLI currently sends `x-skygest-operator-secret`. Update the auth to accept BOTH `Authorization: Bearer` (preferred) AND `x-skygest-operator-secret` (legacy fallback) during transition. Document that the legacy header is deprecated.

```ts
const extractToken = (headers: Headers): string | null => {
  // Preferred: Authorization: Bearer <token>
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

**Tests:**
- Update `tests/operator-auth.test.ts` — test `Authorization: Bearer` header
- Test legacy `x-skygest-operator-secret` still works
- Test missing/invalid token returns 401
- Test `/admin/ops/stats` requires `ops:read` scope (fix from MCP plan)

**Commit:**
```bash
git commit -m "feat(auth): simplify to bearer-token only, remove CF Access JWT (SKY-29)"
```

---

### Task 2: MCP Request Classifier

**Files:**
- Create: `src/mcp/McpRequestAuth.ts`
- Test: `tests/mcp-request-auth.test.ts`

**What to do:**

Create a small module that classifies MCP JSON-RPC requests to determine capability requirements.

```ts
// src/mcp/McpRequestAuth.ts

export type McpCapabilityProfile =
  | "read-only"
  | "curation-write"
  | "editorial-write"
  | "workflow-write";

export type McpRequestClassification = {
  readonly method: string;
  readonly toolOrPromptName: string | null;
  readonly requiredScopes: ReadonlyArray<string>;
  readonly capabilityProfile: McpCapabilityProfile;
};
```

The classifier:
1. Reads the request body as JSON (for `tools/call` and `prompts/get`, extracts the tool/prompt name from the params)
2. Maps tool/prompt names to required scopes:
   - `curate_post` → `curation:write`
   - `submit_editorial_pick` → `editorial:write`
   - `curate-session` prompt → `curation:write` + `editorial:write`
   - everything else → `mcp:read` (already enforced at HTTP boundary)
3. Determines the capability profile based on which scopes the caller has

For `tools/list` and `prompts/list`: no extra scopes needed, but the response should only include tools/prompts matching the caller's profile. This is handled in Task 3 (toolkit splitting), not here.

**Important:** The classifier must clone or buffer the request body because the MCP server also needs to read it. Use `request.clone()` before reading.

**Tests:**
- `tools/call` with `curate_post` → requires `curation:write`
- `tools/call` with `search_posts` → requires `mcp:read` only
- `prompts/get` with `curate-session` → requires both `curation:write` and `editorial:write`
- `tools/list` → no extra scope
- Non-JSON-RPC request → defaults to `read-only`

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
- Test: `tests/mcp-write-tools.test.ts`

**What to do:**

1. **Split toolkits by capability profile** in `Toolkit.ts`:
   - `ReadOnlyMcpToolkit` — current 12 read tools + `get_post_enrichments` (13 total)
   - `CurationWriteMcpToolkit` — read-only + `curate_post` (14 total)
   - `EditorialWriteMcpToolkit` — read-only + `submit_editorial_pick` (14 total)
   - `WorkflowWriteMcpToolkit` — read-only + `curate_post` + `submit_editorial_pick` (15 total)

2. **Re-enable `curate_post` handler** — remove the exclusion note. The handler uses `OperatorIdentity` from request context for the actor string.

3. **Add `submit_editorial_pick` tool + handler** — MCP-compatible input with `FlexibleNumber` for score/expiresInHours. Handler delegates to `EditorialService.submitPick()`.

4. **Add MCP input schema** for `submit_editorial_pick` in `src/domain/editorial.ts` (already designed in the MCP plan — `SubmitEditorialPickMcpInput`).

5. **Add formatters** in `Fmt.ts` — `formatCuratePostResult`, `formatSubmitPickResult`.

6. **Add output schema** in `OutputSchemas.ts` — `SubmitEditorialPickMcpOutput`.

7. **Update `Router.ts`** to:
   - Accept identity from `feed.ts` (passed through from `authorizeOperator`)
   - Use `McpRequestAuth.classifyRequest()` to determine capability profile
   - Select the right toolkit variant based on profile
   - Cache handlers by env + capability profile
   - Pass `operatorIdentityContext(identity)` to `webHandler.handler(request, context)`
   - Update `registerToolkitWithDisplayText.ts` to merge request-time context with registration context

**Tests:**
- Read-only profile sees 13 tools
- Curation-write profile sees 14 tools (includes `curate_post`)
- Workflow-write profile sees 15 tools (includes both write tools)
- `curate_post` handler records the correct curator from identity
- `submit_editorial_pick` handler records the correct curator from identity
- Missing write scope returns error on `tools/call`

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

1. **Add `curate-session` prompt** — workflow prompt using pipeline vocabulary (per SKY-82 and the MCP plan). Only visible on `workflow-write` profile.

2. **Make `hours` parameter optional** in `curate-digest` and `curate-session` — use `Schema.optional(Schema.String)` with a default in the prompt text.

3. **Update `curate-digest`** — if on read-only profile, clearly say "produce recommendations only." If on workflow-write, reference write tools by pipeline transition name.

4. **Update glossary** — add pipeline stages, enrichment readiness values, write tool descriptions with transition names, `curation_decisions` audit trail (per SKY-79).

5. **Update prompt visibility** — `curate-session` only on `workflow-write` profile. Existing prompts on all profiles.

**Tests:**
- Read-only profile has 3 prompts
- Workflow-write profile has 4 prompts (includes `curate-session`)
- Prompt parameter defaults actually work

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
5. Legacy `x-skygest-operator-secret` still works (deprecated)
6. Missing/invalid token returns 401
7. Read-only MCP caller sees 13 tools, 3 prompts
8. Workflow-write MCP caller sees 15 tools, 4 prompts
9. `curate_post` records correct actor from identity
10. `submit_editorial_pick` records correct actor from identity
11. Denied write tool call returns error with tool name in message
12. MCP handler cache is keyed by env + capability profile (not by identity)
13. No auth state leaks between requests on a warm worker
14. Glossary documents pipeline stages, readiness values, write tools
15. `curate-session` prompt uses pipeline vocabulary throughout

## Issues Resolved

This plan covers work from multiple Linear issues:
- **SKY-29** — MCP boundary auth + capability routing (Tasks 1-2)
- **SKY-76** — Request-scoped actor context + scoped write toolkits (Task 3)
- **SKY-79** — Domain glossary and ontology alignment (Task 4)
- **SKY-82** — Verification prompt packs (Task 4)
