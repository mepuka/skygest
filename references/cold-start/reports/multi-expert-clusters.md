# Multi-Expert Cluster Report — SKY-215 Canonical Post Survey

**Date:** 2026-04-08
**Corpus:** 717 classified posts from 76+ experts
**Clusters identified:** 60 (2+ authors citing same data source)
**Clusters with 3+ experts:** 30

## Why multi-expert clusters matter

When multiple independent domain experts reference the same dataset, it signals
editorial consensus about data importance. These clusters are the strongest signal
for what Skygest should prioritize in its data intelligence layer — they represent
the "canonical datasets" that the energy expert community relies on.

---

## Tier 1: Major clusters (9+ experts)

### EIA Today in Energy — 13 experts, 25 posts
**Experts:** kendrawrites.com, 0lsi, robertferry, cityatlas, justinmikulka, seancasten + 7 more
**Pattern:** Experts share EIA daily analysis articles, often adding their own commentary.
Most posts are link-shares with brief editorial framing. Low numeric claim density (5/25)
because TIE articles are narrative, not tabular.
**Cross-expert agreement:** High — experts cite TIE as authoritative. Disagreements are
about policy implications, not data accuracy.
**Join product value:** High — TIE is the most broadly cited single data product.

### RTO Insider — 10 experts, 70 posts
**Experts:** kostyack, terrawatts2010, kensands, simonmahan, yes-energy, cwayner + 4 more
**Pattern:** Grid market news aggregator. Posts are primarily link-shares of RTO Insider
articles. High volume but low numeric claim density (8/70) — most are news commentary.
**Cross-expert agreement:** N/A — RTO Insider is an intermediary. Experts share its
articles but the underlying data comes from FERC, ISOs, and utilities.
**Join product value:** Medium — volume is high but resolution to original data sources
is indirect.

### UNFCCC Climate Negotiations — 9 experts, 14 posts
**Experts:** myzerocarbon.org, wblau, joerirogelj, mollylempriere, adamvaughan,
beyondfossilfuels + 3 more
**Pattern:** Policy and negotiation coverage around COP events. Very low numeric claim
density (1/14) — posts are about process and commitments, not quantitative data.
**Cross-expert agreement:** Mixed — experts have diverse views on negotiation outcomes.
**Join product value:** Low for V/S/O resolution (policy ≠ data), high for editorial curation.

### IEA News & Analysis — 9 experts, 11 posts
**Experts:** ember-energy.org, janrosenow, AukeHoekstra, DrSimEvans + 5 more
**Pattern:** IEA report releases and analysis pieces. Moderate numeric claim density.
Experts often cite IEA data to support or challenge policy positions.
**Cross-expert agreement:** Generally high on data; disagreements on interpretation.
**Join product value:** High — IEA is the global energy data authority.

### EIA Electricity Data — 9 experts, 11 posts
**Experts:** Broad mix of US-focused energy analysts
**Pattern:** Direct references to EIA electricity generation, capacity, and consumption
data. Higher numeric claim density than TIE — posts cite specific MW/GWh figures.
**Cross-expert agreement:** High — EIA data is treated as ground truth for US markets.
**Join product value:** Very high — directly resolvable to V/S/O with specific metrics.

---

## Tier 2: Significant clusters (5–8 experts)

### Ember (misc) — 7 experts, 9 posts
Ember's general analysis output — not tied to a single report. Experts cite Ember
for European and global electricity data. Several Ember staff are among the tracked experts.

### IEA Demand — 7 experts, 7 posts
Electricity demand analysis and projections. Experts reference IEA demand forecasts
in the context of data center growth, electrification, and grid planning.

### Ember (global) — 6 experts, 6 posts
Global electricity analysis — non-European scope. Generation mix, clean energy share.

### Climate Action Tracker — 5 experts, 7 posts
Country-level climate policy assessments. Low numeric density but high editorial value
for understanding expert views on national climate action.

### EIA Generation US — 5 experts, 6 posts
US electricity generation by source — core V/S/O resolvable cluster with specific
GWh and percentage claims.

### IEA Forecast — 5 experts, 6 posts
Forward-looking IEA projections. Highlights the forecast vs. historical gap (see schema-gaps.md).

### NREL — 5 experts, 5 posts
Technology cost and resource potential research. ATB (Annual Technology Baseline)
is the primary data product referenced.

### BNEF Energy Transition Investment — 5 experts, 5 posts
Annual ETI report — global investment flows into clean energy. High numeric density,
all posts cite specific $B figures. Strong V/S/O resolution potential.

---

## Tier 3: Notable clusters (3–4 experts)

| Cluster | Experts | Posts | Notes |
|---------|---------|-------|-------|
| Energy Storage News (industry) | 4 | 72 | High volume intermediary; storage sector |
| Ember Data Explorer | 4 | 6 | Interactive data tool — country-level electricity |
| Ember European Electricity Review | 4 | 5 | Annual flagship — strong V/S/O |
| S&P Global Market Intelligence | 3 | 43 | High volume intermediary; market/pricing |
| IEA Data Portal | 3 | 4 | Direct data access — high resolution potential |
| BNEF (misc) | 3 | 4 | Mixed BNEF analysis |
| EIA Demand | 3 | 3 | US electricity demand |
| ENTSO-E Iberian Blackout | 3 | 3 | Event-specific — milestone cluster |
| ERCOT Demand US-TX | 3 | 3 | Texas grid demand |
| ERCOT (misc) US-TX | 3 | 3 | Texas grid general |
| FERC Demand | 3 | 3 | FERC load/demand data |
| IEA Generation Global | 3 | 3 | Global generation stats |
| FERC Regulatory Orders | 3 | 3 | Regulatory actions |
| EIA STEO | 3 | 3 | Short-term energy outlook |
| EIA International | 3 | 3 | International energy data |

---

## Intermediary analysis

Four intermediaries dominate the raw post counts but are not original data publishers:

| Intermediary | Posts | Experts | Primary sources cited |
|-------------|-------|---------|----------------------|
| RTO Insider | 70 | 10 | FERC, ERCOT, PJM, CAISO, SPP |
| Energy Storage News | 72 | 4 | Ember, BNEF, various national agencies |
| S&P Global | 43 | 3 | CAISO, EIA, FERC, international |
| Enerdata | 145* | N/A | IEA, IRENA, national agencies |

*Enerdata count is from full 717-post corpus; not all posts were in multi-expert clusters.

**Key insight:** Intermediary volume inflates post counts but deflates resolution
quality. A single RTO Insider article may aggregate 3–4 original data sources.
The Candidate resolution correctly maps through intermediaries to original publishers.

---

## Cross-expert join product value

The highest-value clusters for the data intelligence layer are those where:
1. Multiple experts independently cite the same dataset
2. Posts contain numeric claims resolvable to V/S/O
3. The original data source has a stable, accessible distribution

**Top 5 clusters by join product value:**

1. **EIA Electricity Data** (9 experts) — highest resolution density
2. **EIA Today in Energy** (13 experts) — broadest expert coverage
3. **BNEF Energy Transition Investment** (5 experts) — all posts have specific $B claims
4. **Ember European Electricity Review** (4 experts) — annual flagship with full V/S/O
5. **IEA News & Analysis** (9 experts) — global authority, good numeric density
