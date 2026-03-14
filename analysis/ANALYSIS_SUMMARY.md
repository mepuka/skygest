# Skygest Data Analysis Summary

**Generated:** 2026-02-03
**Data Source:** Skygest D1 Database + Skygent Network Analysis

## Data Overview

### Original Posts Dataset (D1 Export)
- **Total Posts:** 48,434
- **Unique Authors:** 14,381
- **Date Range:** September 2024 - February 2026
- **Export File:** `skygest-data.sql`

### Enriched Network Dataset (Skygent)
- **Total Posts:** 231,680
- **Total Authors:** 1,585
- **Store Name:** `skygest-papers`
- **Data Size:** ~1.8 GB

## Content Analysis

### Source Type Breakdown (from URL Classification)

| Category | Percentage | Description |
|----------|------------|-------------|
| Preprint | 47.5% | arXiv, bioRxiv, medRxiv, SSRN |
| Other | 33.0% | Unclassified URLs |
| Publisher | 5.8% | Elsevier, Springer, Wiley, etc. |
| DOI | 5.6% | Generic DOI links |
| High-Impact | 5.4% | Nature, Science, Cell, Lancet |
| Code/Data | 1.5% | GitHub, HuggingFace |
| PubMed | 1.2% | NCBI/PubMed links |

### Unique Paper IDs
- **arXiv Papers:** 47,000+ unique IDs
- **DOIs:** 8,000+ unique DOIs

### Top Keywords (from post content)
| Keyword | Count |
|---------|-------|
| arxiv | 57,741 |
| doi | 18,732 |
| paper | 3,351 |
| ai | 3,168 |
| study | 2,523 |
| research | 2,211 |
| data | 2,031 |
| model | 1,476 |
| health | 1,301 |
| climate | 633 |

### arXiv Field Distribution
| Field | Count |
|-------|-------|
| Computer Science | ~15,000 |
| Physics | ~3,000 |
| Mathematics | ~2,000 |
| Statistics | ~1,500 |
| Biology (q-bio) | ~500 |

## Network Analysis Results

### PageRank Centrality (Top 10)

| Rank | Handle | Score |
|------|--------|-------|
| 1 | dolcevida1.bsky.social | 0.0084 |
| 2 | atrupar.com | 0.0067 |
| 3 | meidastouch.com | 0.0049 |
| 4 | labwaggoner.bsky.social | 0.0043 |
| 5 | acyn.bsky.social | 0.0039 |
| 6 | statuscoupnews.bsky.social | 0.0025 |
| 7 | (unknown) | 0.0024 |
| 8 | noturtlesoup17.bsky.social | 0.0019 |
| 9 | ronfilipkowski.bsky.social | 0.0017 |
| 10 | whstancil.bsky.social | 0.0017 |

**Key Insight:** The network shows significant crossover between academic paper sharing and political/news commentary communities. High PageRank accounts are mostly political commentators who engage with shared academic content.

### Academic-Specific Influencers (from PageRank)
| Rank | Handle | Type |
|------|--------|------|
| 30 | bigearthdata.ai | Data Science |
| 31 | science.org | Journal |
| 50 | ai-firehose.column.social | Aggregator |
| 62 | carolynbertozzi.bsky.social | Scientist |
| 78 | justinwolfers.bsky.social | Economist |

### Community Detection

| Community Type | Size | Examples |
|----------------|------|----------|
| General (largest) | 1,616 | Mixed academic/general |
| Political/News | 1,438 | maxberger, prognews, govwesmoore |
| arXiv Bots | 144 | csmm-bot, csne-bot, mathlo-bot |
| Small Topic Clusters | 2-10 | Various specialized groups |
| Solo Bots | 1 | astroarxiv, phypapers, etc. |

## Output Files

### Data Files (analysis/output/)
| File | Size | Description |
|------|------|-------------|
| `skygest-data.sql` | 31 MB | Original D1 database export |
| `d3_network.json` | 246 KB | D3-ready network (637 nodes, 800 edges) |
| `interactions_full.json` | 123 KB | Full network interactions |
| `communities.json` | 196 KB | Full community assignments |
| `centrality.json` | 11 KB | PageRank scores for top 100 |
| `analysis.json` | 29 KB | Basic post analysis |
| `posts_over_time.json` | 16 KB | Daily post counts |
| `source_breakdown.json` | 2.8 KB | Source type classification |
| `keywords.json` | 1.8 KB | Keyword frequencies |
| `top_authors.json` | 1.5 KB | Most prolific posters |
| `domains.json` | 1.7 KB | Domain frequencies |
| `network_stats.json` | 974 B | Network summary statistics |
| `summary.json` | 195 B | Basic summary |

### Skygent Store
```
Location: ~/.skygent/stores/skygest-papers/
Posts: 231,680
Authors: 1,585
```

## Analysis Scripts

| Script | Purpose |
|--------|---------|
| `explore.py` | Basic link type breakdown |
| `deep_explore.py` | Detailed URL classification |
| `analyze.py` | General statistics and trends |

## D3 Visualization Data

The following JSON files are ready for D3 visualization:

1. **`interactions.json`** - Network graph format
   - `nodes[]` with `id` and `label` (handle)
   - `edges[]` with `from`, `to`, `type` (repost/quote), `weight`
   - Suitable for force-directed graph

2. **`centrality.json`** - Node importance
   - PageRank scores for bubble charts or node sizing

3. **`communities.json`** - Group assignments
   - Community clustering for graph coloring

4. **`posts_over_time.json`** - Time series
   - Daily counts for line charts

## Next Steps for D3 Visualizations

1. **Force-Directed Network Graph**
   - Nodes sized by PageRank
   - Colored by community
   - Edge thickness by interaction weight

2. **Treemap of Source Types**
   - Hierarchical: Category > Source > Count
   - Shows preprint dominance

3. **Time Series Chart**
   - Posts over time
   - Optional: stacked by source type

4. **Bubble Chart of Authors**
   - Size = post count
   - Color = primary source type
   - Position = community clustering

## Key Findings

1. **Preprint Dominance:** Nearly half of all shared papers are preprints (mostly arXiv)

2. **CS/AI Focus:** Computer Science, especially AI/ML, dominates arXiv shares

3. **Cross-Community Engagement:** Academic paper sharing intersects heavily with political/news commentary, suggesting papers related to climate, health policy, and economics get amplified through non-academic channels

4. **Bot Ecosystem:** Numerous specialized arXiv category bots exist (arxiv-cs-ai, arxiv-cs-cl, etc.) forming their own small communities

5. **Key Aggregators:** ai-firehose.column.social acts as a major hub for AI paper reposts
