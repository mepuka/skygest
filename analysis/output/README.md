# Skygest Analysis Output

Generated: 2026-02-04

## Directory Structure

```
output/
├── data/           # Core analysis data
├── network/        # Network analysis (D3-ready)
├── accounts/       # Account lists and classifications
└── reports/        # EDA reports and summaries
```

## Files by Directory

### data/
| File | Description |
|------|-------------|
| summary.json | Basic post/author counts |
| posts_over_time.json | Hourly post counts |
| source_breakdown.json | URL source classification |
| keywords.json | Keyword frequencies |
| domains.json | Domain frequencies |
| post_lengths.json | Character length distribution |
| analysis.json | Combined analysis results |

### network/
| File | Description |
|------|-------------|
| d3_network.json | D3-ready force graph (637 nodes, 800 edges) |
| centrality.json | PageRank scores for top 100 accounts |
| communities.json | Community detection results (43 communities) |
| interactions_full.json | Full interaction graph |
| network_stats.json | Network summary statistics |

### accounts/
| File | Description |
|------|-------------|
| key_accounts.json | Notable bots and aggregators |
| top_authors.json | Most prolific posters |
| top_sharers.json | Top paper sharers by type |
| scientists.json | Curated scientist accounts (37) |
| scientists_clean.txt | Clean list for skygent import |

### reports/
| File | Description |
|------|-------------|
| skygest_eda_report.md | Full EDA report (markdown) |
| eda_summary.json | Structured EDA summary |
| quick_stats.json | Quick reference statistics |

## Data Sources

1. **skygest-data.sql** - D1 database export (48,434 posts)
2. **skygest-papers** store - Skygent (231,680 posts)
3. **skygest-scientists** store - Skygent (74,186 posts)

## Key Metrics

- Total Posts: 48,434
- Unique Authors: 14,381
- Total URLs: 105,390
- Preprint %: 61.1%
- arXiv %: 52.9%
- Network Nodes: 637
- Communities: 43
