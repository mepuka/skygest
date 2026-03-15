# Post Card Component Specification

**Date:** 2026-03-15
**Status:** Final (Sprint 1)
**Scope:** PostCard -- the primary content unit in feed, search, and topic views

---

## 1. Design Token Reference

| Token | Value | Usage |
|---|---|---|
| Body font | Newsreader 400, 16px/25px | Post body text |
| UI chrome font | Inter | All metadata, labels, attribution |
| Accent | `#C45D2C` | Expert tier dots, link domains |
| Background (surface) | `#FFFFFF` | Card background |
| Background (recessed) | `#FAFAF8` | Link preview card background |
| Border (subtle) | `#EEEEE9` | Card divider, link preview border |
| Text primary | `#2A2A26` | Body text |
| Text heading | `#1A1A1A` | Expert names, link titles |
| Text secondary | `#6B6B63` | Mid-weight metadata |
| Text ghost | `#B0B0A6` | Hashtags |
| Text mid | `#9A9A90` | Ontology breadcrumbs |
| Text whisper | `#C4C4BB` | Timestamps, separators |

---

## 2. Post Card Anatomy

The PostCard is a vertical stack of elements. Top to bottom:

```
+-- PostCard -----------------------------------------------+
| [10px top padding]                                        |
|                                                           |
| 1. Attribution Row                                        |
|    (avatar) (7px) Expert Name (7px) Time (6px) Tier Dot   |
|                                                           |
| [6px gap]                                                 |
|                                                           |
| 2. Body Text                                              |
|    Full-width Newsreader 16px/25px                         |
|                                                           |
| [6px gap]                                                 |
|                                                           |
| 3. Hashtags (optional)                                    |
|    Inter 11px/400 #B0B0A6, space-separated                |
|                                                           |
| [6px gap]                                                 |
|                                                           |
| 4. Link Preview (optional)                                |
|    Recessed card with domain + title + optional thumb      |
|                                                           |
| [6px gap]                                                 |
|                                                           |
| 5. Ontology Breadcrumb                                    |
|    Inter 10px/400 #9A9A90, "/" separator in #C4C4BB       |
|                                                           |
| [14px bottom padding]                                     |
|                                                           |
| 6. Divider: 1px #EEEEE9 bottom border                    |
+-----------------------------------------------------------+
```

### 2.1 Element Order

| # | Element | Required | Condition |
|---|---|---|---|
| 1 | Attribution Row | Yes | Always present |
| 2 | Body Text | Yes | Always present |
| 3 | Hashtags | No | Present when post has extracted hashtags |
| 4 | Link Preview | No | Present when post has an external embed link |
| 5 | Ontology Breadcrumb | Yes | Always present (at least one topic match) |
| 6 | Divider | Yes | 1px bottom border separating stacked cards |

### 2.2 Spacing Rules

| Property | Value |
|---|---|
| Top padding | 10px |
| Bottom padding | 14px |
| Gap between internal elements | 6px |
| Avatar-to-name gap | 7px |
| Name-to-time gap | 7px |
| Divider | 1px `#EEEEE9` bottom border |

---

## 3. Attribution Row

The expert's identity and post time, all on one line.

### 3.1 Structure

```
(avatar 22px) (7px) Expert Name (7px) Time (6px) [Tier Dot]
```

- **Avatar:** 22px circle, inline with text baseline. Uses the expert's Bluesky avatar URL from `KnowledgePostResult.avatar`. Falls back to a neutral `#EEEEE9` circle when null.
- **Expert Name:** Inter 13px/600, `#1A1A1A`, `letter-spacing: -0.01em`
- **Time:** Inter 11px/400, `#C4C4BB`. Relative format (see link-preview.md TimeLink spec).
- **Tier Dot:** 4x4px filled circle. `#C45D2C` for energy-focused, `#6B6B63` for general-outlet, absent for independent. See ontology-row.md section 6.

### 3.2 HTML

**Example:** Post by Canary Media (energy-focused expert), posted 3 hours ago.

```html
<div style="
  display: flex;
  align-items: center;
  gap: 7px;
">
  <img src="https://cdn.bsky.app/img/avatar/plain/did:plc:mec75muei3zce23djcw2afqa/bafkrei...@jpeg"
       alt=""
       width="22" height="22"
       style="
         border-radius: 50%;
         object-fit: cover;
         flex-shrink: 0;
         background: #EEEEE9;
       " />
  <span style="
    font-family: Inter, system-ui, sans-serif;
    font-size: 13px;
    font-weight: 600;
    color: #1A1A1A;
    letter-spacing: -0.01em;
    white-space: nowrap;
  ">Canary Media</span>
  <span style="
    font-family: Inter, system-ui, sans-serif;
    font-size: 11px;
    font-weight: 400;
    color: #C4C4BB;
    white-space: nowrap;
  ">3h</span>
  <span style="
    display: inline-block;
    width: 4px;
    height: 4px;
    border-radius: 50%;
    background: #C45D2C;
    flex-shrink: 0;
  " title="Energy-focused source"></span>
</div>
```

### 3.3 Avatar Fallback

When `avatar` is null:

```html
<div style="
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: #EEEEE9;
  flex-shrink: 0;
"></div>
```

---

## 4. Body Text

The post's full text content.

### 4.1 Styling

```html
<p style="
  font-family: Newsreader, Georgia, serif;
  font-size: 16px;
  font-weight: 400;
  line-height: 25px;
  color: #2A2A26;
  margin: 0;
">Utility-scale solar photovoltaic battery storage is easing power grid pressure.</p>
```

- Font: Newsreader 400, 16px/25px (line-height: 25px = ~1.5625)
- Color: `#2A2A26` (primary text)
- Full width, no truncation in the default feed view
- No margin; spacing is handled by the parent flex gap

---

## 5. Hashtags

See `docs/design/components/hashtag-display.md` for the full specification.

### 5.1 Summary

- Style: Inter 11px/400, `#B0B0A6` (Ghost)
- Format: `#solar #storage` -- space-separated, `#` prefix on each
- Position: below body text, above link preview
- Not clickable in v1

### 5.2 HTML

```html
<div style="
  font-family: Inter, system-ui, sans-serif;
  font-size: 11px;
  font-weight: 400;
  line-height: 1.4;
  color: #B0B0A6;
">#solar #storage</div>
```

---

## 6. Link Preview

The recessed card for external links embedded in the post. See `docs/design/components/link-preview.md` for the full specification.

### 6.1 Summary for PostCard Context

Within the PostCard, the link preview uses the **recessed card** treatment:

| Property | Value |
|---|---|
| Background | `#FAFAF8` |
| Border | `1px solid #EEEEE9` |
| Border radius | `3px` |
| Padding | `8px 10px` |
| Domain | Inter 11px/500 `#C45D2C` |
| Title | Inter 12px/500 `#1A1A1A` |
| Thumbnail | 80x60px, right-aligned, `border-radius: 3px` |

### 6.2 HTML: Link Preview Without Thumbnail

**Example data:** Post about offshore wind links to `grid.example.com`. From smoke fixture.

```html
<a href="https://grid.example.com/offshore-wind"
   target="_blank"
   rel="noopener noreferrer"
   style="
     display: block;
     padding: 8px 10px;
     background: #FAFAF8;
     border: 1px solid #EEEEE9;
     border-radius: 3px;
     text-decoration: none;
     color: inherit;
     cursor: pointer;
     transition: border-color 0.15s ease;
   ">
  <div style="
    font-family: Inter, system-ui, sans-serif;
    font-size: 11px;
    font-weight: 500;
    color: #C45D2C;
    margin-bottom: 2px;
  ">grid.example.com</div>
  <div style="
    font-family: Inter, system-ui, sans-serif;
    font-size: 12px;
    font-weight: 500;
    line-height: 1.4;
    color: #1A1A1A;
  ">Wind transmission backlog</div>
</a>
```

### 6.3 HTML: Link Preview With Thumbnail

**Example data:** Post about solar storage links to `example.com/solar-storage`. From smoke fixture (has thumbnail blob ref).

```html
<a href="https://example.com/solar-storage"
   target="_blank"
   rel="noopener noreferrer"
   style="
     display: flex;
     flex-direction: row;
     align-items: flex-start;
     gap: 10px;
     padding: 8px 10px;
     background: #FAFAF8;
     border: 1px solid #EEEEE9;
     border-radius: 3px;
     text-decoration: none;
     color: inherit;
     cursor: pointer;
     transition: border-color 0.15s ease;
   ">
  <div style="flex: 1; min-width: 0;">
    <div style="
      font-family: Inter, system-ui, sans-serif;
      font-size: 11px;
      font-weight: 500;
      color: #C45D2C;
      margin-bottom: 2px;
    ">example.com</div>
    <div style="
      font-family: Inter, system-ui, sans-serif;
      font-size: 12px;
      font-weight: 500;
      line-height: 1.4;
      color: #1A1A1A;
    ">Solar storage buildout</div>
  </div>
  <img src="https://cdn.bsky.app/img/feed_thumbnail/plain/did:plc:bvwqyqjl4vxaswxbqymiofzv/bafkrei-smoke-solar-thumb@jpeg"
       alt=""
       loading="lazy"
       style="
         flex-shrink: 0;
         width: 80px;
         height: 60px;
         border-radius: 3px;
         object-fit: cover;
         background: #EEEEE9;
       " />
</a>
```

### 6.4 Hover State

On hover, border transitions to `#E8E8E4`.

---

## 7. Ontology Breadcrumb

The topic annotation, rendered as plain text. See `docs/design/components/ontology-row.md` section 3 for the full specification.

### 7.1 Summary for PostCard Context

- Style: Inter 10px/400, `#9A9A90` (Mid) for labels and values, `#C4C4BB` for `/` separators
- Position: below everything else (body, hashtags, link preview), above the divider
- Left-aligned, flush with body text

### 7.2 HTML

**Example:** Single topic, term match.

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
  ">photovoltaic</span>
</div>
```

---

## 8. Variants

### 8.1 Variant 1: Text-Only (Simplest)

No hashtags, no link preview. The most minimal post card.

**Example data:** From smoke fixture -- "Offshore wind developers still need more transmission capacity." (post-wind has no hashtags, but does have a link; for this variant illustration, imagine a text-only post)

```html
<article style="
  padding: 10px 0 14px 0;
  border-bottom: 1px solid #EEEEE9;
  display: flex;
  flex-direction: column;
  gap: 6px;
">
  <!-- Attribution Row -->
  <div style="display: flex; align-items: center; gap: 7px;">
    <div style="
      width: 22px; height: 22px;
      border-radius: 50%; background: #EEEEE9;
      flex-shrink: 0;
    "></div>
    <span style="
      font-family: Inter, system-ui, sans-serif;
      font-size: 13px; font-weight: 600;
      color: #1A1A1A; letter-spacing: -0.01em;
    ">Grist</span>
    <span style="
      font-family: Inter, system-ui, sans-serif;
      font-size: 11px; font-weight: 400; color: #C4C4BB;
    ">2h</span>
    <span style="
      display: inline-block; width: 4px; height: 4px;
      border-radius: 50%; background: #C45D2C; flex-shrink: 0;
    " title="Energy-focused source"></span>
  </div>

  <!-- Body Text -->
  <p style="
    font-family: Newsreader, Georgia, serif;
    font-size: 16px; font-weight: 400;
    line-height: 25px; color: #2A2A26; margin: 0;
  ">Offshore wind developers still need more transmission capacity.</p>

  <!-- Ontology Breadcrumb -->
  <div style="display: flex; flex-wrap: wrap; align-items: center; gap: 3px;">
    <span style="font-family: Inter, system-ui, sans-serif; font-size: 10px; font-weight: 400; color: #9A9A90;">Grid and Infrastructure</span>
    <span style="font-family: Inter, system-ui, sans-serif; font-size: 10px; font-weight: 400; color: #C4C4BB;">/</span>
    <span style="font-family: Inter, system-ui, sans-serif; font-size: 10px; font-weight: 400; color: #9A9A90;">transmission</span>
  </div>
</article>
```

### 8.2 Variant 2: With Hashtags

Post has extracted hashtags but no link preview.

**Example data:** From smoke fixture -- "Utility-scale solar photovoltaic battery storage is easing power grid pressure." Tags: `solar`, `storage`.

```html
<article style="
  padding: 10px 0 14px 0;
  border-bottom: 1px solid #EEEEE9;
  display: flex;
  flex-direction: column;
  gap: 6px;
">
  <!-- Attribution Row -->
  <div style="display: flex; align-items: center; gap: 7px;">
    <div style="
      width: 22px; height: 22px;
      border-radius: 50%; background: #EEEEE9;
      flex-shrink: 0;
    "></div>
    <span style="
      font-family: Inter, system-ui, sans-serif;
      font-size: 13px; font-weight: 600;
      color: #1A1A1A; letter-spacing: -0.01em;
    ">Skygest Seed Primary</span>
    <span style="
      font-family: Inter, system-ui, sans-serif;
      font-size: 11px; font-weight: 400; color: #C4C4BB;
    ">5h</span>
  </div>

  <!-- Body Text -->
  <p style="
    font-family: Newsreader, Georgia, serif;
    font-size: 16px; font-weight: 400;
    line-height: 25px; color: #2A2A26; margin: 0;
  ">Utility-scale solar photovoltaic battery storage is easing power grid pressure.</p>

  <!-- Hashtags -->
  <div style="
    font-family: Inter, system-ui, sans-serif;
    font-size: 11px; font-weight: 400;
    line-height: 1.4; color: #B0B0A6;
  ">#solar #storage</div>

  <!-- Ontology Breadcrumb -->
  <div style="display: flex; flex-wrap: wrap; align-items: center; gap: 3px;">
    <span style="font-family: Inter, system-ui, sans-serif; font-size: 10px; font-weight: 400; color: #9A9A90;">Solar</span>
    <span style="font-family: Inter, system-ui, sans-serif; font-size: 10px; font-weight: 400; color: #C4C4BB;">/</span>
    <span style="font-family: Inter, system-ui, sans-serif; font-size: 10px; font-weight: 400; color: #9A9A90;">photovoltaic</span>
  </div>
</article>
```

### 8.3 Variant 3: With Link Preview (No Thumbnail)

Post has an external link embed without a thumbnail image.

**Example data:** From smoke fixture -- "Offshore wind developers still need more transmission capacity." Links to `grid.example.com/offshore-wind` with title "Wind transmission backlog". Tags: `wind`.

```html
<article style="
  padding: 10px 0 14px 0;
  border-bottom: 1px solid #EEEEE9;
  display: flex;
  flex-direction: column;
  gap: 6px;
">
  <!-- Attribution Row -->
  <div style="display: flex; align-items: center; gap: 7px;">
    <div style="
      width: 22px; height: 22px;
      border-radius: 50%; background: #EEEEE9;
      flex-shrink: 0;
    "></div>
    <span style="
      font-family: Inter, system-ui, sans-serif;
      font-size: 13px; font-weight: 600;
      color: #1A1A1A; letter-spacing: -0.01em;
    ">Electrek</span>
    <span style="
      font-family: Inter, system-ui, sans-serif;
      font-size: 11px; font-weight: 400; color: #C4C4BB;
    ">4h</span>
    <span style="
      display: inline-block; width: 4px; height: 4px;
      border-radius: 50%; background: #C45D2C; flex-shrink: 0;
    " title="Energy-focused source"></span>
  </div>

  <!-- Body Text -->
  <p style="
    font-family: Newsreader, Georgia, serif;
    font-size: 16px; font-weight: 400;
    line-height: 25px; color: #2A2A26; margin: 0;
  ">Offshore wind developers still need more transmission capacity.</p>

  <!-- Hashtags -->
  <div style="
    font-family: Inter, system-ui, sans-serif;
    font-size: 11px; font-weight: 400;
    line-height: 1.4; color: #B0B0A6;
  ">#wind</div>

  <!-- Link Preview (no thumbnail) -->
  <a href="https://grid.example.com/offshore-wind"
     target="_blank" rel="noopener noreferrer"
     style="
       display: block;
       padding: 8px 10px;
       background: #FAFAF8;
       border: 1px solid #EEEEE9;
       border-radius: 3px;
       text-decoration: none;
       color: inherit;
       cursor: pointer;
       transition: border-color 0.15s ease;
     ">
    <div style="
      font-family: Inter, system-ui, sans-serif;
      font-size: 11px; font-weight: 500;
      color: #C45D2C; margin-bottom: 2px;
    ">grid.example.com</div>
    <div style="
      font-family: Inter, system-ui, sans-serif;
      font-size: 12px; font-weight: 500;
      line-height: 1.4; color: #1A1A1A;
    ">Wind transmission backlog</div>
  </a>

  <!-- Ontology Breadcrumb -->
  <div style="display: flex; flex-wrap: wrap; align-items: center; gap: 3px;">
    <span style="font-family: Inter, system-ui, sans-serif; font-size: 10px; font-weight: 400; color: #9A9A90;">Grid and Infrastructure</span>
    <span style="font-family: Inter, system-ui, sans-serif; font-size: 10px; font-weight: 400; color: #C4C4BB;">/</span>
    <span style="font-family: Inter, system-ui, sans-serif; font-size: 10px; font-weight: 400; color: #9A9A90;">transmission</span>
  </div>
</article>
```

### 8.4 Variant 4: With Link Preview + Thumbnail

Post has an external link embed with a thumbnail image.

**Example data:** From smoke fixture -- "Utility-scale solar photovoltaic battery storage is easing power grid pressure." Links to `example.com/solar-storage` with title "Solar storage buildout", description "Battery storage and transmission upgrades", and a thumbnail blob.

```html
<article style="
  padding: 10px 0 14px 0;
  border-bottom: 1px solid #EEEEE9;
  display: flex;
  flex-direction: column;
  gap: 6px;
">
  <!-- Attribution Row -->
  <div style="display: flex; align-items: center; gap: 7px;">
    <div style="
      width: 22px; height: 22px;
      border-radius: 50%; background: #EEEEE9;
      flex-shrink: 0;
    "></div>
    <span style="
      font-family: Inter, system-ui, sans-serif;
      font-size: 13px; font-weight: 600;
      color: #1A1A1A; letter-spacing: -0.01em;
    ">Canary Media</span>
    <span style="
      font-family: Inter, system-ui, sans-serif;
      font-size: 11px; font-weight: 400; color: #C4C4BB;
    ">3h</span>
    <span style="
      display: inline-block; width: 4px; height: 4px;
      border-radius: 50%; background: #C45D2C; flex-shrink: 0;
    " title="Energy-focused source"></span>
  </div>

  <!-- Body Text -->
  <p style="
    font-family: Newsreader, Georgia, serif;
    font-size: 16px; font-weight: 400;
    line-height: 25px; color: #2A2A26; margin: 0;
  ">Utility-scale solar photovoltaic battery storage is easing power grid pressure.</p>

  <!-- Hashtags -->
  <div style="
    font-family: Inter, system-ui, sans-serif;
    font-size: 11px; font-weight: 400;
    line-height: 1.4; color: #B0B0A6;
  ">#solar #storage</div>

  <!-- Link Preview (with thumbnail) -->
  <a href="https://example.com/solar-storage"
     target="_blank" rel="noopener noreferrer"
     style="
       display: flex; flex-direction: row;
       align-items: flex-start; gap: 10px;
       padding: 8px 10px;
       background: #FAFAF8;
       border: 1px solid #EEEEE9;
       border-radius: 3px;
       text-decoration: none;
       color: inherit; cursor: pointer;
       transition: border-color 0.15s ease;
     ">
    <div style="flex: 1; min-width: 0;">
      <div style="
        font-family: Inter, system-ui, sans-serif;
        font-size: 11px; font-weight: 500;
        color: #C45D2C; margin-bottom: 2px;
      ">example.com</div>
      <div style="
        font-family: Inter, system-ui, sans-serif;
        font-size: 12px; font-weight: 500;
        line-height: 1.4; color: #1A1A1A;
      ">Solar storage buildout</div>
    </div>
    <img src="https://cdn.bsky.app/img/feed_thumbnail/plain/did:plc:bvwqyqjl4vxaswxbqymiofzv/bafkrei-smoke-solar-thumb@jpeg"
         alt="" loading="lazy"
         style="
           flex-shrink: 0; width: 80px; height: 60px;
           border-radius: 3px; object-fit: cover;
           background: #EEEEE9;
         " />
  </a>

  <!-- Ontology Breadcrumb -->
  <div style="display: flex; flex-wrap: wrap; align-items: center; gap: 3px;">
    <span style="font-family: Inter, system-ui, sans-serif; font-size: 10px; font-weight: 400; color: #9A9A90;">Solar</span>
    <span style="font-family: Inter, system-ui, sans-serif; font-size: 10px; font-weight: 400; color: #C4C4BB;">/</span>
    <span style="font-family: Inter, system-ui, sans-serif; font-size: 10px; font-weight: 400; color: #9A9A90;">photovoltaic</span>
    <span style="font-family: Inter, system-ui, sans-serif; font-size: 10px; font-weight: 400; color: #C4C4BB; margin: 0 3px;">/</span>
    <span style="font-family: Inter, system-ui, sans-serif; font-size: 10px; font-weight: 400; color: #9A9A90;">Energy Storage</span>
    <span style="font-family: Inter, system-ui, sans-serif; font-size: 10px; font-weight: 400; color: #C4C4BB;">/</span>
    <span style="font-family: Inter, system-ui, sans-serif; font-size: 10px; font-weight: 400; color: #9A9A90;">battery storage</span>
  </div>
</article>
```

### 8.5 Variant 5: With Hashtags + Link Preview

Combination of hashtags and link preview. The hashtags appear between body text and link preview.

This is demonstrated in Variant 8.3 and 8.4 above, which both include hashtags. The element order is always: attribution -> body -> hashtags -> link preview -> ontology breadcrumb.

### 8.6 Variant 6: Multi-Topic Breadcrumb

Post matched multiple topics. The breadcrumb shows all topics with `/` separators.

**Example data:** Post matched both `solar` (term: "photovoltaic") and `energy-storage` (term: "battery storage").

The ontology breadcrumb portion renders as:

```html
<div style="display: flex; flex-wrap: wrap; align-items: center; gap: 3px;">
  <span style="font-family: Inter, system-ui, sans-serif; font-size: 10px; font-weight: 400; color: #9A9A90;">Solar</span>
  <span style="font-family: Inter, system-ui, sans-serif; font-size: 10px; font-weight: 400; color: #C4C4BB;">/</span>
  <span style="font-family: Inter, system-ui, sans-serif; font-size: 10px; font-weight: 400; color: #9A9A90;">photovoltaic</span>
  <span style="font-family: Inter, system-ui, sans-serif; font-size: 10px; font-weight: 400; color: #C4C4BB; margin: 0 3px;">/</span>
  <span style="font-family: Inter, system-ui, sans-serif; font-size: 10px; font-weight: 400; color: #9A9A90;">Energy Storage</span>
  <span style="font-family: Inter, system-ui, sans-serif; font-size: 10px; font-weight: 400; color: #C4C4BB;">/</span>
  <span style="font-family: Inter, system-ui, sans-serif; font-size: 10px; font-weight: 400; color: #9A9A90;">battery storage</span>
</div>
```

**Visual rendering:** `Solar / photovoltaic  /  Energy Storage / battery storage`

---

## 9. Edge Cases

### 9.1 Missing Data

| Missing Field | Behavior |
|---|---|
| `avatar` is null | Show neutral 22px circle in `#EEEEE9` |
| `handle` is null | Attribution shows display name only; tier dot still appears based on DID lookup |
| Post has no hashtags | Hashtag row omitted; gap collapses |
| Post has no links | Link preview omitted; gap collapses |
| Link `title` is null | Show truncated URL path as title |
| Link `imageUrl` is null | Use no-thumbnail variant |
| No topic matches | Should not occur (all indexed posts have at least one topic); if it does, omit the ontology breadcrumb |

### 9.2 Long Post Text

Body text is not truncated in the default feed view. For very long posts (>280 chars), the card simply grows taller. A future enhancement could add a "Show more" truncation at ~300 chars.

### 9.3 Multiple Links

The Bluesky post record supports one primary external embed. If the post text contains additional inline URLs (via facets), only the primary embed gets a link preview card. Inline URLs in the body text are rendered as plain text in v1.

---

## 10. Relationship to Backend Data

### 10.1 Data Sources

| Field | Source | API |
|---|---|---|
| Expert name | `KnowledgePostResult.handle` -> expert lookup | `GET /api/posts/recent` |
| Avatar | `KnowledgePostResult.avatar` | `GET /api/posts/recent` |
| Body text | `KnowledgePostResult.text` | `GET /api/posts/recent` |
| Hashtags | Extracted from `KnowledgePost.links[].tags` or post record tags | Post record |
| Link preview | `KnowledgeLinkResult` joined by `postUri` | `GET /api/links` |
| Topic breadcrumb | `ExplainedPostTopic` | `GET /api/posts/:uri/topics` |
| Expert tier | `authorTiers` from ontology snapshot | Client-side lookup |
| Timestamp | `KnowledgePostResult.createdAt` (epoch ms) | `GET /api/posts/recent` |

### 10.2 Expert Display Name Resolution

The `KnowledgePostResult` provides `handle` but not `displayName`. The frontend should:
1. Maintain a client-side expert cache from `GET /api/experts?limit=200`
2. Look up the expert by DID to get `displayName`
3. Fall back to `handle` if no display name is available
4. Fall back to truncated DID (`did:plc:abc1...`) as last resort

### 10.3 Hashtag Extraction

Post hashtags come from the Bluesky post record's `tags` field (extracted during ingestion). The smoke fixture shows tags as arrays: `["solar", "storage"]` and `["wind"]`. The display adds `#` prefixes and joins with spaces.

---

## 11. Accessibility

- The PostCard is an `<article>` element for semantic structure
- The avatar uses `alt=""` (decorative; the expert name provides identity)
- Link preview cards are single `<a>` elements (one tab stop)
- Tier dots have `title` attributes for tooltip/screen reader context
- Color is never the sole indicator of meaning
- All interactive elements have visible focus states via `:focus-visible`
- Timestamps link to the original Bluesky post (see TimeLink spec in link-preview.md)
