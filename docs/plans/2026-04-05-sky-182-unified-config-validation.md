# SKY-182: Unified Config Validation — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a shared config validation layer using Effect Config that validates all required secrets and settings at startup, reports all failures at once (per-key, not per-group), and works across both repos.

**Architecture:** Individual config key declarations live in `src/platform/ConfigShapes.ts` — zero Cloudflare Worker type dependencies so the editorial repo can import them. A `ConfigValidation` module validates every key independently via `Effect.result` and aggregates all failures into a single error. Each entry point (Worker, CLI, editorial scripts) provides its own `ConfigProvider` chain and calls the shared validation. The editorial repo gains a `scripts/validate-config.ts` that catches misconfiguration before any MCP call.

**Tech Stack:** Effect 4 (`effect@4.0.0-beta.43`): `Config`, `Config.all`, `Config.mapOrFail`, `Config.url`, `ConfigProvider`, `Redacted`, `Effect.result`, `Effect.catch`, `Schema.TaggedErrorClass`. Bun runtime for editorial scripts.

**API notes (Effect 4 renames from v3):** `Effect.either` → `Effect.result` (returns `Result.Result`). `Effect.catchAll` → `Effect.catch`. `Config.validate` does not exist — use `Config.mapOrFail` instead. `Config.url` returns `Config<URL>` with format validation.

---

## Research summary

Three agents surveyed the codebase. Key findings that shape this plan:

1. **~20 config values** across both repos, 6 secrets. Naming inconsistency: Worker uses `OPERATOR_SECRET`, CLI/editorial use `SKYGEST_OPERATOR_SECRET` (same value, two names).
2. **`Config.all` is fail-fast** — reports only the first missing key within a group. To validate every key independently, we must resolve each key as a separate `Effect.result`, not rely on `Config.all` for accumulation.
3. **`Config.ts` imports `CloudflareEnv`** which depends on `D1Database`, `KVNamespace`, etc. Editorial repo doesn't have `@cloudflare/workers-types`. Solution: separate shapes (no CF deps) from provider wiring (CF-specific).
4. **Editorial has zero config validation today.** Missing `SKYGEST_OPERATOR_SECRET` surfaces as a silent MCP 401, not a clear startup error.
5. **Twitter cookies are validated nowhere** — `JSON.parse` with no Schema, no expiry check. This plan scopes cookie validation as a future extension point, not a deliverable (depends on SKY-180).
6. **Gemini API key is Worker-only** — editorial is CLI-based, no `GOOGLE_API_KEY` needed in editorial config.

## Config keys

Individual keys (not groups) are the unit of validation. The validator resolves each independently.

| Key name | Type | Required? | Default | Used by |
|---|---|---|---|---|
| `SKYGEST_OPERATOR_SECRET` | `Config.redacted` + non-empty check | yes | — | CLI ops, editorial |
| `SKYGEST_STAGING_BASE_URL` | `Config.url` (validates URL format) | yes | — | CLI ops, editorial |
| `OPERATOR_SECRET` | `Config.redacted` | no | `""` | Worker runtime |
| `PUBLIC_BSKY_API` | `Config.url` | no | `https://public.api.bsky.app` | Worker runtime |
| `INGEST_SHARD_COUNT` | `Config.int` | no | `1` | Worker runtime |
| `DEFAULT_DOMAIN` | `Config.string` | no | `"energy"` | Worker runtime |
| `MCP_LIMIT_DEFAULT` | `Config.int` | no | `20` | Worker runtime |
| `MCP_LIMIT_MAX` | `Config.int` | no | `100` | Worker runtime |
| `ENABLE_STAGING_OPS` | `Config.boolean` | no | `false` | Worker runtime |
| `EDITORIAL_DEFAULT_EXPIRY_HOURS` | `Config.int` | no | `24` | Worker runtime |
| `CURATION_MIN_SIGNAL_SCORE` | `Config.int` | no | `30` | Worker runtime |
| `GOOGLE_API_KEY` | `Config.redacted` | yes (enrichment) | — | Enrichment workflow |
| `GEMINI_VISION_MODEL` | `Config.string` | no | `"gemini-2.5-flash"` | Enrichment workflow |

---

### Task 1: Create `ConfigShapes.ts` — shared individual config declarations

**Files:**
- Create: `src/platform/ConfigShapes.ts`
- Test: `tests/platform/ConfigShapes.test.ts`

**Step 1: Write the test**

```typescript
// tests/platform/ConfigShapes.test.ts
import { describe, expect, it } from "@effect/vitest";
import { Effect, ConfigProvider, Result } from "effect";
import {
  OperatorKeys,
  WorkerKeys,
  EnrichmentKeys
} from "../../src/platform/ConfigShapes";

describe("ConfigShapes", () => {
  describe("OperatorKeys", () => {
    it.effect("operatorSecret resolves from env", () =>
      Effect.gen(function* () {
        const provider = ConfigProvider.fromUnknown({
          SKYGEST_OPERATOR_SECRET: "test-secret-123"
        });
        const result = yield* OperatorKeys.operatorSecret.parse(provider);
        // redacted value should resolve without error
        expect(result).toBeDefined();
      })
    );

    it.effect("operatorSecret fails when missing", () =>
      Effect.gen(function* () {
        const provider = ConfigProvider.fromUnknown({});
        const result = yield* Effect.result(
          OperatorKeys.operatorSecret.parse(provider)
        );
        expect(result._tag).toBe("Failure");
      })
    );

    it.effect("operatorSecret fails when empty string", () =>
      Effect.gen(function* () {
        const provider = ConfigProvider.fromUnknown({
          SKYGEST_OPERATOR_SECRET: ""
        });
        const result = yield* Effect.result(
          OperatorKeys.operatorSecret.parse(provider)
        );
        expect(result._tag).toBe("Failure");
      })
    );

    it.effect("baseUrl validates URL format", () =>
      Effect.gen(function* () {
        const provider = ConfigProvider.fromUnknown({
          SKYGEST_STAGING_BASE_URL: "not-a-url"
        });
        const result = yield* Effect.result(
          OperatorKeys.baseUrl.parse(provider)
        );
        expect(result._tag).toBe("Failure");
      })
    );

    it.effect("baseUrl resolves valid URL", () =>
      Effect.gen(function* () {
        const provider = ConfigProvider.fromUnknown({
          SKYGEST_STAGING_BASE_URL: "https://example.com/mcp"
        });
        const result = yield* OperatorKeys.baseUrl.parse(provider);
        expect(result).toBeInstanceOf(URL);
        expect(result.href).toContain("example.com");
      })
    );
  });

  describe("WorkerKeys", () => {
    it.effect("publicApi defaults to public Bluesky API", () =>
      Effect.gen(function* () {
        const provider = ConfigProvider.fromUnknown({});
        const result = yield* WorkerKeys.publicApi.parse(provider);
        expect(result).toBeInstanceOf(URL);
        expect(result.href).toContain("public.api.bsky.app");
      })
    );

    it.effect("mcpLimitDefault defaults to 20", () =>
      Effect.gen(function* () {
        const provider = ConfigProvider.fromUnknown({});
        const result = yield* WorkerKeys.mcpLimitDefault.parse(provider);
        expect(result).toBe(20);
      })
    );
  });

  describe("EnrichmentKeys", () => {
    it.effect("googleApiKey fails when missing", () =>
      Effect.gen(function* () {
        const provider = ConfigProvider.fromUnknown({});
        const result = yield* Effect.result(
          EnrichmentKeys.googleApiKey.parse(provider)
        );
        expect(result._tag).toBe("Failure");
      })
    );

    it.effect("visionModel defaults to gemini-2.5-flash", () =>
      Effect.gen(function* () {
        const provider = ConfigProvider.fromUnknown({});
        const result = yield* EnrichmentKeys.visionModel.parse(provider);
        expect(result).toBe("gemini-2.5-flash");
      })
    );
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun run test tests/platform/ConfigShapes.test.ts`
Expected: FAIL — module not found

**Step 3: Write the implementation**

```typescript
// src/platform/ConfigShapes.ts
//
// Shared config key declarations — no Cloudflare Worker type dependencies.
// Importable by skygest-editorial via @skygest/platform/ConfigShapes.
//
import { Config, ConfigError, Effect, Redacted } from "effect";

// ── Helpers ────────────────────────────────────────────────────────────

/** Redacted config that rejects empty/whitespace-only values. */
const nonEmptyRedacted = (name: string) =>
  Config.redacted(name).pipe(
    Config.mapOrFail((value) =>
      Redacted.value(value).trim().length > 0
        ? Effect.succeed(value)
        : Effect.fail(
            new ConfigError.MissingData(
              [],
              `${name} must not be empty`
            )
          )
    )
  );

// ── Operator / Editorial keys ──────────────────────────────────────────

export const OperatorKeys = {
  operatorSecret: nonEmptyRedacted("SKYGEST_OPERATOR_SECRET"),
  baseUrl: Config.url("SKYGEST_STAGING_BASE_URL")
} as const;

// ── Worker runtime keys ────────────────────────────────────────────────

export const WorkerKeys = {
  publicApi: Config.withDefault(
    Config.url("PUBLIC_BSKY_API"),
    new URL("https://public.api.bsky.app")
  ),
  ingestShardCount: Config.withDefault(Config.int("INGEST_SHARD_COUNT"), 1),
  defaultDomain: Config.withDefault(Config.string("DEFAULT_DOMAIN"), "energy"),
  mcpLimitDefault: Config.withDefault(Config.int("MCP_LIMIT_DEFAULT"), 20),
  mcpLimitMax: Config.withDefault(Config.int("MCP_LIMIT_MAX"), 100),
  operatorSecret: Config.withDefault(
    Config.redacted("OPERATOR_SECRET"),
    Redacted.make("")
  ),
  enableStagingOps: Config.withDefault(
    Config.boolean("ENABLE_STAGING_OPS"),
    false
  ),
  editorialDefaultExpiryHours: Config.withDefault(
    Config.int("EDITORIAL_DEFAULT_EXPIRY_HOURS"),
    24
  ),
  curationMinSignalScore: Config.withDefault(
    Config.int("CURATION_MIN_SIGNAL_SCORE"),
    30
  )
} as const;

// ── Enrichment keys ────────────────────────────────────────────────────

export const EnrichmentKeys = {
  googleApiKey: Config.redacted("GOOGLE_API_KEY"),
  visionModel: Config.withDefault(
    Config.string("GEMINI_VISION_MODEL"),
    "gemini-2.5-flash"
  )
} as const;
```

Note: keys are exported as plain records of individual `Config<T>` values, NOT wrapped in `Config.all`. This lets the validator resolve each key independently. Consumers that want a grouped struct can `Config.all(OperatorKeys)` themselves.

**Step 4: Run tests**

Run: `bun run test tests/platform/ConfigShapes.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/platform/ConfigShapes.ts tests/platform/ConfigShapes.test.ts
git commit -m "feat(config): add shared config key declarations (SKY-182)"
```

---

### Task 2: Create `ConfigValidation.ts` — per-key all-at-once error reporting

**Files:**
- Create: `src/platform/ConfigValidation.ts`
- Test: `tests/platform/ConfigValidation.test.ts`

The validator takes a flat record of named `Config<T>` values, resolves each one independently via `Effect.result`, and aggregates all failures into a single error. This is per-key, not per-group.

**Step 1: Write the test**

```typescript
// tests/platform/ConfigValidation.test.ts
import { describe, expect, it } from "@effect/vitest";
import { Effect, ConfigProvider, Result } from "effect";
import {
  validateKeys,
  ConfigValidationError
} from "../../src/platform/ConfigValidation";
import { OperatorKeys, EnrichmentKeys } from "../../src/platform/ConfigShapes";

describe("ConfigValidation", () => {
  it.effect("reports all missing keys at once — not fail-fast", () =>
    Effect.gen(function* () {
      // All three required keys missing: operatorSecret, baseUrl, googleApiKey
      const allKeys = { ...OperatorKeys, ...EnrichmentKeys };
      const result = yield* Effect.result(
        validateKeys(allKeys, ConfigProvider.fromUnknown({}))
      );
      expect(result._tag).toBe("Failure");
      if (result._tag === "Failure") {
        const error = Result.causeSquash(result);
        expect(error).toBeInstanceOf(ConfigValidationError);
        if (error instanceof ConfigValidationError) {
          // Must report all three, not just the first
          expect(error.failures.length).toBe(3);
          const names = error.failures.map((f) => f.key);
          expect(names).toContain("operatorSecret");
          expect(names).toContain("baseUrl");
          expect(names).toContain("googleApiKey");
        }
      }
    })
  );

  it.effect("succeeds when all required keys present", () =>
    Effect.gen(function* () {
      const result = yield* validateKeys(
        OperatorKeys,
        ConfigProvider.fromUnknown({
          SKYGEST_OPERATOR_SECRET: "test-secret",
          SKYGEST_STAGING_BASE_URL: "https://example.com"
        })
      );
      expect(result.baseUrl).toBeInstanceOf(URL);
    })
  );

  it.effect("defaults still resolve alongside failures", () =>
    Effect.gen(function* () {
      // visionModel has a default, googleApiKey does not
      const result = yield* Effect.result(
        validateKeys(EnrichmentKeys, ConfigProvider.fromUnknown({}))
      );
      expect(result._tag).toBe("Failure");
      if (result._tag === "Failure") {
        const error = Result.causeSquash(result);
        if (error instanceof ConfigValidationError) {
          // Only googleApiKey should fail; visionModel has a default
          expect(error.failures.length).toBe(1);
          expect(error.failures[0]!.key).toBe("googleApiKey");
          expect(error.successes).toContain("visionModel");
        }
      }
    })
  );

  it.effect("summary is human-readable", () =>
    Effect.gen(function* () {
      const result = yield* Effect.result(
        validateKeys(OperatorKeys, ConfigProvider.fromUnknown({}))
      );
      if (result._tag === "Failure") {
        const error = Result.causeSquash(result);
        if (error instanceof ConfigValidationError) {
          expect(error.summary).toContain("operatorSecret");
          expect(error.summary).toContain("baseUrl");
          expect(error.summary).toContain("Failed");
        }
      }
    })
  );
});
```

**Step 2: Run test to verify it fails**

Run: `bun run test tests/platform/ConfigValidation.test.ts`
Expected: FAIL — module not found

**Step 3: Write the implementation**

```typescript
// src/platform/ConfigValidation.ts
import { Config, ConfigProvider, Effect, Result, Schema } from "effect";

export class ConfigValidationError extends Schema.TaggedErrorClass<ConfigValidationError>()(
  "ConfigValidationError",
  {
    failures: Schema.Array(Schema.Struct({
      key: Schema.String,
      message: Schema.String
    })),
    successes: Schema.Array(Schema.String)
  }
) {
  get summary(): string {
    const failLines = this.failures
      .map((f) => `  ${f.key}: ${f.message}`)
      .join("\n");
    const successLines = this.successes
      .map((s) => `  ${s}: OK`)
      .join("\n");
    return [
      `Config validation: ${this.failures.length} key(s) failed`,
      "",
      "Failed:",
      failLines,
      ...(this.successes.length > 0 ? ["", "Resolved:", successLines] : [])
    ].join("\n");
  }
}

/**
 * Validate a flat record of named Config keys against a provider.
 * Resolves EVERY key independently and reports ALL failures at once.
 */
export const validateKeys = <
  Keys extends Record<string, Config.Config<unknown>>
>(
  keys: Keys,
  provider: ConfigProvider.ConfigProvider
): Effect.Effect<
  { [K in keyof Keys]: Config.Success<Keys[K]> },
  ConfigValidationError
> =>
  Effect.gen(function* () {
    const entries = Object.entries(keys);

    // Resolve each key independently — never fail-fast
    const results = yield* Effect.all(
      entries.map(([name, config]) =>
        Effect.result(
          (config as Config.Config<unknown>).parse(provider)
        ).pipe(
          Effect.map((result) => ({ name, result }))
        )
      ),
      { concurrency: "unbounded" }
    );

    const failures: Array<{ key: string; message: string }> = [];
    const successes: Array<string> = [];
    const resolved: Array<[string, unknown]> = [];

    for (const { name, result } of results) {
      if (result._tag === "Success") {
        successes.push(name);
        resolved.push([name, result.value]);
      } else {
        failures.push({
          key: name,
          message: String(Result.causeSquash(result))
        });
      }
    }

    if (failures.length > 0) {
      return yield* new ConfigValidationError({ failures, successes });
    }

    return Object.fromEntries(resolved) as {
      [K in keyof Keys]: Config.Success<Keys[K]>;
    };
  });
```

**Step 4: Run tests**

Run: `bun run test tests/platform/ConfigValidation.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/platform/ConfigValidation.ts tests/platform/ConfigValidation.test.ts
git commit -m "feat(config): add per-key all-at-once config validation (SKY-182)"
```

---

### Task 3: Refactor `Config.ts` to use `ConfigShapes.ts`

**Files:**
- Modify: `src/platform/Config.ts`

`AppConfig` delegates to `Config.all(WorkerKeys)` from shapes. Pure refactor, zero behavior change — `Config.all` on keys with defaults still resolves identically.

**Step 1: Run existing tests as baseline**

Run: `bun run test`
Expected: PASS (capture count)

**Step 2: Refactor Config.ts**

```typescript
// src/platform/Config.ts
import { Array, Config, ConfigProvider, ServiceMap, Effect, Layer, Result } from "effect";
import { CloudflareEnv } from "./Env";
import { WorkerKeys } from "./ConfigShapes";

const WorkerConfig = Config.all(WorkerKeys);

export type AppConfigShape = Config.Success<typeof WorkerConfig>;

export class AppConfig extends ServiceMap.Service<
  AppConfig,
  AppConfigShape
>()("@skygest/AppConfig") {
  static layer = Layer.effect(
    AppConfig,
    Effect.gen(function* () {
      const env = yield* CloudflareEnv;
      const entries = Array.filterMap(
        [
          ["PUBLIC_BSKY_API", env.PUBLIC_BSKY_API],
          ["INGEST_SHARD_COUNT", env.INGEST_SHARD_COUNT],
          ["DEFAULT_DOMAIN", env.DEFAULT_DOMAIN],
          ["MCP_LIMIT_DEFAULT", env.MCP_LIMIT_DEFAULT],
          ["MCP_LIMIT_MAX", env.MCP_LIMIT_MAX],
          ["OPERATOR_SECRET", env.OPERATOR_SECRET],
          ["ENABLE_STAGING_OPS", env.ENABLE_STAGING_OPS],
          ["EDITORIAL_DEFAULT_EXPIRY_HOURS", env.EDITORIAL_DEFAULT_EXPIRY_HOURS],
          ["CURATION_MIN_SIGNAL_SCORE", env.CURATION_MIN_SIGNAL_SCORE]
        ] as const,
        ([key, value]) =>
          value == null
            ? Result.failVoid
            : Result.succeed([key, String(value)] as const)
      );
      const provider = ConfigProvider.fromUnknown(Object.fromEntries(entries));
      const config = yield* WorkerConfig.parse(provider);

      return config satisfies AppConfigShape;
    })
  );
}
```

Note: `AppConfigShape` type may change slightly since `WorkerKeys.publicApi` is now `Config<URL>` instead of `Config<string>`. Check all consumers of `config.publicApi` — they may need `.href` or `.toString()`. If this breaks downstream, keep `publicApi` as `Config.withDefault(Config.string(...))` in `WorkerKeys` and add a separate `publicApiUrl` with `Config.url` for validation-only use. Prefer the simpler path: update consumers to use `URL`.

**Step 3: Run all tests**

Run: `bun run test`
Expected: PASS (same count as baseline). If `publicApi` type change breaks consumers, see note above.

**Step 4: Commit**

```bash
git add src/platform/Config.ts
git commit -m "refactor(config): delegate AppConfig to shared WorkerKeys (SKY-182)"
```

---

### Task 4: Wire worker startup through the shared validator

**Files:**
- Modify: `src/platform/Config.ts` — add a `validateAll` static method to `AppConfig`
- Modify: `src/enrichment/Layer.ts` — validate enrichment keys at layer construction

This task ensures the worker side also uses the per-key validator, not just the editorial side. The existing `AppConfig.layer` stays as-is for runtime (it needs the grouped struct). A new `AppConfig.validate` provides the all-at-once diagnostic.

**Step 1: Add validate method to AppConfig**

```typescript
// Add to src/platform/Config.ts, inside AppConfig class:

  /** Validate all worker + enrichment config keys at once.
   *  Use at startup or /health endpoints for diagnostic output. */
  static validate = (provider: ConfigProvider.ConfigProvider) =>
    validateKeys(
      { ...WorkerKeys, ...EnrichmentKeys },
      provider
    );
```

Import `validateKeys` from `./ConfigValidation` and `EnrichmentKeys` from `./ConfigShapes`.

**Step 2: Add enrichment validation to Layer.ts**

In `src/enrichment/Layer.ts`, after building the `configLayer` from env entries, add a validation call that surfaces all missing keys at once:

```typescript
// At the top of makeWorkflowEnrichmentLayer, after building configLayer:
// (This is diagnostic — logs all missing keys but does not change the
// existing layer construction behavior)
```

Exact integration depends on whether you want validation to be a hard gate (fail the layer) or a soft diagnostic (log and continue). For v1, keep it as a diagnostic helper that `/health` or startup logging can call. Don't change the existing layer failure behavior.

**Step 3: Run tests**

Run: `bun run test`
Expected: PASS

**Step 4: Commit**

```bash
git add src/platform/Config.ts src/enrichment/Layer.ts
git commit -m "feat(config): add worker-side validate method using shared validator (SKY-182)"
```

---

### Task 5: Add `@skygest/platform/*` path mapping to editorial repo

**Files:**
- Modify: `/Users/pooks/Dev/skygest-editorial/tsconfig.json`
- Modify: `/Users/pooks/Dev/skygest-editorial/src/smoke-test.ts`

**Step 1: Add path mapping**

```json
"paths": {
  "@skygest/domain/*": ["../skygest-cloudflare/src/domain/*"],
  "@skygest/platform/*": ["../skygest-cloudflare/src/platform/*"]
}
```

**Step 2: Extend smoke test to verify import**

Add to `src/smoke-test.ts`:

```typescript
import { OperatorKeys } from "@skygest/platform/ConfigShapes";

// Config shapes resolve
console.log("Config shape import works:", OperatorKeys.operatorSecret !== undefined);
```

**Step 3: Run smoke test**

Run: `bun src/smoke-test.ts` (from skygest-editorial directory)
Expected: "Config shape import works: true"

**Step 4: Commit (in skygest-editorial repo)**

```bash
git add tsconfig.json src/smoke-test.ts
git commit -m "feat: add @skygest/platform path mapping for shared config (SKY-182)"
```

---

### Task 6: Create editorial `validate-config.ts` script

**Files:**
- Create: `/Users/pooks/Dev/skygest-editorial/scripts/validate-config.ts`

**Step 1: Write the script**

```typescript
// scripts/validate-config.ts
import { Effect, ConfigProvider, Result } from "effect";
import { OperatorKeys } from "@skygest/platform/ConfigShapes";
import { validateKeys, ConfigValidationError } from "@skygest/platform/ConfigValidation";

const main = Effect.gen(function* () {
  const provider = ConfigProvider.fromEnv();

  const config = yield* validateKeys(OperatorKeys, provider).pipe(
    Effect.catch((error: ConfigValidationError) =>
      Effect.gen(function* () {
        console.error(error.summary);
        return yield* Effect.fail(error);
      })
    )
  );

  console.log("Config validation passed:");
  console.log("  SKYGEST_STAGING_BASE_URL:", config.baseUrl.href);
  console.log("  SKYGEST_OPERATOR_SECRET: [set]");
});

Effect.runPromise(main).catch(() => process.exit(1));
```

**Step 2: Test with valid config**

Run: `bun scripts/validate-config.ts` (from skygest-editorial with `.env` populated)
Expected: "Config validation passed" with base URL shown

**Step 3: Test with missing secret**

Run: `SKYGEST_OPERATOR_SECRET= SKYGEST_STAGING_BASE_URL= bun scripts/validate-config.ts`
Expected: Error listing both missing keys, exit code 1

**Step 4: Test with bad URL**

Run: `SKYGEST_OPERATOR_SECRET=test SKYGEST_STAGING_BASE_URL=not-a-url bun scripts/validate-config.ts`
Expected: Error about invalid URL format for baseUrl

**Step 5: Commit**

```bash
git add scripts/validate-config.ts
git commit -m "feat: add config validation script for editorial (SKY-182)"
```

---

### Task 7: Wire validation into editorial scripts

**Files:**
- Modify: `/Users/pooks/Dev/skygest-editorial/scripts/morning-curation.sh`
- Modify: `/Users/pooks/Dev/skygest-editorial/scripts/weekly-compile.sh`
- Modify: `/Users/pooks/Dev/skygest-editorial/CLAUDE.md`

**Do NOT modify `publish.sh`** — it only copies local files and doesn't need staging secrets.

**Step 1: Add validation preamble to morning-curation.sh**

After `set -euo pipefail`, before the echo block:

```bash
echo "Validating config..."
bun scripts/validate-config.ts || exit 1
echo ""
```

**Step 2: Same for weekly-compile.sh**

Same preamble pattern.

**Step 3: Add a note to CLAUDE.md pointer section**

Under "Where things live", add:
```
- **Config validation** — `bun scripts/validate-config.ts` verifies secrets and endpoints before workflows
```

**Step 4: Test the script chain**

Run: `./scripts/morning-curation.sh` (from skygest-editorial)
Expected: Config validation runs first, then the existing echo output

**Step 5: Commit**

```bash
git add scripts/morning-curation.sh scripts/weekly-compile.sh CLAUDE.md
git commit -m "feat: wire config validation into editorial scripts (SKY-182)"
```

---

## Out of scope (tracked separately)

- **Twitter cookie validation** — depends on SKY-180. Extension point: add cookie keys to the `validateKeys` call when cookie management lands in editorial.
- **MCP connectivity health check** — could be a post-validation step that pings `list_topics`. Nice-to-have, not blocking.
- **Operator secret naming unification** — Worker uses `OPERATOR_SECRET`, CLI/editorial use `SKYGEST_OPERATOR_SECRET`. Fixing this is a separate migration (Worker secret rename + wrangler.toml + CI). The shapes encode the correct name per context.
- **Claude Code session start hook** — `.claude/settings.json` could add a `SessionStart` hook running `validate-config.ts`. Deferred until we confirm the script works well manually first.
- **`publicApi` type migration** — if changing `WorkerKeys.publicApi` from `string` to `URL` breaks downstream consumers, handle as a follow-up.
