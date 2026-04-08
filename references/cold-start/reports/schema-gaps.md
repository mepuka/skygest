# Schema-Gap Report — SKY-215 Canonical Post Survey

**Date:** 2026-04-08
**Corpus:** 717 classified posts, 289 resolved through V/S/O seam
**Resolution breakdown:** 59 resolved, 227 partially resolved, 3 source only

## Gap 1: Multi-value Candidates

**Problem:** A single post often asserts multiple data points. Example: "EIA reports
solar up 24% while coal dropped 18% in 2025." The current Candidate schema supports
one `assertedValue` / `assertedUnit` pair per record.

**Impact:** 280 posts have numeric claims; many contain 2–3 claims. We lose secondary
assertions unless we create multiple Candidates per post.

**Recommendation:** Allow multiple Candidates per sourceRef (already structurally
possible — just document the 1:N convention). No schema change needed.

## Gap 2: Derived shares vs. raw stocks

**Problem:** "Clean electricity share" is a derived metric (clean generation / total
generation). The Variable schema treats it as a first-class variable with
`statisticType: "share"`, but there's no formal link to the underlying stock/flow
variables it derives from.

**Impact:** 10+ posts reference share metrics. Without derivation tracking, we can't
validate that a claimed "62% clean share" is consistent with the generation data.

**Recommendation:** Add an optional `derivedFrom: VariableId[]` field to Variable in
Phase 1. Low urgency — doesn't block cold-start ingestion.

## Gap 3: Intermediary vs. original source attribution

**Problem:** 33 Enerdata posts, 21 Energy Storage News posts, 13 RTO Insider posts,
and 11 S&P Global posts reference data that originates from EIA, IEA, Ember, or ISOs.
The Candidate must decide whether `referencedAgentId` points to the intermediary
(Enerdata) or the original publisher (IEA).

**Impact:** 78 posts (27% of corpus) come through intermediaries. Current resolution
maps to original publishers, but the intermediary access path is lost.

**Recommendation:** The Distribution already has an `accessURL` field. For intermediary
cases, create a Distribution with `kind: "landing-page"` pointing to the intermediary
article. The `referencedAgentId` stays with the original publisher. This pattern works
but should be documented as a convention.

## Gap 4: Retail vs. wholesale electricity price

**Problem:** The Variable "wholesale electricity price" covers day-ahead/spot markets.
Some posts reference retail electricity rates (e.g., "California residential rates hit
$0.30/kWh"). These are fundamentally different variables.

**Impact:** 5–8 posts in the CAISO and PJM clusters reference retail pricing.

**Recommendation:** Add a "retail electricity price" Variable in Phase 1. The seven-facet
schema handles this cleanly — it's just a new Variable with different `domainObject`.

## Gap 5: Cross-source methodology differences

**Problem:** BNEF and IEA both report "energy transition investment" but with different
definitions. BNEF includes EVs and heat pumps; IEA's "clean energy investment" focuses
on supply-side. The Variable schema doesn't capture methodology provenance.

**Impact:** 5 BNEF ETI posts vs. 3+ IEA WEI posts — experts cite both as if comparable.

**Recommendation:** Use separate Variables ("energy transition investment" vs. "clean
energy investment") and document methodology differences in the `definition` field.
Already implemented in this survey. The `methodologyVariant` AliasRelation handles
cross-variable linking.

## Gap 6: Forecast vs. historical distinction

**Problem:** Some posts reference projections ("EIA projects 40% renewables by 2030")
while others reference historical data ("2025 generation was..."). The Candidate schema
has no formal flag distinguishing forecast from observed data.

**Impact:** ~30 posts reference forecasts or projections (AEO, STEO, BNEF outlooks).

**Recommendation:** Add `extra: { type: "forecast" }` to FixedDims for Series that
represent projections. Already partially implemented in this survey. A more formal
`temporalCoverage: "forecast" | "historical"` field on Series would be cleaner for
Phase 1.

## Gap 7: Grid operational milestones vs. statistical data

**Problem:** "ERCOT solar hit 24 GW record" is a milestone event, not a dataset release.
The Candidate schema treats all data references uniformly, but milestones have different
provenance (press releases, grid operator tweets) than statistical publications.

**Impact:** 6 ERCOT solar posts, 3 CAISO battery posts, 2 CAISO 100% WWS posts are
milestones.

**Recommendation:** Add `candidateKind: "milestone" | "statistic" | "commentary"` to
Candidate in Phase 1. For now, milestones are marked `partially_resolved` since they
reference a real dataset but the "observation" is an operational event.

## Gap 8: RTO-as-publisher vs. RTO-as-data-subject

**Problem:** ERCOT publishes data about the ERCOT grid. The Agent record represents
ERCOT-the-organization, but the Series `fixedDims.market: "ERCOT"` represents
ERCOT-the-grid-region. These are conceptually different.

**Impact:** All 13 ERCOT posts, 11 CAISO posts, 4 PJM posts, 4 SPP posts. The
conflation is manageable but imprecise.

**Recommendation:** No schema change needed. Document the convention: Agent = the
publishing organization; `fixedDims.market` = the grid region. They happen to share
names for ISOs but are semantically distinct.

## Summary

| Gap | Severity | Phase 1 Action |
|-----|----------|----------------|
| Multi-value Candidates | Low | Document 1:N convention |
| Derived shares | Medium | Add `derivedFrom` to Variable |
| Intermediary attribution | Medium | Document Distribution convention |
| Retail vs. wholesale price | Low | Add Variable |
| Methodology differences | Low | Already handled via separate Variables |
| Forecast vs. historical | Medium | Add `temporalCoverage` to Series |
| Milestones vs. statistics | Medium | Add `candidateKind` to Candidate |
| RTO dual role | Low | Document convention |
