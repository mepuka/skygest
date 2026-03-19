# Skygest Design System v2 — "The Annotated Feed"

> Expert discourse as manuscript. Data enrichments as scholarly marginalia.

## Design Principles

1. **Two temperatures, one system.** Magazine layer (warm, editorial) and data layer (cool, analytical) are distinct but unified through shared accent (#C45D2C) and spatial rules. Magazine leads, data annotates.

2. **Thread-first, not post-first.** Primary content unit is a thread (expert + charts + discussion), not an individual post. Cards show thread depth, chart count, and reply count as first-class signals.

3. **Progressive disclosure over density.** Feed shows magazine layer by default. Data layer surfaces via hover hints in the margin (desktop) or collapse bars (mobile). User chooses when to go deep.

4. **Charts are content, not decoration.** Numbered chart thumbnails with captions are integral to thread cards. Vision findings annotate them directly.

5. **Expert identity carries weight.** Tier dot indicators and avatars establish credibility before content is read.

---

## Token Architecture

### Magazine Layer (warm, editorial — "the paper")

| Token | Value | Usage |
|-------|-------|-------|
| `--font-display` | Instrument Serif | Wordmark, display headings |
| `--font-body` | Newsreader 16px/25px | Post text, thread body |
| `--font-ui` | Inter 10-13px | Metadata, labels, attribution |
| `--color-text-primary` | `#2A2A26` | Body text, expert names |
| `--color-text-heading` | `#1A1A1A` | Display headings |
| `--color-text-secondary` | `#6B6B63` | Metadata, handles, captions |
| `--color-text-ghost` | `#B0B0A6` | Hashtags, tertiary text |
| `--color-text-whisper` | `#C4C4BB` | Timestamps, separators |
| `--color-surface` | `#FFFFFF` | Card backgrounds |
| `--color-surface-recessed` | `#FAFAF8` | Page background, link preview bg |
| `--color-accent` | `#C45D2C` | Tier dots, active pills, highlights |
| `--color-accent-tint` | `rgba(196,93,44,0.06)` | Hover states, tinted pills |
| `--color-border` | `#EEEEE9` | Card dividers, subtle borders |
| `--color-border-hover` | `#E8E8E4` | Interactive border state |
| `--radius-card` | `3px` | Card corners |
| `--padding-card` | `10px 14px` | Card internal spacing |

### Data Layer (cool, analytical — "the marginalia")

| Token | Value | Usage |
|-------|-------|-------|
| `--font-data-body` | Humanist sans 13-14px | Findings, annotation text |
| `--font-data-mono` | IBM Plex Mono 10-11px | Axis labels, chart types, citations |
| `--color-data-text` | `#3D4551` | Primary data layer text |
| `--color-data-secondary` | `#6B7280` | Secondary data text |
| `--color-data-surface` | `#F5F6F7` | Annotation card backgrounds |
| `--color-data-border` | `#D8DDE3` | Card borders, connectors |
| `--color-data-connector` | `#D8DDE3` dashed | Annotation link lines |
| `--color-data-external` | `#2D7D46` | External data source indicator |
| `--radius-data-card` | `4px` | Data card corners |
| `--padding-data-card` | `12px` | Data card internal spacing |

### Shared

| Token | Value | Usage |
|-------|-------|-------|
| `--color-accent` | `#C45D2C` | Bridge color — both layers |
| `--tier-energy-focused` | `#C45D2C` | 4×4px dot |
| `--tier-general-outlet` | `#6B6B63` | 4×4px dot |
| `--tier-independent` | (none) | No indicator |

---

## Component Inventory

### Magazine Layer Components

#### M1: Thread Card
Primary feed unit. Contains attribution, body, chart strip, reply count.

- **Variants:** text-only, with-charts, with-link-preview
- **Anatomy:** Attribution Row → Body text → (Chart Strip) → (Link Preview) → Reply count
- **Spacing:** 6px internal gaps, 10px top / 14px bottom padding
- **Border:** 1px `--color-border` bottom divider between cards

#### M2: Attribution Row
Expert identity + timestamp.

- **Anatomy:** Avatar (22×22px rounded) → Expert name (Inter 13px/600) → Tier dot (4×4px) → Relative time
- **Spacing:** 7px gaps between elements
- **Tier dots:** energy-focused = `#C45D2C`, general-outlet = `#6B6B63`, independent = none

#### M3: Chart Strip
Horizontal row of numbered chart thumbnails.

- **Anatomy:** Thumbnail image → Number badge (top-left corner) → Caption below
- **Layout:** Horizontal flex, gap 8px, scroll on overflow (mobile)
- **Thumbnail size:** ~120×80px in feed, larger in detail view
- **Caption:** Inter 10px, `--color-text-secondary`

#### M4: Link Preview
External URL card.

- **Anatomy:** Domain line (with tier dot) → Title (2-line clamp) → Description (2-line clamp) → Thumbnail (80×60px)
- **Background:** `--color-surface-recessed`
- **Border:** 1px `--color-border`, hover: `--color-border-hover`
- **Radius:** 3px

#### M5: Expert Discussion
Collapsed reply thread.

- **Collapsed:** "N expert replies" + chevron ▾
- **Expanded:** Indented reply posts with avatars, depth indicators
- **Styling:** Inter 13px, `--color-text-secondary`

#### M6: Blockquote
Pull-quote with attribution.

- **Background:** `#2A2A26` (dark)
- **Text:** Cream/off-white, Newsreader italic
- **Attribution:** "— Name, role" in Inter 11px

#### M7: Topic Filter Bar
Navigation + stats.

- **Pills:** Horizontal row, scroll on mobile
  - Default: transparent bg, `--color-text-secondary`, 1px `--color-border`
  - Hover: `--color-accent-tint` background
  - Active: `--color-accent` fill, white text
- **Stats bar:** Below pills, Inter 11px — "247 threads · 89 experts · Last 24h | Trending: ..."

### Data Layer Components

Data layer components are finding-centric — each card unifies the chart reference, type, insight, and source attribution. No signal scores or confidence numbers are surfaced; these are internal implementation details.

Left border color signals annotation type: `#C45D2C` for vision findings, `#6B6B63` for source-only, `#2D7D46` for external data.

#### D1: Finding Card
Primary annotation unit. Combines chart reference + analysis + source.

- **Left border:** 3px `--color-accent`
- **Anatomy:** Chart number badge + type pill + temporal range → Finding text → Axis info → Source with tier dot
- **Chart badge:** Mono 10px, white on `#3D4551`, 2px radius
- **Type pill:** Mono 10px, `#EBEDF0` bg — e.g., "bar-chart", "line-chart"
- **Finding:** Inter 13px, `--color-data-text`
- **Source:** Favicon + domain mono + tier dot, separated by 1px `#EBEDF0` divider

#### D2: Synthesis Card
Cross-chart finding spanning multiple charts.

- **Left border:** 3px `--color-accent`
- **Anatomy:** Multiple chart badges [1][3][7] + "Cross-chart" label → Combined finding text → Multiple sources
- **Finding text:** Inter 13px/500 (slightly bolder than single-chart findings)

#### D3: Source Card
For link-preview threads without chart analysis.

- **Left border:** 3px `#6B6B63` (secondary)
- **Anatomy:** "LINKED SOURCE" label → Favicon + title + domain with tier dot → Description
- **Title:** Inter 13px/500

#### D4: External Data
Grounding evidence from external APIs/datasets.

- **Left border:** 3px `--color-data-external` (#2D7D46)
- **Anatomy:** "EXTERNAL DATA" label → Sparkline + claim text → API/data source links
- **Sparkline:** 64×24px, `--color-data-external` stroke

#### D5: Discussion Summary
Compact reply overview.

- **Anatomy:** Reply count (mono 20px) + "expert replies" → Top replier (avatar + handle)
- **No sentiment bar or scoring**

#### D6: Data Collapse Bar
Progressive disclosure trigger (primarily mobile).

- **Anatomy:** "N findings · N sources" + chevron ▾
- **Surface:** Warm tan `#F0EDE8` (bridges magazine→data transition)
- **Expanded:** Reveals finding cards stacked vertically in cool gray surface
- **Behavior:** Pushes content down (not overlay)

---

## Layout System

### Desktop (1440px)

```
┌──────────────────────────────────────────────────────────┐
│  Skygest (Instrument Serif)    Topic Pills     [User]    │
│  Stats bar: 247 threads · 89 experts · Trending: ...     │
├────────────────────────────────┬─────────────────────────┤
│                                │                         │
│  Thread Card (680px)           │  Margin Note (320px)    │
│  ┌────────────────────────┐    │  ┌───────────────────┐  │
│  │ M2: Attribution Row     │◄───┼──│ D1: Finding Card   │  │
│  │ Body text (Newsreader)  │    │  │ D3: Source Card     │  │
│  │ M3: [1.][2.][3.] charts│    │  │ "3 findings"       │  │
│  │ M5: 3 expert replies ▾ │    │  └───────────────────┘  │
│  └────────────────────────┘    │  (anchored to card)     │
│                                │                         │
│  Thread Card                   │                         │
│  ┌────────────────────────┐    │  (appears on            │
│  │ ...                    │    │   hover/select)         │
│  └────────────────────────┘    │                         │
│                                │                         │
└────────────────────────────────┴─────────────────────────┘
```

- Main column: 680px, left-aligned with generous left margin
- Margin: 320px, right of main column
- Gap: 40px between columns
- Margin notes anchored to their thread card (scroll with card)
- Connector: dashed line from card edge to margin note

### Thread Detail (Desktop)

```
┌──────────────────────────────────────────────────────────┐
│  ← Back    Skygest                             [User]    │
├────────────────────────────────┬─────────────────────────┤
│                                │                         │
│  M2: Focus post attribution    │  D1: Finding Cards      │
│  Body text (full)              │  ┌───────────────────┐  │
│  Inline highlights on key      │  │ [1] bar-chart      │  │
│  findings (#C45D2C underline)  │  │ Finding + source   │  │
│                                │  ├───────────────────┤  │
│  M3: Chart grid (2×5)         │  │ [1][3][7] Cross    │  │
│  ┌────┬────┬────┬────┬────┐   │  │ Synthesis finding  │  │
│  │ 1. │ 2. │ 3. │ 4. │ 5. │   │  └───────────────────┘  │
│  ├────┼────┼────┼────┼────┤   │                         │
│  │ 6. │ 7. │ 8. │ 9. │10. │   │  D4: External Data      │
│  └────┴────┴────┴────┴────┘   │  D5: Discussion Summary  │
│                                │                         │
│  Ancestors (indented)          │                         │
│                                │                         │
├────────────────────────────────┴─────────────────────────┤
│  Expert Discussion (full width)                          │
│  Indented replies with engagement counts                 │
└──────────────────────────────────────────────────────────┘
```

### Mobile (375px)

```
┌───────────────────────┐
│ Skygest        ≡ User │
│ [All][Solar][Wind]→   │  ← horizontal scroll
├───────────────────────┤
│ M2: Attribution Row   │
│ Body text             │
│ M3: [1.][2.][3.]  →  │  ← scroll strip
│ D6: 3 findings ·     │
│     3 sources    ▾    │  ← collapse bar
│ M5: 3 replies    ▾   │
├───────────────────────┤
│ Next thread card      │
└───────────────────────┘
```

---

## Interaction Patterns

### 1. Margin Annotation (Desktop)

- Default: margin area empty/subtle
- Hover thread card: margin shows lightweight summary (finding count + source count)
- Click/select card: margin shows full annotation stack
- One active annotation at a time
- Connector: dashed line from card right edge to margin note left edge

### 2. Progressive Disclosure (Mobile)

- D7 collapse bar sits between chart strip and reply count
- Tap chevron: expands finding cards + sources vertically
- Content below pushes down (no overlay)
- Collapse bar summary updates contextually

### 3. Feed → Detail Transition

- Click thread card → navigate to thread detail view
- Detail view: full two-column layout (magazine + full data margin)
- Back button returns to feed at scroll position

### 4. Topic Filtering

- Pill states: default → hover (tint) → active (fill)
- Multi-select supported: multiple active pills filter additively
- Stats bar updates live: thread count, expert count, trending topics

### 5. Chart Thumbnail Interaction

- Feed: thumbnails are preview-only, numbered
- Detail: click thumbnail → highlights corresponding Vision Finding in margin
- Detail: hover thumbnail → connector line appears to its analysis card

---

## Views

### V1: Feed View
- Topic filter bar (M7) at top
- Thread cards (M1) in main column
- Margin annotations anchored to cards
- Infinite scroll or paginated

### V2: Thread Detail View
- Full thread with focus post, ancestors, replies
- Chart grid with numbered thumbnails
- Full data layer margin (finding cards, sources, external data)
- Expert discussion at bottom, full width

### V3: Mobile Feed
- Single column, topic pills scroll horizontally
- Thread cards with D6 collapse bars
- No margin — data layer inline via progressive disclosure

### V4: Mobile Thread Detail
- Single column, full thread text
- Charts in scroll strip
- D6 collapse bar expands to show finding cards + sources
- Replies below with indentation

---

## Future Components (not in current scope)

- **Integration Panel:** External API data (GridStatus, BC Hydro) in data layer
- **Curation Interface:** Operator tools for flagging/approving candidates
- **Expert Profile:** Expert page with thread history, topic coverage
- **Notification/Alert:** Topic-based alerts for breaking threads
