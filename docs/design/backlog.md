# Design & Frontend Backlog

## Backend Prerequisites

### Post Image Collection
**Priority**: Medium
**Status**: Not started

Bluesky posts can contain up to 4 inline images (`app.bsky.embed.images`), but we currently only capture external embed thumbnails (`embed.external.thumb`) and expert avatars.

**What's needed**:
1. Add `images` embed type to `Embed` schema in `src/bluesky/PostRecord.ts`
2. Parse image blob refs from `app.bsky.embed.images#image` — each has `image.ref.$link` (CID) and `image.mimeType`
3. Construct CDN URLs via `BskyCdn.ts`: `https://cdn.bsky.app/img/feed_fullsize/plain/{did}/{cid}@jpeg`
4. Store image URLs — either a `post_images` table (`post_uri, image_url, alt_text, position`) or a JSON array column on posts
5. Surface in `KnowledgePostResult` as `images: ReadonlyArray<{ url: HttpsUrl; alt: string | null }>`
6. D1 migration for storage

**Design impact**: Enables featured image cards, image galleries in posts, and richer visual feed. The media design language (filters, topic-colored overlays) applies to these images the same way it applies to link thumbnails.

**Bluesky embed.images shape**:
```json
{
  "$type": "app.bsky.embed.images",
  "images": [
    {
      "alt": "Solar farm in Texas",
      "image": {
        "$type": "blob",
        "ref": { "$link": "bafkrei..." },
        "mimeType": "image/jpeg",
        "size": 543210
      }
    }
  ]
}
```

### Author Hashtags in API
**Priority**: Low
**Status**: Not started

Thread `tags` array from `SlimPostRecord` through storage and query layers into `KnowledgePostResult`. Currently captured during ingest but not persisted or surfaced.

### Link Joining in Post Responses
**Priority**: Medium
**Status**: Not started

Include the primary external link inline in post responses to avoid separate API round-trips for the feed view. Consider an `?include=links` query parameter or always include the first link.

## Design Items

### Video Thumbnail Support
**Priority**: Low — Bluesky video is newer, lower volume in energy discourse

### Geographic Entity Extraction
**Priority**: Low — Requires NER at ingest time. The ontology models GeographicEntity but we don't extract locations from posts.

### Organization Entity Extraction
**Priority**: Low — Same as geographic. The ontology models Organization (with sectors) but we don't extract company/org mentions.
