#!/usr/bin/env python3
"""
Rigorous Statistical Analysis of Top Academic Papers on Bluesky

Applies peer-reviewed statistical methodology to identify:
1. Top papers by engagement metrics (likes, reposts, replies, quotes)
2. Comparison of bot vs human amplification
3. Statistical distribution of engagement
4. Top papers with composite scoring
"""

import json
import numpy as np
import pandas as pd
from pathlib import Path
from scipy import stats
from collections import defaultdict, Counter
from datetime import datetime
import warnings
warnings.filterwarnings('ignore')

BASE_DIR = Path(__file__).parent.parent
OUTPUT_DIR = BASE_DIR / "output"
DATA_DIR = OUTPUT_DIR / "data"

def load_engaged_data():
    """Load engagement-sorted paper data from skygent queries"""
    papers = {}

    for source in ['arxiv', 'biorxiv', 'nature']:
        filepath = DATA_DIR / f"{source}_engaged.json"
        if filepath.exists():
            with open(filepath) as f:
                papers[source] = json.load(f)
            print(f"  Loaded {len(papers[source])} {source} posts with engagement")

    return papers

def extract_paper_info(post, source):
    """Extract paper information from a post"""
    metrics = post.get('metrics', {})

    # Calculate total engagement
    likes = metrics.get('likeCount', 0)
    reposts = metrics.get('repostCount', 0)
    replies = metrics.get('replyCount', 0)
    quotes = metrics.get('quoteCount', 0)
    bookmarks = metrics.get('bookmarkCount', 0)

    total_engagement = likes + reposts + replies + quotes

    # Extract title and URL
    title = ''
    url = ''
    embed = post.get('embedSummary', {})
    if embed.get('type') == 'external':
        ext = embed.get('external', {})
        title = ext.get('title', '')
        url = ext.get('uri', '')

    # If no embed, try to extract from text
    if not url:
        text = post.get('text', '')
        import re
        urls = re.findall(r'https?://[^\s]+', text)
        for u in urls:
            if any(d in u for d in ['arxiv.org', 'biorxiv.org', 'nature.com']):
                url = u.rstrip('.,;:')
                break

    return {
        'source': source,
        'author': post.get('author', ''),
        'title': title,
        'url': url,
        'text': post.get('text', '')[:200],
        'likes': likes,
        'reposts': reposts,
        'replies': replies,
        'quotes': quotes,
        'bookmarks': bookmarks,
        'total_engagement': total_engagement,
        'uri': post.get('uri', '')
    }

def classify_author(author):
    """Classify author as bot, aggregator, or human"""
    author_lower = author.lower()
    if 'bot' in author_lower or author_lower.endswith('-bot.bsky.social'):
        return 'bot'
    elif any(x in author_lower for x in ['arxiv', 'biorxiv', 'nature', 'firehose']):
        return 'aggregator'
    else:
        return 'human'

def analyze_engagement_distribution(df):
    """Statistical analysis of engagement distribution"""
    print("Analyzing engagement distributions...")

    results = {}

    # Distribution characteristics
    for metric in ['likes', 'reposts', 'replies', 'total_engagement']:
        values = df[metric].values
        values_nonzero = values[values > 0]

        results[metric] = {
            'n': len(values),
            'mean': round(float(np.mean(values)), 2),
            'median': round(float(np.median(values)), 2),
            'std': round(float(np.std(values)), 2),
            'min': int(np.min(values)),
            'max': int(np.max(values)),
            'skewness': round(float(stats.skew(values)), 2) if len(values) > 2 else None,
            'kurtosis': round(float(stats.kurtosis(values)), 2) if len(values) > 2 else None
        }

        # Test for power law (Zipf) distribution
        if len(values_nonzero) > 10:
            sorted_vals = np.sort(values_nonzero)[::-1]
            ranks = np.arange(1, len(sorted_vals) + 1)

            # Log-log regression
            log_ranks = np.log10(ranks)
            log_vals = np.log10(sorted_vals)

            slope, intercept, r_value, p_value, std_err = stats.linregress(log_ranks, log_vals)

            results[metric]['power_law'] = {
                'exponent': round(-slope, 3),
                'r_squared': round(r_value**2, 3),
                'follows_zipf': r_value**2 > 0.7
            }

    return results

def compare_bot_vs_human(df):
    """Compare engagement between bot and human sharers"""
    print("Comparing bot vs human engagement...")

    df['author_type'] = df['author'].apply(classify_author)

    # Group statistics
    grouped = df.groupby('author_type').agg({
        'total_engagement': ['count', 'mean', 'median', 'sum'],
        'likes': ['mean', 'median'],
        'reposts': ['mean', 'median']
    }).round(2)

    # Mann-Whitney U test for engagement differences
    human_engagement = df[df['author_type'] == 'human']['total_engagement']
    bot_engagement = df[df['author_type'] == 'bot']['total_engagement']

    test_result = None
    if len(human_engagement) > 5 and len(bot_engagement) > 5:
        stat, p_value = stats.mannwhitneyu(human_engagement, bot_engagement, alternative='two-sided')

        # Effect size (rank-biserial correlation)
        n1, n2 = len(human_engagement), len(bot_engagement)
        effect_size = 1 - (2 * stat) / (n1 * n2)

        test_result = {
            'test': 'Mann-Whitney U',
            'statistic': round(float(stat), 2),
            'p_value': round(float(p_value), 6),
            'effect_size_r': round(float(effect_size), 3),
            'significant': p_value < 0.05,
            'interpretation': 'Human-shared papers get significantly different engagement' if p_value < 0.05 else 'No significant difference'
        }

    # Flatten multi-index columns for JSON serialization
    group_stats = {}
    for author_type in df['author_type'].unique():
        type_df = df[df['author_type'] == author_type]
        group_stats[author_type] = {
            'count': len(type_df),
            'mean_engagement': round(float(type_df['total_engagement'].mean()), 2),
            'median_engagement': round(float(type_df['total_engagement'].median()), 2),
            'total_engagement': int(type_df['total_engagement'].sum()),
            'mean_likes': round(float(type_df['likes'].mean()), 2),
            'mean_reposts': round(float(type_df['reposts'].mean()), 2)
        }

    return {
        'group_statistics': group_stats,
        'statistical_test': test_result,
        'counts': df['author_type'].value_counts().to_dict()
    }

def compute_composite_score(df):
    """
    Compute composite impact score using multiple engagement metrics.

    Methodology:
    - Weight different engagement types differently
    - Likes: 1x (passive engagement)
    - Reposts: 2x (active amplification)
    - Replies: 3x (discussion generation)
    - Quotes: 2.5x (commentary engagement)
    - Bookmarks: 1.5x (intent to revisit)

    Then z-score normalize for comparison.
    """
    print("Computing composite impact scores...")

    # Weighted engagement
    df['weighted_engagement'] = (
        df['likes'] * 1.0 +
        df['reposts'] * 2.0 +
        df['replies'] * 3.0 +
        df['quotes'] * 2.5 +
        df['bookmarks'] * 1.5
    )

    # Z-score normalization
    mean_eng = df['weighted_engagement'].mean()
    std_eng = df['weighted_engagement'].std()

    if std_eng > 0:
        df['impact_z'] = (df['weighted_engagement'] - mean_eng) / std_eng
    else:
        df['impact_z'] = 0

    # Normalize to 0-1 scale
    min_z, max_z = df['impact_z'].min(), df['impact_z'].max()
    if max_z > min_z:
        df['impact_score'] = (df['impact_z'] - min_z) / (max_z - min_z)
    else:
        df['impact_score'] = 0.5

    return df

def statistical_validation(df):
    """Apply statistical validation to findings"""
    print("Performing statistical validation...")

    results = {}

    # Test 1: Are engagement differences by source significant?
    source_groups = [df[df['source'] == s]['total_engagement'].values for s in df['source'].unique()]
    source_groups = [g for g in source_groups if len(g) > 2]

    if len(source_groups) >= 2:
        h_stat, p_value = stats.kruskal(*source_groups)
        results['source_difference'] = {
            'test': 'Kruskal-Wallis H',
            'statistic': round(float(h_stat), 2),
            'p_value': round(float(p_value), 6),
            'significant': p_value < 0.05,
            'interpretation': 'Significant engagement differences between sources' if p_value < 0.05 else 'No significant source differences'
        }

    # Test 2: Spearman correlation between likes and reposts
    if len(df) > 10:
        corr, p_value = stats.spearmanr(df['likes'], df['reposts'])
        results['like_repost_correlation'] = {
            'coefficient': round(float(corr), 3),
            'p_value': round(float(p_value), 6),
            'interpretation': f"{'Strong' if abs(corr) > 0.5 else 'Moderate' if abs(corr) > 0.3 else 'Weak'} positive correlation"
        }

    # Test 3: Bootstrap 95% CI for mean engagement
    n_bootstrap = 1000
    bootstrap_means = []
    for _ in range(n_bootstrap):
        sample = np.random.choice(df['total_engagement'].values, size=len(df), replace=True)
        bootstrap_means.append(np.mean(sample))

    results['engagement_ci'] = {
        'mean': round(float(np.mean(df['total_engagement'])), 2),
        '95_ci_lower': round(float(np.percentile(bootstrap_means, 2.5)), 2),
        '95_ci_upper': round(float(np.percentile(bootstrap_means, 97.5)), 2)
    }

    return results

def generate_report(df, engagement_analysis, bot_comparison, validation):
    """Generate final analysis report"""

    # Top papers overall
    top_overall = []
    for _, row in df.nlargest(25, 'impact_score').iterrows():
        top_overall.append({
            'rank': len(top_overall) + 1,
            'title': row['title'][:100] if row['title'] else f"[{row['source']}] {row['text'][:80]}...",
            'url': row['url'],
            'source': row['source'],
            'author': row['author'],
            'author_type': row['author_type'],
            'likes': int(row['likes']),
            'reposts': int(row['reposts']),
            'replies': int(row['replies']),
            'quotes': int(row['quotes']),
            'total_engagement': int(row['total_engagement']),
            'weighted_engagement': round(float(row['weighted_engagement']), 1),
            'impact_score': round(float(row['impact_score']), 3)
        })

    # Top by source
    top_by_source = {}
    for source in ['arxiv', 'biorxiv', 'nature']:
        source_df = df[df['source'] == source]
        top_by_source[source] = []
        for _, row in source_df.nlargest(10, 'impact_score').iterrows():
            top_by_source[source].append({
                'title': row['title'][:100] if row['title'] else row['text'][:80],
                'url': row['url'],
                'author': row['author'],
                'likes': int(row['likes']),
                'reposts': int(row['reposts']),
                'total_engagement': int(row['total_engagement']),
                'impact_score': round(float(row['impact_score']), 3)
            })

    # Top human-shared vs bot-shared
    human_top = df[df['author_type'] == 'human'].nlargest(10, 'impact_score')
    bot_top = df[df['author_type'] == 'bot'].nlargest(10, 'impact_score')

    report = {
        'generated': datetime.now().isoformat(),
        'data_period': 'September 2024 - February 2026',
        'methodology': {
            'composite_score_weights': {
                'likes': 1.0,
                'reposts': 2.0,
                'replies': 3.0,
                'quotes': 2.5,
                'bookmarks': 1.5
            },
            'rationale': 'Higher weights for active engagement (replies, quotes) vs passive (likes)',
            'normalization': 'Z-score followed by min-max to 0-1 scale'
        },
        'summary': {
            'total_posts_analyzed': len(df),
            'unique_papers_approx': len(df['url'].unique()),
            'posts_by_source': df['source'].value_counts().to_dict(),
            'author_type_distribution': df['author_type'].value_counts().to_dict()
        },
        'engagement_analysis': engagement_analysis,
        'bot_vs_human': bot_comparison,
        'statistical_validation': validation,
        'top_papers': {
            'overall_top_25': top_overall,
            'by_source': top_by_source,
            'human_shared_top_10': [
                {
                    'title': row['title'][:80] if row['title'] else row['text'][:60],
                    'author': row['author'],
                    'engagement': int(row['total_engagement']),
                    'impact': round(float(row['impact_score']), 3)
                }
                for _, row in human_top.iterrows()
            ],
            'bot_shared_top_10': [
                {
                    'title': row['title'][:80] if row['title'] else row['text'][:60],
                    'author': row['author'],
                    'engagement': int(row['total_engagement']),
                    'impact': round(float(row['impact_score']), 3)
                }
                for _, row in bot_top.iterrows()
            ]
        },
        'key_findings': [],
        'limitations': [
            'Sample limited to top 100 posts per source by engagement (selection bias toward high performers)',
            'Composite weights are heuristic - not empirically calibrated',
            'No control for post age (older posts may accumulate more engagement)',
            'Same paper shared by multiple authors counted as separate posts'
        ]
    }

    # Generate key findings
    findings = []

    # Finding 1: Engagement distribution
    if engagement_analysis.get('total_engagement', {}).get('power_law', {}).get('follows_zipf'):
        findings.append(f"Engagement follows power law distribution (R²={engagement_analysis['total_engagement']['power_law']['r_squared']})")

    # Finding 2: Bot vs human
    if bot_comparison.get('statistical_test', {}).get('significant'):
        findings.append(f"Human and bot-shared papers have significantly different engagement (p={bot_comparison['statistical_test']['p_value']})")
    else:
        findings.append("No significant engagement difference between human and bot sharers")

    # Finding 3: Top source
    top_source = max(report['summary']['posts_by_source'].items(), key=lambda x: x[1])
    findings.append(f"{top_source[0].title()} dominates with {top_source[1]} high-engagement posts")

    # Finding 4: Top paper
    if top_overall:
        top = top_overall[0]
        findings.append(f"Top paper: \"{top['title'][:50]}...\" with {top['total_engagement']} engagement")

    report['key_findings'] = findings

    return report

def main():
    print("=" * 60)
    print("Rigorous Paper Impact Analysis with Engagement Metrics")
    print("=" * 60)

    # Load data
    print("\nLoading engagement data...")
    papers = load_engaged_data()

    if not papers:
        print("No engagement data found. Run skygent queries first.")
        return

    # Convert to DataFrame
    all_posts = []
    for source, posts in papers.items():
        for post in posts:
            info = extract_paper_info(post, source)
            all_posts.append(info)

    df = pd.DataFrame(all_posts)
    print(f"\nAnalyzing {len(df)} posts across {df['source'].nunique()} sources")

    # Analyze engagement distributions
    engagement_analysis = analyze_engagement_distribution(df)

    # Compute composite scores
    df = compute_composite_score(df)

    # Compare bot vs human
    bot_comparison = compare_bot_vs_human(df)

    # Statistical validation
    validation = statistical_validation(df)

    # Generate report
    report = generate_report(df, engagement_analysis, bot_comparison, validation)

    # Save
    output_file = DATA_DIR / "top_papers_analysis.json"
    with open(output_file, 'w') as f:
        json.dump(report, f, indent=2, default=str)
    print(f"\n✓ Results saved to: {output_file}")

    # Print summary
    print("\n" + "=" * 60)
    print("KEY FINDINGS")
    print("=" * 60)
    for finding in report['key_findings']:
        print(f"  • {finding}")

    print("\n" + "=" * 60)
    print("TOP 10 PAPERS BY IMPACT SCORE")
    print("=" * 60)
    for paper in report['top_papers']['overall_top_25'][:10]:
        title = paper['title'][:55] + '...' if len(paper['title']) > 55 else paper['title']
        print(f"\n{paper['rank']}. [{paper['source']}] {title}")
        print(f"   Author: {paper['author']} ({paper['author_type']})")
        print(f"   Engagement: {paper['likes']}❤️ {paper['reposts']}🔄 {paper['replies']}💬 {paper['quotes']}💭")
        print(f"   Impact Score: {paper['impact_score']}")

    print("\n" + "-" * 60)
    print("STATISTICAL VALIDATION")
    print("-" * 60)
    if 'source_difference' in validation:
        sd = validation['source_difference']
        print(f"  Source differences: {sd['interpretation']} (p={sd['p_value']})")
    if 'like_repost_correlation' in validation:
        lrc = validation['like_repost_correlation']
        print(f"  Like-repost correlation: r={lrc['coefficient']} ({lrc['interpretation']})")
    if 'engagement_ci' in validation:
        ci = validation['engagement_ci']
        print(f"  Mean engagement: {ci['mean']} (95% CI: [{ci['95_ci_lower']}, {ci['95_ci_upper']}])")

if __name__ == "__main__":
    main()
