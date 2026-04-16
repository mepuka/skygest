# SKY-23 — Candidate Payload Storage Decision

## Decision

Use **D1 as the durable store** for candidate and picked post payloads.

KV remains appropriate for ephemeral session/cache state, but not for the durable post-scoped payloads needed by operator review and post-pick enrichment.

## Why D1

- the candidate set is much smaller than the full energy-related corpus, so row-count pressure is modest
- writes happen at clear boundaries: candidate capture, pick promotion, enrichment update
- reads happen repeatedly afterward from the same post-scoped record
- post payloads need to live alongside `posts` and `editorial_picks`, not in a separate eventually consistent cache
- enrichment will update the same record later, which is a better fit for indexed row updates than KV blobs

## Storage Shape

Use one row per post in `post_payloads`, with per-enrichment child rows in `post_enrichments`:

- `post_uri` as the primary key
- `capture_stage` as `candidate | picked`
- `embed_type` as the normalized embed discriminator
- `embed_payload_json` for lightweight embed metadata only
- `post_enrichments(post_uri, enrichment_type)` for later vision/source/grounding results
- `captured_at`, `updated_at`, `enriched_at` for lifecycle tracking

No binary media is stored. Bluesky CDN URLs remain the media source of truth.

## Access Patterns

- candidate scoring captures the lightweight payload once a post enters the candidate set
- pick flow promotes an existing payload row from `candidate` to `picked`
- enrichment writes upsert one child row per enrichment type later
- operator/feed surfaces read the payload by `post_uri`

## Candidate Write Trigger

The intended write boundary is the future `SKY-20` candidate-set transition. Existing manual pick flows can also write directly at pick time if a row does not already exist.

## Migration Plan

1. keep live thread/embed handling unchanged
2. start writing durable payload rows at candidate/pick boundaries
3. let enrichment read from `post_payloads` first
4. only fall back to live Bluesky embed fetches where no durable row exists during rollout
