# SKY-24: Unified Runtime Schema Target

## Goal

Produce a single canonical schema target for Skygest application code by combining the `energy-news` and `energy-media` ontology work at the ontology level, then exporting a runtime-friendly representation for Effect Schema modeling.

The typed schemas must cover **both** the stored payload path (candidatePayload/post_payloads) **and** the live MCP thread output path (ThreadPostResult.embedContent). One shape, two consumers.

## Current State

### Ontology Tracks

**Energy-News** (`ontology_skill/ontologies/energy-news/`): Version 0.2.0, release 0.3.0. TBox classes include Post, Article, AuthorAccount, Publication, Feed, Organization, GeographicEntity, SocialMediaPlatform, EnergyTopic, MediaAttachment, Chart, DocumentExcerpt, Photo, Infographic, VideoAttachment, ChartAxis, ChartSeries, ChartSourceLine, TemporalCoverage, EnergyDataProvider, EnergyDataset. SKOS schemes: EnergyTopicScheme (92 concepts), ChartTypeScheme (14 chart types), AltTextProvenanceScheme (3 values).

**Energy-Media** (`ontology_skill/ontologies/energy-media/`): Version 0.1.0, uses `emedia:` namespace. Conceptual model says "Media domain is now merged into energy-news ontology (enews namespace)." The overlap with energy-news is near-total.

**Convergence status**: The energy-news release artifacts already contain the merged media classes under `enews:`. The ontology-level merge is architecturally complete.

### Backend Domain Types

| File | Key Types | Gap |
|------|-----------|-----|
| `bi.ts` L595 | `ThreadPostResult.embedContent` | `Schema.NullOr(Schema.Unknown)` — live MCP path |
| `candidatePayload.ts` | `CandidatePayloadRecord.embedPayload` | `Schema.NullOr(Schema.Unknown)` — storage path |
| `editorial.ts` | `EditorialPickRecord` | No media awareness |
| `curation.ts` | `CurationRecord` | No media richness signal |

### Current Embed Handling

`mapEmbedType` (duplicated in Toolkit.ts L367 and CurationService.ts L199) classifies Bluesky embeds into 5 types via `$type` string matching. `buildEmbedContent` (Toolkit.ts L385) constructs different shapes per type but returns `unknown`. The `recordWithMedia` branch (L416-427) recursively calls `buildEmbedContent` on `embed.media`, which can be images, video, **or an external link** — all three are valid.

### Ontology Naming

The ontology artifact (`energy-media-summary.json`) uses PascalCase names: `AreaChart`, `BarChart`, `AltTextOriginal`, `AltTextSynthetic`. The snapshot builder (`build-ontology-snapshot.ts`) does not export ChartTypeScheme or AltTextProvenanceScheme at all — these are not in the runtime snapshot today.

## Key Design Decisions

**DD-1: Embed types vs media types are separate concerns.** `EmbedKind` is a Bluesky wire-format concern (what the API sends). `MediaType` is a domain-level concern (what the content actually is). An `"img"` embed could be a chart, photo, or infographic.

**DD-2: Enrichment payloads are discriminated unions, not opaque JSON.** Typed enrichment outputs enable MCP, API, and frontend to consume enrichment data without per-consumer decode logic.

**DD-3: Media and chart enums derived from ontology export, not hand-maintained.** The snapshot builder should export ChartTypeScheme and AltTextProvenanceScheme alongside EnergyTopicScheme. The Effect Schema literals are then generated from (or validated against) the export, not maintained as a second list. Slug format: kebab-case derived from PascalCase names (e.g., `AreaChart` → `area-chart`).

**DD-4: Multi-enrichment table, not single blob column.** Already implemented in SKY-25 as `post_enrichments` keyed by `(post_uri, enrichment_type)`.

**DD-5: `embed_type` column is source of truth; `kind` field inside JSON is derived on read, not stored.** The `EmbedPayload` union discriminator is `embed_type` from the D1 column. When decoding stored JSON, the column value selects which schema variant to decode against. No `kind` field is stored in the JSON blob. When constructing `EmbedPayload` for MCP output, `kind` is added from the embed $type classification. This avoids dual-label disagreements.

**DD-6: `post_payloads.enrichment_payload_json` is dead.** The column stays in migration 12 (can't remove columns in SQLite) but all enrichment reads/writes go through `post_enrichments` (migration 14). The column is ignored on read and written as NULL on new captures. A future migration can drop it via table rebuild if needed.

**DD-7: One `EmbedPayload` type, two consumers.** The same `EmbedPayload` union is used for both `CandidatePayloadRecord.embedPayload` (stored) and `ThreadPostResult.embedContent` (live MCP). `buildTypedEmbed` in `EmbedExtract.ts` produces `EmbedPayload` for both paths.

## Effect Schema Target Definitions

### EmbedKind (Bluesky wire format — existing `ThreadEmbedType`)

```
Schema.Literal("link", "img", "quote", "media", "video")
```

### MediaType (ontology-derived classification — new)

```
Schema.Literal("chart", "document-excerpt", "photo", "infographic", "video")
```

### EmbedPayload (typed union replacing `Schema.Unknown`)

Discriminated union keyed on `kind` (derived from `EmbedKind`):

- **LinkEmbed**: `kind: "link"`, `uri`, `title`, `description`, `thumb`
- **ImageEmbed**: `kind: "img"`, `images: Array<{ thumb, fullsize, alt }>`
- **VideoEmbed**: `kind: "video"`, `playlist`, `thumbnail`, `alt`
- **QuoteEmbed**: `kind: "quote"`, `uri`, `text`, `author`
- **MediaComboEmbed**: `kind: "media"`, `record: QuoteRef | null`, `media: LinkEmbed | ImageEmbed | VideoEmbed | null`

Note: `MediaComboEmbed.media` includes `LinkEmbed` because Bluesky `recordWithMedia` supports quote + external link (not just quote + images/video). This matches the current `buildEmbedContent` behavior at Toolkit.ts L425 which recursively handles all embed types.

### EnrichmentOutput (typed per enrichment kind)

- **VisionEnrichment** (`kind: "vision"`): `mediaType`, `chartTypes[]`, `altText`, `altTextProvenance`, `xAxis`, `yAxis`, `series[]`, `sourceLines[]`, `temporalCoverage`, `keyFindings[]`, `title`, `modelId`, `processedAt`
- **SourceAttributionEnrichment** (`kind: "source-attribution"`): `imageSource`, `contentSource`, `dataSource`, `processedAt`
- **GroundingEnrichment** (`kind: "grounding"`): `claimText`, `supportingEvidence[]`, `processedAt`

### ChartType (from ChartTypeScheme, 14 values)

Derived from ontology export. PascalCase names → kebab-case slugs:

```
Schema.Literal(
  "bar-chart", "stacked-bar-chart", "line-chart", "area-chart",
  "scatter-plot", "heatmap", "pie-chart", "sankey-diagram",
  "treemap", "candlestick-chart", "choropleth-map", "point-map",
  "data-table", "dual-axis-chart"
)
```

### Supporting Types

- `AltTextProvenance`: `Schema.Literal("original", "synthetic", "absent")` (derived from ontology `AltTextOriginal` → `original`, etc.)
- `ChartAxis`: `{ label, unit }`
- `ChartSeries`: `{ legendLabel, unit }`
- `ChartSourceLine`: `{ sourceText }`
- `TemporalCoverage`: `{ startDate, endDate }`
- `ProviderReference`: `{ providerId, providerLabel, datasetLabel }`
- `SourceReference`: `{ url, title, domain, publication }`

## Storage Mapping

### post_payloads (existing)

- `embed_type TEXT` — one of 5 `EmbedKind` values. **Source of truth** for EmbedPayload discriminator.
- `embed_payload_json TEXT` — JSON decoded against `EmbedPayload` using `embed_type` to select variant.
- `enrichment_payload_json TEXT` — **dead column**. Ignored on read, written as NULL. All enrichment goes to `post_enrichments`.

### post_enrichments (migration 14, from SKY-25)

```sql
CREATE TABLE post_enrichments (
  post_uri          TEXT NOT NULL,
  enrichment_type   TEXT NOT NULL,
  enrichment_payload_json TEXT NOT NULL,
  updated_at        INTEGER NOT NULL,
  enriched_at       INTEGER NOT NULL,
  PRIMARY KEY (post_uri, enrichment_type),
  FOREIGN KEY (post_uri) REFERENCES post_payloads(post_uri)
);
```

### Backward compatibility

**Reading old `embed_payload_json` rows:** Try to decode as `EmbedPayload` using `embed_type` column as discriminator. If decode fails (raw Bluesky object without `kind`), wrap in a lenient decode that extracts the known fields and logs a warning. Never fail on existing data.

**Writing new rows via `curatePost`:** `EmbedExtract.buildTypedEmbed()` produces a typed `EmbedPayload` from the raw Bluesky embed. The JSON stored is the typed shape (without `kind` — that's derived from `embed_type` column).

**Reading `enrichment_payload_json` from old `post_payloads` rows:** Ignore. Any pre-SKY-25 enrichment data is unreachable (none exists in production — `saveEnrichment` had no callers).

## Implementation Phases

### Phase 1: Ontology export + domain types (foundation)

1. Update `build-ontology-snapshot.ts` to export `ChartTypeScheme` and `AltTextProvenanceScheme` from ontology artifacts with kebab-case slug derivation
2. Create `src/domain/media.ts` with `MediaType`, `ChartType`, `AltTextProvenance`, chart description types, `ProviderReference`, `SourceReference`
3. Create `src/domain/embed.ts` with `EmbedPayload` union (5 variants including `MediaComboEmbed.media: LinkEmbed | ImageEmbed | VideoEmbed`)
4. Create `src/domain/enrichment.ts` with `EnrichmentOutput` union

### Phase 2: Shared embed extraction + both consumer paths

1. Create `src/bluesky/EmbedExtract.ts` with `extractEmbedKind()` and `buildTypedEmbed()` — produces `EmbedPayload` from raw Bluesky embed
2. Update `src/mcp/Toolkit.ts` — replace inline `mapEmbedType`/`buildEmbedContent` with `EmbedExtract.ts` imports. Update `ThreadPostResult.embedContent` to use `EmbedPayload`
3. Update `src/domain/bi.ts` — `ThreadPostResult.embedContent` from `Schema.Unknown` to `Schema.NullOr(EmbedPayload)`
4. Update `src/services/CurationService.ts` — replace inline `mapEmbedType` with `EmbedExtract.ts` import

### Phase 3: Storage path typing

1. Update `src/domain/candidatePayload.ts` — `embedPayload` from `Schema.Unknown` to `Schema.NullOr(EmbedPayload)` with fallback decode
2. Update `src/services/d1/CandidatePayloadRepoD1.ts` — decode `embed_payload_json` using `embed_type` column as discriminator, with lenient fallback
3. Stop writing `enrichment_payload_json` in `upsertCapture` (always NULL)

### Phase 4: Wire to downstream consumers (unblocks SKY-16, SKY-17, SKY-21)

1. SKY-16 (vision pipeline) produces `VisionEnrichment` and writes to `post_enrichments`
2. SKY-17 (data source registry) produces `SourceAttributionEnrichment`
3. SKY-21 (enrichment pipeline) orchestrates multiple passes

## New Files

| File | Contents |
|------|----------|
| `src/domain/media.ts` | `MediaType`, `ChartType`, `AltTextProvenance`, chart description structs, `ProviderReference`, `SourceReference` |
| `src/domain/embed.ts` | `EmbedPayload` union (5 variants), `ImageRef`, `QuoteRef` |
| `src/domain/enrichment.ts` | `EnrichmentOutput` union, `VisionEnrichment`, `SourceAttributionEnrichment`, `GroundingEnrichment` |
| `src/bluesky/EmbedExtract.ts` | `extractEmbedKind()`, `buildTypedEmbed()` — shared extraction |

## Modified Files

| File | Change |
|------|--------|
| `src/scripts/build-ontology-snapshot.ts` | Export ChartTypeScheme + AltTextProvenanceScheme with kebab-case slugs |
| `src/domain/bi.ts` | `ThreadPostResult.embedContent` → `Schema.NullOr(EmbedPayload)` |
| `src/domain/candidatePayload.ts` | `embedPayload` → `Schema.NullOr(EmbedPayload)` with fallback |
| `src/mcp/Toolkit.ts` | Replace inline embed logic with `EmbedExtract.ts` imports |
| `src/services/CurationService.ts` | Replace inline `mapEmbedType` with `EmbedExtract.ts` |
| `src/services/d1/CandidatePayloadRepoD1.ts` | Typed embed decode using `embed_type` discriminator + lenient fallback; stop writing `enrichment_payload_json` |

## What Stays Ontology-Only

- BFO alignment, PROV-O attribution properties
- `enews:Organization`, `enews:GeographicEntity` (future entity extraction)
- OWL class hierarchy structure (runtime uses flat literal unions)
- SKOS broader/narrower relationships for chart types (flat enum sufficient for v1)

## Open Question Resolution

**Should media/chart enums come from the ontology build step?** Yes — DD-3 updated. The snapshot builder exports ChartTypeScheme and AltTextProvenanceScheme. The Effect Schema literals are then validated against or generated from that export. One source of truth.
