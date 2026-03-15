# Ontology Row Component Specification

**Date:** 2026-03-15
**Status:** Final (Sprint 1)
**Scope:** OntologyRow (text breadcrumb + interactive pill modes), TopicTag, SearchContextBar, and expert tier indicator components

---

## 1. Design Token Reference

All components in this specification share a common token set. These are the authoritative values; do not override them inline.

| Token | Value |
|---|---|
| Brand typeface | Instrument Serif 400 |
| Body typeface | Newsreader 400, 16px/1.55, `#2A2A26` |
| UI chrome typeface | Inter |
| Background (paper) | `#FAFAF8` |
| Background (surface) | `#FFFFFF` |
| Accent (burnt sienna) | `#C45D2C` |
| Text primary | `#2A2A26` |
| Text secondary | `#6B6B63` |
| Text tertiary / ghost | `#B0B0A6` |
| Text mid / breadcrumb | `#9A9A90` |
| Separator | `#C4C4BB` |
| Pill active background | `#C45D2C` |
| Pill active text | `#FFFFFF` |
| Expert name color | `#1A1A1A` |
| Handle color | `#B0B0A6` |
| Time color | `#C4C4BB` |

---

## 2. Annotation Modes: Breadcrumb vs. Interactive Pill

The team has decided on **two distinct rendering modes** for topic annotations. The mode is determined by context, not by the data.

| Mode | Context | Visual treatment |
|---|---|---|
| **Text breadcrumb** (default) | Post cards, feed items, search results | Plain Inter 10px text, no background, `/` separator |
| **Interactive pill** | Topic filter bars, facet navigation, active topic state | Subtle pill with hover/active states |

The OntologyRow component accepts a `mode` prop to switch between these treatments. In the absence of an explicit mode, **text breadcrumb is the default**.

---

## 3. OntologyRow Component (Text Breadcrumb Mode)

The default annotation for posts. Shows one or more topic matches as plain text breadcrumbs with match provenance.

### 3.1 Schema

```typescript
interface OntologyRowProps {
  mode?: "breadcrumb" | "interactive";  // default: "breadcrumb"
  topics: Array<{
    topicSlug: string;        // e.g. "solar"
    topicLabel: string;       // e.g. "Solar"
    matchSignal: "term" | "hashtag" | "domain";
    matchValue: string;       // e.g. "photovoltaic", "pv-magazine.com", "#solarenergy"
  }>;
}
```

The data source is the `ExplainedPostTopic` schema from `src/domain/bi.ts`, specifically the fields `topicSlug`, `topicLabel`, `matchSignal`, and `matchValue`.

### 3.2 Breadcrumb Layout Rules

- The row is a horizontal flex container, `align-items: center`, wrapping allowed
- Each topic annotation is a text unit: `Topic Label / match-value`
- Multiple topic annotations are separated by a `  /  ` separator (with spaces) in `#C4C4BB`
- The entire row sits below all other post content (body, hashtags, link preview), above the divider
- Position: left-aligned, flush with body text

```html
<div style="
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 3px;
">
  <!-- topic breadcrumb units go here -->
</div>
```

### 3.3 Variant A: Single Topic with Term Match

The most common case. The topic label and match value are rendered as plain text.

**Example data:** Post matched `solar` via the term "photovoltaic". From smoke fixture: "Utility-scale solar photovoltaic battery storage is easing power grid pressure."

```html
<div style="
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 3px;
">
  <span style="
    font-family: Inter, system-ui, sans-serif;
    font-size: 10px;
    font-weight: 400;
    line-height: 1;
    color: #9A9A90;
    white-space: nowrap;
  ">Solar</span>
  <span style="
    font-family: Inter, system-ui, sans-serif;
    font-size: 10px;
    font-weight: 400;
    color: #C4C4BB;
  ">/</span>
  <span style="
    font-family: Inter, system-ui, sans-serif;
    font-size: 10px;
    font-weight: 400;
    color: #9A9A90;
    white-space: nowrap;
  ">photovoltaic</span>
</div>
```

**Visual rendering:** `Solar / photovoltaic`
- `Solar` is Inter 10px/400, `#9A9A90` (Mid)
- `/` is Inter 10px/400, `#C4C4BB` (Separator)
- `photovoltaic` is Inter 10px/400, `#9A9A90` (Mid)
- 3px gap between elements

### 3.4 Variant B: Multi-Topic Breadcrumb

When a post matches multiple topics. Each annotation unit follows the same pattern; units are separated by a `/` in `#C4C4BB` with surrounding spacing.

**Example data:** Post about offshore wind transmission matched both `grid-and-infrastructure` (term: "transmission") and `wind` (term: "offshore wind"). From smoke fixture: "Offshore wind developers still need more transmission capacity."

```html
<div style="
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 3px;
">
  <span style="
    font-family: Inter, system-ui, sans-serif;
    font-size: 10px;
    font-weight: 400;
    line-height: 1;
    color: #9A9A90;
    white-space: nowrap;
  ">Grid and Infrastructure</span>
  <span style="
    font-family: Inter, system-ui, sans-serif;
    font-size: 10px;
    font-weight: 400;
    color: #C4C4BB;
  ">/</span>
  <span style="
    font-family: Inter, system-ui, sans-serif;
    font-size: 10px;
    font-weight: 400;
    color: #9A9A90;
    white-space: nowrap;
  ">transmission</span>
  <span style="
    font-family: Inter, system-ui, sans-serif;
    font-size: 10px;
    font-weight: 400;
    color: #C4C4BB;
    margin: 0 3px;
  ">/</span>
  <span style="
    font-family: Inter, system-ui, sans-serif;
    font-size: 10px;
    font-weight: 400;
    line-height: 1;
    color: #9A9A90;
    white-space: nowrap;
  ">Wind</span>
  <span style="
    font-family: Inter, system-ui, sans-serif;
    font-size: 10px;
    font-weight: 400;
    color: #C4C4BB;
  ">/</span>
  <span style="
    font-family: Inter, system-ui, sans-serif;
    font-size: 10px;
    font-weight: 400;
    color: #9A9A90;
    white-space: nowrap;
  ">offshore wind</span>
</div>
```

**Visual rendering:** `Grid and Infrastructure / transmission  /  Wind / offshore wind`

The `/` between `transmission` and `Wind` acts as the inter-topic separator. Within a topic, the `/` separates label from match value. The spacing makes the hierarchy readable: label`/`value for intra-topic, and a wider `  /  ` for inter-topic boundaries.

### 3.5 Variant C: No Match Value

When the matched term is identical to the topic label (e.g., a post matched "wind" and the topic is "Wind"). The match value adds no information, so omit it and the intra-topic separator.

```html
<div style="
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 3px;
">
  <span style="
    font-family: Inter, system-ui, sans-serif;
    font-size: 10px;
    font-weight: 400;
    line-height: 1;
    color: #9A9A90;
    white-space: nowrap;
  ">Wind</span>
</div>
```

**Display rule:** If `matchValue.toLowerCase() === topicLabel.toLowerCase()` or `matchValue === topicSlug`, render only the topic label text without separator or match-value text.

### 3.6 Variant D: Domain Signal

When the topic match was driven by a link domain (matchSignal: `"domain"`). A small link icon precedes the domain name.

**Example data:** Post links to `pv-magazine.com`, which is a curated domain for the `solar` topic (score: 4).

```html
<div style="
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 3px;
">
  <span style="
    font-family: Inter, system-ui, sans-serif;
    font-size: 10px;
    font-weight: 400;
    line-height: 1;
    color: #9A9A90;
    white-space: nowrap;
  ">Solar</span>
  <span style="
    font-family: Inter, system-ui, sans-serif;
    font-size: 10px;
    font-weight: 400;
    color: #C4C4BB;
  ">/</span>
  <span style="display: inline-flex; align-items: center; gap: 2px;">
    <svg width="9" height="9" viewBox="0 0 16 16" fill="none" style="flex-shrink: 0;">
      <path d="M6.5 11.5L4.5 13.5C3.4 14.6 1.6 14.6 0.5 13.5C-0.6 12.4 -0.6 10.6 0.5 9.5L4.5 5.5C5.6 4.4 7.4 4.4 8.5 5.5" stroke="#9A9A90" stroke-width="1.5" stroke-linecap="round"/>
      <path d="M9.5 4.5L11.5 2.5C12.6 1.4 14.4 1.4 15.5 2.5C16.6 3.6 16.6 5.4 15.5 6.5L11.5 10.5C10.4 11.6 8.6 11.6 7.5 10.5" stroke="#9A9A90" stroke-width="1.5" stroke-linecap="round"/>
    </svg>
    <span style="
      font-family: Inter, system-ui, sans-serif;
      font-size: 10px;
      font-weight: 400;
      color: #9A9A90;
      white-space: nowrap;
    ">pv-magazine.com</span>
  </span>
</div>
```

**Visual rendering:** `Solar / (link-icon) pv-magazine.com`

The link icon is a 9x9 chain-link SVG in `#9A9A90` (matching the breadcrumb text), positioned inline before the domain text. The icon color matches the surrounding breadcrumb text, not the accent color -- keeping the annotation quiet.

### 3.7 Variant E: Hashtag Signal

When the topic match was driven by a hashtag (matchSignal: `"hashtag"`). The match value is displayed with the `#` prefix.

**Example data:** Post tagged `#solarenergy`, which is a curated hashtag for the `solar` topic (score: 3).

```html
<div style="
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 3px;
">
  <span style="
    font-family: Inter, system-ui, sans-serif;
    font-size: 10px;
    font-weight: 400;
    line-height: 1;
    color: #9A9A90;
    white-space: nowrap;
  ">Solar</span>
  <span style="
    font-family: Inter, system-ui, sans-serif;
    font-size: 10px;
    font-weight: 400;
    color: #C4C4BB;
  ">/</span>
  <span style="
    font-family: Inter, system-ui, sans-serif;
    font-size: 10px;
    font-weight: 400;
    color: #9A9A90;
    white-space: nowrap;
  ">#solarenergy</span>
</div>
```

**Visual rendering:** `Solar / #solarenergy`

The `#` prefix is part of the rendered text for hashtag signals.

### 3.8 Match Value Display Rules

| matchSignal | matchValue format | Display format | Icon |
|---|---|---|---|
| `term` | `"photovoltaic"` | `photovoltaic` | none |
| `hashtag` | `"solarenergy"` | `#solarenergy` | none |
| `domain` | `"pv-magazine.com"` | `pv-magazine.com` | chain-link (9x9) |

Suppress match value entirely when:
- `matchValue` lowercased equals `topicLabel` lowercased
- `matchValue` equals `topicSlug`

### 3.9 Breadcrumb Spacing Summary

| Property | Value |
|---|---|
| Text size | Inter 10px/400 |
| Text color (labels + values) | `#9A9A90` |
| Separator `/` color | `#C4C4BB` |
| Intra-unit gap (label / separator / value) | `3px` |
| Inter-topic separator | `/` in `#C4C4BB` with `3px` margin on each side |
| Domain icon size | 9x9px |
| Domain icon gap (icon to text) | `2px` |

---

## 4. TopicTag Component (Interactive Pill Mode)

The interactive pill is used **only in filter/navigation contexts** -- topic filter bars, facet navigation, search context bars. It is NOT used for post-level annotations (those use the text breadcrumb above).

### 4.1 Schema

```typescript
interface TopicTagProps {
  slug: string;        // e.g. "solar"
  label: string;       // e.g. "Solar"
  active?: boolean;    // true when this is the current filter or nav context
  size?: "default" | "small";  // "small" for sub-filter and breadcrumb contexts
}
```

### 4.2 Rest State (Ghost Pill)

At rest, the pill has **no background fill** -- just text. This is a deliberate departure from the earlier filled-pill treatment, making filters feel lighter and less cluttered.

Rendered as a `<a>` element linking to `/topic/${slug}`.

```html
<a href="/topic/solar"
   style="
     display: inline-flex;
     align-items: center;
     font-family: Inter, system-ui, sans-serif;
     font-size: 11px;
     font-weight: 500;
     line-height: 1;
     color: #6B6B63;
     background: transparent;
     padding: 2px 8px;
     border-radius: 2px;
     text-decoration: none;
     cursor: pointer;
     white-space: nowrap;
     transition: background 120ms ease, color 120ms ease;
   ">Solar</a>
```

**Visual:** `Solar` in Inter 11px/500, `#6B6B63` text on transparent background, 2px vertical / 8px horizontal padding, 2px border-radius. The padding is maintained even with no fill so that hover/active transitions don't cause layout shift.

### 4.3 Hover State

On hover, a very light topic-tinted background appears. For the default accent color:

```html
<a href="/topic/solar"
   style="
     display: inline-flex;
     align-items: center;
     font-family: Inter, system-ui, sans-serif;
     font-size: 11px;
     font-weight: 500;
     line-height: 1;
     color: #6B6B63;
     background: rgba(196, 93, 44, 0.06);
     padding: 2px 8px;
     border-radius: 2px;
     text-decoration: none;
     cursor: pointer;
     white-space: nowrap;
   ">Solar</a>
```

**Visual:** Same text styling, but with a barely-perceptible warm tint (`rgba(196, 93, 44, 0.06)` -- 6% opacity accent). This confirms interactivity without visual heaviness.

If topic-specific colors are available, the hover background uses that topic's color at 6% opacity instead of the default accent. For topics without a specific color, fall back to the accent `#C45D2C`.

### 4.4 Active State

Applied when this topic is the current filter selection. The pill fills with the accent color.

```html
<a href="/topic/solar"
   style="
     display: inline-flex;
     align-items: center;
     font-family: Inter, system-ui, sans-serif;
     font-size: 11px;
     font-weight: 500;
     line-height: 1;
     color: #FFFFFF;
     background: #C45D2C;
     padding: 2px 8px;
     border-radius: 2px;
     text-decoration: none;
     cursor: pointer;
     white-space: nowrap;
   ">Solar</a>
```

**Visual:** White text on filled accent background. This is the strongest visual state, clearly indicating the active filter.

### 4.5 Active Hover State

When hovering the already-active pill:

- Background transitions to `#A84D24` (10% darker accent)
- Text remains `#FFFFFF`

### 4.6 Small Variant

Used in SearchContextBar related-concepts row and sub-filters.

```html
<a href="/topic/energy-storage"
   style="
     display: inline-flex;
     align-items: center;
     font-family: Inter, system-ui, sans-serif;
     font-size: 10px;
     font-weight: 500;
     line-height: 1;
     color: #6B6B63;
     background: transparent;
     padding: 2px 6px;
     border-radius: 2px;
     text-decoration: none;
     cursor: pointer;
     white-space: nowrap;
     transition: background 120ms ease, color 120ms ease;
   ">Energy Storage</a>
```

Differences from default: `font-size: 10px`, `padding: 2px 6px`.

### 4.7 State Transition Summary

| State | Background | Text color | Border |
|---|---|---|---|
| Rest | `transparent` | `#6B6B63` | none |
| Hover | `rgba(196, 93, 44, 0.06)` | `#6B6B63` | none |
| Active | `#C45D2C` | `#FFFFFF` | none |
| Active + Hover | `#A84D24` | `#FFFFFF` | none |
| Focus-visible | per current state | per current state | standard browser focus ring |

### 4.8 Contexts Where Each Mode Appears

| Context | Mode | Variant | Notes |
|---|---|---|---|
| Post card ontology annotation | **breadcrumb** | -- | Plain text below all post content |
| Search result ontology annotation | **breadcrumb** | -- | Same as post card |
| Topic ribbon / facet nav | **interactive pill** | default or active | Active state on current filter |
| Search context bar breadcrumb | **interactive pill** | default (active for current topic) | In `ONTOLOGY / [Topic]` hierarchy |
| Search context bar related concepts | **interactive pill** | small | Related concept pills in row 2 |
| Concept sub-filters | **interactive pill** | small | Narrower concept pills within an expanded topic |

### 4.9 Real Data Examples

From the `energy-snapshot.json` ontology (v0.3.0):

- `Solar` -- slug: `solar`, 11 terms, 4 hashtags, 1 domain
- `Grid and Infrastructure` -- slug: `grid-and-infrastructure`, 23 terms, 6 hashtags, 3 domains
- `Energy Policy` -- slug: `energy-policy`, 24 terms, 3 hashtags, 3 domains
- `Wind` -- slug: `wind`, 7 terms, 4 hashtags, 1 domain
- `Energy Storage` -- slug: `energy-storage`, 18 terms, 3 hashtags, 2 domains

---

## 5. SearchContextBar Component

Displays the ontology hierarchy breadcrumb above search results, connecting the user's search or topic filter to the ontology structure. Uses **interactive pills** (not text breadcrumbs) because this is a navigation/filter context.

### 5.1 Schema

```typescript
interface SearchContextBarProps {
  /** The active topic being browsed or filtered */
  topic: {
    slug: string;
    label: string;
    description: string;
    parentSlugs: string[];
    childSlugs: string[];
  };
  /** Related/narrower concepts for sub-filtering */
  relatedConcepts: Array<{
    slug: string;
    label: string;
  }>;
  /** Search query, if any */
  query?: string;
}
```

The data source is the `OntologyListTopic` schema from `src/domain/bi.ts`.

### 5.2 Layout

The bar has two rows:
1. **Breadcrumb row:** `ONTOLOGY / [Topic Label] / match-context`
2. **Related concepts row:** small interactive TopicTag pills for narrower concepts

```html
<div style="
  padding: 12px 16px 10px 16px;
  background: #FFFFFF;
  border-bottom: 1px solid #F0F0EC;
">
  <!-- Row 1: Breadcrumb -->
  <div style="
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 8px;
  ">
    <span style="
      font-family: Inter, system-ui, sans-serif;
      font-size: 10px;
      font-weight: 600;
      letter-spacing: 0.05em;
      text-transform: uppercase;
      color: #B0B0A6;
    ">Ontology</span>
    <span style="
      font-family: Inter, system-ui, sans-serif;
      font-size: 11px;
      font-weight: 400;
      color: #C4C4BB;
    ">/</span>
    <a href="/topic/energy-storage"
       style="
         display: inline-flex; align-items: center;
         font-family: Inter, system-ui, sans-serif;
         font-size: 11px; font-weight: 500; line-height: 1;
         color: #FFFFFF; background: #C45D2C;
         padding: 2px 8px; border-radius: 2px;
         text-decoration: none; cursor: pointer; white-space: nowrap;
       ">Energy Storage</a>
    <span style="
      font-family: Inter, system-ui, sans-serif;
      font-size: 11px;
      font-weight: 400;
      color: #C4C4BB;
    ">/</span>
    <span style="
      font-family: Inter, system-ui, sans-serif;
      font-size: 11px;
      font-weight: 400;
      color: #C45D2C;
    ">battery storage</span>
  </div>

  <!-- Row 2: Related concepts (interactive small pills) -->
  <div style="
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px;
  ">
    <a href="/topic/energy-storage?concept=LongDurationStorage"
       style="
         display: inline-flex; align-items: center;
         font-family: Inter, system-ui, sans-serif;
         font-size: 10px; font-weight: 500; line-height: 1;
         color: #6B6B63; background: transparent;
         padding: 2px 6px; border-radius: 2px;
         text-decoration: none; cursor: pointer; white-space: nowrap;
         transition: background 120ms ease;
       ">Long Duration Storage</a>
    <a href="/topic/energy-storage?concept=PumpedHydroStorage"
       style="
         display: inline-flex; align-items: center;
         font-family: Inter, system-ui, sans-serif;
         font-size: 10px; font-weight: 500; line-height: 1;
         color: #6B6B63; background: transparent;
         padding: 2px 6px; border-radius: 2px;
         text-decoration: none; cursor: pointer; white-space: nowrap;
         transition: background 120ms ease;
       ">Pumped Hydro Storage</a>
    <a href="/topic/energy-storage?concept=BatteryRecycling"
       style="
         display: inline-flex; align-items: center;
         font-family: Inter, system-ui, sans-serif;
         font-size: 10px; font-weight: 500; line-height: 1;
         color: #6B6B63; background: transparent;
         padding: 2px 6px; border-radius: 2px;
         text-decoration: none; cursor: pointer; white-space: nowrap;
         transition: background 120ms ease;
       ">Battery Recycling</a>
  </div>
</div>
```

**Visual rendering:**

```
ONTOLOGY / [Energy Storage] / battery storage
  Long Duration Storage   Pumped Hydro Storage   Battery Recycling
```

Note: The active topic pill (`[Energy Storage]`) uses the filled active state. The related concept pills use the ghost/rest state with hover behavior.

### 5.3 Real Data Example: Solar Topic

From `GET /api/topics/solar`:

- **Topic:** Solar (slug: `solar`)
- **Terms (select):** photovoltaic, solar farm, rooftop solar, solar panel, distributed solar
- **Hashtags:** `#solar`, `#solarenergy`, `#solarpower`, `#rooftopsolar`
- **Domains:** `pv-magazine.com`

Breadcrumb rendering when user searches for "photovoltaic" within the solar topic:

```
ONTOLOGY / [Solar] / photovoltaic
  Rooftop Solar
```

### 5.4 Real Data Example: Grid and Infrastructure Topic

- **Topic:** Grid and Infrastructure (slug: `grid-and-infrastructure`)
- **Concept slugs:** Distribution, GridAndInfrastructure, GridModernization, GridOperator, Interconnection, Transmission
- **Terms (select):** transmission, interconnection, smart grid, grid modernization, power distribution

Breadcrumb rendering when filtering by grid-and-infrastructure:

```
ONTOLOGY / [Grid and Infrastructure]
  Distribution   Grid Modernization   Grid Operator   Interconnection   Transmission
```

### 5.5 States

| State | Behavior |
|---|---|
| Default | Breadcrumb visible, topic pill in active state, related concept pills at rest (transparent bg) |
| Concept hover | Hovered concept pill shows `rgba(196, 93, 44, 0.06)` background |
| Concept selected | One related concept pill transitions to active state (filled); results filter to that narrower concept |
| Search active | Match context text (after final `/`) shows the search query term in `#C45D2C` |
| No related concepts | Row 2 is hidden; bar shrinks to breadcrumb only |

### 5.6 Visual Connection to OntologyRow

The SearchContextBar and OntologyRow share the same visual language:
- Same `/` separator style (`#C4C4BB`)
- Same match-value accent color (`#C45D2C`) in the search context bar
- Same Inter typeface throughout

The bar establishes the topic context at the page level; the OntologyRow breadcrumb on each post card echoes it at the post level in a quieter register (Inter 10px `#9A9A90` instead of the bar's more prominent treatment).

### 5.7 Spacing and Alignment Summary

| Property | Value |
|---|---|
| Bar padding | `12px 16px 10px 16px` |
| Bar bottom border | `1px solid #F0F0EC` |
| Breadcrumb row gap | `6px` |
| Breadcrumb to concepts row spacing | `8px` |
| Concept pill gap | `4px` |
| "ONTOLOGY" label | Inter 10px/600, uppercase, `letter-spacing: 0.05em`, `#B0B0A6` |

---

## 6. Expert Tier Indicator

The backend adds `tier: "energy-focused" | "general-outlet" | "independent"` to expert data, driven by the `authorTiers` section of the ontology snapshot. The UI needs a subtle indicator next to expert names.

### 6.1 Data Source

From `config/ontology/energy-snapshot.json`:

- **energy-focused:** 100 handles (e.g., `sammyroth.bsky.social`, `jeffstjohn.bsky.social`, `hausfath.bsky.social`, `canarymedia.com`, `carbonbrief.org`, `heatmap.news`)
- **general-outlet:** 17 handles (e.g., `nytimes.com`, `reuters.com`, `washingtonpost.com`, `bloomberg.com`, `politico.com`)
- **independent:** All other experts (no explicit list; default tier)

### 6.2 Indicator Specifications

#### energy-focused

A small filled dot in the accent color, positioned after the expert name in the attribution row.

```html
<span style="
  display: inline-block;
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: #C45D2C;
  flex-shrink: 0;
" title="Energy-focused source"></span>
```

**Visual:** 4x4px filled circle in `#C45D2C`. Tooltip: "Energy-focused source".

#### general-outlet

A small filled dot in the mid text color.

```html
<span style="
  display: inline-block;
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: #6B6B63;
  flex-shrink: 0;
" title="General news outlet"></span>
```

**Visual:** 4x4px filled circle in `#6B6B63`. Tooltip: "General news outlet".

#### independent

No indicator. The absence of a dot is the default.

### 6.3 Indicator Summary

| Tier | Element | Size | Fill | Tooltip |
|---|---|---|---|---|
| `energy-focused` | Filled circle | 4x4px | `#C45D2C` | "Energy-focused source" |
| `general-outlet` | Filled circle | 4x4px | `#6B6B63` | "General news outlet" |
| `independent` | (none) | -- | -- | -- |

### 6.4 Placement Rules

- The tier indicator appears inline in the attribution row, after the expert name, before the time
- It vertically centers with the surrounding text baseline
- In compact layouts, the indicator moves to after the expert name if the handle is hidden
- The indicator does not appear when expert attribution is omitted

### 6.5 Coordination with Publication Tier Indicators

The expert tier indicator and the publication/link tier indicator share the same visual grammar:

- Same size (4x4px dots)
- Same color mapping: accent-filled for domain-specialized sources, mid-filled for general sources, absent for unclassified
- Same positioning pattern (inline after the relevant label)

---

## 7. Implementation Notes

### 7.1 Data Flow

1. `GET /api/posts/recent` returns `KnowledgePostResult` with `topics: string[]` (slug array only)
2. To render OntologyRow with match provenance, the frontend must either:
   - Call `GET /api/posts/:uri/topics` per post to get `ExplainedPostTopic` with `matchSignal`, `matchValue`, and `topicLabel`
   - Or the API should be extended to include provenance inline in the post result (recommended for performance)
3. Topic labels and hierarchy come from `GET /api/topics/:slug` and `GET /api/topics/:slug/expand?mode=descendants`
4. Expert tier is determined by matching the expert's handle against `authorTiers.energyFocused` and `authorTiers.generalOutlets` in the ontology snapshot

### 7.2 Recommended API Extension

To avoid N+1 calls for post topic provenance, extend `KnowledgePostResult` to include inline provenance:

```typescript
// Current
topics: string[]  // ["solar", "energy-storage"]

// Recommended
topics: Array<{
  slug: string;
  label: string;
  matchSignal: "term" | "hashtag" | "domain";
  matchValue: string;
}>
```

This allows OntologyRow to render without additional API calls.

### 7.3 Match Value Display-Suppression Logic

```typescript
const shouldShowMatchValue = (
  topicLabel: string,
  topicSlug: string,
  matchValue: string
): boolean => {
  const normalizedLabel = topicLabel.toLowerCase();
  const normalizedValue = matchValue.toLowerCase();
  return normalizedValue !== normalizedLabel
      && normalizedValue !== topicSlug;
};
```

### 7.4 Expert Tier Resolution

```typescript
type ExpertTier = "energy-focused" | "general-outlet" | "independent";

const resolveExpertTier = (
  handle: string,
  authorTiers: { energyFocused: string[]; generalOutlets: string[] }
): ExpertTier => {
  if (authorTiers.energyFocused.includes(handle)) return "energy-focused";
  if (authorTiers.generalOutlets.includes(handle)) return "general-outlet";
  return "independent";
};
```

### 7.5 Ontology Data from Snapshot (v0.3.0)

| Metric | Value |
|---|---|
| Canonical topics | 31 |
| SKOS concepts | 92 |
| Total terms across all topics | ~280 |
| Total curated hashtags | ~85 |
| Total curated domains | ~34 |
| Energy-focused authors | 100 |
| General-outlet authors | 17 |
| Ontology version | `0.3.0` |
| Snapshot version | `0.3.0-1f1f1b1426bb` |
