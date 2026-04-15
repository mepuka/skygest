# Improving Skygest Data-Reference Resolution

_Event-driven architecture, ontology-aware candidate generation, and TypeScript-friendly implementation guidance for resolving agents, datasets, distributions, variables, and series from enriched social-media charts_

Prepared on April 14, 2026.

## 1. Executive Summary

Skygest already has the correct core runtime seam for this problem: vision -> source attribution -> resolver worker -> Stage 1 -> Resolution Kernel -> stored data-ref-resolution row. The next step should not be another broad resolver rewrite. The next step should be to turn that seam into a versioned, event-driven, dual-track resolver that separately handles provenance resolution and semantic resolution, then joins the results through the data-layer graph and ontology-derived constraints. [I1][I2][I3]

The most important near-term finding is upstream of ranking. The empirical search audit shows that the current checked-in corpus is missing the graph completeness needed for the intended resolver behavior: dataset-to-variable links are absent, variable reverse ancestry is absent, series rows have no URL surface, and several search projections are collapsing in ways that make tuning misleading. Fixing those problems should happen before heavy ranking or reranker tuning. [I4]

This document recommends five architectural moves. First, model resolution as a bundle of linked roles rather than a single winning URI. Second, split candidate generation into two tracks: a provenance track for agent/dataset/distribution and a semantic track for variable/series. Third, make every result versioned against registry, ontology, and resolver versions and add a re-resolution loop when those inputs change. Fourth, push ontology reasoning offline and materialize lightweight closure tables for the hot path. Fifth, finish the editorial projection surface so that the shipped runtime becomes usable in hydrate-story, build-graph, and MCP tools. [I5][I6]

**Decision Summary**

| Decision | Recommendation | Why |
| --- | --- | --- |
| Runtime authority | Keep Stage 1 + Resolution Kernel as the authoritative hot-path contract; treat any future LLM adjudication as optional and asynchronous. | The shipped architecture is already built around stage1 + kernel, and the current gap is quality and freshness, not another runtime stage taxonomy. [I1][I2][I3] |
| Resolution object | Resolve a bundle of roles, not one URI: source agent, source dataset/distribution, semantic variable, semantic series, and optional chart slice. | A single chart often needs both provenance resolution and semantic resolution; collapsing those into one URI loses useful certainty and makes evaluation harder. |
| Primary improvement order | Fix graph completeness before tuning ranking: restore dataset↔variable ancestry, restore series URL/provenance surfaces, and normalize alias coverage. | The empirical audit shows those data-plane gaps are blocking the intended facet and URL behavior today. [I4] |
| Freshness strategy | Make resolution versioned and event-driven: every result must carry registryVersion, ontologyVersion, resolverVersion, and evidence fingerprint. | Without versioning and re-resolution triggers, the system will stay forward-only and silently stale when the registry or ontology improves. [I1][I5] |
| Reasoning strategy | Run ontology reasoning offline and materialize closure tables for the hot path; do not put live SPARQL/OWL inference on the request path. | Skygest already treats the graph as a derived artifact in the triple-store design; that is the right separation of concerns for latency and operational simplicity. [I5] |

## 2. Problem Definition and Success Criteria

Input: a social-media post plus enrichment artifacts. In practice this means post text, outbound links, link-card titles, chart titles, visible URLs, source lines, logo text, organization mentions, axes, units, legend labels, temporal coverage, and thread context.

Desired output: a structured resolution bundle that can resolve the chart at multiple levels of specificity. The ideal case is not just 'this looks like Ember'; it is 'this chart most likely came from this dataset/distribution and depicts this variable/series and chart slice.'

The system should be allowed to succeed partially. A post may cleanly resolve to a source dataset but only weakly to a series. Conversely, a chart may strongly resolve to a variable/series while provenance remains uncertain. Forcing a single monolithic status hides useful certainty.

Success should therefore be measured at each rung of a resolution ladder rather than by one all-or-nothing metric.

**Resolution Ladder**

| Level | Output | Meaning | Default policy |
| --- | --- | --- | --- |
| L1 | Agent / publisher | Best-effort source organization or publisher family | Auto-link if single exact/near-exact candidate and no conflict |
| L2 | Dataset / distribution | Likely source artifact behind the chart | Auto-link if URL/source-line evidence is strong |
| L3 | Variable | The quantity being plotted (generation, price, emissions, share, etc.) | Auto-link if semantic cues and ontology constraints agree |
| L4 | Series | Variable + fixed dimensions such as geography, frequency, market, or sector | Auto-link only with strong dimensional agreement |
| L5 | Chart slice | Series + inferred time window and transform (share, rolling avg, YoY, etc.) | Suggestion/review first; treat as future-grade precision |

## 3. Current-State Diagnosis

The shipped runtime path is already clearer than older architecture sketches: the authoritative runtime result is stage1 + kernel, persisted into post_enrichments(kind=data-ref-resolution). There is no live runtime Stage 2 plus Stage 3 flow in the current branch. That is good news because it gives the system one stable contract to harden. [I1][I2][I3]

The bigger issue is that the data plane does not yet support the intended search semantics. The empirical audit found all 1,790 Dataset rows had NULL across all seven facet columns, all 25 Variable rows had no parent datasets, and all 29 Series rows had zero canonical URLs. In other words, important parts of the resolver's candidate space are structurally unreachable or under-described before ranking even begins. [I4]

There is also a freshness gap. The architecture notes surface an important missing mechanism: there is no first-class re-resolution sweep when the registry grows or when the ontology/search projections change. That means historical posts can remain stale even if the registry gets better. [I1][I5]

Finally, the product surface is still incomplete. The runtime can already write resolver rows, but editors and MCP workflows still need better lookup and projection tools: direct resolve_data_ref lookup, cross-expert join by data reference, story-frontmatter projection, and stale/unresolved warnings in build-graph. [I6]

## 4. Recommended Architecture: Dual-Track, Event-Driven Resolution

The central design change is conceptual. Treat chart resolution as two related but distinct tasks:

Provenance resolution asks: Where did this chart come from? That is usually answered by visible URLs, hostnames, source lines, organization mentions, link cards, and publisher hints. The natural target family is Agent -> Dataset -> Distribution.

Semantic resolution asks: What quantity is being plotted? That is usually answered by chart title, axis labels, units, legend labels, geography, frequency, temporal coverage, and post text. The natural target family is Variable -> Series, optionally joined back to Dataset.

The final link step joins those two candidate sets through the data-layer graph and ontology-derived constraints. This split makes the pipeline more explainable, easier to evaluate, and more resilient when provenance cues are missing but the chart semantics are strong, or vice versa.

Operationally, model the system as event-driven. Enrichment completion should enqueue asset-level resolution work. Registry and ontology version publications should compute impact sets and enqueue re-resolution work. Editorial projection should be downstream of stored resolution bundles rather than piggybacking on the resolution call itself. [E1][E2]

**Core Event Model**

| Event | Producer | Consumer | Purpose |
| --- | --- | --- | --- |
| PostCreated | Ingest workflow | Enrichment workflow | Start vision/source attribution |
| EnrichmentCompleted | Enrichment workflow | Resolver queue | Launch asset-level resolution jobs |
| ResolutionRequested | Queue producer | Resolution workflow | Create a versioned resolution job for one asset |
| ResolutionCompleted | Resolution workflow | D1 + editorial projection queue | Persist bundle, candidates, links, and explanations |
| RegistryVersionPublished | Registry sync pipeline | Impact analyzer workflow | Compute changed block keys and enqueue re-resolution |
| OntologyVersionPublished | Ontology export pipeline | Impact analyzer workflow | Refresh closure tables and enqueue affected posts/assets |
| StoryProjectionRequested | Resolution workflow or build-graph | Editorial projection tool | Refresh frontmatter and stale-state markers |

## 5. Resolution Data Model

Add explicit resolution artifacts instead of relying on one large JSON blob to carry everything. This does not mean abandoning the current stored enrichment. It means normalizing the information you will need for re-resolution, explanations, and review.

At minimum, introduce a canonical EvidenceEnvelope, candidate rows with score breakdowns, a role-based ResolutionBundle, and a versioned RegistryVersion/ImpactSet model. The stored enrichment can still embed the final bundle, but the normalized artifacts make impact analysis and debugging much easier.

**Recommended Artifacts**

| Artifact | Purpose | Key fields |
| --- | --- | --- |
| EvidenceEnvelope | Canonicalized per-asset evidence | postUri, assetKey, normalized title/axes/legend, URLs, org mentions, source lines, units, geography, frequency, time window |
| CandidateHit | One candidate from one lane | entityId, entityType, lane, rank, rawScore, normalizedScore, scoreBreakdown, evidenceRefs |
| ResolutionBundle | Final role-based result | sourceAgent, sourceDataset, sourceDistribution, variable, series, chartSlice, statuses, confidence, explanation |
| RegistryVersion | Versioned source of truth | versionId, publishedAt, changedEntityIds, changedBlockKeys, ontologyVersion |
| ImpactSet | Backfill targeting artifact | versionId, blockKey, affectedPostUris/assetKeys, reason, priority |

## 6. Hot-Path Pipeline Design

Step A: canonicalize evidence. Build one EvidenceEnvelope per chart asset. Normalize URLs, dedupe surface forms, preserve acronyms, normalize units into a known unit family, extract likely geography and frequency, and keep structured provenance about where each field came from. Do not flatten all text into one bag of words.

Step B: provenance candidate generation. Run exact URL, canonical URL, URL prefix, hostname, publisher alias, link-card, source-line, and visible-branding lanes. Return candidate hits only for Agent, Dataset, and Distribution families. Expand exact Distribution hits to parent Dataset and publisher Agent immediately.

Step C: semantic candidate generation. Compile a semantic query from chart title, axis labels, units, legend labels, key findings, source-line dataset names, post text, and thread context. Retrieve Variable and Series candidates using lexical search, semantic search, and ontology-expanded surface forms. Expand strong Variable hits to known Series and vice versa.

Step D: graph join. Join provenance hits and semantic hits across known graph edges such as Agent publishes Dataset, Dataset has Distribution, Dataset has Variable, Series implements Variable, and Series publishedInDataset. Score the pair or bundle, not just the individual hits.

Step E: apply constraints and penalties. Hard-veto obvious contradictions such as a power-series candidate when the chart is clearly a percentage share chart, or an annual series when the chart is daily and the series family never publishes daily data. Use softer penalties for weaker signals like publication date mismatch or imperfect geography overlap.

Step F: decide and persist. Produce a ResolutionBundle with one status per role, a bundle-level confidence, a score breakdown, and an abstain path. Low-confidence ties become Ambiguous or Suggested, not falsely precise links.

Step G: optional adjudication. Only if the bundle remains ambiguous after all structured scoring should you invoke a reranker or review queue. The adjudicator should see a tiny structured top-k, not the open world.

## 7. NLP and Search Recommendations

Build a typed query compiler, not a concatenated query string. Provenance search and semantic search need different analyzers, different fields, and different candidate families. Mixing them too early makes both worse.

Preserve acronym behavior deliberately. The empirical audit already shows tokenizer edge cases like U.S. splitting into single-character tokens. Agent aliases such as EIA, NESO, and CAISO should be preserved as exact surfaces in exact-match and alias indexes even if the full-text analyzer tokenizes them differently. [I4]

Normalize units and transformations. The y-axis unit is one of the strongest semantic filters in chart resolution. Map visible units to a normalized unit family first, then use exact or near-exact matches in scoring and vetoes. Distinguish level, share, rate, cumulative, and transformed values where possible.

Separate index families. Recommended minimum: a provenance index for Agent/Dataset/Distribution, a semantic index for Variable/Series, and a graph adjacency layer for joins. A single blended search table can remain as a fallback, but it should not be the primary ranking surface for all roles.

Fix projection quality before weight tuning. Specifically: restore dataset-variable ancestry, project selected distribution URLs or hostnames onto series or add explicit series-provenance edges, improve title-less distribution fallback labels, and downweight agent ontology text while it remains non-discriminative. [I4]

Use embeddings for recall, not authority. Embeddings are best used to pull in paraphrased candidates that lexical search missed. They should not, on their own, decide the final link.

## 8. Blocking and Candidate Generation

The blocking strategy should be explicit and typed. Each chart asset should emit a set of block keys that are stored alongside the EvidenceEnvelope and reused for re-resolution targeting later.

Block families should be layered. Start with high-precision blocks such as exact URL and strong publisher ID. Then widen with softer blocks such as ontology facets, geography/frequency, lexical title/source retrieval, and finally vector retrieval. Union and dedupe the results, but cap each lane so one noisy signal cannot dominate the candidate set.

A practical candidate budget for an asset is: exact/URL lanes up to 20, publisher lanes up to 50, lexical provenance up to 50, lexical semantic up to 50, vector semantic up to 50, then graph-join expansion capped to a final top 100 bundle candidates before reranking. Adjust upward only if the gold set shows real recall problems.

Hard filters should be used sparingly before top-k. Exact URL, impossible unit-family contradictions, and impossible entity-family mismatches are good hard filters. Geography, frequency, and publication windows are often better as strong penalties until the set is smaller.

**Blocking Families**

| Family | Example keys | Target families | Filter policy |
| --- | --- | --- | --- |
| Exact URL / URL prefix | api.eia.gov/v2/electricity/..., ember-climate.org/insights/... | Distribution, Dataset, Agent | Hard block for exact matches; soft-expansion for prefixes |
| Publisher / organization | Ember, EIA, NESO, Fraunhofer, ROR/Wikidata aliases | Agent, Dataset, Distribution | Hard block only when confidence is high; otherwise soft prior |
| Ontology facets | unitFamily=power, statisticType=share, measuredProperty=generation | Variable, Series, Dataset | Hard veto for obvious contradictions; otherwise boost/penalty |
| Dimensional cues | place=GB, frequency=daily, market=CAISO | Series, Dataset, Distribution | Usually soft filter first, hard filter only after top-k |
| Lexical title/source | chart title, source lines, link-card title, alias text | All families | BM25/typo-tolerant retrieval |
| Semantic embedding | title + axes + legend + key findings | Variable, Series, Dataset | Vector top-k to catch paraphrase and unseen phrasings |
| Historical priors | same expert/account previously linked to Ember GB power datasets | Agent, Dataset | Soft prior only; never override exact evidence |

## 9. Ontology and Reasoning Layer

Use ontology reasoning to improve recall and precision, but keep it off the hot path. The right design is to materialize closure tables and surface-form expansions ahead of time, then let the resolver consume those tables as normal lookup data. [I5]

Recommended precomputed assets include: concept surface forms; broader/narrower/exact/close mapping closure; dataset->variable closure; series->dataset closure; normalized unit-family mapping; and methodology-variant links where you need to distinguish gross/net, market/system, public/net, etc.

Reasoning should mostly do three things for the resolver. First, expand synonyms and close lexical variants for candidate generation. Second, add or subtract confidence based on compatibility constraints. Third, explain why a candidate is compatible or incompatible in human-readable terms.

Use SHACL or equivalent validation offline to catch registry inconsistencies that would otherwise look like resolver failures. If dataset-variable ancestry is broken, or if a series has no parent dataset or provenance path, the validation layer should flag that before the resolver is blamed. [I4][I5]

## 10. Re-Resolution and Freshness

A registry improvement that does not trigger re-resolution is only half an improvement. Introduce a RegistryVersionPublished event every time aliases, URLs, lineage, or ontology-derived surfaces change. Do the same for ontology exports if concept mappings or closure tables change.

The impact analyzer should not blindly replay the whole corpus. It should compute changed block keys and only re-enqueue posts/assets whose stored evidence contains those keys. Example changed keys: a new hostname, a new alias, a new dataset-variable relation, a new concept surface form, or a new series provenance edge.

Every stored resolution bundle should carry: registryVersion, ontologyVersion, resolverVersion, evidenceFingerprint, and resolvedAt. Editorial projection should also carry the resolutionVersion used to hydrate the story. That allows build-graph and MCP tools to say 'this ref is stale relative to the current registry' instead of silently serving old links.

If you later add an optional adjudication stage, keep the stale-state model simple: a bundle is fresh only when all mandatory stages are complete for the latest relevant registry/ontology versions.

## 11. Editorial and MCP Surface

The runtime write path is already shipped; the remaining leverage is in the read surface. Project role-based dataRefs into story frontmatter, not just a flat list of IDs. A chart can legitimately carry one source dataset ref and one semantic series ref at the same time. [I6]

Suggested frontmatter shape: each ref should include role, entityId, confidence, status (resolved/suggested/ambiguous/stale), and resolutionVersion. That gives editors something they can reason over and lets build-graph warn precisely.

MCP tools should expose both direct and reverse paths. Direct path: resolve_data_ref and explain why it was chosen. Reverse path: find_candidates_by_data_ref and show other posts/assets linked to that entity, optionally filtered by role and confidence band. [I6]

Do not hide ambiguity. If two series remain close, show both with explanations. The editorial system should only auto-inline what crossed the chosen confidence threshold.

## 12. Recommended External APIs and Services

The cleanest implementation path is still Cloudflare-native orchestration with a small number of external enrichment dependencies. Workflows are designed for durable multi-step execution with retries and persisted state; Queues add guaranteed-delivery decoupling for backfills and retry spikes. [E1][E2]

For search, the best default external fit is Typesense if you want a low-ops TypeScript-friendly lexical/hybrid engine with typo tolerance and a JavaScript client. OpenSearch is stronger if you need custom analyzers, search pipelines, or deeper explainability at larger scale. Qdrant is a strong vector adjunct but should not replace a real lexical index unless you intentionally go vector-first. [E3][E4][E5]

For identity normalization, use ROR for organizations and Wikidata for cross-identifier expansion. ROR is particularly useful for messy organization strings, and its affiliation matching API is designed for that use case. Wikidata is valuable for alias and sameAs expansion. [E6][E7]

For scholarly metadata, Crossref is a useful optional enrichment layer when posts link to reports, papers, or DOI-bearing artifacts. Its REST API is public, filterable, and exposes useful metadata including ROR IDs and license information in records. [E8]

For embeddings and reranking, the simplest in-platform path is Workers AI plus Vectorize if you want minimal topology spread. Vectorize keeps the vector store next to Workers, and Workers AI currently exposes embedding and reranking-capable models such as bge-m3 and bge-reranker-base. If you prefer external services, Cohere Rerank and OpenAI embeddings are straightforward alternatives. [E9][E10][E11][E12]

**Service Options**

| Role | Default | Alternative(s) | Guidance |
| --- | --- | --- | --- |
| Workflow/eventing | Cloudflare Workflows + Queues | Temporal / custom bus if topology grows beyond Workers | Best fit if Skygest stays Cloudflare-native and wants durable steps plus decoupled retries. [E1][E2] |
| Primary lexical/hybrid retrieval | Typesense | OpenSearch | Typesense is the simpler TypeScript fit; OpenSearch is stronger when you need custom analyzers, query pipelines, and larger-scale tuning. [E3][E4] |
| Vector adjunct | Cloudflare Vectorize or Qdrant | OpenSearch vector / Typesense vector | Vectorize minimizes stack spread on Cloudflare; Qdrant is strong if you want a dedicated vector system with payload filters. [E5][E9] |
| Embeddings | Workers AI bge-m3 | OpenAI embeddings | bge-m3 is attractive if you want multilingual, multi-granularity embeddings in-platform; OpenAI is a straightforward external alternative. [E10][E12] |
| Reranking | Workers AI bge-reranker-base | Cohere Rerank | Keep reranking as a late-stage adjudicator over structured top-k candidates, not an open-world resolver. [E10][E11] |
| Organization normalization | ROR | Wikidata | ROR is a clean agent-normalization layer, especially for messy organization strings; Wikidata is excellent for alias and sameAs expansion. [E6][E7] |
| Scholarly / DOI enrichment | Crossref | DataCite or publisher APIs later | Useful when charts or reports cite papers/DOIs and you want ROR-linked publisher metadata or license signals. [E8] |

## 13. Implementation Roadmap

Do not start with an adjudicator. Start with graph completeness and versioning. Otherwise the system will spend money and complexity compensating for missing edges and stale data.

A realistic order is: repair the registry graph, version the outputs, split candidate generation into provenance and semantic tracks, add graph-join constraints, wire re-resolution, and only then add reranking or manual review for the small ambiguous tail.

**Phased Rollout**

| Phase | Main deliverables | Success gate |
| --- | --- | --- |
| Phase 0: data-plane repairs | Restore dataset↔variable links, series provenance/URLs, friendlier distribution labels, alias normalization, shared agent registry | Audit rerun shows real facet coverage and Series URL recall |
| Phase 1: versioned resolution bundle | Add EvidenceEnvelope, ResolutionBundle, RegistryVersion, ImpactSet, and version stamps to stored outputs | Every row can be traced to registry/ontology/model versions |
| Phase 2: dual-track retrieval | Separate provenance retrieval from semantic retrieval; add blocking families and top-k union/dedupe | Top-k recall improves on gold set without unacceptable candidate explosion |
| Phase 3: graph join + constraints | Join provenance and semantic candidates through registry edges and ontology closure tables | Pairwise precision improves and contradiction rate drops |
| Phase 4: event-driven re-resolution | Publish registry/ontology versions, compute impact sets, and enqueue backfills | Historical posts become fresher when the registry improves |
| Phase 5: editorial projection + review UX | Project role-based dataRefs into story frontmatter; add stale/ambiguous warnings in build-graph and MCP tools | Editors can see what is resolved, what is stale, and what needs review |
| Phase 6: optional adjudication | Add reranker or human-review workflow only for the hardest top-k ties | Quality rises without turning the whole system into an LLM bottleneck |

## 14. Evaluation and Operating Metrics

Evaluate by role, by evidence regime, and by freshness. At minimum track: Agent top-1 accuracy, Dataset/Distribution top-3 recall, Variable top-3 recall, Series top-5 recall, bundle-level precision, abstain rate, and stale-rate after registry changes.

Stratify the gold set. You need separate buckets for: strong provenance with weak semantics; weak provenance with strong semantics; same-publisher hard negatives; same-variable different-series hard negatives; and charts that truly should abstain.

Instrument score breakdowns. For every chosen bundle store the lane hits, normalized scores, compatibility boosts/penalties, and vetoes. That makes regression analysis possible when a change to aliases, ontology closure, or ranking unexpectedly hurts quality.

Keep latency budgets per phase. The hot path should remain mostly deterministic and cheap. If vector retrieval or reranking is added, keep them as bounded top-k steps with separate timeout and fallback behavior.

## 15. Risks and Guardrails

The main technical risk is false precision. A chart can be very easy to classify semantically and still hard to tie to the exact source dataset or series. Preserve partial success and abstain states rather than forcing exactness.

The main product risk is stale confidence. If story files or MCP tools do not surface freshness, editors will treat old links as current truth even after the registry improves.

The main operational risk is duplicate identity systems. Unify the provider registry and the data-layer Agent registry over time so source attribution, resolver candidate generation, and editorial lookup all speak the same publisher identity language.

The main architecture guardrail is to keep reasoning and graph exports as derived artifacts. Materialize what the hot path needs; do not move a full semantic reasoner into the online request path unless there is a very strong reason to do so. [I5]

## Appendix A. Suggested TypeScript Contracts

The following shapes are intentionally minimal. They show the role-based, versioned structure needed to support re-resolution, explanations, and editorial projection.

```ts
type ResolutionRole =
  | "sourceAgent"
  | "sourceDataset"
  | "sourceDistribution"
  | "variable"
  | "series"
  | "chartSlice";
```

```ts
interface EvidenceEnvelope {
  postUri: string;
  assetKey: string;
  postText: string[];
  chartTitle?: string;
  xAxis?: { label?: string; unit?: string; dataType?: string };
  yAxis?: { label?: string; unit?: string; dataType?: string };
  legendLabels: string[];
  visibleUrls: string[];
  organizationMentions: string[];
  sourceLines: { text: string; datasetName?: string }[];
  geographyCodes: string[];
  frequency?: string;
  timeWindow?: { start?: string; end?: string };
  unitFamily?: string;
  resolverVersion: string;
}
```

```ts
interface CandidateHit {
  entityId: string;
  entityType: "Agent" | "Dataset" | "Distribution" | "Variable" | "Series";
  lane:
    | "exact-url"
    | "url-prefix"
    | "publisher"
    | "lexical"
    | "vector"
    | "ontology"
    | "history";
  rank: number;
  rawScore: number;
  normalizedScore: number;
  scoreBreakdown: Record<string, number>;
  evidenceRefs: string[];
}
```

```ts
interface ResolutionLink {
  role: ResolutionRole;
  entityId?: string;
  status: "resolved" | "suggested" | "ambiguous" | "unresolved" | "stale";
  confidence: number;
  explanation: string;
  supportingCandidates: string[];
}
```

```ts
interface ResolutionBundle {
  postUri: string;
  assetKey: string;
  registryVersion: string;
  ontologyVersion: string;
  resolverVersion: string;
  resolvedAt: string;
  links: ResolutionLink[];
  bundleConfidence: number;
  evidenceFingerprint: string;
}
```

```ts
interface RegistryVersionPublished {
  versionId: string;
  publishedAt: string;
  ontologyVersion: string;
  changedEntityIds: string[];
  changedBlockKeys: string[];
}
```

## Appendix B. Source Notes

Internal architecture and product notes used in this document:

### Internal
- **I1** — Skygest System Context (system-context.md, 2026-04-14)
- **I2** — Skygest Seams Inventory (seams.md, 2026-04-14)
- **I3** — Resolution Trace: One Post Through the Shipped Kernel Path (resolution-trace.md, 2026-04-14)
- **I4** — Entity Search Empirical Analysis (entity-search-empirical-analysis.md, 2026-04-14)
- **I5** — Unified Triple-Store Export Design (unified-triple-store-export-design.md, 2026-04-14)
- **I6** — Product Alignment Matrix (product-alignment.md, 2026-04-14)

### External official references reviewed
- **E1** — Cloudflare Workflows docs: durable multi-step workflows with retries and persisted state.
- **E2** — Cloudflare Queues docs: guaranteed-delivery queueing and buffering for asynchronous workers.
- **E3** — Typesense docs: JavaScript client, typo tolerance, and hybrid/vector search support.
- **E4** — OpenSearch docs: JavaScript client and hybrid search/query pipelines.
- **E5** — Qdrant docs: REST/Query API plus payload indexing and filtering for vector search.
- **E6** — ROR docs: JSON REST API plus affiliation matching; client IDs recommended for full rate limits by Q3 2026.
- **E7** — Wikidata Query Service docs: SPARQL endpoint for alias and identifier expansion.
- **E8** — Crossref REST API docs: public JSON API with filters; includes ROR IDs and license metadata in records.
- **E9** — Cloudflare Vectorize docs: Worker-bound vector database; inserts/upserts are asynchronous.
- **E10** — Cloudflare Workers AI docs: bge-m3 embeddings and bge-reranker-base available on the platform.
- **E11** — Cohere docs: Rerank endpoint for ordered relevance scoring over a query and candidate list.
- **E12** — OpenAI docs: Embeddings endpoint for text vector generation.
