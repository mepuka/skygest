# Skygest Data - Exploratory Data Analysis Report

**Generated:** 2026-02-04
**Data Source:** Skygest D1 Database + Skygent Network Analysis
**Analyst:** Claude Code (AI Agent)

---

## Executive Summary

This report analyzes the Skygest academic paper feed data, covering **48,434 posts** from **14,381 unique authors** sharing scientific papers on Bluesky. The data reveals a vibrant ecosystem of paper-sharing bots, academic researchers, and science communicators, with notable crossover into political/news commentary communities.

### Key Findings

| Metric | Value |
|--------|-------|
| Total Posts | 48,434 |
| Unique Authors | 14,381 |
| Posts per Author | 3.4 avg |
| Total URLs | 105,390 |
| Preprint % | 61.1% |
| Network Nodes | 637 |
| Communities | 43 |

---

## 1. Dataset Overview

### Post Statistics
- **Total Posts:** 48,434
- **Unique Authors:** 14,381
- **Average Posts/Author:** 3.4
- **Time Range:** 2026-01-21 to 2026-02-02 (12 days)

### Data Quality
- ✓ No temporal gaps detected
- ✓ Consistent posting activity
- ✓ Good source diversity
- ⚠ High arXiv concentration (52.9%)

---

## 2. Temporal Distribution

| Metric | Value |
|--------|-------|
| Hours Covered | 269 |
| Avg Posts/Hour | 180.1 |
| Peak Hour | 2026-01-30 06:00 (1,400 posts) |
| Lowest Hour | 2026-02-01 17:00 (14 posts) |
| Std Dev | 178.1 |
| Median | 153 |

### Observations
- High variability in posting (std dev nearly equals mean)
- Clear diurnal patterns likely present
- Weekend vs weekday differences worth investigating

---

## 3. Source Type Distribution

### By Category

| Category | Count | Percentage |
|----------|-------|------------|
| Preprint | 64,413 | 61.1% |
| Other | 20,374 | 19.3% |
| Publisher | 6,137 | 5.8% |
| DOI (unclassified) | 5,874 | 5.6% |
| High-Impact Journal | 5,686 | 5.4% |
| PubMed | 2,761 | 2.6% |
| Code/Data | 145 | 0.1% |

### Top 10 Sources

| Rank | Source | Count | % | Category |
|------|--------|-------|---|----------|
| 1 | arXiv | 55,724 | 52.9% | Preprint |
| 2 | other | 20,374 | 19.3% | Other |
| 3 | bioRxiv | 7,135 | 6.8% | Preprint |
| 4 | DOI | 5,874 | 5.6% | DOI |
| 5 | Nature | 3,911 | 3.7% | High-Impact |
| 6 | PubMed | 2,761 | 2.6% | PubMed |
| 7 | Elsevier | 1,451 | 1.4% | Publisher |
| 8 | Wiley | 1,269 | 1.2% | Publisher |
| 9 | Springer | 941 | 0.9% | Publisher |
| 10 | medRxiv | 887 | 0.8% | Preprint |

### Key Insight
**Preprints dominate** (61%), with arXiv alone accounting for over half of all shared papers. This reflects the rapid, open-access nature of academic Twitter/Bluesky culture.

---

## 4. Keyword Analysis

### Top Keywords by Category

**📚 Academic Terms:**
| Keyword | Count |
|---------|-------|
| arxiv | 57,741 |
| doi | 18,732 |
| paper | 3,351 |
| study | 2,523 |
| research | 2,211 |
| journal | 1,731 |
| published | 1,243 |
| preprint | 363 |
| peer review | 124 |

**🤖 AI/ML Terms:**
| Keyword | Count |
|---------|-------|
| ai | 3,168 |
| neural | 503 |
| llm | 485 |
| machine learning | 325 |
| deep learning | 312 |
| transformer | 148 |
| gpt | 32 |
| nlp | 24 |

**🔬 Science Terms:**
| Keyword | Count |
|---------|-------|
| health | 1,301 |
| climate | 633 |
| protein | 561 |
| medical | 346 |
| chemistry | 283 |
| physics | 240 |
| biology | 172 |
| neuroscience | 102 |

### Observation
Strong AI/ML presence confirms this is a tech-forward academic community, with significant life science and climate science representation.

---

## 5. Network Structure

### Basic Metrics

| Metric | Value |
|--------|-------|
| Nodes | 637 |
| Edges | 800 |
| Edge Density | 0.39% |
| Average Degree | 2.51 |

### Edge Types (Interactions)

| Type | Count | Percentage |
|------|-------|------------|
| Repost | 406 | 50.7% |
| Mention | 365 | 45.6% |
| Quote | 28 | 3.5% |
| Reply | 1 | 0.1% |

### Community Structure

| Metric | Value |
|--------|-------|
| Total Communities | 43 |
| Largest Community | 1,616 members |
| Multi-member Communities | 18 |
| Singleton Communities | 25 (bots) |

### Key Insight
The network is **sparse** (0.39% density) with **two dominant interaction modes**: reposts (amplification) and mentions (attribution). Direct replies are rare, suggesting paper sharing is more broadcast than conversation.

---

## 6. Top Accounts by PageRank

### Most Influential (Network Centrality)

| Rank | Handle | PageRank | Type |
|------|--------|----------|------|
| 1 | dolcevida1.bsky.social | 0.0084 | Political |
| 2 | atrupar.com | 0.0067 | News |
| 3 | meidastouch.com | 0.0049 | Political |
| 4 | labwaggoner.bsky.social | 0.0043 | Academic |
| 5 | acyn.bsky.social | 0.0039 | News |
| 31 | science.org | 0.0009 | Journal |
| 30 | bigearthdata.ai | 0.0010 | Academic |
| 50 | ai-firehose.column.social | 0.0006 | Aggregator |

### Network Character
- **Political/News dominance:** Top PageRank accounts are primarily political commentators
- **Academic accounts cluster separately:** Lower PageRank but high within-community influence
- **Cross-community bridging:** Papers on climate, health policy, economics reach political audiences

---

## 7. Key Accounts Summary

### Top Paper Bots (by post volume)

| Bot | Posts | Category |
|-----|-------|----------|
| biorxivpreprint.bsky.social | 1,486 | bioRxiv |
| astroarxiv.bsky.social | 791 | Astronomy |
| cslg-bot.bsky.social | 742 | CS/Language |
| arxiv-cs-cv.bsky.social | 564 | Computer Vision |
| arxiv-cs-cl.bsky.social | 394 | Comp. Linguistics |

### Key Aggregators

| Handle | PageRank | Role |
|--------|----------|------|
| bigearthdata.ai | 0.000950 | Climate/Earth Data |
| science.org | 0.000936 | Science Journal |
| aai.org | 0.000728 | AI Association |
| ai-firehose.column.social | 0.000561 | AI Aggregator |

### Bot Community
- **144 specialized arXiv category bots**
- Cover: cs.ai, cs.cl, cs.cv, hep-th, astro-ph, math, stat, etc.
- Form their own tight community with minimal outside interaction

---

## 8. Data Quality Assessment

| Check | Status | Details |
|-------|--------|---------|
| Temporal Coverage | ✓ | 269 hours, no gaps |
| Source Diversity | ⚠ | arXiv 52.9% (high concentration) |
| Network Size | ✓ | 637 nodes (sufficient for analysis) |
| Community Detection | ✓ | 43 communities found |
| Missing Data | ✓ | No null values in key fields |

---

## 9. Recommendations

### For Visualization (D3.js)

1. **Force-Directed Network Graph**
   - File: `d3_network.json` (252 KB)
   - Nodes sized by PageRank
   - Colored by community
   - Edge thickness by interaction count

2. **Source Treemap/Sunburst**
   - File: `source_breakdown.json`
   - Hierarchy: Category → Source → Count

3. **Time Series Area Chart**
   - File: `posts_over_time.json`
   - Stacked by source type (optional)

4. **Author Bubble Chart**
   - File: `centrality.json`
   - Size = PageRank, Color = community

### For Further Analysis

1. **Bot vs Human Classification**
   - High bot activity detected
   - Classify by posting frequency, handle patterns

2. **Topic Modeling**
   - Cluster posts by content
   - Identify trending research areas

3. **Temporal Patterns**
   - Day-of-week effects
   - Time-of-day patterns
   - Event correlation (conference dates, paper deadlines)

4. **Cross-Community Influence**
   - Which papers bridge academic ↔ political communities?
   - What topics get amplified beyond academia?

---

## 10. Files Reference

| File | Size | Contents |
|------|------|----------|
| d3_network.json | 252 KB | D3-ready network graph |
| centrality.json | 11 KB | PageRank scores |
| communities.json | 201 KB | Community assignments |
| source_breakdown.json | 3 KB | Source classification |
| posts_over_time.json | 16 KB | Temporal distribution |
| keywords.json | 2 KB | Keyword frequencies |
| key_accounts.json | 2 KB | Notable accounts |
| network_stats.json | 1 KB | Network summary |

---

## Appendix: Stores Available

### skygest-papers
- **Posts:** 231,680
- **Authors:** 1,585
- **Date Range:** Sept 2024 - Feb 2026

### skygest-scientists
- **Posts:** 74,186
- **Authors:** 7,461
- **Date Range:** Apr 2014 - Feb 2026
- **Focus:** 37 curated scientist accounts + network

---

*Report generated by Claude Code using the Exploratory Data Analysis skill*
