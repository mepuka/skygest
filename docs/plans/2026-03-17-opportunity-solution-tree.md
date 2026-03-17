# Skygest — Opportunity Solution Tree

## Desired Outcome

**Build an MCP that enables AI agents to deeply understand, contextualize, and curate expert energy discourse.**

The MCP is the foundation. The reader UI, newsletter experience, and editorial tools are consumption layers on top. If the MCP is excellent, the rest follows.

## Opportunity Map

### Opportunity 1: Discourse structure is flattened

**Problem:** The MCP returns posts but doesn't represent threads as coherent arguments. A 10-post thread with a narrative arc reads like 10 disconnected posts. An agent can't distinguish a deep data thread from a one-off take.

**Evidence:** Blake Shaffer's 10-chart hydro thread is the canonical example — it tells a structured story (overview → historical trend → paradox → province deep-dives → conclusion) but the MCP presents it as a flat list.

**Solutions:**

1. **Thread-as-document model** — Represent threads as a single structured document: ordered posts with position markers, author's narrative arc preserved, discussion replies as a distinct section. An agent receives one coherent "article."
2. **Signal metadata on threads** — Enrich threads with computed metadata: depth, engagement totals, discussion reply count, expert tier of participants, topic density. An agent filters and ranks without reading every post.
3. **Temporal thread linking** — Link threads on the same topic by the same expert across time. An agent gets narrative continuity: "Blake Shaffer on hydro: March 2026, January 2026, September 2025."

### Opportunity 2: Charts and media are opaque

**Problem:** The MCP surfaces image URLs but an agent can't read charts, extract data points, or understand what a visualization represents. The highest-density signal is locked behind pixels. Most expert charts have no alt text.

**Evidence:** All 10 of Blake Shaffer's hydro charts have empty alt text. Ketan Joshi's data centre post has excellent alt text (full transcript). The gap between experts who write alt text and those who don't is exactly where automated analysis fills in.

**Solutions:**

1. **Vision-extracted chart summaries** — Run multimodal LLM (Gemini 2.5 Flash) on chart images to produce structured descriptions: chart type, axes, key data points, trends. Store as metadata.
2. **Source attribution on charts** — Trace chart images back to probable data sources based on expert, topic, and cited links. Build a registry of known energy data sources. Match charts to sources.
3. **Alt text gap-filling** — For charts with no alt text, generate synthetic alt text via vision and surface through the MCP. An agent gets what a good alt text author would have written.

### Opportunity 3: Expert claims are ungrounded (future)

**Problem:** An agent reads "BC imported 10 TWh at C$46/MWh" but has no way to verify, contextualize, or enrich that claim with live data.

**Evidence:** The JTBD identified grounding as a core job. The sources exist (GridStatus, EIA, provincial hydro reports) but aren't connected.

**Solutions:**

1. **Data source registry + API integration** — Build integrations with GridStatus, EIA, ENTSO-E. When a thread references grid data, the MCP can cross-reference.
2. **Claim extraction pipeline** — Extract quantitative claims from thread text ("10 TWh", "$1B revenue", "41% drop") and tag them for verification.
3. **Expert citation graph** — Track what sources each expert cites over time. The graph reveals which data sources matter for each topic.

## Selected POCs

All three are pipeline/workflow problems that map to Cloudflare's event-driven infrastructure (Workflows, DOs, Queues).

### POC 1: Thread-as-document model

**Feasibility:** 4/5 — thread depth, engagement sorting, embed content already built today
**Impact:** 5/5 — transforms how agents consume threads
**Market Fit:** 5/5 — directly addresses the core JTBD

**Hypothesis:** If we reshape the MCP thread response into a structured document (ordered posts, narrative position, separated discussion), agents will produce significantly better energy analysis summaries.

**Experiment:** Restructure `get_post_thread` response. Test by asking Claude to summarize the Blake Shaffer hydro thread with old format vs new format. Compare quality.

### POC 2: Source attribution + alt text gap-filling

**Feasibility:** 4/5 — event-driven pipeline: post ingested → image detected → vision workflow → store result. Gemini 2.5 Flash handles chart analysis well.
**Impact:** 5/5 — unlocks the highest-density signal in the system
**Market Fit:** 5/5 — no one else does this

**Hypothesis:** If we extract chart descriptions and source attributions via vision and store them as structured metadata, agents will be able to reason about chart data without vision capabilities themselves.

**Experiment:** Build a Cloudflare Workflow that processes image embeds through Gemini 2.5 Flash. Run on the 7 canonical threads. Evaluate quality of extracted descriptions and source attributions.

### POC 3: Data source registry (next after POC 1+2)

**Feasibility:** 3/5 — requires building API integrations with external providers
**Impact:** 5/5 — the core differentiator from the positioning statement
**Market Fit:** 5/5 — directly addresses "ground narrative in data"

**Hypothesis:** If we connect expert citations to live data APIs, agents can verify claims and enrich threads with current data.

**Experiment:** Start with GridStatus API. When a thread mentions grid data (ERCOT, CAISO), fetch current data and include in MCP response. Test with 5 threads.

## Implementation Order

Already in place:

- thread/document-aware MCP responses
- embed-content surfacing for live media analysis
- manual editorial picks and curated-feed infrastructure

Execution order for the Expert News Feed milestone:

1. **Unified runtime schema target** — finish ontology convergence for `energy-news` + `energy-media` (`SKY-19`, `SKY-24`)
2. **Candidate scoring + pick workflow** — deterministic candidate set and operator pick action (`SKY-20`)
3. **Candidate payload storage** — lightweight persistence for candidate/picked posts only; no binary media (`SKY-23`)
4. **Pick-driven enrichment primitives** — workflow state, retries, provenance, idempotent execution (`SKY-21`)
5. **Vision enrichment** — chart analysis, alt-text gap filling, source attribution for picked posts (`SKY-16`)
6. **Provider registry** — normalized source catalog and attribution matching (`SKY-17`)
7. **Live grounding adapters** — GridStatus first, then additional external data providers (`SKY-10`)
8. **Temporal linking and claim extraction** — later

## Related

- `docs/plans/2026-03-17-jobs-to-be-done.md`
- `docs/plans/2026-03-17-positioning-statement.md`
- `docs/plans/2026-03-17-expert-news-feed-execution-plan.md`
- `docs/canonical-threads.md`
