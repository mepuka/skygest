# Skygest Energy — Frontend Design System Plan

## Artboard Inventory (27 total)

### Global Chrome (4)
- G1: Header — Default (brand, search, topic ribbon)
- G2: Header — Topic Active
- G3: Header — Search Focused
- G4: Footer

### Feed View (6)
- F1: Feed — Populated (No Filter) — recent posts, all topics
- F2: Feed — Filtered by Topic — e.g., "Energy Storage"
- F3: Feed — Filtered by Expert — single expert's posts
- F4: Feed — Empty (No Posts)
- F5: Feed — Loading (skeleton)
- F6: Feed — Pagination Boundary

### Search View (7)
- S1: Search — Landing (Empty)
- S2: Search — Results Populated
- S3: Search — Results with Topic Filter
- S4: Search — No Results
- S5: Search — Error State
- S6: Search — Snippet Detail (zoomed)
- S7: Search — Pagination

### Topic Detail (3)
- T1: Topic Detail — Canonical Topic (e.g., "Grid and Infrastructure")
- T2: Topic Detail — Concept Drilldown (e.g., "Transmission")
- T3: Topic Map — Full Ontology directory

### Link Preview (2)
- L1: Link Preview — Inline (within post)
- L2: Links Feed (standalone)

### Expert Directory (2)
- E1: Expert Directory
- E2: Avatar Fallback spec

### Error States (3)
- X1: Network Error
- X2: 404
- X3: Slow Connection / Timeout

---

## Typography Scale

| Role | Font | Weight | Size | Line Height | Color |
|---|---|---|---|---|---|
| Brand wordmark | Instrument Serif | 400 | 28px | 1.2 | #1A1A1A |
| Section heading | Instrument Serif | 400 | 22px | 1.3 | #1A1A1A |
| Topic heading | Instrument Serif | 400 | 18px | 1.3 | #1A1A1A |
| Post text / body | Newsreader | 400 | 16px | 1.55 | #1A1A1A |
| Expert name | Inter | 600 | 14px | 1.3 | #1A1A1A |
| Handle / metadata | Inter | 400 | 13px | 1.3 | #6B6B63 |
| Topic tag label | Inter | 500 | 11px | 1.2 | #3D3D38 |
| Time display | Inter | 400 | 13px | 1.3 | #6B6B63 |
| Search snippet | Newsreader | 400 | 15px | 1.5 | #1A1A1A |
| Caption / footnote | Inter | 400 | 12px | 1.4 | #6B6B63 |

## Spacing System

| Token | Value | Usage |
|---|---|---|
| section | 48px | Between major sections |
| group | 24px | Between post cards |
| element | 12px | Within post cards |
| tight | 8px | Avatar-to-name, between pills |
| micro | 4px | Pill padding, label-value gaps |

## Color Palette

| Name | Hex | Usage |
|---|---|---|
| Ink | #1A1A1A | Primary text |
| Paper | #FAFAF8 | Background |
| Surface | #FFFFFF | Raised column |
| Mid | #6B6B63 | Secondary text, metadata |
| Light | #E8E8E4 | Dividers, borders |
| Accent | #C45D2C | Active states, highlights |
| Ink-light | #3D3D38 | Topic tags |
| Ghost | #B0B0A6 | Handles, timestamps |
| Whisper | #C4C4BB | Connecting text ("via", "/") |
| Tag-bg | #F0F0EC | Topic tag background |
| Highlight | rgba(196,93,44,0.12) | Search match highlight |

## OntologyContextUnit — The Coherent Component

Three levels of progressive disclosure:

**Primary (always visible)**: Topic pills — e.g., `[Solar] [Energy Policy]`

**Secondary (hover/tap)**: Match evidence — `[Solar] via "photovoltaic" (term)`

**Tertiary (explicit click)**: Full provenance from `/api/posts/:uri/topics` — match score, ontology version, concept path

Same TopicTag component everywhere: header ribbon, post cards, search context, breadcrumbs.

## Time Display

| Age | Format | Example |
|---|---|---|
| < 1 min | "just now" | just now |
| 1-59 min | "{n}m ago" | 23m ago |
| 1-23 hours | "{n}h ago" | 4h ago |
| 1-6 days | "{n}d ago" | 3d ago |
| 7-365 days | "Mon D" | Mar 7 |
| > 365 days | "Mon D, YYYY" | Jan 19, 2022 |

## URL Structure

```
/                              Feed (recent posts, no filter)
/topic/:slug                   Topic-filtered feed
/topic/:slug/:conceptSlug      Concept drilldown
/expert/:did                   Expert-filtered feed
/search?q=...&topic=...        Search results
/topics                        Full topic directory
/experts                       Expert directory
/links                         Links feed
```

## Ontology Groups (for topic ribbon ordering)

1. **Generation**: solar, wind, offshore-wind, geothermal, hydro, biomass, nuclear, hydrogen, natural-gas, coal, oil
2. **Grid & Demand**: energy-storage, distributed-energy, grid-and-infrastructure, electrification, energy-efficiency, data-center-demand
3. **Markets & Policy**: energy-policy, energy-markets, energy-finance, energy-geopolitics, critical-minerals
4. **Climate & Transition**: climate-and-emissions, carbon-capture, carbon-markets, environment-and-land-use, energy-justice, sectoral-decarbonization, workforce-and-manufacturing, research-and-innovation

## Key Components

- PostCard, ExpertAttribution, AvatarCircle, TopicTag, TopicRibbon
- SearchBar, SearchContextBar, OntologyContextUnit, SnippetText
- LinkPreview, TimeDisplay, TopicDescription, OntologyBreadcrumb
- PageShell, ContentColumn, InfiniteScrollSentinel, ErrorMessage
