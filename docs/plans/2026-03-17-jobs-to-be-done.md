# Skygest — Jobs to Be Done

## Context

**Product:** Skygest — AI-managed energy news intelligence
**Target segments:** Energy analysts (utilities, consultancies, government), energy journalists/newsletter writers, energy experts seeking amplification
**Current alternatives:** Manual Bluesky/Twitter scrolling, private expert lists, editorial newsletters (Bloomberg Green, Carbon Brief), nothing (missing the discourse entirely)
**Product model:** Media product (intelligent newsreader), not a dev tool

## Customer Jobs

### Functional Jobs

- **Surface high-signal expert discourse** — stay current on what energy experts are saying about breaking events, policy shifts, and market trends without manually monitoring dozens of feeds
- **Understand why a discussion matters** — see the expert consensus, the disagreement, the engagement signals, and the discussion replies that add nuance — not just the root post
- **Ground narrative in data** — trace expert analysis back to underlying data sources, verify stated numbers, connect charts to the reality they represent
- **Preserve and link discourse over time** — build a living record of how expert understanding evolves, connecting today's analysis to last month's thread on the same topic
- **Extract the citation graph** — by ingesting the experts (who are themselves data refineries), capture both their refined outputs (threads, charts, takes) and their raw inputs (the sources they cite, the data they visualize)

### Social Jobs

- (For experts) Have deep analysis amplified and presented with the depth it deserves, reaching beyond follower counts — validation that this kind of work is valued
- (For analysts/journalists) Be the person who already knows what the experts are saying before it hits mainstream coverage
- (For all) Participate in the real discourse that drives energy decisions, not the simplified media version

### Emotional Jobs

- Feel confident you're not missing the important conversations in energy
- Experience complex topics as engaging and accessible, not overwhelming
- Trust that what you're reading is grounded — opinion connected to data, not opinion alone
- Feel the excitement of engaging deeply with complex topics through a system that deepens understanding over time

## Pains

### Challenges

- Expert discourse is ephemeral — brilliant threads disappear into the timeline within hours
- No way to connect today's expert analysis to prior threads — the throughline is lost
- Charts contain the densest data but have no alt text, no linked sources, no way to verify claims
- The highest-value discussions (10-post data threads with expert replies) look identical to hot takes in a standard feed
- The real intellectual substrate of energy decision-making is invisible unless you know exactly where to look

### Costliness

- Manually monitoring expert feeds across Bluesky takes hours and still misses things
- Contextualizing a breaking story requires cross-referencing multiple experts, data sources, and prior threads — work that currently requires a research team
- Understanding why a discussion is garnering engagement requires reading every reply, not just the root post
- Newsletter curation is one editor's judgment, published on their schedule — not real-time, not verifiable, not interactive

### Unresolved Problems

- No product connects expert social discourse to the underlying data sources experts draw from
- No product tracks how expert narratives evolve over time across multiple threads and events
- No product recognizes that experts are data refineries — their citation patterns reveal which data sources actually matter for understanding energy topics
- Charts are the highest-density signal but are trapped as images with no structured data extraction

## Gains

### Expectations

- Expert threads surfaced by signal quality (7 ranking signals), not chronology — the Blake Shaffer hydro thread should be unmissable
- Charts rendered large with data sources traced and linked
- Discussion replies preserved as first-class content, not buried beneath the root post
- Temporal linking — "Blake Shaffer analyzed BC hydro in March, here's what happened since"
- The citation graph emerges naturally: these are the data sources energy experts actually use

### Savings

- Eliminate the daily scroll through feeds to find signal
- Replace the research-assistant work of cross-referencing claims with data (via agentic integrations: GridStatus, EIA, provincial hydro reports)
- Reduce the editorial labor of contextualizing stories from hours to seconds
- Automate the knowledge work of understanding and validating expert discussions

### Life Improvement

- Complex energy topics become engaging instead of overwhelming
- Confidence that you're tracking the real discourse, not the simplified media version
- Over time, a deepening understanding of how energy narratives evolve — not just snapshots, but the living conversation
- Proof of what matters: the data sources experts themselves ingest and refine become visible, building a knowledge graph of energy intelligence

## The Core Job Statement

> "When an energy news event breaks or an important analysis emerges, I need to quickly understand what the smartest people in energy are saying about it, whether the data supports their claims, and how it connects to the broader narrative — without manually hunting across feeds, newsletters, and data sources."

## The Insight

Experts are human data refineries. They ingest raw data (GridStatus, government reports, company filings, grid data) and output high-signal analysis (threads, charts, arguments). By ingesting the experts, Skygest captures both layers:

1. **The refined output** — their analysis, charts, arguments, expert replies
2. **The raw inputs** — the sources they cite, the data they visualize, the charts they create

Over time, the citation and data graph itself becomes uniquely valuable: "these are the 20 data sources that energy experts actually use to understand hydro markets." This cannot be built top-down — it emerges from tracking what experts actually cite and how they refine it.

## Canonical Example

Blake Shaffer's Canada-US hydro trade thread (`at://did:plc:qadd3esli2op67lh66daubzp/app.bsky.feed.post/3mh7xbwo2422s`) — 10 posts, 10 charts, expert discussion replies, zero alt text, implied data sources (BC Hydro, Manitoba Hydro, Hydro-Quebec). This thread contains an original finding (all 3 hydro provinces net importers for the first time), data that can be verified, and expert replies that add insider nuance. It is the perfect test case for every layer of Skygest.

## Related Documents

- `docs/canonical-threads.md` — 7 golden thread examples
- Linear: Skygest Product Vision & Reference (project document)
- Memory: `project_product_vision.md`, `project_ranking_signals.md`
