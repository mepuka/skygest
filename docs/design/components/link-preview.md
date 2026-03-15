# Link Preview & Publication Enrichment Component Specification

**Date:** 2026-03-15
**Status:** Draft
**Scope:** LinkPreview, PublicationBadge, TimeLink components for the Skygest Energy frontend

---

## Design Tokens Reference

| Token | Value | Usage |
|---|---|---|
| Brand font | Instrument Serif 400 | Headlines, publication names in hero contexts |
| Body font | Newsreader 400 16px/1.55 | Post body text, link preview titles |
| UI chrome font | Inter | Timestamps, domain labels, metadata |
| Accent | `#C45D2C` | Energy-focused dot, interactive highlights |
| Background (paper) | `#FAFAF8` | Page background |
| Background (surface) | `#FFFFFF` | Card surfaces |
| Border (subtle) | `#EEEEE9` | Link preview card border |
| Border (standard) | `#E8E8E4` | Hover state border |
| Body text | `#2A2A26` | Primary text color |
| Mid text | `#6B6B63` | Domain labels, descriptions |
| Ghost text | `#B0B0A6` | Truncated description tails |
| Whisper | `#C4C4BB` | Timestamps |

---

## 1. LinkPreview Component

The LinkPreview is a compact card for external links embedded within Bluesky posts. It appears below the post body text, within the 32px left indent that aligns body text past the avatar column.

### Data Source

The API returns links as part of `KnowledgeLinkResult`:

```typescript
{
  postUri: AtUri,        // "at://did:plc:abc123/app.bsky.feed.post/3ldef456"
  url: string,           // "https://utilitydive.com/news/ferc-order-2222/..."
  domain: string | null, // "utilitydive.com"
  title: string | null,  // "FERC Order 2222 implementation..."
  description: string | null,
  imageUrl: HttpsUrl | null, // CDN thumbnail via Bluesky blob ref
  createdAt: number      // epoch ms
}
```

The `imageUrl` field is constructed from the Bluesky embed's blob reference via `BskyCdn.feedThumbnailUrl()`, producing URLs like:
`https://cdn.bsky.app/img/feed_thumbnail/plain/did:plc:abc123/bafkrei...@jpeg`

### Layout Rules

- **Horizontal position:** Left edge aligns with post body text (32px from the left edge of the PostCard content area, past the avatar column).
- **Right edge:** Flush with the PostCard right content boundary.
- **Vertical position:** 8px below the last line of post body text.
- **Bottom spacing:** 8px below the LinkPreview to the next element (timestamp row or post divider).

### 1a. Variant: With Thumbnail

Used when `imageUrl` is non-null.

```
+---------------------------------------------------------------+
|  [Publication dot] Domain Label              +----------+     |
|  Title text goes here and may wrap           | thumb    |     |
|  to a second line maximum                    | 80x60    |     |
|  Description text in mid gray, up to         +----------+     |
|  two lines with ellipsis overflow...                          |
+---------------------------------------------------------------+
```

#### HTML Structure

```html
<a href="https://utilitydive.com/news/ferc-order-2222/..."
   target="_blank"
   rel="noopener noreferrer"
   class="link-preview"
   title="utilitydive.com">
  <div class="link-preview__body">
    <div class="link-preview__domain">
      <span class="publication-dot publication-dot--energy"></span>
      <span class="link-preview__domain-label">Utility Dive</span>
    </div>
    <div class="link-preview__title">
      FERC Order 2222 implementation faces new delays as utilities push back on DER aggregation timelines
    </div>
    <div class="link-preview__description">
      Federal regulators are grappling with utility resistance to distributed energy resource participation in wholesale markets, with several RTOs requesting extended compliance deadlines.
    </div>
  </div>
  <img class="link-preview__thumb"
       src="https://cdn.bsky.app/img/feed_thumbnail/plain/did:plc:abc123/bafkrei...@jpeg"
       alt=""
       loading="lazy" />
</a>
```

#### CSS

```css
.link-preview {
  display: flex;
  flex-direction: row;
  align-items: flex-start;
  gap: 12px;
  padding: 10px 12px;
  border: 1px solid #EEEEE9;
  border-radius: 8px;
  background: #FFFFFF;
  text-decoration: none;
  color: inherit;
  cursor: pointer;
  transition: border-color 0.15s ease;
}

.link-preview:hover {
  border-color: #E8E8E4;
}

.link-preview__body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.link-preview__domain {
  display: flex;
  align-items: center;
  gap: 5px;
  font-family: 'Inter', sans-serif;
  font-size: 12px;
  font-weight: 400;
  line-height: 1.33;
  color: #6B6B63;
  letter-spacing: 0.01em;
}

.link-preview__domain-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.link-preview__title {
  font-family: 'Newsreader', serif;
  font-size: 14px;
  font-weight: 500;
  line-height: 1.4;
  color: #2A2A26;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.link-preview__description {
  font-family: 'Inter', sans-serif;
  font-size: 12px;
  font-weight: 400;
  line-height: 1.5;
  color: #6B6B63;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.link-preview__thumb {
  flex-shrink: 0;
  width: 80px;
  height: 60px;
  border-radius: 4px;
  object-fit: cover;
  background-color: #EEEEE9;
}
```

#### Inline Style Equivalent (Paper)

For the outer `<a>` container:
```
display: flex; flex-direction: row; align-items: flex-start; gap: 12px;
padding: 10px 12px; border: 1px solid #EEEEE9; border-radius: 8px;
background: #FFFFFF; text-decoration: none; color: inherit; cursor: pointer;
```

For the domain line:
```
font-family: Inter; font-size: 12px; font-weight: 400; line-height: 1.33;
color: #6B6B63; letter-spacing: 0.01em; display: flex; align-items: center; gap: 5px;
```

For the title:
```
font-family: Newsreader; font-size: 14px; font-weight: 500; line-height: 1.4;
color: #2A2A26;
```

For the description:
```
font-family: Inter; font-size: 12px; font-weight: 400; line-height: 1.5;
color: #6B6B63;
```

For the thumbnail:
```
width: 80px; height: 60px; border-radius: 4px; object-fit: cover;
background-color: #EEEEE9; flex-shrink: 0;
```

### 1b. Variant: Without Thumbnail

Used when `imageUrl` is null. The layout is identical except the thumbnail is omitted and the body text fills the full width.

```
+---------------------------------------------------------------+
|  [Publication dot] Domain Label                               |
|  Title text goes here and may wrap to a second line           |
|  maximum two lines with ellipsis                              |
|  Description text in mid gray, up to two lines with           |
|  ellipsis overflow...                                         |
+---------------------------------------------------------------+
```

#### HTML Structure

```html
<a href="https://heatmap.news/technology/ai-data-center-energy-demand"
   target="_blank"
   rel="noopener noreferrer"
   class="link-preview"
   title="heatmap.news">
  <div class="link-preview__body">
    <div class="link-preview__domain">
      <span class="publication-dot publication-dot--energy"></span>
      <span class="link-preview__domain-label">Heatmap News</span>
    </div>
    <div class="link-preview__title">
      AI data center energy demand projections keep climbing, but the grid buildout hasn't caught up
    </div>
    <div class="link-preview__description">
      New projections from Lawrence Berkeley suggest data center power demand could reach 12% of US electricity consumption by 2028, far outpacing current interconnection queues.
    </div>
  </div>
</a>
```

The same CSS applies; the body simply expands to fill the full card width when no thumbnail is present, because `flex: 1` handles this naturally.

### 1c. Variant: Publication-Enriched vs. Raw Hostname

The domain line rendering depends on whether the link's domain matches a known publication in the ontology.

**Enriched (known publication):**
- Domain text shows the publication's display label (e.g., "Canary Media") instead of the raw hostname
- A PublicationBadge dot appears before the label
- Hostname is available as the `title` attribute on the card for tooltip on hover

**Raw hostname (unknown/discovered):**
- Domain text shows the raw hostname (e.g., "example.com")
- No dot before the label
- No tooltip needed (the displayed text is already the hostname)

### States

| State | Visual Change |
|---|---|
| Default | Border: `#EEEEE9` |
| Hover | Border: `#E8E8E4` |
| Focus-visible | Standard browser focus ring on the outer `<a>` |
| Thumbnail loading | Gray `#EEEEE9` background rectangle visible until image loads |
| Thumbnail error | Gray rectangle remains (no broken image icon) |

---

## 2. PublicationBadge Component

The PublicationBadge is a small filled dot that indicates the tier of a known publication. It appears inline before the publication name in the LinkPreview domain line, and will also be used for expert tier indicators (parallel with Agent 1's ExpertBadge work).

### Tier Visual Language

| PublicationTier | Dot | Color | Meaning |
|---|---|---|---|
| `energy-focused` | Filled circle, 4px diameter | `#C45D2C` (accent) | Energy-sector specialized publication |
| `general-outlet` | Filled circle, 4px diameter | `#6B6B63` (mid text) | General-interest news outlet covering energy |
| `unknown` | No dot | -- | Unknown or newly discovered domain |

### CSS

```css
.publication-dot {
  display: inline-block;
  width: 4px;
  height: 4px;
  border-radius: 50%;
  flex-shrink: 0;
  position: relative;
  top: 0px;
}

.publication-dot--energy {
  background-color: #C45D2C;
}

.publication-dot--general {
  background-color: #6B6B63;
}
```

#### Inline Style Equivalent (Paper)

Energy-focused dot:
```
display: inline-block; width: 4px; height: 4px; border-radius: 50%;
background-color: #C45D2C; flex-shrink: 0;
```

General-outlet dot:
```
display: inline-block; width: 4px; height: 4px; border-radius: 50%;
background-color: #6B6B63; flex-shrink: 0;
```

### Usage in ExpertBadge (shared visual language)

The same dot system applies to `ExpertTier`:

| ExpertTier | Dot | Color |
|---|---|---|
| `energy-focused` | 4px filled circle | `#C45D2C` |
| `general-outlet` | 4px filled circle | `#6B6B63` |
| `independent` | No dot | -- |

This ensures publications and experts share a single consistent tier indicator vocabulary.

### Rendering Logic

```typescript
function renderPublicationDot(tier: PublicationTier): string | null {
  switch (tier) {
    case "energy-focused":
      return '<span class="publication-dot publication-dot--energy"></span>';
    case "general-outlet":
      return '<span class="publication-dot publication-dot--general"></span>';
    case "unknown":
      return null;
  }
}
```

---

## 3. Domain Display Rules

The LinkPreview domain line must resolve the raw hostname to a publication-enriched display.

### Resolution Order

1. **Check the publications registry** (`GET /api/publications` or client-side cache from the publications seed). Look up the link's `domain` field by hostname.
2. **If found with `source: "seed"`**: show the publication's display label + tier dot.
3. **If found with `source: "discovered"` and `tier: "unknown"`**: show raw hostname, no dot.
4. **If not found**: show raw hostname, no dot.

### Publication Label Map

The current seed data (`config/ontology/publications-seed.json`) stores only hostnames, not display labels. The frontend needs a static label map that maps known hostnames to human-readable names. This map should be maintained as a client-side constant derived from the seed data.

Recommended label map (complete for current seed):

```typescript
const PUBLICATION_LABELS: Record<string, string> = {
  "apnews.com": "AP News",
  "arstechnica.com": "Ars Technica",
  "axios.com": "Axios",
  "bloomberg.com": "Bloomberg",
  "bnef.com": "BloombergNEF",
  "canary.media": "Canary Media",
  "canarymedia.com": "Canary Media",
  "carbonbrief.org": "Carbon Brief",
  "cleantechnica.com": "CleanTechnica",
  "cnbc.com": "CNBC",
  "economist.com": "The Economist",
  "eenews.net": "E&E News",
  "eia.gov": "U.S. EIA",
  "electrek.co": "Electrek",
  "energy.gov": "U.S. DOE",
  "energyintel.com": "Energy Intelligence",
  "energymonitor.ai": "Energy Monitor",
  "energyvoice.com": "Energy Voice",
  "ferc.gov": "FERC",
  "financialtimes.com": "Financial Times",
  "greentechmedia.com": "Greentech Media",
  "grist.org": "Grist",
  "heatmap.news": "Heatmap News",
  "iea.org": "IEA",
  "insideclimatenews.org": "Inside Climate News",
  "insideevs.com": "InsideEVs",
  "irena.org": "IRENA",
  "latimes.com": "Los Angeles Times",
  "latitudemedia.com": "Latitude Media",
  "npr.org": "NPR",
  "nrel.gov": "NREL",
  "nytimes.com": "The New York Times",
  "oilprice.com": "OilPrice",
  "platts.com": "S&P Global Platts",
  "politico.com": "Politico",
  "powermag.com": "POWER Magazine",
  "pv-magazine.com": "PV Magazine",
  "rechargenews.com": "Recharge News",
  "renewableenergyworld.com": "Renewable Energy World",
  "reuters.com": "Reuters",
  "rtoinsider.com": "RTO Insider",
  "thedriven.io": "The Driven",
  "theguardian.com": "The Guardian",
  "thehill.com": "The Hill",
  "utilitydive.com": "Utility Dive",
  "volts.wtf": "Volts",
  "vox.com": "Vox",
  "washingtonpost.com": "The Washington Post",
  "windpowermonthly.com": "Windpower Monthly",
  "wired.com": "Wired",
  "woodmac.com": "Wood Mackenzie",
};
```

### Subdomain Handling

The `domain` field from the API is already a bare hostname (extracted by `PostRecord.hostnameFor()` via `new URL(value).hostname`). Some publications use `www.` subdomains; the API strips this during extraction. If a hostname has a `www.` prefix, strip it before lookup.

```typescript
function resolvePublicationDisplay(
  hostname: string | null,
  publications: Map<string, { tier: PublicationTier }>
): { label: string; tier: PublicationTier | null } {
  if (!hostname) {
    return { label: "Link", tier: null };
  }

  const normalized = hostname.replace(/^www\./, "");
  const pub = publications.get(normalized);

  if (pub && pub.tier !== "unknown") {
    const label = PUBLICATION_LABELS[normalized] ?? normalized;
    return { label, tier: pub.tier };
  }

  return { label: normalized, tier: null };
}
```

### Real Data Examples

Based on the current staging data and seed publications:

| Domain from API | Resolved Label | Tier | Dot |
|---|---|---|---|
| `utilitydive.com` | Utility Dive | `energy-focused` | `#C45D2C` |
| `reuters.com` | Reuters | `general-outlet` | `#6B6B63` |
| `heatmap.news` | Heatmap News | `energy-focused` | `#C45D2C` |
| `canarymedia.com` | Canary Media | `energy-focused` | `#C45D2C` |
| `nytimes.com` | The New York Times | `general-outlet` | `#6B6B63` |
| `carbonbrief.org` | Carbon Brief | `energy-focused` | `#C45D2C` |
| `substack.com` | substack.com | -- | none |
| `x.com` | x.com | -- | none |
| `docs.google.com` | docs.google.com | -- | none |

---

## 4. TimeLink Component

The TimeLink is a relative timestamp that links to the original Bluesky post. It converts the AT Protocol URI to a Bluesky web URL.

### AT URI to Bluesky Web URL Conversion

AT URIs follow the format:
```
at://did:plc:abc123/app.bsky.feed.post/3ldef456
```

The Bluesky web URL format is:
```
https://bsky.app/profile/{handle}/post/{rkey}
```

Where:
- `handle` is the user's Bluesky handle (from `KnowledgePostResult.handle`)
- `rkey` is the last path segment of the AT URI

If `handle` is null, fall back to the DID:
```
https://bsky.app/profile/{did}/post/{rkey}
```

### Conversion Logic

```typescript
function atUriToBskyUrl(uri: string, handle: string | null): string {
  // AT URI format: at://did:plc:xyz/app.bsky.feed.post/rkey
  const parts = uri.split("/");
  const rkey = parts[parts.length - 1];
  const identifier = handle ?? parts[2]; // parts[2] is the DID
  return `https://bsky.app/profile/${identifier}/post/${rkey}`;
}
```

### Relative Time Display

Format `createdAt` (epoch milliseconds) as a compact relative time string:

| Elapsed | Display |
|---|---|
| < 60 seconds | "just now" |
| < 60 minutes | "3m" |
| < 24 hours | "2h" |
| < 7 days | "3d" |
| < 30 days | "2w" |
| < 365 days | "Mar 8" (month + day) |
| >= 365 days | "Mar 2025" (month + year) |

### HTML Structure

```html
<a href="https://bsky.app/profile/david-energy.bsky.social/post/3ldef456"
   target="_blank"
   rel="noopener noreferrer"
   class="time-link"
   title="2026-03-14T18:42:00.000Z">
  3h
</a>
```

### CSS

```css
.time-link {
  font-family: 'Inter', sans-serif;
  font-size: 12px;
  font-weight: 400;
  line-height: 1.33;
  color: #C4C4BB;
  text-decoration: none;
  cursor: pointer;
  transition: color 0.15s ease;
}

.time-link:hover {
  color: #B0B0A6;
  text-decoration: underline;
  text-decoration-color: #C4C4BB;
  text-underline-offset: 2px;
}
```

#### Inline Style Equivalent (Paper)

Default:
```
font-family: Inter; font-size: 12px; font-weight: 400; line-height: 1.33;
color: #C4C4BB; text-decoration: none; cursor: pointer;
```

Hover:
```
color: #B0B0A6; text-decoration: underline; text-decoration-color: #C4C4BB;
text-underline-offset: 2px;
```

### States

| State | Visual |
|---|---|
| Default | `#C4C4BB` Inter 12px, no underline |
| Hover | `#B0B0A6` text color, subtle underline in `#C4C4BB` |
| Focus-visible | Standard browser focus ring |
| Tooltip | Full ISO datetime string shown via `title` attribute |

### Placement in PostCard

The TimeLink appears in the metadata row below the post body (and below the LinkPreview if present):

```
+-- PostCard -----------------------------------------------+
|  [Avatar]  Handle + Display Name                          |
|            Post body text goes here...                    |
|                                                           |
|            +-- LinkPreview ---------------------------+   |
|            | [dot] Utility Dive         [thumb]       |   |
|            | FERC Order 2222 faces...   [80x60]       |   |
|            | Federal regulators are...                |   |
|            +------------------------------------------+   |
|                                                           |
|            3h  ·  solar  ·  energy-policy                 |
+-----------------------------------------------------------+
```

The `3h` is the TimeLink. It sits in the same row as topic tags, separated by a `·` (middle dot) delimiter.

---

## 5. PostCard Integration: Spacing and Alignment

This section documents how LinkPreview and TimeLink integrate into the PostCard layout.

### PostCard Content Grid

```
|-- 40px --|-- flex ----------------------------------------|
|  Avatar  |  Header row (handle, display name)             |
|  40x40   |  Body text (Newsreader 16px/1.55)              |
|          |  [8px gap]                                      |
|          |  LinkPreview (if post has external embed)        |
|          |  [8px gap]                                      |
|          |  Metadata row (TimeLink · topics)               |
|-- 40px --|-- flex ----------------------------------------|
```

- Avatar column: 40px wide, with 12px gap to the body column (total left indent: 52px from PostCard edge, but content starts at the body column).
- The 32px indent referenced in the task description is the distance from the PostCard's left padding to where body text begins (accounting for avatar + gap). The LinkPreview left edge aligns with body text, not with the avatar.

### Spacing Rules

| Between | Gap |
|---|---|
| Post body text bottom to LinkPreview top | 8px |
| LinkPreview bottom to metadata row top | 8px |
| Post body text bottom to metadata row (no LinkPreview) | 8px |
| PostCard bottom padding | 16px |
| PostCard top padding | 16px |
| PostCard left padding | 16px |
| PostCard right padding | 16px |
| Between PostCards (divider) | 1px border `#EEEEE9` (no gap, cards stack with border between) |

### Metadata Row

```css
.post-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  font-family: 'Inter', sans-serif;
  font-size: 12px;
  line-height: 1.33;
  color: #B0B0A6;
}

.post-meta__separator {
  color: #C4C4BB;
  user-select: none;
}

.post-meta__topic {
  color: #B0B0A6;
  text-decoration: none;
}

.post-meta__topic:hover {
  color: #6B6B63;
}
```

---

## 6. Complete Rendered Example

### Example 1: Energy-focused publication with thumbnail

Post by `@energy-reporter.bsky.social`:
> "FERC's latest order on distributed energy aggregation is facing significant pushback. Several RTOs are requesting extended timelines."

```html
<div class="post-card">
  <div class="post-card__avatar">
    <img src="https://cdn.bsky.app/img/avatar/plain/did:plc:abc123/bafkrei...@jpeg"
         alt="" width="40" height="40" />
  </div>
  <div class="post-card__content">
    <div class="post-card__header">
      <span class="post-card__display-name">Energy Reporter</span>
      <span class="post-card__handle">@energy-reporter.bsky.social</span>
    </div>
    <div class="post-card__body">
      FERC's latest order on distributed energy aggregation is facing
      significant pushback. Several RTOs are requesting extended timelines.
    </div>
    <a href="https://utilitydive.com/news/ferc-order-2222-der-aggregation/"
       target="_blank" rel="noopener noreferrer"
       class="link-preview" title="utilitydive.com">
      <div class="link-preview__body">
        <div class="link-preview__domain">
          <span class="publication-dot publication-dot--energy"></span>
          <span class="link-preview__domain-label">Utility Dive</span>
        </div>
        <div class="link-preview__title">
          FERC Order 2222 implementation faces new delays as utilities push back
        </div>
        <div class="link-preview__description">
          Federal regulators are grappling with utility resistance to distributed
          energy resource participation in wholesale markets.
        </div>
      </div>
      <img class="link-preview__thumb"
           src="https://cdn.bsky.app/img/feed_thumbnail/plain/did:plc:abc123/bafkrei...@jpeg"
           alt="" loading="lazy" />
    </a>
    <div class="post-meta">
      <a href="https://bsky.app/profile/energy-reporter.bsky.social/post/3ldef456"
         target="_blank" rel="noopener noreferrer"
         class="time-link" title="2026-03-14T18:42:00.000Z">3h</a>
      <span class="post-meta__separator">&middot;</span>
      <a href="/topics/grid-and-infrastructure" class="post-meta__topic">grid &amp; infrastructure</a>
      <span class="post-meta__separator">&middot;</span>
      <a href="/topics/energy-policy" class="post-meta__topic">energy policy</a>
    </div>
  </div>
</div>
```

### Example 2: General-outlet publication, no thumbnail

Post by `@climate-desk.bsky.social`:
> "New reporting on the political dynamics around the Inflation Reduction Act's energy provisions."

```html
<a href="https://nytimes.com/2026/03/14/climate/ira-energy-politics.html"
   target="_blank" rel="noopener noreferrer"
   class="link-preview" title="nytimes.com">
  <div class="link-preview__body">
    <div class="link-preview__domain">
      <span class="publication-dot publication-dot--general"></span>
      <span class="link-preview__domain-label">The New York Times</span>
    </div>
    <div class="link-preview__title">
      IRA Energy Spending Becomes New Political Flashpoint in 2026 Budget Talks
    </div>
    <div class="link-preview__description">
      Congressional negotiators are debating whether to extend clean energy tax
      credits as part of a broader spending package.
    </div>
  </div>
</a>
```

### Example 3: Unknown domain, no thumbnail, no enrichment

```html
<a href="https://someresearcher.substack.com/p/grid-scale-battery-analysis"
   target="_blank" rel="noopener noreferrer"
   class="link-preview" title="someresearcher.substack.com">
  <div class="link-preview__body">
    <div class="link-preview__domain">
      <span class="link-preview__domain-label">someresearcher.substack.com</span>
    </div>
    <div class="link-preview__title">
      Grid-Scale Battery Economics: A Deep Dive into 2026 Project Finance
    </div>
    <div class="link-preview__description">
      Analysis of the latest utility-scale battery storage project finance
      trends and levelized cost projections.
    </div>
  </div>
</a>
```

Note: no `publication-dot` element is rendered for unknown domains.

---

## 7. Edge Cases

### Missing Data

| Missing Field | Behavior |
|---|---|
| `title` is null | Show the URL path as the title (e.g., `/news/ferc-order-2222/`) truncated to 60 chars |
| `description` is null | Hide the description line entirely; card is shorter |
| `domain` is null | Show "Link" as the domain label, no dot |
| `imageUrl` is null | Use the no-thumbnail variant |
| `handle` is null | TimeLink URL uses DID instead of handle: `bsky.app/profile/did:plc:abc123/post/rkey` |
| Both `title` and `description` null | Show only the domain line and a truncated URL as the title |

### Thumbnail Loading

- The `<img>` tag uses `loading="lazy"` to defer loading for off-screen previews.
- The background color `#EEEEE9` shows during load, matching the subtle border color.
- On image error, the `<img>` element should be hidden via `onerror="this.style.display='none'"` or equivalent, causing the body to expand to fill the card width.

### Long Hostnames

Hostnames like `someresearcher.substack.com` may be long. The domain label uses `text-overflow: ellipsis` and `white-space: nowrap` with `overflow: hidden` to truncate gracefully. The full hostname is always available via the card's `title` attribute.

---

## 8. Relationship to Backend Data

### Current API Endpoints

| Endpoint | Returns | Link Data |
|---|---|---|
| `GET /api/posts/recent` | `KnowledgePostResult[]` | Posts with `uri`, `handle` for TimeLink construction |
| `GET /api/links` | `KnowledgeLinkResult[]` | Link cards with `url`, `domain`, `title`, `description`, `imageUrl` |
| `GET /api/publications` | `PublicationListItem[]` | Publication registry with `hostname`, `tier`, `source` |

### Data Flow for LinkPreview Rendering

1. Fetch posts from `/api/posts/recent`.
2. Fetch the publication registry from `/api/publications` (cache client-side; changes infrequently).
3. For each post, if the post has links (indicated by the link data joined to the post or fetched separately), render a LinkPreview.
4. Resolve the link's `domain` against the publication registry and the `PUBLICATION_LABELS` map.
5. Render the appropriate variant (with/without thumbnail, with/without publication enrichment).

### Future: Inline Links on Posts

The current `KnowledgePostResult` does not embed link data inline. The links endpoint returns links with `postUri` as a foreign key. For the frontend, there are two approaches:

1. **Separate fetch:** After loading posts, batch-fetch links by post URIs.
2. **API enhancement:** Add an `embed` or `links` field to `KnowledgePostResult` that inlines the primary external embed link. This is the recommended path since the Bluesky post record already distinguishes the primary external embed from inline facet URLs.

---

## 9. Accessibility

- The entire LinkPreview card is a single `<a>` element, making it a single tab stop.
- The thumbnail has `alt=""` (decorative) since the title provides the meaningful text.
- The TimeLink has a `title` attribute with the full ISO date for screen readers and tooltip.
- Color is never the sole indicator of meaning: the tier dot is supplementary to the publication label text.
- All interactive elements have visible focus states via `:focus-visible`.
