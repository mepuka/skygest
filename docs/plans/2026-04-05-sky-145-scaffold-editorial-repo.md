# SKY-145: Scaffold skygest-editorial Repo — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Create the `skygest-editorial` repo — the local editorial workspace that bridges Claude Code / Codex to SkyGest infrastructure via MCP, housing story briefs, newsletter editions, podcast staging, and editorial memory as git-tracked files.

**Architecture:** A lightweight Bun + TypeScript + Effect repo at `~/Dev/skygest-editorial` that imports domain types directly from `../skygest-cloudflare/src/domain` via TypeScript path mapping. No server, no build step — it's a CLI-native workspace where AI agents (Claude Code, Codex, Gemini CLI) operate via MCP tools connected to the staging worker. A single `AGENTS.md` is the canonical project instructions file, symlinked to `CLAUDE.md` and `GEMINI.md` for multi-agent compatibility.

**Tech Stack:** Bun, TypeScript 5, Effect 4.0.0-beta.43, MCP (HTTP transport to skygest-staging, configured for Claude Code, Codex CLI, and Gemini CLI)

---

### Task 1: Initialize repo and package.json

**Files:**
- Create: `/Users/pooks/Dev/skygest-editorial/package.json`

**Step 1: Create directory and init git**

```bash
mkdir -p /Users/pooks/Dev/skygest-editorial
cd /Users/pooks/Dev/skygest-editorial
git init
```

**Step 2: Write package.json**

```json
{
  "name": "skygest-editorial",
  "module": "index.ts",
  "type": "module",
  "private": true,
  "scripts": {
    "prepare": "effect-language-service patch",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "@effect/language-service": "^0.71.2",
    "@types/bun": "latest"
  },
  "peerDependencies": {
    "typescript": "^5"
  },
  "dependencies": {
    "effect": "4.0.0-beta.43"
  }
}
```

**Step 3: Install dependencies**

```bash
cd /Users/pooks/Dev/skygest-editorial && bun install
```

**Step 4: Verify**

```bash
cd /Users/pooks/Dev/skygest-editorial && bun --version && ls node_modules/effect/package.json
```
Expected: bun version prints, effect package.json exists.

**Step 5: Commit**

```bash
cd /Users/pooks/Dev/skygest-editorial
git add package.json bun.lock
git commit -m "feat: init skygest-editorial with Bun + Effect"
```

---

### Task 2: TypeScript config with domain path mapping

**Files:**
- Create: `/Users/pooks/Dev/skygest-editorial/tsconfig.json`

**Step 1: Write tsconfig.json**

```json
{
  "compilerOptions": {
    "plugins": [{ "name": "@effect/language-service" }],

    "lib": ["ESNext"],
    "types": ["bun"],
    "target": "ESNext",
    "module": "Preserve",
    "moduleDetection": "force",
    "allowJs": true,

    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "verbatimModuleSyntax": true,
    "noEmit": true,

    "strict": true,
    "skipLibCheck": true,
    "noFallthroughCasesInSwitch": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "exactOptionalPropertyTypes": true,
    "noUnusedLocals": false,
    "noUnusedParameters": false,
    "noPropertyAccessFromIndexSignature": false,

    "paths": {
      "@skygest/domain/*": ["../skygest-cloudflare/src/domain/*"]
    }
  },
  "include": ["src/**/*.ts", "scripts/**/*.ts"],
  "exclude": ["node_modules"]
}
```

Key: The `paths` mapping lets `import { EditorialPickRecord } from "@skygest/domain/editorial"` resolve to `../skygest-cloudflare/src/domain/editorial.ts`.

**Step 2: Write a smoke-test file to verify path mapping**

Create `src/smoke-test.ts`:
```ts
import { Schema } from "effect";
import { EditorialPickCategory } from "@skygest/domain/editorial";
import { ContentType } from "@skygest/domain/content";
import { PodcastEpisodeLifecycleState } from "@skygest/domain/podcast";

// Smoke test: domain types resolve and are usable
const _category = Schema.decodeUnknownSync(EditorialPickCategory)("breaking");
const _contentType = Schema.decodeUnknownSync(ContentType)("post");
const _lifecycle = Schema.decodeUnknownSync(PodcastEpisodeLifecycleState)("fetched");

console.log("Domain path mapping works:", { _category, _contentType, _lifecycle });
```

**Step 3: Run typecheck**

```bash
cd /Users/pooks/Dev/skygest-editorial && bunx tsc --noEmit
```
Expected: No errors. (May need to install skygest-cloudflare's deps if domain types reference them — if so, the error will be clear.)

**Step 4: Run smoke test**

```bash
cd /Users/pooks/Dev/skygest-editorial && bun src/smoke-test.ts
```
Expected: Prints `Domain path mapping works: { _category: "breaking", _contentType: "post", _lifecycle: "fetched" }`

**Step 5: Commit**

```bash
cd /Users/pooks/Dev/skygest-editorial
git add tsconfig.json src/smoke-test.ts
git commit -m "feat: add tsconfig with domain path mapping to skygest-cloudflare"
```

---

### Task 3: Directory structure and .gitignore

**Files:**
- Create: all directories per spec
- Create: `/Users/pooks/Dev/skygest-editorial/.gitignore`
- Create: `/Users/pooks/Dev/skygest-editorial/.env`

**Step 1: Create directory tree**

```bash
cd /Users/pooks/Dev/skygest-editorial
mkdir -p stories editions/drafts editions/published narratives podcasts entities scripts templates src .claude .codex .gemini
```

**Step 2: Write .gitignore**

```gitignore
# Dependencies
node_modules/

# Environment
.env

# OS
.DS_Store

# Editor
*.swp
*.swo
*~

# Agent session data (personal, not shared)
.claude/settings.local.json

# Push receipts contain ephemeral data
podcasts/**/push-receipt.json
```

**Step 3: Write .env with staging credentials**

```bash
# skygest-editorial/.env
SKYGEST_STAGING_BASE_URL=https://skygest-bi-agent-staging.kokokessy.workers.dev
SKYGEST_OPERATOR_SECRET=a0726f2016da7043950c7c930402b235850c745c8167ce662c9ab8e25a0af8c6
```

**Step 4: Add .gitkeep files so empty directories are tracked**

```bash
cd /Users/pooks/Dev/skygest-editorial
touch stories/.gitkeep editions/drafts/.gitkeep editions/published/.gitkeep narratives/.gitkeep podcasts/.gitkeep entities/.gitkeep
```

**Step 5: Commit**

```bash
cd /Users/pooks/Dev/skygest-editorial
git add .gitignore stories/.gitkeep editions/ narratives/.gitkeep podcasts/.gitkeep entities/.gitkeep
git commit -m "feat: add directory structure and .gitignore"
```

---

### Task 4: AGENTS.md — canonical project instructions (multi-agent)

**Files:**
- Create: `/Users/pooks/Dev/skygest-editorial/AGENTS.md` (canonical)
- Create: `/Users/pooks/Dev/skygest-editorial/CLAUDE.md` (symlink → AGENTS.md)
- Create: `/Users/pooks/Dev/skygest-editorial/GEMINI.md` (symlink → AGENTS.md)

**Step 1: Write AGENTS.md**

This is the canonical project instructions file. All three agents (Claude Code, Codex, Gemini CLI) read it — Claude via `CLAUDE.md` symlink, Codex directly as `AGENTS.md`, Gemini via `GEMINI.md` symlink.

```markdown
# Skygest Editorial Context

## What this repo is

Local editorial workspace for Skygest Energy — an AI-managed energy news intelligence platform. Story briefs, newsletter editions, podcast staging, and editorial memory live here as git-tracked markdown files.

Domain types are imported from `../skygest-cloudflare/src/domain/` via `@skygest/domain/*` path mapping.

## MCP connection

This workspace connects to the Skygest staging MCP server for curation, search, and enrichment tools.

Server name: `skygest-staging`
Base URL: https://skygest-bi-agent-staging.kokokessy.workers.dev

MCP config locations (all point to the same HTTP server):
- Claude Code: `.mcp.json`
- Codex CLI: `.codex/config.toml`
- Gemini CLI: `.gemini/settings.json`

### Key MCP tools

- `search_posts` — search ingested expert posts by keyword, topic, date range
- `list_curation_candidates` — view posts flagged for editorial review
- `curate_post` / `bulk_curate` — approve or reject posts for enrichment
- `list_editorial_picks` — view editorially picked posts with scores
- `submit_editorial_pick` — pick a post with score + reason + category
- `get_post_enrichments` — retrieve vision/source enrichment data for a post
- `get_post_thread` — get full thread context for a post
- `list_topics` / `get_topic` — browse the energy topic ontology
- `list_experts` — browse tracked energy experts

## Toolchain

- **Bun** for everything: `bun <file>`, `bun install` — never Node/npm/npx
- **Effect** for typed operations — same patterns as skygest-cloudflare
- Bun loads `.env` automatically — no dotenv needed

## Editorial voice

- Authoritative but accessible. Data-first.
- Always attribute: name the source, name the expert, name the provider.
- No advocacy: present the discourse, don't take sides.
- When in doubt, show the chart.

## Active narratives

_(Add narrative files here as they are created)_

## Recurring data events

- EIA Weekly Natural Gas Storage: Thursdays 10:30 ET
- EIA Short-Term Energy Outlook: monthly, ~5th business day
- CAISO Daily Renewable Report: daily

## Directory structure

```
stories/         → Story briefs (AI-generated, human-edited markdown)
editions/        → Compiled newsletter editions (drafts/ and published/)
narratives/      → Long-running thematic arcs
podcasts/        → Podcast episode local staging ({show-slug}/{episode-slug}/)
entities/        → Entity registry extensions
scripts/         → Automation hooks (morning-curation, weekly-compile, publish)
templates/       → Markdown templates for stories and editions
src/             → TypeScript utilities
```

## Recently covered

_(Agent appends here at end of each editorial session)_
```

**Step 2: Create symlinks**

```bash
cd /Users/pooks/Dev/skygest-editorial
ln -s AGENTS.md CLAUDE.md
ln -s AGENTS.md GEMINI.md
```

Verify symlinks resolve:
```bash
ls -la CLAUDE.md GEMINI.md
# Both should show -> AGENTS.md
head -1 CLAUDE.md GEMINI.md
# Both should show "# Skygest Editorial Context"
```

**Step 3: Commit**

```bash
cd /Users/pooks/Dev/skygest-editorial
git add AGENTS.md CLAUDE.md GEMINI.md
git commit -m "feat: add AGENTS.md with editorial context, symlinked to CLAUDE.md and GEMINI.md"
```

---

### Task 5: Multi-agent MCP configuration (Claude Code + Codex + Gemini)

**Files:**
- Create: `/Users/pooks/Dev/skygest-editorial/.mcp.json` (Claude Code — project-scoped, shared)
- Create: `/Users/pooks/Dev/skygest-editorial/.codex/config.toml` (Codex CLI)
- Create: `/Users/pooks/Dev/skygest-editorial/.gemini/settings.json` (Gemini CLI)

All three configs point to the same HTTP MCP server with Bearer token auth. The token comes from `SKYGEST_OPERATOR_SECRET` in `.env`.

**Step 1: Write `.mcp.json` (Claude Code)**

Claude Code reads `.mcp.json` at project root for shared MCP config. Supports `${ENV_VAR}` interpolation.

```json
{
  "mcpServers": {
    "skygest-staging": {
      "type": "http",
      "url": "https://skygest-bi-agent-staging.kokokessy.workers.dev/mcp",
      "headers": {
        "Authorization": "Bearer ${SKYGEST_OPERATOR_SECRET}"
      }
    }
  }
}
```

**Step 2: Write `.codex/config.toml` (Codex CLI)**

Codex reads `.codex/config.toml` at project root. Uses `bearer_token_env_var` for auth (reads the env var at runtime).

```bash
mkdir -p /Users/pooks/Dev/skygest-editorial/.codex
```

```toml
[mcp_servers.skygest-staging]
url = "https://skygest-bi-agent-staging.kokokessy.workers.dev/mcp"
bearer_token_env_var = "SKYGEST_OPERATOR_SECRET"
```

**Step 3: Write `.gemini/settings.json` (Gemini CLI)**

Gemini CLI reads `.gemini/settings.json` at project root. Uses `httpUrl` (not `url`) and inline headers.

```bash
mkdir -p /Users/pooks/Dev/skygest-editorial/.gemini
```

```json
{
  "mcpServers": {
    "skygest-staging": {
      "httpUrl": "https://skygest-bi-agent-staging.kokokessy.workers.dev/mcp",
      "headers": {
        "Authorization": "Bearer ${SKYGEST_OPERATOR_SECRET}"
      },
      "timeout": 10000
    }
  }
}
```

Note: Gemini CLI may not support `${VAR}` expansion in headers. If it doesn't, the user will need to hardcode the token in the local copy (which is fine since `.gemini/` can be gitignored or the settings.json can reference a local override). For now, use the same pattern and document the fallback.

**Step 4: Commit**

```bash
cd /Users/pooks/Dev/skygest-editorial
git add .mcp.json .codex/config.toml .gemini/settings.json
git commit -m "feat: add MCP config for Claude Code, Codex CLI, and Gemini CLI"
```

---

### Task 6: Templates — story brief and edition

**Files:**
- Create: `/Users/pooks/Dev/skygest-editorial/templates/story-brief.md`
- Create: `/Users/pooks/Dev/skygest-editorial/templates/edition.md`

**Step 1: Write story brief template**

`templates/story-brief.md`:
```markdown
---
id: story-{date}-{slug}
headline: ""
status: draft
created: {ISO timestamp}
topics: []
entities: []
mode: breaking | developing | analysis | recurring
posts:
  - uri: ""
    role: lead | supporting | data | reaction
    editorial_score: 0
---

## Summary

[2-3 sentence AI-generated summary, human-editable]

## Key data

[Charts and data points from vision enrichment]

## Expert voices

[Key expert takes with handles]

## Editorial notes

[Human editor's notes — what to emphasize, what to cut, tone guidance]
```

**Step 2: Write edition template**

`templates/edition.md`:
```markdown
---
id: edition-{year}-w{week}
status: draft | reviewed | published
compiled: {ISO timestamp}
stories: []
---

# Skygest Energy — Week {N}, {Year}

## Lead story

[Imported from story brief with editorial framing]

## This week in energy

[3-4 supporting stories, condensed]

## Data highlights

[Best charts from the week with provenance]

## Expert spotlight

[Notable expert contribution or thread]

## On our radar

[Developing stories to watch]
```

**Step 3: Commit**

```bash
cd /Users/pooks/Dev/skygest-editorial
git add templates/
git commit -m "feat: add story brief and edition markdown templates"
```

---

### Task 7: Script stubs

**Files:**
- Create: `/Users/pooks/Dev/skygest-editorial/scripts/morning-curation.sh`
- Create: `/Users/pooks/Dev/skygest-editorial/scripts/weekly-compile.sh`
- Create: `/Users/pooks/Dev/skygest-editorial/scripts/publish.sh`

**Step 1: Write morning-curation.sh**

```bash
#!/usr/bin/env bash
# morning-curation.sh — Run the morning editorial curation session
#
# Usage: ./scripts/morning-curation.sh [hours]
#
# Opens Claude Code with a prompt to run the curation workflow:
# 1. List curation candidates from the last N hours (default 24)
# 2. Review and curate/reject posts
# 3. Submit editorial picks for top content
# 4. Update CLAUDE.md "Recently covered" section

set -euo pipefail

HOURS="${1:-24}"

echo "Starting morning curation session (last ${HOURS}h)..."
echo "Open Claude Code in this repo and run:"
echo ""
echo "  List curation candidates from the last ${HOURS} hours, review them,"
echo "  curate the best ones, and submit editorial picks."
echo ""
```

**Step 2: Write weekly-compile.sh**

```bash
#!/usr/bin/env bash
# weekly-compile.sh — Compile the week's story briefs into an edition draft
#
# Usage: ./scripts/weekly-compile.sh
#
# Opens Claude Code with a prompt to compile stories into an edition:
# 1. Gather all story briefs from this week
# 2. Select lead story and supporting stories
# 3. Write edition draft from template
# 4. Save to editions/drafts/

set -euo pipefail

WEEK=$(date +%V)
YEAR=$(date +%Y)

echo "Compiling edition for Week ${WEEK}, ${YEAR}..."
echo "Open Claude Code in this repo and run:"
echo ""
echo "  Compile this week's story briefs into an edition draft."
echo "  Use the template at templates/edition.md."
echo ""
```

**Step 3: Write publish.sh**

```bash
#!/usr/bin/env bash
# publish.sh — Move a reviewed edition from drafts to published
#
# Usage: ./scripts/publish.sh <edition-file>
#
# Moves the edition from editions/drafts/ to editions/published/
# and updates its frontmatter status to "published".

set -euo pipefail

if [ -z "${1:-}" ]; then
  echo "Usage: ./scripts/publish.sh <edition-file>"
  echo "Example: ./scripts/publish.sh editions/drafts/edition-2026-w14.md"
  exit 1
fi

SOURCE="$1"
BASENAME=$(basename "$SOURCE")
DEST="editions/published/${BASENAME}"

if [ ! -f "$SOURCE" ]; then
  echo "Error: File not found: $SOURCE"
  exit 1
fi

cp "$SOURCE" "$DEST"
# Update status in frontmatter
sed -i '' 's/^status: .*/status: published/' "$DEST"

echo "Published: $DEST"
```

**Step 4: Make scripts executable**

```bash
chmod +x /Users/pooks/Dev/skygest-editorial/scripts/*.sh
```

**Step 5: Commit**

```bash
cd /Users/pooks/Dev/skygest-editorial
git add scripts/
git commit -m "feat: add editorial workflow script stubs"
```

---

### Task 8: README

**Files:**
- Create: `/Users/pooks/Dev/skygest-editorial/README.md`

**Step 1: Write README.md**

```markdown
# skygest-editorial

Local editorial workspace for [Skygest Energy](https://skygest-bi-agent-staging.kokokessy.workers.dev) — AI-managed energy news intelligence.

## What this is

This repo is where story briefs, newsletter editions, podcast episodes, and editorial memory live as git-tracked files. AI agents (Claude Code, Codex, Gemini CLI) operate here via MCP tools connected to the Skygest staging infrastructure.

## Setup

```bash
# Install dependencies
bun install

# Copy env template and fill in credentials
cp .env.example .env
# Edit .env with your SKYGEST_OPERATOR_SECRET

# Verify domain type imports work
bun src/smoke-test.ts

# Open your preferred AI agent:
claude        # Claude Code — reads CLAUDE.md (symlink → AGENTS.md)
codex         # Codex CLI — reads AGENTS.md directly
gemini        # Gemini CLI — reads GEMINI.md (symlink → AGENTS.md)
```

## Agent configuration

All three agents connect to the same Skygest staging MCP server. Project instructions live in `AGENTS.md` (canonical), symlinked to `CLAUDE.md` and `GEMINI.md`.

| Agent | Instructions | MCP Config |
|-------|-------------|------------|
| Claude Code | `CLAUDE.md` → `AGENTS.md` | `.mcp.json` |
| Codex CLI | `AGENTS.md` | `.codex/config.toml` |
| Gemini CLI | `GEMINI.md` → `AGENTS.md` | `.gemini/settings.json` |

## Operational model

1. **Morning curation** — Agent reviews overnight posts, curates best content, submits editorial picks
2. **Story assembly** — Agent clusters editorial picks into story briefs
3. **Weekly compile** — Agent compiles week's stories into a newsletter edition
4. **Human review** — Editor reviews drafts, adds editorial notes, approves for publication

## Tech stack

- **Bun** — runtime and package manager
- **TypeScript + Effect** — same stack as skygest-cloudflare
- **MCP** — connects to Skygest staging for search, curation, enrichment tools
- **Domain types** — imported from `../skygest-cloudflare/src/domain/` via path mapping

## Directory structure

| Directory | Purpose |
|-----------|---------|
| `stories/` | Story briefs (AI-generated, human-edited markdown) |
| `editions/` | Compiled newsletter editions (`drafts/`, `published/`) |
| `narratives/` | Long-running thematic arcs |
| `podcasts/` | Podcast episode local staging |
| `entities/` | Entity registry extensions |
| `scripts/` | Automation hooks |
| `templates/` | Markdown templates |
| `src/` | TypeScript utilities |
```

**Step 2: Write .env.example**

```bash
# Skygest staging credentials
SKYGEST_STAGING_BASE_URL=https://skygest-bi-agent-staging.kokokessy.workers.dev
SKYGEST_OPERATOR_SECRET=your-operator-secret-here
```

**Step 3: Commit**

```bash
cd /Users/pooks/Dev/skygest-editorial
git add README.md .env.example
git commit -m "feat: add README and .env.example"
```

---

### Task 9: Verify end-to-end — domain imports + MCP connection

**Files:**
- None new — verification only

**Step 1: Run typecheck**

```bash
cd /Users/pooks/Dev/skygest-editorial && bunx tsc --noEmit
```
Expected: Clean — no type errors.

**Step 2: Run smoke test**

```bash
cd /Users/pooks/Dev/skygest-editorial && bun src/smoke-test.ts
```
Expected: Prints domain type values successfully.

**Step 3: Manual MCP verification**

Open Claude Code in `/Users/pooks/Dev/skygest-editorial` and verify:
1. CLAUDE.md is loaded as project context
2. MCP server `skygest-staging` connects
3. Running `list_topics` returns the energy topic ontology

This step is manual — the agent implementing the plan should flag it for the user to verify.

**Step 4: Clean up smoke test (optional)**

If the smoke test was only for verification, it can be kept as a quick sanity check or removed. Recommend keeping it.

---

## Summary

| Task | Description | Files |
|------|-------------|-------|
| 1 | Init repo + package.json | package.json |
| 2 | tsconfig + domain path mapping | tsconfig.json, src/smoke-test.ts |
| 3 | Directory structure + .gitignore + .env | .gitignore, .env, .gitkeep files |
| 4 | AGENTS.md + symlinks (multi-agent) | AGENTS.md, CLAUDE.md→, GEMINI.md→ |
| 5 | MCP config (Claude + Codex + Gemini) | .mcp.json, .codex/config.toml, .gemini/settings.json |
| 6 | Story brief + edition templates | templates/*.md |
| 7 | Script stubs | scripts/*.sh |
| 8 | README + .env.example | README.md, .env.example |
| 9 | End-to-end verification | (verification only) |

Total: 9 tasks, ~20 files created, one new repo ready for multi-agent editorial operations.
