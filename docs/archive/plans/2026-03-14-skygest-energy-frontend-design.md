# Skygest Energy — Frontend Design

## Overview

Public-facing frontend for the Skygest Energy knowledge platform. Serves energy industry professionals, researchers, and power users who want to track expert discourse across energy and climate topics.

## Principles

- **Tufte-inspired**: High data-ink ratio. Let data speak through typography and spatial relationships.
- **Expert-first**: Every post is attributed to a tracked expert.
- **Ontology-aware**: Topic structure enriches navigation, filtering, and context.
- **Search as backbone**: Core infrastructure for both human use and future agentic flows.

## MVP Scope (v0)

1. **Search view** — query box, results with expert attribution, topic tags, snippets, pagination
2. **Feed view** — recent posts stream, filterable by topic
3. **Topic navigation** — sidebar/faceted browse using the 30 canonical topics
4. **Expert identity** — posts show who said it (handle, display name), clickable to filter

Out of scope for v0: post detail page, mobile optimization, expert profiles, link aggregation.

## Deployment Architecture

Same Cloudflare Worker using Workers Static Assets:

```toml
[assets]
directory = "./dist"
binding = "ASSETS"
not_found_handling = "single-page-application"
html_handling = "auto-trailing-slash"
run_worker_first = ["/api/*", "/admin/*", "/mcp", "/health"]
```

- Static assets served directly from Cloudflare CDN (never touch Worker)
- API routes hit existing Worker code unchanged
- Single `wrangler deploy` for both API and frontend
- SPA built by Bun, output to `./dist`
- Worker script size unaffected — static assets upload separately to edge CDN
- SPA routing: any path not matching a static file returns `index.html` (200)
- Consider bumping `compatibility_date` to `2025-04-01` for navigation request optimization

### Gotchas

- Current `main = "src/worker/filter.ts"` — verify it routes all API traffic before adding assets
- Free plan: `run_worker_first` requests count toward 100K/day Worker invocation limit
- Asset limits: 20K files / 25MB per file (free), 100K files (paid) — well within for a React SPA

## Visual Foundation

**Palette**:
- Ink: `#1a1a1a` (primary text)
- Paper: `#fafaf8` (background)
- Mid: `#6b6b63` (secondary text, metadata)
- Light: `#e8e8e4` (dividers, borders)
- Accent: `#c45d2c` (burnt sienna — active states, highlights)
- Ink-light: `#3d3d38` (topic tags)

**Typography**: Inter. Display 600/-0.02em, body 400/16px/1.5, captions 400/13px in Mid.

**Spacing**: 48px sections, 24px groups, 12px elements. Tighter within posts, generous between.

**Layout**: Single-column 720px max-width centered. Optional 240px sidebar for topic filters. No cards — posts on surface, separated by whitespace and 1px Light dividers.

## Tech Stack

- React 19 + TypeScript
- Tailwind CSS 4
- Bun build to `./dist`
- Client-side routing (search + feed views)
- Fetches from same-origin `/api/*` endpoints

## Image Assets — Backend Prerequisites

Three categories of image data needed for the frontend, none currently captured:

### Expert Avatars

- **Current state**: Bluesky `app.bsky.actor.getProfile` returns `avatar` URL but we don't parse or store it
- **Schema**: `BlueskyProfile` in `src/domain/bi.ts` omits avatar field
- **Database**: `experts` table has no `avatar` column
- **Changes needed**:
  1. Add `avatar: Schema.optional(Schema.NullOr(Schema.String))` to `BlueskyProfile`
  2. D1 migration: `ALTER TABLE experts ADD COLUMN avatar TEXT`
  3. Update `ExpertRecord`, `ExpertListItem`, `AdminExpertResult` to include avatar
  4. Update `BlueskyClient.getProfile()` to parse avatar URL
  5. Populate on next sync — avatars are Bluesky CDN URLs (e.g., `https://cdn.bsky.app/img/avatar/...`)
- **Frontend fallback**: Initial-based colored circles (permanent fallback for experts without avatars)

### Link Preview Thumbnails

- **Current state**: External embeds contain `thumb` blob but `extractLinkRecords()` discards it
- **Schema**: `LinkRecord` in `src/domain/bi.ts` has no image field; `ExternalEmbed` in `PostRecord.ts` omits thumb
- **Database**: `links` table has no `image_url` column
- **Changes needed**:
  1. Add `thumb` field to `ExternalEmbed` schema in `src/bluesky/PostRecord.ts`
  2. Add `imageUrl: Schema.optional(Schema.NullOr(Schema.String))` to `LinkRecord`
  3. D1 migration: `ALTER TABLE links ADD COLUMN image_url TEXT`
  4. Update `extractLinkRecords()` to carry through the thumb URL
  5. Expose in `KnowledgeLinkResult` API response
- **Note**: Thumb blobs are Bluesky CDN URLs, not raw CIDs — can be used directly

### Topic Iconography

- **Current state**: No visual markers for the 30 canonical topics
- **Approach**: Minimal monochrome SVG line icons — sun (solar), turbine (wind), atom (nuclear), battery (storage), etc.
- **Delivery**: Bundled as static assets in the SPA, referenced by topic slug
- **No backend changes needed** — purely a frontend/design asset

### Image Architecture Decision

Store avatar and thumbnail URLs as **direct Bluesky CDN URLs** for now. Simple, no proxy needed. If CDN availability becomes an issue, add R2 caching later.

## Target Users

- A: Energy industry professionals (analysts, policy, journalists)
- B: Researchers / academics investigating energy discourse
- C: Power users from general public interested in curated expert views
