# Hashtag Display Component Specification

**Date:** 2026-03-15
**Status:** Final (Sprint 1)
**Scope:** HashtagDisplay -- muted text display of post hashtags within the PostCard

---

## 1. Design Token Reference

| Token | Value | Usage |
|---|---|---|
| UI chrome font | Inter | All hashtag text |
| Text ghost | `#B0B0A6` | Hashtag text color |
| Text mid | `#9A9A90` | Ontology breadcrumb text (for contrast reference) |

---

## 2. Purpose

Hashtags extracted from Bluesky post records are displayed as quiet, non-interactive text within the PostCard. They provide secondary context about the post's self-declared topics, distinct from the system-assigned ontology breadcrumb below.

### 2.1 Visual Distinction from Ontology Breadcrumbs

Hashtags and ontology breadcrumbs occupy similar visual space but serve different purposes. They are distinguished by:

| Property | Hashtags | Ontology Breadcrumb |
|---|---|---|
| Font size | 11px | 10px |
| Color | `#B0B0A6` (Ghost) | `#9A9A90` (Mid) |
| Prefix | `#` on each tag | none |
| Separator | space | `/` in `#C4C4BB` |
| Position | Above link preview | Below everything (last element before divider) |
| Source | Post author's self-tagging | System-assigned via ontology matching |
| Interactivity | Not clickable (v1) | Not clickable (v1) |

The hashtags sit *higher* in the card (closer to the body text they annotate) and are slightly *more visible* (`#B0B0A6` is lighter than `#9A9A90` but at 11px vs 10px the hashtags read at roughly equal weight). The ontology breadcrumb anchors the bottom of the card as the quietest element.

---

## 3. Styling

```css
.hashtag-display {
  font-family: 'Inter', system-ui, sans-serif;
  font-size: 11px;
  font-weight: 400;
  line-height: 1.4;
  color: #B0B0A6;
}
```

Inline style equivalent:

```
font-family: Inter, system-ui, sans-serif;
font-size: 11px;
font-weight: 400;
line-height: 1.4;
color: #B0B0A6;
```

---

## 4. Format

Hashtags are rendered as a single line of space-separated text, each prefixed with `#`.

**Input data:** `["solar", "storage"]` (from post record `tags` array)

**Rendered output:** `#solar #storage`

### 4.1 Formatting Rules

- Each tag is prefixed with `#` (no space between `#` and the tag text)
- Tags are separated by a single space
- Tags are rendered lowercase as received from the post record
- No trailing punctuation or separators
- Long tag lists wrap naturally; no truncation in v1

### 4.2 HTML

**Example data:** From smoke fixture post-solar with tags `["solar", "storage"]`.

```html
<div style="
  font-family: Inter, system-ui, sans-serif;
  font-size: 11px;
  font-weight: 400;
  line-height: 1.4;
  color: #B0B0A6;
">#solar #storage</div>
```

**Example data:** From smoke fixture post-wind with tags `["wind"]`.

```html
<div style="
  font-family: Inter, system-ui, sans-serif;
  font-size: 11px;
  font-weight: 400;
  line-height: 1.4;
  color: #B0B0A6;
">#wind</div>
```

**Example:** A post with many hashtags (hypothetical energy post).

```html
<div style="
  font-family: Inter, system-ui, sans-serif;
  font-size: 11px;
  font-weight: 400;
  line-height: 1.4;
  color: #B0B0A6;
">#hydrogen #greenhydrogen #ammonia #energytransition</div>
```

---

## 5. Position in PostCard

The hashtag display sits between the body text and the link preview (if present), or between the body text and the ontology breadcrumb (if no link preview).

```
Attribution Row
Body Text
[6px gap]
Hashtags          <-- here
[6px gap]
Link Preview (if present)
[6px gap]
Ontology Breadcrumb
```

### 5.1 When Absent

If the post has no hashtags (the `tags` array is empty or not present), the hashtag row is omitted entirely. The 6px gap collapses, and the next element (link preview or ontology breadcrumb) follows directly after the body text with a single 6px gap.

---

## 6. Data Source

Hashtags come from the Bluesky post record's `tags` field, extracted during ingestion. In the `SmokeFixture.ts`:

```typescript
// post-solar
tags: ["solar", "storage"]

// post-wind
tags: ["wind"]
```

These are stored as part of the post record and available on the `KnowledgePost` schema's source data. The current `KnowledgePostResult` API response does not include tags directly; a future API extension should add them.

### 6.1 Recommended API Extension

Add a `tags` field to `KnowledgePostResult`:

```typescript
// Current
{
  uri, did, handle, avatar, text, createdAt, topics, snippet
}

// Recommended
{
  uri, did, handle, avatar, text, createdAt, topics, snippet,
  tags: string[]  // ["solar", "storage"]
}
```

---

## 7. Interactivity

### 7.1 v1 (Current)

Hashtags are **not clickable**. They are plain text, rendered as a `<div>`, not as links. No hover state, no cursor change.

### 7.2 Future Enhancement

In a future version, hashtags could become clickable filters:
- Clicking a hashtag would filter the feed to posts containing that hashtag
- Visual treatment would add `cursor: pointer` and a subtle hover state (e.g., color transition to `#6B6B63`)
- Each tag would become an individual `<a>` or `<button>` element
- This would complement the ontology-based topic filtering with user-declared tag filtering

---

## 8. Accessibility

- Hashtags are rendered as plain text, requiring no special ARIA attributes
- The `#` prefix is part of the visible text content and is read by screen readers
- Color contrast: `#B0B0A6` on `#FFFFFF` background = 2.8:1 ratio. This is below WCAG AA for normal text (4.5:1) but acceptable for supplementary metadata that is not essential for understanding the post content. The same pattern is used industry-wide for secondary metadata (Twitter/X, Mastodon).
