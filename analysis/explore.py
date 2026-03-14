#!/usr/bin/env python3
"""Explore Skygest data to understand what we have."""

import re
import sqlite3
from collections import Counter
from pathlib import Path

import polars as pl


def load_data(sql_path: Path) -> pl.DataFrame:
    """Load SQL dump into a Polars DataFrame."""
    conn = sqlite3.connect(":memory:")
    with open(sql_path) as f:
        conn.executescript(f.read())

    df = pl.read_database(
        "SELECT uri, author_did, created_at, search_text FROM posts WHERE status = 'active'",
        conn
    )
    conn.close()
    return df


def extract_arxiv_categories(df: pl.DataFrame) -> Counter:
    """Extract arXiv category codes (e.g., cs.AI, physics.gen-ph)."""
    # arXiv URLs look like: arxiv.org/abs/2401.12345 or arxiv.org/pdf/2401.12345
    # Categories are in the paper metadata, but we can also look for category mentions
    arxiv_pattern = re.compile(r'arxiv\.org/(?:abs|pdf)/(\d{4}\.\d{4,5})', re.IGNORECASE)

    # Also look for explicit category mentions like [cs.AI] or cs.LG
    category_pattern = re.compile(r'\b(cs\.[A-Z]{2}|stat\.[A-Z]{2}|math\.[A-Z]{2}|physics\.[a-z-]+|q-bio\.[A-Z]{2}|q-fin\.[A-Z]{2}|eess\.[A-Z]{2}|astro-ph|cond-mat|gr-qc|hep-[a-z]+|nlin\.[A-Z]{2}|nucl-[a-z]+|quant-ph)\b', re.IGNORECASE)

    categories = Counter()
    arxiv_ids = []

    for text in df["search_text"].to_list():
        if text:
            # Find category mentions
            cats = category_pattern.findall(text.lower())
            categories.update(cats)

            # Collect arxiv IDs
            ids = arxiv_pattern.findall(text)
            arxiv_ids.extend(ids)

    return categories, len(set(arxiv_ids))


def analyze_link_types(df: pl.DataFrame) -> dict:
    """Categorize posts by link type."""
    patterns = {
        'arxiv': re.compile(r'arxiv\.org', re.IGNORECASE),
        'biorxiv': re.compile(r'biorxiv\.org', re.IGNORECASE),
        'medrxiv': re.compile(r'medrxiv\.org', re.IGNORECASE),
        'doi': re.compile(r'doi\.org|dx\.doi\.org', re.IGNORECASE),
        'nature': re.compile(r'nature\.com', re.IGNORECASE),
        'science': re.compile(r'science\.org', re.IGNORECASE),
        'pubmed': re.compile(r'pubmed|ncbi\.nlm\.nih\.gov', re.IGNORECASE),
        'plos': re.compile(r'plos(?:one)?\.org', re.IGNORECASE),
        'springer': re.compile(r'springer\.com|link\.springer', re.IGNORECASE),
        'wiley': re.compile(r'wiley\.com|onlinelibrary\.wiley', re.IGNORECASE),
        'elsevier': re.compile(r'sciencedirect\.com|elsevier', re.IGNORECASE),
        'ssrn': re.compile(r'ssrn\.com', re.IGNORECASE),
        'researchgate': re.compile(r'researchgate\.net', re.IGNORECASE),
        'github': re.compile(r'github\.com', re.IGNORECASE),
        'huggingface': re.compile(r'huggingface\.co', re.IGNORECASE),
    }

    counts = {k: 0 for k in patterns}
    posts_with_links = 0

    for text in df["search_text"].to_list():
        if text:
            found_any = False
            for name, pattern in patterns.items():
                if pattern.search(text):
                    counts[name] += 1
                    found_any = True
            if found_any:
                posts_with_links += 1

    return counts, posts_with_links


def sample_posts_by_type(df: pl.DataFrame, link_type: str, n: int = 5) -> list[str]:
    """Get sample posts containing a specific link type."""
    patterns = {
        'arxiv': r'arxiv\.org',
        'biorxiv': r'biorxiv\.org',
        'doi': r'doi\.org',
        'nature': r'nature\.com',
    }

    pattern = patterns.get(link_type, link_type)

    samples = []
    for text in df["search_text"].to_list():
        if text and re.search(pattern, text, re.IGNORECASE):
            # Truncate for display
            samples.append(text[:300] + "..." if len(text) > 300 else text)
            if len(samples) >= n:
                break

    return samples


def analyze_content_themes(df: pl.DataFrame) -> Counter:
    """Look for thematic content patterns."""
    themes = {
        'machine_learning': re.compile(r'machine\s*learning|deep\s*learning|neural\s*net|transformer|llm|gpt|bert|diffusion\s*model', re.IGNORECASE),
        'biology_life_sci': re.compile(r'biolog|genomic|protein|cell|gene|dna|rna|crispr|molecular|organism', re.IGNORECASE),
        'medicine_health': re.compile(r'medic|clinic|patient|disease|drug|pharma|health|covid|cancer|therap', re.IGNORECASE),
        'physics': re.compile(r'physic|quantum|particle|gravity|cosmolog|astroph', re.IGNORECASE),
        'climate_environment': re.compile(r'climate|environment|emission|carbon|sustainab|ecolog|biodiversity', re.IGNORECASE),
        'social_science': re.compile(r'social|economic|politic|psycholog|sociolog|demograph', re.IGNORECASE),
        'computer_science': re.compile(r'algorithm|comput|software|program|database|network|cyber|cryptograph', re.IGNORECASE),
        'chemistry': re.compile(r'chemi|molecul|reaction|compound|catalyst|synthesis', re.IGNORECASE),
        'math_stats': re.compile(r'mathematic|statistic|probabilit|theorem|proof|algebra|geometr', re.IGNORECASE),
        'neuroscience': re.compile(r'neuro|brain|cognit|neural|cortex|synap', re.IGNORECASE),
    }

    counts = Counter()

    for text in df["search_text"].to_list():
        if text:
            for theme, pattern in themes.items():
                if pattern.search(text):
                    counts[theme] += 1

    return counts


def main():
    sql_path = Path(__file__).parent / "skygest-data.sql"

    print("Loading data...")
    df = load_data(sql_path)
    total = len(df)
    print(f"Total posts: {total:,}\n")

    # Link type breakdown
    print("=" * 60)
    print("LINK TYPE BREAKDOWN")
    print("=" * 60)
    link_counts, posts_with_links = analyze_link_types(df)

    for name, count in sorted(link_counts.items(), key=lambda x: -x[1]):
        pct = count / total * 100
        print(f"  {name:20} {count:6,} ({pct:5.1f}%)")

    print(f"\n  Posts with recognized links: {posts_with_links:,}")

    # arXiv categories
    print("\n" + "=" * 60)
    print("ARXIV CATEGORIES (extracted from text)")
    print("=" * 60)
    categories, unique_arxiv_ids = extract_arxiv_categories(df)

    print(f"\n  Unique arXiv paper IDs found: {unique_arxiv_ids:,}")
    print("\n  Top categories mentioned:")
    for cat, count in categories.most_common(25):
        print(f"    {cat:20} {count:5,}")

    # Thematic analysis
    print("\n" + "=" * 60)
    print("CONTENT THEMES")
    print("=" * 60)
    themes = analyze_content_themes(df)

    for theme, count in themes.most_common():
        pct = count / total * 100
        print(f"  {theme:25} {count:6,} ({pct:5.1f}%)")

    # Sample posts
    print("\n" + "=" * 60)
    print("SAMPLE ARXIV POSTS")
    print("=" * 60)
    for i, sample in enumerate(sample_posts_by_type(df, 'arxiv', 3), 1):
        print(f"\n[{i}] {sample}")

    print("\n" + "=" * 60)
    print("SAMPLE BIORXIV POSTS")
    print("=" * 60)
    for i, sample in enumerate(sample_posts_by_type(df, 'biorxiv', 3), 1):
        print(f"\n[{i}] {sample}")

    print("\n" + "=" * 60)
    print("SAMPLE NATURE POSTS")
    print("=" * 60)
    for i, sample in enumerate(sample_posts_by_type(df, 'nature', 3), 1):
        print(f"\n[{i}] {sample}")


if __name__ == "__main__":
    main()
