#!/usr/bin/env python3
"""Analyze Skygest Bluesky feed data and output JSON for D3 visualizations."""

import json
import re
import sqlite3
from collections import Counter
from datetime import datetime
from pathlib import Path

import polars as pl


def load_data(sql_path: Path) -> pl.DataFrame:
    """Load SQL dump into a Polars DataFrame."""
    # Create in-memory SQLite database from SQL dump
    conn = sqlite3.connect(":memory:")

    with open(sql_path) as f:
        sql_content = f.read()

    conn.executescript(sql_content)

    # Query posts into Polars
    query = """
    SELECT
        uri,
        author_did,
        created_at,
        indexed_at,
        search_text,
        status
    FROM posts
    WHERE status = 'active'
    """

    df = pl.read_database(query, conn)
    conn.close()

    return df


def analyze_posts_over_time(df: pl.DataFrame) -> list[dict]:
    """Analyze post volume over time."""
    # Convert timestamps (milliseconds) to dates
    posts_by_hour = (
        df.with_columns(
            pl.from_epoch(pl.col("created_at"), time_unit="ms").alias("created_datetime")
        )
        .with_columns(
            pl.col("created_datetime").dt.truncate("1h").alias("hour")
        )
        .group_by("hour")
        .agg(pl.len().alias("count"))
        .sort("hour")
        .with_columns(
            pl.col("hour").dt.strftime("%Y-%m-%dT%H:%M:%S").alias("hour_str")
        )
    )

    return [
        {"hour": row["hour_str"], "count": row["count"]}
        for row in posts_by_hour.iter_rows(named=True)
    ]


def analyze_top_authors(df: pl.DataFrame, limit: int = 20) -> list[dict]:
    """Find the most active authors."""
    top_authors = (
        df.group_by("author_did")
        .agg(pl.len().alias("post_count"))
        .sort("post_count", descending=True)
        .head(limit)
    )

    return [
        {"author": row["author_did"], "count": row["post_count"]}
        for row in top_authors.iter_rows(named=True)
    ]


def analyze_domains(df: pl.DataFrame, limit: int = 30) -> list[dict]:
    """Extract and count linked domains from posts."""
    # Common URL patterns
    url_pattern = re.compile(r'https?://(?:www\.)?([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})')

    domain_counts: Counter[str] = Counter()

    for text in df["search_text"].to_list():
        if text:
            domains = url_pattern.findall(text.lower())
            domain_counts.update(domains)

    return [
        {"domain": domain, "count": count}
        for domain, count in domain_counts.most_common(limit)
    ]


def analyze_keywords(df: pl.DataFrame, limit: int = 50) -> list[dict]:
    """Find common academic keywords in posts."""
    # Academic/paper-related keywords to look for
    academic_patterns = [
        r'\barxiv\b', r'\bdoi\b', r'\bpaper\b', r'\bstudy\b', r'\bresearch\b',
        r'\bpublished\b', r'\bjournal\b', r'\bpreprint\b', r'\bpeer.?review',
        r'\bdata\b', r'\banalysis\b', r'\bmodel\b', r'\bneural\b', r'\bai\b',
        r'\bmachine.?learning\b', r'\bdeep.?learning\b', r'\bllm\b', r'\bgpt\b',
        r'\btransformer\b', r'\bbert\b', r'\bnlp\b', r'\bcv\b', r'\bvision\b',
        r'\bclimate\b', r'\bhealth\b', r'\bmedical\b', r'\bbiology\b', r'\bphysics\b',
        r'\bchemistry\b', r'\bmath\b', r'\bstatistics\b', r'\beconomics\b',
        r'\bpsychology\b', r'\bneuroscience\b', r'\bgenomics\b', r'\bprotein\b',
    ]

    keyword_counts: Counter[str] = Counter()

    for text in df["search_text"].to_list():
        if text:
            text_lower = text.lower()
            for pattern in academic_patterns:
                matches = re.findall(pattern, text_lower)
                if matches:
                    # Normalize the keyword
                    keyword = pattern.replace(r'\b', '').replace('.?', ' ').replace('\\', '')
                    keyword_counts[keyword] += len(matches)

    return [
        {"keyword": keyword, "count": count}
        for keyword, count in keyword_counts.most_common(limit)
    ]


def analyze_post_length_distribution(df: pl.DataFrame) -> list[dict]:
    """Analyze distribution of post lengths."""
    lengths = (
        df.with_columns(
            pl.col("search_text").str.len_chars().alias("length")
        )
        .with_columns(
            (pl.col("length") // 50 * 50).alias("bucket")
        )
        .group_by("bucket")
        .agg(pl.len().alias("count"))
        .sort("bucket")
    )

    return [
        {"bucket": row["bucket"], "count": row["count"]}
        for row in lengths.iter_rows(named=True)
        if row["bucket"] is not None
    ]


def compute_summary_stats(df: pl.DataFrame) -> dict:
    """Compute summary statistics."""
    total_posts = len(df)
    unique_authors = df["author_did"].n_unique()

    # Time range
    min_ts = df["created_at"].min()
    max_ts = df["created_at"].max()

    min_date = datetime.fromtimestamp(min_ts / 1000).isoformat() if min_ts else None
    max_date = datetime.fromtimestamp(max_ts / 1000).isoformat() if max_ts else None

    # Days running
    if min_ts and max_ts:
        days_running = (max_ts - min_ts) / (1000 * 60 * 60 * 24)
    else:
        days_running = 0

    return {
        "total_posts": total_posts,
        "unique_authors": unique_authors,
        "first_post": min_date,
        "last_post": max_date,
        "days_running": round(days_running, 1),
        "posts_per_day": round(total_posts / days_running, 1) if days_running > 0 else 0,
    }


def main():
    """Run analysis and output JSON."""
    sql_path = Path(__file__).parent / "skygest-data.sql"
    output_dir = Path(__file__).parent / "output"
    output_dir.mkdir(exist_ok=True)

    print("Loading data...")
    df = load_data(sql_path)
    print(f"Loaded {len(df):,} posts")

    print("Computing summary stats...")
    summary = compute_summary_stats(df)
    print(f"  Total posts: {summary['total_posts']:,}")
    print(f"  Unique authors: {summary['unique_authors']:,}")
    print(f"  Days running: {summary['days_running']}")
    print(f"  Posts/day: {summary['posts_per_day']}")

    print("Analyzing posts over time...")
    posts_over_time = analyze_posts_over_time(df)

    print("Finding top authors...")
    top_authors = analyze_top_authors(df)

    print("Extracting domains...")
    domains = analyze_domains(df)

    print("Counting keywords...")
    keywords = analyze_keywords(df)

    print("Analyzing post lengths...")
    post_lengths = analyze_post_length_distribution(df)

    # Combine all data
    output_data = {
        "summary": summary,
        "posts_over_time": posts_over_time,
        "top_authors": top_authors,
        "domains": domains,
        "keywords": keywords,
        "post_lengths": post_lengths,
    }

    # Write JSON output
    output_path = output_dir / "analysis.json"
    with open(output_path, "w") as f:
        json.dump(output_data, f, indent=2)

    print(f"\nOutput written to {output_path}")

    # Also write individual files for easier D3 consumption
    for key, data in output_data.items():
        individual_path = output_dir / f"{key}.json"
        with open(individual_path, "w") as f:
            json.dump(data, f, indent=2)
        print(f"  - {individual_path}")


if __name__ == "__main__":
    main()
