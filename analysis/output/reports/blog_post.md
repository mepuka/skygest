# Analyzing Academic Bluesky with Skygent

Skygest is a feed generation system I built on Cloudflare Workers. It connects to Bluesky's Jetstream firehose, filters for academic paper links, and serves personalized feeds. Skygent is the companion CLI — a local tool for querying and analyzing the data Skygest collects.

This post covers what I found when I pointed both tools at academic Bluesky for about two weeks.

## The data

Skygest ingested 48,434 posts sharing academic papers from 14,381 unique accounts between January 21 and February 3, 2026. These posts contain links to arXiv, bioRxiv, Nature, Science, PubMed, and other sources.

I used Skygent to query the stores:

```bash
skygent query papers --sort by-engagement --limit 100 --format json --fields "@social"
```

This pulls posts sorted by engagement (likes + reposts + replies + quotes) with social metrics attached.

## Where the papers come from

arXiv dominates, accounting for 52.9% of all shared links. The top five sources account for 88.3%.

| Source Category | Share |
|-----------------|-------|
| Preprints (arXiv, bioRxiv, medRxiv) | 61.1% |
| High-impact journals (Nature, Science, Cell) | 5.4% |
| Other publishers | 5.8% |
| PubMed links | 2.6% |
| Code/Data (GitHub, HuggingFace) | 0.1% |

The concentration is high. The Herfindahl-Hirschman Index sits at 0.33, which in market terms qualifies as "highly concentrated." Preprint culture drives academic Bluesky.

## The 6 AM spike

Every day, posting volume spikes at 06:00 UTC — an average of 727 posts in that single hour. By 07:00 UTC it drops to 90. This pattern repeats every weekday.

The cause is straightforward: arXiv publishes new papers at that time, and a fleet of bots picks them up immediately. We detected 123 bot accounts in the network, most specialized to a single arXiv category. They fire in unison, then go quiet.

Wednesdays are busiest. Sundays are quietest. Weekdays outpace weekends.

## The network

637 accounts interact with each other around paper sharing. The network is sparse (density 0.002) and star-shaped — a few hub accounts broadcast to many passive receivers.

The degree assortativity is -0.58: hubs connect to the periphery, not to each other. We validated this against null models; the observed assortativity falls 38 standard deviations below random graphs with the same degree sequence. The hub-and-spoke pattern is structural, not artifactual.

45 communities emerged from the network. Two contain 82% of accounts. The remaining 43 are small clusters, many consisting of a single bot account and its followers.

### Bridge accounts

Certain accounts connect otherwise separate communities. Science journalism outlets — science.org, for example — bridge academic clusters and general-interest audiences. These bridge nodes carry papers beyond the academic echo chamber.

## Bots vs. humans

Of the 637 interacting accounts, 77% are human, 19% are bots, and the rest are institutions or aggregators. Among top-engaged posts, human-shared papers draw far more engagement than bot-shared ones (median 22 vs. 5 interactions).

A caveat: both groups were sampled from high-engagement posts, so this comparison describes only already-successful content. It says nothing about whether human posts generally outperform bots.

## Top papers

I ranked papers with a composite score, weighting replies and quotes above likes because they represent more active engagement. We tested six weighting schemes to check ranking sensitivity. The rankings held: the top papers remained stable across all schemes (Spearman correlations above 0.94).

The top papers during this period:

| Paper | Source | Engagement |
|-------|--------|------------|
| Swapping old immune cells in the brain with fresh ones | Nature | 853 |
| Tiny robots swim through blood, deliver drugs | Nature | 335 |
| Sensitization of tumours to immunotherapy | Nature | 334 |
| mRNA 3'UTRs chaperone intrinsically disordered regions | bioRxiv | 233 |
| Scientists should speak out against attacks on science | Nature | 190 |
| Single antivenom protects against 17 snakebites | Nature | 169 |

Health and medicine topics led. The top human curator, labwaggoner.bsky.social, appeared in 3 of the top 10 — a dedicated science communicator with 94 posts in the high-engagement set.

## What the AI/ML crowd talks about

AI and machine learning keywords appear in about 4.9% of posts. The top terms: ai, neural, llm, machine learning, deep learning, transformer, gpt. General science terms (health, climate, protein, medical) appear in 3.7%. The remaining ~91% use generic academic language.

## Limitations

This analysis covers a 12-day window. The top-papers section draws from the 100 highest-engagement posts per source, capturing viral content but missing typical posting patterns. Bot/human classification relies on heuristic string matching against usernames. Network rankings shift under perturbation — bootstrap confidence intervals remain wide.

These are descriptive findings, not causal claims.

## The tools

**Skygest** runs on Cloudflare Workers with a pipeline architecture: a Jetstream ingestor (Durable Object) feeds a filter worker, which writes to D1, which feeds a generator that caches personalized feeds in KV. The whole system uses Effect TypeScript.

**Skygent** is a local CLI, also built with Effect, that syncs Bluesky data into SQLite stores and provides query, filter, and export capabilities. It supports a filter DSL for composing rules (hashtags, authors, engagement thresholds, date ranges, etc.).

Both are open source.
