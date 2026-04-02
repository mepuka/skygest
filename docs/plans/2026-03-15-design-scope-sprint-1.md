# Design Sprint 1 — Ontology Coherence + Data Surface

## Problem Statement

The current Paper mockups have three inconsistencies:

1. **Ontology representation is fragmented** — Topic pills on posts, breadcrumbs on topic pages, and search context bars each use different visual patterns to represent the same ontology hierarchy. A user seeing `[Solar]` on a post and `ONTOLOGY / Energy Storage / battery storage` on search should recognize them as the same system.

2. **Rich post data is unused** — We have link previews (title, domain, description, thumbnail), original Bluesky post URLs, author hashtags, and match signal types (term/hashtag/domain) that aren't surfaced in the designs.

3. **No unified component spec** — The PostCard, TopicTag, and OntologyRow components don't have formal specs that ensure consistency across all artboards.

4. **Publication/domain data is underutilized** — The formal ontology contains 1,032 curated Publication entities with human-readable labels (e.g., "Canary Media" not just `canarymedia.com`), but the runtime only uses 34 domains as match signals. The remaining 998 observed publication domains sit unused in the ABox, and link previews show raw hostnames instead of publication names.

## Design Principles for This Sprint

- **One hierarchy language**: Every ontology reference uses the same `/` separator pattern: `Topic / matched-term`. Whether it appears in a search context bar, a post annotation, a breadcrumb, or a topic page header.
- **Surface what we have**: If the API returns it and it's useful, design for it. Don't leave data on the floor.
- **Progressive disclosure**: Level 1 (scan) shows topic + expert. Level 2 (read) shows body + link preview. Level 3 (engage) shows match provenance, hashtags, original post link.
- **Everything is a link**: Topic pills navigate to `/topic/:slug`. Expert names navigate to `/expert/:did`. Domains navigate to `/links?domain=x`. Post timestamps link to the original Bluesky post.

## Ontology Audit — What We Have vs. What We Use

This section documents the full inventory of ontology data and where the frontend is (or isn't) leveraging it. Generated from direct inspection of the triple store at `ontology_skill/ontologies/energy-news/` and the runtime snapshot.

### Triple Store Inventory

| Entity | Count | Source File | Runtime Usage |
|---|---|---|---|
| SKOS Concepts (`EnergyTopic`) | 92 | `energy-news-reference-individuals.ttl` | All 92 rolled into 30 canonical topics via `conceptToCanonicalTopicSlug` map |
| Canonical Topics | 30 | `src/ontology/canonical.ts` | Fully used — match signals, facets, navigation |
| Publication instances | 1,032 | `data/abox-snapshot.ttl` | **Only 34** used as domain match signals. Labels not surfaced at all. |
| Article→Publication links | 17,167 | `data/abox-snapshot.ttl` | Not used at runtime (articles aren't stored) |
| Hashtag signals | 85 | Snapshot `signalCatalog.hashtags` | Fully used in matcher (score 3) |
| Domain match signals | 34 | Snapshot `signalCatalog.domains` | Fully used in matcher (score 4, highest) |
| Term match phrases | ~340 | Across 30 topics | Fully used in matcher (score 1-2) |
| Ambiguity guard terms | 16 | `canonical.ts` | Fully used — prevents false-positive single-word matches |
| Author tiers — energy-focused | 99 handles | Snapshot `authorTiers.energyFocused` | Used for filtering in derived store, **not surfaced in UI** |
| Author tiers — general outlets | 17 handles | Snapshot `authorTiers.generalOutlets` | Used for filtering, **not surfaced in UI** |
| Organization instances | 2+ (FERC, CATL) | `energy-news-data.ttl` | **Not used at runtime** |
| Geographic entities | 2+ (US, Australia) | `energy-news-data.ttl` | **Not used at runtime** |
| Project status enumeration | 6 values | `energy-news-reference-individuals.ttl` | **Not used at runtime** |

### Key Gaps Identified

1. **Publication labels are invisible** — The ontology has `enews:pub_canary_media rdfs:label "Canary Media"` but link previews show raw hostname `canarymedia.com`. The `siteDomain` is the owl:hasKey for Publication — we could look up friendly names.

2. **Author tier not reflected in UI** — 99 energy-focused handles and 17 general outlet handles are classified but the frontend treats all experts identically. A visual indicator (badge, tier label) could signal source authority.

3. **Domain as entity vs. domain as string** — Currently `links.domain` is a bare string column. Making Publication a first-class entity (even just a KV lookup map `hostname → { label, tier }`) would enable richer link previews and domain-level navigation.

4. **92 concepts collapse to 30 topics** — The `conceptToCanonicalTopicSlug` mapping is working, but the concept-level granularity (e.g., `Agrivoltaics` → `environment-and-land-use`) is only visible via the `/api/topics?view=concepts` endpoint. The design doesn't yet show concept-level drilldown in context.

5. **Organization and geographic data unused** — The ontology models `Organization` (with sectors) and `GeographicEntity` but these aren't extracted from posts or stored. This is a future enrichment opportunity, not a sprint 1 item.

## Scope Items

### S1: Unified Ontology Hierarchy Component

**Goal**: One visual pattern for all ontology references.

**The pattern**: `[Topic Label] / match-value`

Where:
- `[Topic Label]` is a pill — the canonical topic from `OntologyListTopic.label`
- `/` is the hierarchy separator in whisper color (#C4C4BB)
- `match-value` is the specific term/hashtag/domain from `ExplainedPostTopic.matchValue` in accent color (#C45D2C)

**Variants**:
- **Post annotation** (always visible): `[Grid and Infrastructure] / interconnection`
- **Search context bar**: `[Energy Storage] / battery storage` with related concepts below
- **Topic page breadcrumb**: `TOPIC / grid-and-infrastructure` then heading
- **Concept sub-filter**: Same pill component, used in a row on topic detail pages
- **Multi-topic post**: Multiple `[Topic] / term` groups separated by spacing
- **No match-value**: When match term equals topic name, just show `[Topic]` alone
- **Domain signal**: When matchSignal is "domain", show `[Topic] / utilitydive.com` with a subtle link icon
- **Hashtag signal**: When matchSignal is "hashtag", show `[Topic] / #solarenergy`

**Data source**: `KnowledgePostResult.topics` (slugs) resolved via client-side lookup table from `/api/topics?view=facets`. Match values from `/api/posts/:uri/topics` (lazy-loaded on interaction).

### S2: Link Preview Component

**Goal**: Surface external link data that we already capture.

**Data available per link** (from `KnowledgeLinkResult`):
- `url` — the shared URL
- `domain` — e.g., "insideclimatenews.org"
- `title` — article headline
- `description` — article summary
- `imageUrl` — CDN thumbnail (nullable, populated for posts with external embed thumbs)

**Design**:
- Compact card below post body text, within the 32px left indent
- Shows: domain in small caps, title in Inter 13px/600, description truncated to 1 line in 12px/400
- Thumbnail (if available) right-aligned, 80x60px rounded corners
- Entire card is a link to the external URL
- Border: 1px #EEEEE9, subtle — not a heavy card

**When to show**: Only for posts where `hasLinks: true`. The links API is a separate call — consider whether to lazy-load or join server-side.

### S3: Original Bluesky Post Link

**Goal**: Every post should link back to the original on Bluesky.

**Implementation**: The `uri` field (`at://did:plc:xyz/app.bsky.feed.post/abc123`) can be converted to `https://bsky.app/profile/{handle}/post/{rkey}` where `rkey` is the last segment of the AT URI.

**Design**: The relative timestamp ("2h ago", "1y ago") becomes a clickable link to the original Bluesky post. Styled with a subtle underline on hover — not visually different at rest, but interactive.

### S4: Author Hashtags

**Goal**: Surface the expert's own categorization alongside the ontology's.

**Data**: The `tags` field on `SlimPostRecord` contains author-applied hashtags. These are currently stored but not exposed in the public API response.

**Backend prerequisite**: Add `tags` to `KnowledgePostResult` (or expose via a detail endpoint).

**Design**: Show hashtags as a subtle inline list below the body text, before the ontology row. Format: `#solar #agrivoltaic #solarfarms` in 12px Inter 400 #9A9A90. These are NOT ontology-managed — they're the expert's voice. The visual distinction from topic pills must be clear: hashtags are plain text, topics are pills.

**Decision needed**: Do we add `tags` to the API response, or is this a future enhancement?

### S5: Match Signal Type Indicators

**Goal**: Differentiate how a topic was matched — term, hashtag, or domain.

**Data**: `ExplainedPostTopic.matchSignal` is one of `"term" | "hashtag" | "domain"`.

**Design**: In the ontology row, the match-value rendering varies by signal type:
- **term**: Plain accent text — `solar panel`
- **hashtag**: Prefixed with # — `#solarenergy`
- **domain**: Subtle link icon before — `utilitydive.com`

This is secondary information (Level 3 / engage). Only visible when explain data is loaded.

### S6: Publication-Enriched Link Previews

**Goal**: Replace raw hostnames with human-readable publication names from the ontology.

**Backend status**: The publications backend plan (`docs/plans/2026-03-14-publications-and-expert-tiers-backend.md`) is actively being implemented. This gives us:

**New data model (from backend plan)**:
- `PublicationRecord`: `{ hostname, tier, source, firstSeenAt, lastSeenAt }`
- `PublicationListItem`: `{ hostname, tier, source, postCount, latestPostAt }`
- `PublicationTier`: `"energy-focused" | "general-outlet" | "unknown"`
- `PublicationSource`: `"seed" | "discovered"`
- Publications are first-class D1 entities, not KV lookups
- Curated seeds come from a build-time artifact (`config/ontology/publications-seed.json`)
- New domains are auto-discovered during ingest via `KnowledgeRepoD1.upsertPosts`

**New API endpoint**: `GET /api/publications` with filters for `tier` and `source`.

**Design impact on S2 (Link Preview)**:
- Domain line changes from raw `insideclimatenews.org` to publication label (fetched from `/api/publications` at app init, cached client-side as `Map<hostname, PublicationListItem>`)
- `energy-focused` publications get a subtle visual marker (small filled circle before the name)
- `general-outlet` publications show label without marker
- `unknown` / `discovered` domains fall back to hostname — no visual disruption

**Frontend data flow**: On app init, fetch `GET /api/publications` → build `Map<hostname, { label?, tier }>` → link preview component resolves `domain` string to publication info. Note: seed publications carry human-readable labels from the ontology; discovered publications only have hostnames until manually curated.

### S7: Expert Identity + Tier Badge

**Goal**: Expert names and avatars should be interactive, and expert authority should be visually signaled.

**Backend status**: The backend plan adds `tier: ExpertTier` to `ExpertRecord`, `ExpertListItem`, `AdminExpertResult`, and `KnowledgePostResult`. Tier values are `"energy-focused" | "general-outlet" | "independent"`, computed from `authorTiers` in the ontology snapshot via a shared `resolveExpertTier` helper. After Deploy B + bootstrap + refresh, all 800 experts will have computed tiers.

**Design**:
- On hover, expert name gets a subtle underline. Clicking navigates to `/expert/:did`.
- Avatar is also clickable.
- **Tier indicator**: `energy-focused` experts get a small accent-colored dot or badge next to their name — signals domain authority without being noisy. `general-outlet` experts (e.g., news orgs) could get a different indicator (publication icon). `independent` experts show no indicator — it's the default.
- The tier badge uses the same visual language as the publication tier marker on link previews — a small filled circle, color-coded by tier.

**Data**: `did` for navigation, `handle` for Bluesky profile link, `tier` (new) for authority signal.

## Artboard Updates Required

| Artboard | Changes |
|---|---|
| **Search Results** | Update ontology row to use `[Topic] / term` pattern consistently. Add link preview to one post with publication name. Make timestamps linkable. |
| **Home Feed** | Update topic pills to use same component. Add link preview to one post with thumbnail and publication name. Timestamp links to Bluesky. |
| **Topic Detail** | Concept sub-filters already use pill pattern — verify consistency. Add link preview to posts. Show concept-level breadcrumb where applicable. |
| **Links Feed (L2)** | Show publication names instead of hostnames. Group or filter by publication tier (core energy vs. general). |
| **NEW: Component Sheet** | Formal spec showing TopicTag, OntologyRow, LinkPreview (with publication enrichment), ExpertAttribution (with tier badge), TimeLink at all states. |

## Agent Assignments

### Agent 1: Ontology Component Designer
**Role**: Refine the unified `[Topic] / match-value` pattern across all three artboards.
**Deliverable**: Updated artboards where every topic mention uses the same visual component.
**Key constraint**: Must use real data from the staging API — no placeholder labels.
**New data available**: `ExpertTier` on post results (after Deploy B) — design the tier indicator on expert attribution.

### Agent 2: Link Preview + Publication Designer
**Role**: Design the link preview card component with publication enrichment. After Deploy A, `GET /api/publications` returns `PublicationListItem` with `hostname`, `tier`, `source`, `postCount`.
**Deliverable**: At least one post per artboard showing a link preview. For seeded publications (the ~50 curated energy + general outlet domains), show the publication label. For discovered/unknown domains, fall back to hostname.
**Key constraint**: Must handle with-thumbnail and without-thumbnail states. Must show the visual distinction between `energy-focused`, `general-outlet`, and `unknown` publication tiers. The tier visual should match the expert tier indicator from Agent 1 (same design language for authority signaling).

### Agent 3: Component Sheet Author
**Role**: Create a formal component specification artboard showing every component at every state.
**Deliverable**: One artboard (1440x1200) with:
- TopicTag (default, active, hover)
- OntologyRow (single topic, multi-topic, with/without match value, domain signal variant, hashtag signal variant)
- LinkPreview (with/without thumbnail, with publication name vs. raw hostname, energy-focused vs. general-outlet vs. unknown tier indicator)
- ExpertAttribution (with tier badge: energy-focused / general-outlet / independent)
- TimeLink (relative time as Bluesky link)
- SearchBar
- PublicationBadge (the shared tier indicator used on both link previews and expert names)
**Key constraint**: Must document the token values (font, size, weight, color, spacing) for each component. The tier indicator design must be a single shared component used by both expert attribution and publication link previews.

## Backend Status

### Being Implemented Now (publications-and-expert-tiers-backend plan)

The following are actively being built and will be available after Deploy A + Deploy B:

1. **Publications as first-class D1 entities** — `publications` table with `hostname`, `tier`, `source`, `firstSeenAt`, `lastSeenAt`. Curated seeds from ontology, auto-discovered from ingest.
2. **`GET /api/publications`** — List publications with `tier` and `source` filters. Returns `PublicationListItem` with `postCount` and `latestPostAt`.
3. **Expert tier field** — `tier: ExpertTier` added to `ExpertRecord`, `ExpertListItem`, `AdminExpertResult`, `KnowledgePostResult`. Values: `"energy-focused" | "general-outlet" | "independent"`.
4. **`POST /admin/ops/seed-publications`** — Operator endpoint to seed curated publications from the ontology artifact.
5. **Domain normalization** — Historical `links.domain` values normalized in migration 10. Future writes use consistent normalization.
6. **Publication auto-discovery** — `KnowledgeRepoD1.upsertPosts` records observed publication domains during link insertion.

### Remaining Frontend-Only Items

7. **Bluesky post URL helper** — Client-side utility to convert AT URIs (`at://did/collection/rkey`) to Bluesky web URLs (`https://bsky.app/profile/{handle}/post/{rkey}`). No backend change needed.
8. **Add `tags` to `KnowledgePostResult`** — Thread author hashtags through storage and query layers. Deferred — not in the current backend plan.
9. **Consider joining links into post responses** — Currently links require a separate API call. For the feed view, an option to include the primary external link inline would reduce round-trips. Deferred.

### Rollout Sequence (from backend plan)

**Deploy A**: Schema + seed plumbing → run migration 10 → seed publications
**Deploy B**: Read paths + expert tier + discovery → bootstrap experts → refresh profiles → verify APIs

The frontend can design against the Deploy B API surface now, since the schemas are defined.

## Ontology Utilization Score

How well the frontend surfaces what the ontology provides:

| Signal | Ontology Has | Runtime Uses | Frontend Surfaces | Gap |
|---|---|---|---|---|
| Canonical topics (30) | 30 | 30 | 30 (pills, facets, navigation) | None |
| SKOS concepts (92) | 92 | 92 (rolled into topics) | Partially (concept view endpoint exists, T2 artboard planned) | Design concept drilldown |
| Term matching | ~340 phrases | All | Match value shown in explain mode | None |
| Hashtag matching | 85 | All | Match value shown in explain mode | None |
| Domain matching | 34 core | All | Match value shown in explain mode | None |
| Publication labels | 1,032 | **Closing** — `publications` D1 table with curated seeds | **0** → S6 designs for it | **S6 + backend Deploy A closes this** |
| Publication tiers | 3-tier (`energy-focused`, `general-outlet`, `unknown`) | **Closing** — `PublicationTier` in D1 | **0** → S6 designs for it | **S6 + backend Deploy A closes this** |
| Author/expert tiers | 99 focused + 17 general | **Closing** — `ExpertTier` field on all expert/post models | **0** → S7 designs for it | **S7 + backend Deploy B closes this** |
| Organizations | 2+ defined | 0 | 0 | Future — requires NER at ingest |
| Geographic entities | 2+ defined | 0 | 0 | Future — requires NER at ingest |

**Current score: ~60%** of ontology value reaches the user. After the backend deploy + this design sprint, target is **~85%** — closing Publication labels, publication tiers, and expert tiers. The remaining 15% is Organization/Geographic entity extraction (future NER work).

## Success Criteria

- A user can look at any topic pill anywhere in the UI and immediately understand it's part of the ontology
- Posts with shared links show the article title and publication name (not just hostname) inline
- Link previews for core energy publications are visually distinguishable from general media links
- Every post has a path back to the original Bluesky source
- The component sheet serves as a reference that a frontend engineer could implement from directly
- Domain navigation (`/links?domain=x`) shows the publication's friendly name in the page header
