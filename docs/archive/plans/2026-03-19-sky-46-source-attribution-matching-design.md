# SKY-46 — Source Attribution Matching Design

> Deterministic matching system for assigning a canonical data originator, a referenced external page, and social provenance to a post.

## Design Principles

1. **No LLM confidence scores.** Matching is rule-based and deterministic.
2. **Provider means originator only.** The provider registry contains only the canonical organization that produced the underlying data, such as ERCOT, EIA, or BC Hydro.
3. **Platforms and publications are separate.** GridStatus, Utility Dive, Reuters, and similar domains can appear as `contentSource` or future platform metadata, but they are not providers under the SKY-43 domain model.
4. **Three attribution concepts stay separate.** `provider`, `contentSource`, and `socialProvenance` are distinct outputs and should not be collapsed into a single “source” idea.
5. **Persisted attribution stays small.** The saved enrichment remains a single post-level summary. Internal evidence can be richer, but the persisted result stores only one provider, one content source, and one social provenance record.
6. **Ambiguity is explicit.** If the matcher cannot choose one unique provider deterministically, it persists `provider = null` rather than inventing a winner from asset order.
7. **`sourceFamily` is canonical, not raw.** `sourceFamily` means a normalized family already present in the provider registry. Raw extracted dataset labels stay raw until they can be normalized safely.
8. **Visual posts should match after vision.** If a post has visual assets, source attribution should run after vision so strong chart signals participate. Text/link-only posts can run without vision.

---

## Domain Semantics

### Provider

The `provider` field answers:

> Who produced the underlying data being cited?

Examples:
- ERCOT
- EIA
- BC Hydro

Non-examples:
- GridStatus
- Utility Dive
- Reuters

### Content Source

The `contentSource` field answers:

> What external page or document did the post explicitly share?

This can be a dashboard, article, report page, PDF, or other linked page. It does **not** need to be the same organization as the provider.

Examples:
- `gridstatus.io/live/ercot`
- `utilitydive.com/news/...`
- `bchydro.com/.../annual-report.pdf`

### Social Provenance

The `socialProvenance` field answers:

> Which account published or reposted the content on Bluesky?

This is about who posted, not who originated the data.

Examples:
- `did:plc:...` + `gridstatus.io`
- `did:plc:...` + `blakeshaffer.bsky.social`

### `sourceFamily`

The `sourceFamily` field answers:

> Which canonical dataset or report family from the matched provider does this likely belong to?

Examples:
- `Form 860`
- `Daily Renewable Report`
- `Load Forecast Report`

Important constraints:
- `sourceFamily` only refines an already-matched provider.
- A raw extracted label like `"ERCOT load data"` is **not** automatically a canonical `sourceFamily`.
- A dataset label alone must not create a provider match.

---

## Complete Data Flow

```
Bluesky Post
  ├─ text (URLs via facets, @mentions, hashtags)
  ├─ link embed (URL, domain, title, description)
  ├─ image embeds (chart images)
  └─ author (DID, handle, tier)
       │
       ▼
Ingestion (D1)
  ├─ posts table (text, created_at)
  ├─ links table (url, domain, title)
  └─ post_topics (matched topics)
       │
       ▼
Vision Enrichment (Gemini, for posts with images)
  ├─ sourceLines[].sourceText        ──► "Source: EIA"
  ├─ title                           ──► "ERCOT Real-Time Prices"
  ├─ visibleUrls[]                   ──► "gridstatus.io" in footer
  ├─ sourceLines[].datasetName       ──► "Form 860"
  ├─ organizationMentions[]          ──► optional future alias hints
  └─ logoText[]                      ──► optional future watermark hints
       │
       ▼
Deterministic Matching
  ├─ provider signals     ──► canonical originator
  ├─ content-source pick  ──► shared external page, if any
  ├─ social provenance    ──► posting account
  └─ sourceFamily refine  ──► canonical family for chosen provider
       │
       ▼
SourceAttributionEnrichment
  ├─ provider: { providerId, providerLabel, sourceFamily } | null
  ├─ contentSource: { url, title, domain, publication } | null
  └─ socialProvenance: { did, handle } | null
```

---

## Execution Rules

### When does SKY-46 run?

- **Posts with no visual assets:** source attribution can run from links, embed URLs, and post text alone.
- **Posts with one or more visual assets:** source attribution should run after vision enrichment has completed.

This is a design rule for SKY-47 integration. The matcher can technically operate without vision, but the workflow should not finalize source attribution for image posts until vision signals are available.

### Degraded mode

The matcher has one supported degraded mode:

- **Text/link-only degraded mode:** allowed for posts that do not contain images.

The matcher does **not** define a second “image post but vision missing” final mode. If vision is missing for an image post, the workflow should defer or rerun source attribution after vision completes.

---

## Signal Types

Seven deterministic provider-signal types, ranked by priority:

| Rank | Signal ID | Input Source | Lookup Method |
|------|-----------|--------------|---------------|
| 1 | `source-line-alias` | `VisionAssetAnalysis.sourceLines[].sourceText` | Strip source prefixes, then exact alias match or greedy prefix match |
| 2 | `source-line-domain` | URL/domain extracted from `sourceText` | `registry.findByDomain()` |
| 3 | `chart-title-alias` | `VisionAssetAnalysis.title` | Word-boundary scan against registry aliases |
| 4 | `link-domain` | `LinkRecord.domain` or parsed URL | `registry.findByDomain()` |
| 5 | `embed-link-domain` | `LinkCard.uri` hostname | `registry.findByDomain()` |
| 6 | `visible-url-domain` | `VisionAssetAnalysis.visibleUrls[]` | `registry.findByDomain()` |
| 7 | `post-text-mention` | `KnowledgePost.text` | Word-boundary scan against aliases |

### Notes on scope

- `organizationMentions` and `logoText` are useful future signals, but they are **not part of the initial seven-signal contract**. They can be added later without changing the core ontology.
- `contentSource` and `socialProvenance` are assembled separately. They are not provider signals.

### Signal details

- **source-line-alias**: Strongest signal. Handles explicit lines like `"Source: ERCOT"` or `"Data: BC Hydro"`.
- **source-line-domain**: Strong signal when the chart cites `eia.gov`, `ercot.com`, or similar.
- **chart-title-alias**: Useful when a provider name appears directly in the chart title.
- **link-domain / embed-link-domain**: Only match providers for originator domains already present in the provider registry.
- **visible-url-domain**: Uses URLs or domains visibly printed inside the chart image, often in footers.
- **post-text-mention**: Weakest provider signal. Helps when analysts explicitly name the originator in post text.

---

## Normalization Rules

These rules should be shared across the matcher so implementations do not drift:

- **Alias normalization**: trim, lowercase, collapse internal whitespace.
- **Domain normalization**: parse hostname when possible, lowercase, strip `www.`.
- **Whole-word matching**: aliases must match on word boundaries, not as raw substrings inside larger tokens.
- **Source-prefix stripping**: strip common leading markers such as `Source:`, `Data:`, `Source data:`, and `via`.
- **Greedy prefix match**: when exact alias match fails on a source line, try the longest matching alias prefix first.
- **Domain extraction from text**: accept both full URLs and bare domains appearing in source lines or visible URL fields.

This matters for names like `ISO-NE`, `ENTSO-E`, dotted abbreviations, and mixed URL/text source lines.

---

## Source Family Refinement

`sourceFamily` is a **refinement step**, not a primary provider-matching step.

### Raw dataset labels

Vision extraction may produce a raw dataset label such as:

- `Form 860`
- `Daily Renewable Report`
- `ERCOT load data`

These raw labels are **not** persisted as `sourceFamily` automatically.

### Canonicalization rule

The matcher may set `provider.sourceFamily` only when all of the following are true:

1. A provider has already been matched by a stronger signal.
2. A raw dataset label exists for the same chart or source line.
3. That raw label matches a canonical `sourceFamily` registered for the already-matched provider.

### Disallowed behavior

The matcher must **not** do the following:

- Create a provider from `datasetName` alone.
- Pick a provider by taking the first provider returned from `findBySourceFamily()`.
- Persist a raw extracted label as if it were already a canonical family.

### Examples

- `"Source: EIA, Form 860"` → provider = EIA, sourceFamily = `Form 860`
- `"Source: BC Hydro Annual Report 2023"` → provider = BC Hydro, sourceFamily = null
- `"datasetName = ERCOT load data"` with no provider match → provider = null, sourceFamily = null

---

## Content Source Assembly

`contentSource` means:

> The external page explicitly shared by the post, when one can be chosen deterministically.

### Selection rules

1. Prefer the explicit external embed/link-card URL if present.
2. Otherwise, if exactly one unique external link URL exists in stored links, use that.
3. Otherwise, leave `contentSource = null`.

### Important constraints

- `contentSource` is not inferred from chart styling alone.
- `contentSource` can be a platform or publication even when `provider` is a different organization.
- If a post contains multiple unrelated links and no single obvious primary URL, do not guess.

---

## Matching Algorithm

### Input

- `EnrichmentExecutionPlan`
- `VisionEnrichment` when the post has visual assets

### Procedure

```
0. Gating
   if plan has visual assets and vision enrichment is missing:
     do not finalize source attribution yet

1. Initialize matches: Map<ProviderId, ProviderMatch>

2. Assemble non-provider outputs first
   contentSource = choosePrimaryContentSource(plan)
   socialProvenance = { did: plan.post.did, handle: expert handle or null }

3. PHASE 1 — Link-domain provider signals
   For each link in plan.links:
     domain = normalizeDomain(link.domain ?? parseHostname(link.url))
     entry = registry.findByDomain(domain)
     if entry: addMatch(entry.providerId, "link-domain", { url: link.url, domain })

4. PHASE 2 — Embed-link provider signals
   For each linkCard in plan.linkCards:
     domain = normalizeDomain(parseHostname(linkCard.uri))
     entry = registry.findByDomain(domain)
     if entry: addMatch(entry.providerId, "embed-link-domain", { url: linkCard.uri, domain })

5. PHASE 3 — Post-text mention provider signals
   For each provider in registry.providers:
     For each alias in [provider.providerLabel, ...provider.aliases]:
       if alias.length < 3: skip
       if isWholeWordMatch(plan.post.text, alias):
         addMatch(provider.providerId, "post-text-mention", { matchedAlias: alias })
         break

6. PHASE 4 — Vision provider signals
   For each asset in vision.assets:
     For each sourceLine in asset.analysis.sourceLines:
       stripped = stripSourcePrefix(sourceLine.sourceText)
       entry = registry.findByAlias(stripped)
       if !entry: entry = greedyPrefixMatch(stripped, registry)
       if entry:
         addMatch(entry.providerId, "source-line-alias",
           { sourceText: sourceLine.sourceText, assetKey: asset.assetKey })
         maybeRefineSourceFamily(entry.providerId, sourceLine.datasetName)

       domainMatch = extractDomainFromText(sourceLine.sourceText)
       if domainMatch:
         entry = registry.findByDomain(domainMatch)
         if entry:
           addMatch(entry.providerId, "source-line-domain",
             { sourceText: sourceLine.sourceText, domain: domainMatch, assetKey: asset.assetKey })
           maybeRefineSourceFamily(entry.providerId, sourceLine.datasetName)

     if asset.analysis.title:
       scan title for alias matches and add "chart-title-alias"

     For each visibleUrl in asset.analysis.visibleUrls:
       domain = normalizeDomain(parseHostname(visibleUrl))
       entry = registry.findByDomain(domain)
       if entry:
         addMatch(entry.providerId, "visible-url-domain",
           { url: visibleUrl, assetKey: asset.assetKey })

7. Resolve provider
   if no matches: provider = null
   else if one provider has the strongest unique signal: provider = that provider
   else: provider = null   // ambiguous by design

8. Persist result
   Save provider | null, contentSource | null, socialProvenance | null
```

---

## Match Result Shape

### Internal (matching-time only)

```typescript
type MatchSignalType =
  | "source-line-alias"
  | "source-line-domain"
  | "chart-title-alias"
  | "link-domain"
  | "embed-link-domain"
  | "visible-url-domain"
  | "post-text-mention";

type MatchEvidence = {
  readonly signal: MatchSignalType;
  readonly raw: Record<string, string>;
};

type ProviderMatch = {
  readonly providerId: ProviderId;
  readonly providerLabel: string;
  readonly sourceFamily: string | null;
  readonly signals: ReadonlyArray<MatchEvidence>;
};

type MatchResult = {
  readonly providerMatches: ReadonlyArray<ProviderMatch>;
  readonly selectedProvider: ProviderReference | null;
  readonly resolution: "matched" | "ambiguous" | "none";
  readonly contentSource: ContentSourceReference | null;
  readonly socialProvenance: SocialProvenance | null;
};
```

### Persisted (SourceAttributionEnrichment)

```typescript
{
  kind: "source-attribution",
  provider: { providerId: "ercot", providerLabel: "ERCOT", sourceFamily: null },
  contentSource: {
    url: "https://www.gridstatus.io/live/ercot",
    title: "ERCOT live dashboard",
    domain: "gridstatus.io",
    publication: null
  },
  socialProvenance: { did: "did:plc:...", handle: "blakeshaffer.bsky.social" },
  processedAt: 1710720000000
}
```

Evidence remains internal for now. SKY-45 can formalize how that evidence is exposed to ops or debugging tools without inflating the persisted enrichment payload.

---

## Edge Cases

### Utility Dive article citing ERCOT data

Post links to `utilitydive.com/story/...`, chart says `"Source: ERCOT"`.

- `utilitydive.com` is not a provider-domain match
- `source-line-alias` matches ERCOT
- **Result**: provider = ERCOT, contentSource = Utility Dive article

### `"Source: BC Hydro Annual Report 2023"`

1. Strip prefix → `"BC Hydro Annual Report 2023"`
2. Exact alias match fails
3. Greedy prefix match finds `"BC Hydro"`
4. Remaining text does not match a canonical source family
5. **Result**: provider = BC Hydro, sourceFamily = null

### Post sharing a GridStatus link with no chart

Post links to `gridstatus.io/live/ercot` and says `"ERCOT demand is near peak"`.

- `gridstatus.io` is not in the provider registry
- post text mentions ERCOT
- **Result**: provider = ERCOT, contentSource = gridstatus.io page

### GridStatus chart with only platform watermark

Chart shows `gridstatus.io` in footer but no upstream source line and no provider mention in text.

- `visible-url-domain` points to GridStatus as a platform domain, not a provider
- no originator signal exists
- **Result**: provider = null, contentSource = gridstatus.io page

### Multiple providers in one post

Chart 1 cites EIA. Chart 2 cites ERCOT.

- both providers match at the strongest rank
- no unique post-level provider winner exists
- **Result**: provider = null, internal result keeps both provider matches

This is intentional. The persisted model stays single-provider, but ambiguity is preserved as null rather than resolved by asset order.

---

## Provider Registry Requirements

The existing `ProviderRegistryEntry` shape is sufficient **for an originator-only registry**:

```typescript
ProviderRegistryEntry {
  providerId: ProviderId
  providerLabel: string
  aliases: string[]
  domains: string[]
  sourceFamilies: string[]
}
```

### Admission rule

Only add a registry entry when the organization is a canonical data originator.

Examples that belong:
- ERCOT
- EIA
- CAISO
- ISO New England
- BC Hydro

Examples that do not belong:
- GridStatus
- Utility Dive
- Reuters
- Yes Energy

If the product later needs first-class platform modeling, add a separate platform or content-source registry. Do not overload `ProviderRegistryEntry`.

---

## Vision Contract For Matching

The current ontology is only stable if the vision contract is pinned exactly. These are the intended field shapes:

```typescript
type VisionAssetAnalysis = {
  // existing fields omitted
  readonly visibleUrls: ReadonlyArray<string>;
  readonly organizationMentions: ReadonlyArray<{
    readonly name: string;
    readonly location: "title" | "subtitle" | "footer" | "watermark" | "body";
  }>;
  readonly logoText: ReadonlyArray<string>;
  readonly sourceLines: ReadonlyArray<{
    readonly sourceText: string;
    readonly datasetName: string | null;
  }>;
};
```

### Required vs optional

- **Required for the full SKY-46 vision-aware matcher**:
  - `visibleUrls: string[]`
  - `sourceLines[].datasetName: string | null`
- **Optional follow-on signals**:
  - `organizationMentions`
  - `logoText`

`organizationMentions` and `logoText` should not be treated as hidden prerequisites for the initial SKY-46 implementation.

---

## Implementation Slice Boundaries

| Slice | What | Status |
|-------|------|--------|
| SKY-43 | Provider/source domain types + refactor | **Done** |
| SKY-44 | Originator-only provider registry seed set | **Done** |
| SKY-49 | Vision contract additions: `visibleUrls`, `datasetName`; optional `organizationMentions` and `logoText` | Needs exact spec |
| SKY-45 | Internal evidence contract for ops/debugging; does not change persisted enrichment shape yet | Ready to spec |
| SKY-46 | Deterministic matching service over provider/content-source/social-provenance outputs | Ready after SKY-49 contract is pinned |
| SKY-47 | Workflow integration: run source attribution after vision for image posts, then persist output | Blocked by 46 |

---

## Signals Available At Each Stage

### Pre-ingestion

| Signal | Field | Available |
|--------|-------|-----------|
| Post text URLs | `facets[].features[].uri` | Yes |
| Link embed URL | `embed.external.uri` | Yes |
| Link embed title/description | `embed.external.title/description` | Yes |
| Image embeds | `embed.images[].thumb/fullsize/alt` | Yes |
| Author DID/handle | From expert table | Yes |

### Post-ingestion

| Signal | Field | Available |
|--------|-------|-----------|
| Link domains | `links.domain` | Yes |
| Link URLs | `links.url` | Yes |
| Publication lookup by hostname | publication/domain table | Yes |
| Expert tier | `experts.tier` | Yes |

### Post-vision

| Signal | Field | Available |
|--------|-------|-----------|
| Source line text | `sourceLines[].sourceText` | Yes |
| Chart title | `title` | Yes |
| Visible URLs | `visibleUrls[]` | SKY-49 |
| Raw dataset label | `sourceLines[].datasetName` | SKY-49 |
| Organization mentions | `organizationMentions[]` | Optional follow-on |
| Logo text | `logoText[]` | Optional follow-on |

### Not provider signals

- Axis labels and series names
- Post hashtags
- Quote-post author
- Analyst prose in key findings
- Platform domains that are not originator domains
