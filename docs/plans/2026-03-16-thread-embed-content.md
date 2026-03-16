# Thread Embed Content — Design

## Goal

Surface actual media content (image URLs, link metadata, quoted posts, video) from Bluesky thread embeds through the MCP `get_post_thread` tool, so an LLM with vision can fetch and analyze charts, graphs, and images shared by energy experts.

## Context

The system currently detects embed *type* (`link | img | quote | media`) but discards the actual content. An LLM sees `[img]` but can't look at the chart. This change captures the full embed payload from Bluesky's live API and surfaces it in both structured JSON and the `_display` text.

## Verified AT Proto Embed View Schemas

**`app.bsky.embed.images#view`** — `images[]`: `{ thumb, fullsize, alt, aspectRatio? }` (max 4)

**`app.bsky.embed.external#view`** — `external`: `{ uri, title, description, thumb? }`

**`app.bsky.embed.record#view`** — `record`: union of viewRecord `{ uri, cid, author, value, indexedAt, embeds[]?, counts? }` | viewNotFound | viewBlocked | viewDetached

**`app.bsky.embed.video#view`** — `{ cid, playlist, thumbnail?, alt?, aspectRatio?, presentation? }`

**`app.bsky.embed.recordWithMedia#view`** — `{ record: record#view, media: images#view | video#view | external#view }`

## Changes

### 1. ThreadTypes.ts — Expanded Embed Schemas

Add lightweight view schemas matching the AT Proto lexicons:

```typescript
const ThreadImageView = Schema.Struct({
  thumb: Schema.String,
  fullsize: Schema.String,
  alt: Schema.String,
  aspectRatio: Schema.optional(Schema.Struct({
    width: Schema.Number,
    height: Schema.Number
  }))
});

const ThreadExternalView = Schema.Struct({
  uri: Schema.String,
  title: Schema.String,
  description: Schema.String,
  thumb: Schema.optional(Schema.String)
});

const ThreadVideoView = Schema.Struct({
  cid: Schema.optional(Schema.String),
  playlist: Schema.String,
  thumbnail: Schema.optional(Schema.String),
  alt: Schema.optional(Schema.String)
});

const ThreadRecordView = Schema.Struct({
  uri: Schema.optional(Schema.String),
  cid: Schema.optional(Schema.String),
  author: Schema.optional(ThreadProfileBasic),
  value: Schema.optional(Schema.Unknown)
});
```

Expand embed field on ThreadPostView:

```typescript
embed: Schema.optional(Schema.Struct({
  $type: Schema.optional(Schema.String),
  images: Schema.optional(Schema.Array(ThreadImageView)),
  external: Schema.optional(ThreadExternalView),
  record: Schema.optional(ThreadRecordView),
  media: Schema.optional(Schema.Struct({
    images: Schema.optional(Schema.Array(ThreadImageView)),
    external: Schema.optional(ThreadExternalView),
    video: Schema.optional(ThreadVideoView)
  })),
  // video directly on embed (not nested under media)
  cid: Schema.optional(Schema.String),
  playlist: Schema.optional(Schema.String),
  thumbnail: Schema.optional(Schema.String),
  alt: Schema.optional(Schema.String)
}))
```

Note: Video view fields live directly on the embed object (not nested), matching how Bluesky serializes `embed.video#view`.

### 2. bi.ts — Schema Updates

```typescript
export const ThreadEmbedType = Schema.Literal("link", "img", "quote", "media", "video");
```

Add to ThreadPostResult:

```typescript
embedContent: Schema.NullOr(Schema.Unknown)
```

### 3. Toolkit.ts — Build embedContent

Update `mapEmbedType` to detect video. Add `buildEmbedContent(embed)` that returns:

- **img**: `{ images: [{ thumb, fullsize, alt }] }`
- **link**: `{ uri, title, description, thumb }`
- **quote**: `{ uri, text, author }` (extract text from value.text)
- **video**: `{ thumbnail, playlist, alt }`
- **media**: `{ record: { uri, text, author }, media: <one of above> }`

### 4. Fmt.ts — Media URL Lines

After the text line, append media URLs:

- `📷 <fullsize_url> (alt: <alt_text>)` — one per image, max 4
- `🔗 <uri> — <title>` — for external links
- `🎬 <playlist_url> (thumb: <thumbnail_url>)` — for video
- `💬 @<author> · <text_truncated> (<uri>)` — for quoted posts

### 5. Tests

- **thread-flatten.test.ts**: Verify embed content passes through FlattenedPost
- **mcp-fmt.test.ts**: Test each media type renders correct prefix and URL lines

## Files

| File | Change |
|------|--------|
| `src/bluesky/ThreadTypes.ts` | Expanded embed view schemas |
| `src/domain/bi.ts` | `video` in ThreadEmbedType, `embedContent` field |
| `src/mcp/Toolkit.ts` | `mapEmbedType` video, `buildEmbedContent` |
| `src/mcp/Fmt.ts` | Media URL lines with emoji prefixes |
| `tests/thread-flatten.test.ts` | Embed content passthrough test |
| `tests/mcp-fmt.test.ts` | Media display line tests |

## Verification

1. `bunx tsc --noEmit` — clean
2. `bun run test` — all pass
3. Deploy staging, test on thread with images (jaapburger.eu solar prices thread)
