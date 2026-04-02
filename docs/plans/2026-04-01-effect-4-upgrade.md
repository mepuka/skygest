# Effect 3 → Effect 4 Upgrade Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Upgrade skygest-cloudflare from Effect 3 to Effect 4 beta, replacing `@effect/*` packages with `effect/unstable/*` imports.

**Architecture:** In Effect 4, most `@effect/*` packages are folded into the main `effect` package under `effect/unstable/*`. The upgrade removes ~10 separate `@effect/*` dependencies and replaces them with imports from the unified package. Service definitions change from `Context.Tag` to `ServiceMap.Service`. Schema APIs rename (`TaggedError` → `TaggedErrorClass`, `optional` → `optionalKey`).

**Tech Stack:** Effect 4.0.0-beta.43, `@effect/vitest` 4.0.0-beta.43, `@effect/sql-d1` 4.0.0-beta.43, Bun, Cloudflare Workers

**Linear:** SKY-117

---

## Package Migration Map

| Effect 3 Package | Effect 4 Import |
|---|---|
| `@effect/platform` (HttpClient, FetchHttpClient) | `effect/unstable/http/HttpClient`, `effect/unstable/http/FetchHttpClient` |
| `@effect/platform` (HttpApi, HttpApiBuilder, HttpApiEndpoint, HttpApiGroup) | `effect/unstable/httpapi/HttpApi`, etc. |
| `@effect/platform` (HttpApiSchema) | `effect/unstable/httpapi/HttpApiSchema` |
| `@effect/ai` (McpServer, Completions) | `effect/unstable/ai/McpServer`, etc. |
| `@effect/cli` (Command, Options, Args) | `effect/unstable/cli/Command`, etc. |
| `@effect/sql` (SqlClient) | `effect/unstable/sql/SqlClient` |
| `@effect/sql/SqlError` | `effect/unstable/sql/SqlError` |
| `@effect/printer` | `effect/unstable/printer/*` or removed |
| `@effect/platform-bun` (BunRuntime, BunContext, FileSystem) | `effect/unstable/platform-bun/*` or `effect/unstable/*` |
| `@effect/sql-sqlite-bun` | `@effect/sql-sqlite-bun@4.0.0-beta.43` (still separate) |
| `@effect/sql-sqlite-node` | `@effect/sql-sqlite-node@4.0.0-beta.43` (still separate) |
| `@effect/sql-d1` | `@effect/sql-d1@4.0.0-beta.43` (still separate) |
| `@effect/vitest` | `@effect/vitest@4.0.0-beta.43` (still separate) |

**NOTE:** The exact import paths above are best-effort from npm pack inspection. `tsc --noEmit` after the dependency bump will reveal the actual paths. The D1, SQLite, and vitest packages remain separate with their own Effect 4 betas.

---

## Task 1: Dependency Bump + Error Baseline

**Files:**
- Modify: `package.json`

**Step 1: Update package.json**

```bash
bun add effect@4.0.0-beta.43
bun add -d @effect/vitest@4.0.0-beta.43
bun add @effect/sql-d1@4.0.0-beta.43
bun add -d @effect/sql-sqlite-bun@4.0.0-beta.43
bun add -d @effect/sql-sqlite-node@4.0.0-beta.43
```

Remove packages that are now in `effect` core (only after verifying imports exist):
```bash
bun remove @effect/platform @effect/platform-bun @effect/ai @effect/cli @effect/sql @effect/printer
```

**Step 2: Run tsc to get error baseline**

```bash
bunx tsc --noEmit 2>&1 | wc -l
bunx tsc --noEmit 2>&1 | head -50
```

Record the error count — this is the progress tracker. Each subsequent task should reduce it toward zero.

**Step 3: Commit**

```bash
git commit -m "chore: bump effect to v4.0.0-beta.43, remove folded @effect/* packages"
```

---

## Task 2: Fix Import Paths

**Files:** All files that import from `@effect/platform`, `@effect/ai`, `@effect/cli`, `@effect/sql`, `@effect/printer`

This is the most discovery-heavy task. After the dependency bump, `tsc` errors will show every broken import. Fix them by mapping old package imports to new `effect/unstable/*` paths.

**Step 1: Fix imports file by file**

Use the package migration map above as a guide. For each `tsc` error about a missing module:
1. Find the new import path in `effect/unstable/*`
2. Update the import statement

Key import patterns to find and replace:

```ts
// HTTP
import { HttpClient } from "@effect/platform"        → import * as HttpClient from "effect/unstable/http/HttpClient"
import { FetchHttpClient } from "@effect/platform"    → import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient"
import { HttpClientResponse } from "@effect/platform" → import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse"

// HTTP API (routers)
import * as HttpApi from "@effect/platform/HttpApi"                   → import * as HttpApi from "effect/unstable/httpapi/HttpApi"
import * as HttpApiBuilder from "@effect/platform/HttpApiBuilder"     → import * as HttpApiBuilder from "effect/unstable/httpapi/HttpApiBuilder"
import * as HttpApiEndpoint from "@effect/platform/HttpApiEndpoint"   → import * as HttpApiEndpoint from "effect/unstable/httpapi/HttpApiEndpoint"
import * as HttpApiGroup from "@effect/platform/HttpApiGroup"         → import * as HttpApiGroup from "effect/unstable/httpapi/HttpApiGroup"
import * as HttpApiSchema from "@effect/platform/HttpApiSchema"       → import * as HttpApiSchema from "effect/unstable/httpapi/HttpApiSchema"

// AI (MCP)
import { McpServer } from "@effect/ai"  → import { McpServer } from "effect/unstable/ai/McpServer"

// CLI
import { Command, Options, Args } from "@effect/cli"  → from "effect/unstable/cli/Command", etc.

// SQL
import { SqlClient } from "@effect/sql"   → import * as SqlClient from "effect/unstable/sql/SqlClient"
import { SqlError } from "@effect/sql"    → import * as SqlError from "effect/unstable/sql/SqlError"

// Platform Bun
import { BunRuntime, BunContext } from "@effect/platform-bun"  → check effect/unstable/* or Bun-specific
```

**Step 2: Run tsc to verify import errors are resolved**

```bash
bunx tsc --noEmit 2>&1 | wc -l
```

Remaining errors should be API changes (TaggedError, optional, Context.Tag), not missing modules.

**Step 3: Commit**

```bash
git commit -m "refactor: migrate @effect/* imports to effect/unstable/*"
```

---

## Task 3: Schema.TaggedError → Schema.TaggedErrorClass

**Files:** 11 files with 43 occurrences

- `src/domain/errors.ts` (24 occurrences)
- `src/domain/bi.ts` (4)
- `src/ops/Errors.ts` (5)
- `src/services/OntologyCatalog.ts` (2)
- `src/domain/editorial.ts`, `curation.ts`, `candidatePayload.ts` (1 each)
- `src/services/EnrichmentTriggerClient.ts`, `src/platform/Env.ts`, `src/mcp/Client.ts`, `src/auth/AuthService.ts` (1-2 each)

**Step 1: Global find-and-replace**

In every file: `Schema.TaggedError<` → `Schema.TaggedErrorClass<`

```bash
# Verify the change is safe — every occurrence should be a class definition
grep -rn "Schema.TaggedError<" src/ | wc -l
# Then replace
sed -i '' 's/Schema\.TaggedError</Schema.TaggedErrorClass</g' src/**/*.ts
```

**Step 2: Run tsc to verify**

```bash
bunx tsc --noEmit 2>&1 | grep "TaggedError" | wc -l
```

Should be zero TaggedError-related errors.

**Step 3: Commit**

```bash
git commit -m "refactor: Schema.TaggedError → Schema.TaggedErrorClass (Effect 4)"
```

---

## Task 4: Schema.optional → Schema.optionalKey

**Files:** 23 files with ~305 occurrences

**IMPORTANT:** Not every `Schema.optional` becomes `Schema.optionalKey`. Audit each occurrence:
- Inside `Schema.Struct({...})` field definitions → change to `Schema.optionalKey`
- Inside `Schema.TaggedErrorClass` field definitions → change to `Schema.optionalKey`
- Standalone usage (e.g., `Schema.optional(Schema.String)` as a standalone type) → may stay as `Schema.optional` or need different treatment

Also check `Schema.optionalWith` — may become `Schema.optionalKeyWith` or similar.

**Step 1: Let tsc guide you**

After Tasks 2-3, remaining `Schema.optional` errors from `tsc` will show exactly which ones need changing. Fix each file based on tsc output rather than blind find-and-replace.

**Step 2: Run tsc to verify**

```bash
bunx tsc --noEmit 2>&1 | grep "optional" | wc -l
```

**Step 3: Commit**

```bash
git commit -m "refactor: Schema.optional → Schema.optionalKey in struct fields (Effect 4)"
```

---

## Task 5: Context.Tag → ServiceMap.Service

**Files:** 42 service definition files

Transform pattern:

```ts
// Effect 3
export class MyService extends Context.Tag("@skygest/MyService")<
  MyService,
  { readonly method: () => Effect.Effect<Result> }
>() {
  static readonly layer = Layer.effect(
    MyService,
    Effect.gen(function* () {
      // ...
      return MyService.of({ method: () => ... });
    })
  );
}

// Effect 4
export class MyService extends ServiceMap.Service<
  MyService,
  { readonly method: () => Effect.Effect<Result> }
>()("@skygest/MyService") {
  static readonly layer = Layer.effect(
    MyService,
    Effect.gen(function* () {
      // ...
      return { method: () => ... };  // no .of() wrapper
    })
  );
}
```

Changes per file:
1. Replace `import { Context, ... }` with `import { ServiceMap, ... }` (add ServiceMap, may keep Context if used elsewhere)
2. Change class signature: `Context.Tag("id")<Self, Shape>()` → `ServiceMap.Service<Self, Shape>()("id")`
3. Remove `.of()` from layer return values

**Step 1: Transform all service files**

Work through tsc errors. Each service file is the same mechanical transform.

**Step 2: Fix type helpers**

`src/mcp/Toolkit.ts` uses `Context.Tag.Service<typeof X>` type helper. In Effect 4 this may be `ServiceMap.Service.Type<typeof X>` or extracted differently. Check tsc errors.

**Step 3: Run tsc**

```bash
bunx tsc --noEmit 2>&1 | wc -l
```

Target: zero errors.

**Step 4: Commit**

```bash
git commit -m "refactor: Context.Tag → ServiceMap.Service (Effect 4)"
```

---

## Task 6: Run Full Test Suite + Fix Failures

**Step 1: Run all tests**

```bash
bun run test
```

**Step 2: Fix any test failures**

Test files may need the same import/API changes as source files. Common issues:
- Test helpers using `Context.Tag`
- Test mocks returning `.of()` wrapped values
- Import path changes in test files

**Step 3: Run tsc + tests**

```bash
bunx tsc --noEmit && bun run test
```

Both must pass with zero errors/failures.

**Step 4: Commit**

```bash
git commit -m "test: fix test suite for Effect 4 compatibility"
```

---

## Task 7: Cleanup + Verify

**Step 1: Check for leftover Effect 3 patterns**

```bash
grep -rn "Context.Tag" src/ tests/
grep -rn "Schema.TaggedError<" src/ tests/
grep -rn "@effect/platform" src/ tests/
grep -rn "@effect/ai" src/ tests/
grep -rn "@effect/cli" src/ tests/
grep -rn "@effect/sql\"" src/ tests/
```

All should return zero results (except maybe comments or docs).

**Step 2: Verify package.json is clean**

Ensure removed packages are gone, versions are correct.

**Step 3: Final verification**

```bash
bunx tsc --noEmit && bun run test
```

**Step 4: Commit**

```bash
git commit -m "chore: cleanup leftover Effect 3 references"
```

---

## Verification Checklist

1. `bunx tsc --noEmit` — zero errors
2. `bun run test` — all 600+ tests pass
3. No `@effect/platform`, `@effect/ai`, `@effect/cli`, `@effect/sql` in package.json dependencies
4. No `Context.Tag` in source files
5. No `Schema.TaggedError<` (should be `TaggedErrorClass`) in source files
6. `@effect/sql-d1`, `@effect/sql-sqlite-bun`, `@effect/sql-sqlite-node`, `@effect/vitest` on `4.0.0-beta.43`
7. `effect` on `4.0.0-beta.43`
