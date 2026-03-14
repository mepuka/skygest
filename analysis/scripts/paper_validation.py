#!/usr/bin/env python3
"""
Validation Analyses for Paper Impact Analysis

Addresses peer review concerns:
1. Selection bias acknowledgment and sensitivity analysis
2. Weight sensitivity analysis for composite scores
3. Improved statistical interpretation
4. Classification validation checks
5. Multiple testing correction

Following peer review methodology from scientific-skills:peer-review
"""

import json
import numpy as np
import pandas as pd
from pathlib import Path
from scipy import stats
from itertools import product
import warnings
warnings.filterwarnings('ignore')

BASE_DIR = Path(__file__).parent.parent
OUTPUT_DIR = BASE_DIR / "output"
DATA_DIR = OUTPUT_DIR / "data"

def load_data():
    """Load paper data for validation"""
    papers = {}
    for source in ['arxiv', 'biorxiv', 'nature']:
        filepath = DATA_DIR / f"{source}_engaged.json"
        if filepath.exists():
            with open(filepath) as f:
                papers[source] = json.load(f)
    return papers

def extract_metrics(post, source):
    """Extract engagement metrics from post"""
    metrics = post.get('metrics', {})
    return {
        'source': source,
        'author': post.get('author', ''),
        'likes': metrics.get('likeCount', 0),
        'reposts': metrics.get('repostCount', 0),
        'replies': metrics.get('replyCount', 0),
        'quotes': metrics.get('quoteCount', 0),
        'bookmarks': metrics.get('bookmarkCount', 0)
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

def compute_weighted_engagement(df, weights):
    """Compute weighted engagement with given weight scheme"""
    return (
        df['likes'] * weights['likes'] +
        df['reposts'] * weights['reposts'] +
        df['replies'] * weights['replies'] +
        df['quotes'] * weights['quotes'] +
        df['bookmarks'] * weights['bookmarks']
    )

def weight_sensitivity_analysis(df):
    """
    Test sensitivity of rankings to different weight schemes.

    Addresses peer review concern: "composite weights are heuristic, not empirically calibrated"
    """
    print("\n" + "=" * 60)
    print("WEIGHT SENSITIVITY ANALYSIS")
    print("=" * 60)

    # Define multiple plausible weight schemes
    weight_schemes = {
        'original': {'likes': 1.0, 'reposts': 2.0, 'replies': 3.0, 'quotes': 2.5, 'bookmarks': 1.5},
        'equal': {'likes': 1.0, 'reposts': 1.0, 'replies': 1.0, 'quotes': 1.0, 'bookmarks': 1.0},
        'likes_heavy': {'likes': 3.0, 'reposts': 1.0, 'replies': 1.0, 'quotes': 1.0, 'bookmarks': 1.0},
        'interaction_heavy': {'likes': 0.5, 'reposts': 2.0, 'replies': 4.0, 'quotes': 3.0, 'bookmarks': 1.0},
        'amplification_heavy': {'likes': 1.0, 'reposts': 4.0, 'replies': 2.0, 'quotes': 3.0, 'bookmarks': 1.0},
        'reversed': {'likes': 3.0, 'reposts': 1.5, 'replies': 1.0, 'quotes': 1.5, 'bookmarks': 2.0}
    }

    results = {}
    rankings = {}

    for scheme_name, weights in weight_schemes.items():
        df[f'score_{scheme_name}'] = compute_weighted_engagement(df, weights)
        rankings[scheme_name] = df.nlargest(25, f'score_{scheme_name}').index.tolist()

    # Compute rank correlations between all pairs
    scheme_names = list(weight_schemes.keys())
    correlation_matrix = np.zeros((len(scheme_names), len(scheme_names)))

    print("\nSpearman rank correlations between weight schemes:")
    print("-" * 50)

    for i, scheme1 in enumerate(scheme_names):
        for j, scheme2 in enumerate(scheme_names):
            if i <= j:
                rank1 = df[f'score_{scheme1}'].rank(ascending=False)
                rank2 = df[f'score_{scheme2}'].rank(ascending=False)
                corr, p = stats.spearmanr(rank1, rank2)
                correlation_matrix[i, j] = corr
                correlation_matrix[j, i] = corr
                if i != j:
                    print(f"  {scheme1} vs {scheme2}: ρ = {corr:.3f}")

    # Check top-10 stability
    print("\nTop-10 stability across schemes:")
    print("-" * 50)

    top10_sets = {name: set(rankings[name][:10]) for name in scheme_names}
    original_top10 = top10_sets['original']

    for scheme_name in scheme_names:
        if scheme_name != 'original':
            overlap = len(original_top10 & top10_sets[scheme_name])
            print(f"  Original vs {scheme_name}: {overlap}/10 papers in common")

    # Identify consistently top-ranked papers
    print("\nPapers appearing in top-10 across ALL weight schemes:")
    print("-" * 50)

    all_top10 = set.intersection(*top10_sets.values())
    for idx in all_top10:
        row = df.loc[idx]
        print(f"  • {row['source']}: {row.get('title', row.get('text', 'Unknown'))[:50]}...")

    results = {
        'weight_schemes_tested': list(weight_schemes.keys()),
        'correlation_matrix': {
            'schemes': scheme_names,
            'correlations': correlation_matrix.tolist()
        },
        'top10_overlaps': {
            scheme: len(original_top10 & top10_sets[scheme])
            for scheme in scheme_names if scheme != 'original'
        },
        'robust_papers': len(all_top10),
        'interpretation': (
            f"Rankings show {'high' if np.mean([correlation_matrix[0, i] for i in range(1, len(scheme_names))]) > 0.8 else 'moderate'} "
            f"stability across weight schemes. {len(all_top10)} papers appear in top-10 regardless of weighting."
        )
    }

    return results

def classification_validation(df):
    """
    Validate and analyze author classification.

    Addresses peer review concern: "naive bot/human classification based on heuristics"
    """
    print("\n" + "=" * 60)
    print("CLASSIFICATION VALIDATION")
    print("=" * 60)

    df['author_type'] = df['author'].apply(classify_author)

    # Show examples from each category for manual verification
    print("\nSample authors by category (for manual verification):")
    print("-" * 50)

    results = {'categories': {}}

    for category in ['human', 'bot', 'aggregator']:
        cat_authors = df[df['author_type'] == category]['author'].unique()
        sample = list(cat_authors[:10])
        results['categories'][category] = {
            'count': len(cat_authors),
            'sample': sample
        }
        print(f"\n{category.upper()} ({len(cat_authors)} unique authors):")
        for author in sample:
            print(f"  - {author}")

    # Analyze edge cases that might be misclassified
    print("\nPotential edge cases (humans with bot-like activity):")
    print("-" * 50)

    # Humans with very high post counts might be bots
    human_posts = df[df['author_type'] == 'human'].groupby('author').size()
    high_volume_humans = human_posts[human_posts > 5].index.tolist()

    for author in high_volume_humans[:5]:
        count = human_posts[author]
        print(f"  - {author}: {count} posts in top-engaged set")

    results['edge_cases'] = {
        'high_volume_humans': len(high_volume_humans),
        'sample': high_volume_humans[:10]
    }

    # Classification confidence
    results['confidence_note'] = (
        "Classification is heuristic-based (string matching on 'bot' in username). "
        "Human verification recommended for edge cases. Results should be interpreted "
        "as 'likely human' vs 'likely automated' rather than definitive labels."
    )

    return results

def selection_bias_analysis(df):
    """
    Document and analyze selection bias from top-100 sampling.

    Addresses peer review concern: "severe selection bias from top-100 sampling"
    """
    print("\n" + "=" * 60)
    print("SELECTION BIAS ANALYSIS")
    print("=" * 60)

    total_engagement = df['likes'] + df['reposts'] + df['replies'] + df['quotes']

    results = {
        'sample_characteristics': {
            'total_posts': len(df),
            'min_engagement': int(total_engagement.min()),
            'max_engagement': int(total_engagement.max()),
            'median_engagement': float(total_engagement.median()),
            'mean_engagement': round(float(total_engagement.mean()), 2)
        },
        'acknowledged_limitations': [
            "Sample consists of TOP 100 posts by engagement per source",
            "This systematically excludes the long tail of low-engagement posts",
            "Findings describe HIGH-ENGAGEMENT posts only, not general posting patterns",
            "Cannot make inferences about typical paper-sharing behavior",
            "Results are DESCRIPTIVE of viral/high-impact posts, not inferential"
        ],
        'valid_inferences': [
            "What characterizes highly-engaged academic posts",
            "Relative comparison within the high-engagement tier",
            "Which topics/sources reach the engagement threshold",
            "Differences between human and bot sharers among top posts"
        ],
        'invalid_inferences': [
            "Overall engagement distribution of academic posts",
            "Typical bot vs human engagement patterns",
            "General conclusions about the academic Bluesky community",
            "Power law claims require full population data"
        ]
    }

    print(f"\nSample: Top {len(df)} posts by engagement")
    print(f"Engagement range: {results['sample_characteristics']['min_engagement']} - {results['sample_characteristics']['max_engagement']}")

    print("\n⚠️  ACKNOWLEDGED LIMITATIONS:")
    for lim in results['acknowledged_limitations']:
        print(f"  • {lim}")

    print("\n✓ VALID INFERENCES:")
    for inf in results['valid_inferences']:
        print(f"  • {inf}")

    print("\n✗ INVALID INFERENCES:")
    for inf in results['invalid_inferences']:
        print(f"  • {inf}")

    return results

def improved_statistical_tests(df):
    """
    Re-run statistical tests with improved interpretation.

    Addresses peer review concerns:
    - Mann-Whitney U interpretation issues
    - Multiple testing correction
    - Effect size reporting
    """
    print("\n" + "=" * 60)
    print("IMPROVED STATISTICAL ANALYSIS")
    print("=" * 60)

    df['author_type'] = df['author'].apply(classify_author)
    df['total_engagement'] = df['likes'] + df['reposts'] + df['replies'] + df['quotes']

    results = {'tests': []}

    # Test 1: Bot vs Human engagement (with proper interpretation)
    human_eng = df[df['author_type'] == 'human']['total_engagement']
    bot_eng = df[df['author_type'] == 'bot']['total_engagement']

    if len(human_eng) > 5 and len(bot_eng) > 5:
        stat, p = stats.mannwhitneyu(human_eng, bot_eng, alternative='two-sided')

        # Proper rank-biserial correlation
        n1, n2 = len(human_eng), len(bot_eng)
        r = 1 - (2 * stat) / (n1 * n2)

        # Common language effect size
        all_comparisons = n1 * n2
        human_wins = stat
        cles = human_wins / all_comparisons

        test1 = {
            'name': 'Bot vs Human Engagement',
            'test': 'Mann-Whitney U',
            'statistic': round(float(stat), 2),
            'p_value': float(p),
            'p_value_formatted': f"p = {p:.4f}" if p >= 0.0001 else "p < 0.0001",
            'effect_size_r': round(float(r), 3),
            'cles': round(float(cles), 3),
            'n_human': len(human_eng),
            'n_bot': len(bot_eng),
            'human_median': float(human_eng.median()),
            'bot_median': float(bot_eng.median()),
            'interpretation': (
                f"Within this TOP-ENGAGED sample, human-shared posts have "
                f"{'higher' if human_eng.median() > bot_eng.median() else 'lower'} "
                f"median engagement ({human_eng.median():.0f} vs {bot_eng.median():.0f}). "
                f"Effect size r = {r:.3f} ({'large' if abs(r) > 0.5 else 'medium' if abs(r) > 0.3 else 'small'}). "
                f"Note: This compares already-successful posts, not general posting patterns."
            ),
            'caution': (
                "This does NOT mean human posts generally get more engagement. "
                "Both groups were sampled from top-100 by engagement, so conclusions "
                "only apply to posts that already achieved high visibility."
            )
        }
        results['tests'].append(test1)

        print(f"\n1. Bot vs Human (within top-engaged posts):")
        print(f"   U = {stat:.2f}, {test1['p_value_formatted']}")
        print(f"   Effect size r = {r:.3f}")
        print(f"   Human median: {human_eng.median():.0f}, Bot median: {bot_eng.median():.0f}")
        print(f"   ⚠️  {test1['caution']}")

    # Test 2: Source differences (Kruskal-Wallis)
    source_groups = [df[df['source'] == s]['total_engagement'].values
                     for s in df['source'].unique()]
    source_groups = [g for g in source_groups if len(g) > 2]

    if len(source_groups) >= 2:
        h_stat, p = stats.kruskal(*source_groups)

        # Epsilon-squared effect size for Kruskal-Wallis
        n = len(df)
        k = len(source_groups)
        epsilon_sq = (h_stat - k + 1) / (n - k)

        test2 = {
            'name': 'Source Engagement Differences',
            'test': 'Kruskal-Wallis H',
            'statistic': round(float(h_stat), 2),
            'p_value': float(p),
            'p_value_formatted': f"p = {p:.4f}" if p >= 0.0001 else "p < 0.0001",
            'effect_size_epsilon_sq': round(float(max(0, epsilon_sq)), 3),
            'n_groups': len(source_groups),
            'interpretation': (
                f"Engagement differs significantly across sources "
                f"(H = {h_stat:.2f}, {test2['p_value_formatted'] if p >= 0.0001 else 'p < 0.0001'}). "
                f"ε² = {max(0, epsilon_sq):.3f} "
                f"({'large' if epsilon_sq > 0.14 else 'medium' if epsilon_sq > 0.06 else 'small'} effect)."
            )
        }
        results['tests'].append(test2)

        print(f"\n2. Source Differences:")
        print(f"   H = {h_stat:.2f}, {test2['p_value_formatted']}")
        print(f"   Effect size ε² = {max(0, epsilon_sq):.3f}")

    # Multiple testing correction
    p_values = [t['p_value'] for t in results['tests']]
    n_tests = len(p_values)

    # Bonferroni correction
    alpha = 0.05
    bonferroni_alpha = alpha / n_tests

    # Benjamini-Hochberg correction
    sorted_p = sorted(enumerate(p_values), key=lambda x: x[1])
    bh_significant = []
    for rank, (idx, p) in enumerate(sorted_p, 1):
        threshold = (rank / n_tests) * alpha
        bh_significant.append((idx, p <= threshold))

    results['multiple_testing'] = {
        'n_tests': n_tests,
        'bonferroni_alpha': round(bonferroni_alpha, 4),
        'all_significant_after_bonferroni': all(p < bonferroni_alpha for p in p_values),
        'benjamini_hochberg_results': [
            {'test': results['tests'][idx]['name'], 'significant': sig}
            for idx, sig in bh_significant
        ]
    }

    print(f"\n3. Multiple Testing Correction ({n_tests} tests):")
    print(f"   Bonferroni α = {bonferroni_alpha:.4f}")
    print(f"   All tests significant after correction: {results['multiple_testing']['all_significant_after_bonferroni']}")

    return results

def remove_power_law_claims(df):
    """
    Document why power law claims are removed.

    Addresses peer review concern: "flawed power law testing methodology"
    """
    print("\n" + "=" * 60)
    print("POWER LAW ANALYSIS - METHODOLOGY NOTE")
    print("=" * 60)

    total_engagement = df['likes'] + df['reposts'] + df['replies'] + df['quotes']

    result = {
        'original_claim': "Engagement follows power law (Zipf) distribution",
        'methodology_used': "Log-log linear regression R² threshold",
        'why_invalid': [
            "Proper power law testing requires Clauset et al. (2009) methodology",
            "Log-log R² can be high for many non-power-law distributions",
            "Sample is truncated (top-100 only), obscuring true tail behavior",
            "Need KS test against fitted power law, comparison to alternatives",
            "Full population data required for valid inference"
        ],
        'revised_statement': (
            "The engagement distribution within this high-engagement sample shows "
            "high variance and right skew (skewness = {:.2f}), consistent with the "
            "heavy-tailed distributions commonly observed in social media. However, "
            "formal power law testing is not appropriate for this truncated sample."
        ).format(float(stats.skew(total_engagement))),
        'recommendation': (
            "For proper power law analysis, collect full engagement distribution "
            "data and apply methods from: Clauset, A., Shalizi, C. R., & Newman, M. E. J. (2009). "
            "Power-law distributions in empirical data. SIAM Review, 51(4), 661-703."
        )
    }

    print(f"\n⚠️  POWER LAW CLAIMS REMOVED")
    print(f"\nOriginal claim: {result['original_claim']}")
    print(f"\nWhy invalid:")
    for reason in result['why_invalid']:
        print(f"  • {reason}")
    print(f"\nRevised statement: {result['revised_statement']}")

    return result

def main():
    print("=" * 60)
    print("PAPER ANALYSIS VALIDATION")
    print("Addressing Peer Review Concerns")
    print("=" * 60)

    # Load data
    print("\nLoading data...")
    papers = load_data()

    if not papers:
        print("No data found. Run paper_analysis.py first.")
        return

    # Convert to DataFrame
    all_posts = []
    for source, posts in papers.items():
        for post in posts:
            info = extract_metrics(post, source)
            # Also extract title/text for display
            embed = post.get('embedSummary', {})
            if embed.get('type') == 'external':
                info['title'] = embed.get('external', {}).get('title', '')
            else:
                info['title'] = ''
            info['text'] = post.get('text', '')[:100]
            all_posts.append(info)

    df = pd.DataFrame(all_posts)
    print(f"Loaded {len(df)} posts from {df['source'].nunique()} sources")

    # Run all validation analyses
    validation_results = {
        'generated': pd.Timestamp.now().isoformat(),
        'purpose': 'Address peer review methodological concerns'
    }

    # 1. Selection bias documentation
    validation_results['selection_bias'] = selection_bias_analysis(df)

    # 2. Weight sensitivity
    validation_results['weight_sensitivity'] = weight_sensitivity_analysis(df)

    # 3. Classification validation
    validation_results['classification'] = classification_validation(df)

    # 4. Improved statistical tests
    validation_results['improved_statistics'] = improved_statistical_tests(df)

    # 5. Power law methodology note
    validation_results['power_law_note'] = remove_power_law_claims(df)

    # Save results
    output_file = DATA_DIR / "paper_validation_analyses.json"
    with open(output_file, 'w') as f:
        json.dump(validation_results, f, indent=2, default=str)

    print("\n" + "=" * 60)
    print(f"✓ Validation results saved to: {output_file}")
    print("=" * 60)

    # Summary
    print("\nVALIDATION SUMMARY")
    print("-" * 40)
    print("1. Selection bias: Documented and acknowledged")
    print("2. Weight sensitivity: Tested 6 alternative schemes")
    print("3. Classification: Sample authors shown for verification")
    print("4. Statistical tests: Improved with effect sizes & corrections")
    print("5. Power law claims: Removed with methodology note")

    return validation_results

if __name__ == "__main__":
    main()
