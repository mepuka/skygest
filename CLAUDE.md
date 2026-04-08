---
description: Core development rules for the skygest Cloudflare Worker — Effect-native, domain-first, Bun toolchain.
alwaysApply: true
---

# Skygest Development Rules

This is a Cloudflare Worker built with Effect.ts. Every rule below is non-negotiable.

## Toolchain: Bun

- `bun <file>`, `bun run test`, `bun install`, `bunx <pkg>` — never Node, npm, npx, vite, jest.
- Bun loads `.env` automatically — no dotenv.

## Architecture

Cloudflare Worker with D1 (SQLite), KV, Workflows, and Durable Objects. Entry point: `src/worker/filter.ts`.

```
src/domain/     → Schemas, branded types, errors (single source of truth)
src/services/   → ServiceMap.Service services + Layer.effect implementations
src/services/d1/→ D1 repository implementations
src/api/        → HttpApi route handlers
src/platform/   → Config, runtime, logging, JSON helpers
src/enrichment/ → Gemini vision pipeline
src/ingest/     → Bluesky ingest pipeline (Workflows + Durable Objects)
```

## Effect-Native Code (see skill: effect-native)

1. **Stay in Effect.** No `async function`, `try-catch`, `new Promise` except at Worker entry points (`src/worker/`). Use `Effect.gen` with `yield*` everywhere else.
2. **Check effect-solutions first.** Run `effect-solutions show <topic>` before implementing any Effect pattern. Topics: quick-start, project-setup, tsconfig, basics, services-and-layers, data-modeling, error-handling, config, testing, cli.
3. **Schema.parseJson, not JSON.parse.** Use `Schema.parseJson(TargetSchema)` or helpers in `src/platform/Json.ts`. Never manual `JSON.parse` + decode.
4. **Schema.TaggedErrorClass for all errors.** Define in `src/domain/errors.ts`. No plain `Error` or `throw`.
5. **No duplicate helpers.** Search `src/platform/` and `src/services/d1/` before writing any utility function.
6. **Services follow one pattern:** `ServiceMap.Service` + `Layer.effect` + `Effect.gen` + `yield*` for dependency injection.
7. **Use Effect platform APIs for IO.** Use `FileSystem`, `Path`, `HttpClient`, `DateTime` from Effect — never `node:fs`, `node:path`, `node:crypto`, or other Node built-ins in `src/`. The worker bundle must contain zero Node imports. Node imports are acceptable only in `scripts/` (local Bun tooling) and `tests/` (test infrastructure). For timestamps prefer `DateTime.make` / `DateTime.formatIso` over `new Date()`.

## Domain-First Schemas (see skill: domain-modeling)

1. **Search `src/domain/` before creating any schema.** The domain layer is the single source of truth.
2. **New schemas go in `src/domain/`, not inline** in services, repos, or API handlers.
3. **Derive from existing schemas** using `Schema.extend`, `Schema.pick`, `Schema.omit`, `Schema.compose`.
4. **Use branded types for IDs:** `Did`, `AtUri`, `HttpsUrl`, `TopicSlug`, `OntologyConceptSlug`. Never raw `Schema.String` for identifiers.
5. **Row schemas are the exception** — D1 repos may define local row schemas, but must transform to domain types via helpers.

## Testing

Use `bun run test` (vitest via @effect/vitest). Test Effect code with `Effect.runPromise` + layer provision.

```ts
import { describe, expect, it } from "@effect/vitest";
```

## Development Workflow

- **Branching:** Trunk-based. Feature branches: `sky-<issue>/<description>`.
- **PRs:** Always to `main`, squash merge. Reference `SKY-XX` in branch name or PR body.
- **CI:** GitHub Actions runs `bunx tsc --noEmit` + `bun run test`. Staging auto-deploys on merge to main.
- **Linear:** Project key is `SKY`. GitHub integration auto-links via issue ID.

<!-- effect-solutions:start -->
## Effect Reference

Whenever you are designing or um implementing anything of note in uh effect, you should look into the effect reference repo and review this relevant source code to find patterns, right? Find the most appropriate APIs, um you know, explore the different modules um and determine what is the idiomatic effect way to implement this, right? That's a question you should always be asking during your design and planning phases in order to create, right? For all major elements of a program and of this code base, there is almost always an effect solution, right, that will give you a better result and a will cleanly integrate natively into this code base and into the you know you know to the rest of the coding patterns 

Run `effect-solutions list` to see guides. Run `effect-solutions show <topic>...` for patterns.
Search `.reference/effect/` for Effect 4 library source (effect-smol repo, tagged at `effect@4.0.0-beta.43`).
Key source paths: `.reference/effect/packages/effect/src/` for core, `unstable/` subdirectories for platform/ai/sql/cli modules.
<!-- effect-solutions:end -->
