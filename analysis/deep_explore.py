#!/usr/bin/env python3
"""Deep exploration of Skygest data - understanding what we actually have."""

import re
import sqlite3
from collections import Counter, defaultdict
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


def extract_all_urls(text: str) -> list[dict]:
    """Extract all URLs with their types from text."""
    if not text:
        return []

    urls = []
    url_pattern = re.compile(r'(https?://[^\s<>"{}|\\^`\[\]]+)', re.IGNORECASE)

    for match in url_pattern.finditer(text):
        url = match.group(1).rstrip('.,;:)')
        urls.append(classify_url(url))

    return urls


def classify_url(url: str) -> dict:
    """Classify a URL into source type and extract metadata."""
    url_lower = url.lower()

    # arXiv
    arxiv_match = re.search(r'arxiv\.org/(?:abs|pdf)/(\d{4}\.\d{4,5})', url_lower)
    if arxiv_match:
        return {'type': 'arxiv', 'id': arxiv_match.group(1), 'url': url}

    # bioRxiv
    biorxiv_match = re.search(r'biorxiv\.org/content/(10\.\d+/[\d.]+)', url_lower)
    if biorxiv_match:
        return {'type': 'biorxiv', 'doi': biorxiv_match.group(1), 'url': url}
    if 'biorxiv.org' in url_lower:
        return {'type': 'biorxiv', 'url': url}

    # medRxiv
    medrxiv_match = re.search(r'medrxiv\.org/content/(10\.\d+/[\d.]+)', url_lower)
    if medrxiv_match:
        return {'type': 'medrxiv', 'doi': medrxiv_match.group(1), 'url': url}
    if 'medrxiv.org' in url_lower:
        return {'type': 'medrxiv', 'url': url}

    # DOI links
    doi_match = re.search(r'(?:doi\.org|dx\.doi\.org)/(10\.\d+/[^\s]+)', url_lower)
    if doi_match:
        doi = doi_match.group(1).rstrip('.,;:)')
        return {'type': 'doi', 'doi': doi, 'url': url}

    # Nature
    if 'nature.com' in url_lower:
        return {'type': 'nature', 'url': url}

    # Science
    if 'science.org' in url_lower:
        return {'type': 'science', 'url': url}

    # PubMed
    pubmed_match = re.search(r'pubmed\.ncbi\.nlm\.nih\.gov/(\d+)', url_lower)
    if pubmed_match:
        return {'type': 'pubmed', 'pmid': pubmed_match.group(1), 'url': url}
    if 'ncbi.nlm.nih.gov' in url_lower:
        return {'type': 'pubmed', 'url': url}

    # Elsevier / ScienceDirect
    if 'sciencedirect.com' in url_lower or 'elsevier.com' in url_lower:
        return {'type': 'elsevier', 'url': url}

    # Springer
    if 'springer.com' in url_lower or 'link.springer' in url_lower:
        return {'type': 'springer', 'url': url}

    # Wiley
    if 'wiley.com' in url_lower or 'onlinelibrary.wiley' in url_lower:
        return {'type': 'wiley', 'url': url}

    # PLOS
    if 'plos' in url_lower:
        return {'type': 'plos', 'url': url}

    # SSRN
    if 'ssrn.com' in url_lower:
        return {'type': 'ssrn', 'url': url}

    # ResearchGate
    if 'researchgate.net' in url_lower:
        return {'type': 'researchgate', 'url': url}

    # GitHub
    if 'github.com' in url_lower:
        return {'type': 'github', 'url': url}

    # HuggingFace
    if 'huggingface.co' in url_lower:
        return {'type': 'huggingface', 'url': url}

    # JAMA
    if 'jamanetwork.com' in url_lower:
        return {'type': 'jama', 'url': url}

    # Lancet
    if 'thelancet.com' in url_lower:
        return {'type': 'lancet', 'url': url}

    # BMJ
    if 'bmj.com' in url_lower:
        return {'type': 'bmj', 'url': url}

    # PNAS
    if 'pnas.org' in url_lower:
        return {'type': 'pnas', 'url': url}

    # Cell
    if 'cell.com' in url_lower:
        return {'type': 'cell', 'url': url}

    # ACS (American Chemical Society)
    if 'pubs.acs.org' in url_lower:
        return {'type': 'acs', 'url': url}

    # Oxford Academic
    if 'academic.oup.com' in url_lower:
        return {'type': 'oxford', 'url': url}

    # Cambridge
    if 'cambridge.org' in url_lower:
        return {'type': 'cambridge', 'url': url}

    # Taylor & Francis
    if 'tandfonline.com' in url_lower:
        return {'type': 'taylor_francis', 'url': url}

    # SAGE
    if 'sagepub.com' in url_lower:
        return {'type': 'sage', 'url': url}

    return {'type': 'other', 'url': url}


def categorize_source(source_type: str) -> str:
    """Categorize sources into higher-level groups."""
    preprints = {'arxiv', 'biorxiv', 'medrxiv', 'ssrn', 'researchgate'}
    high_impact = {'nature', 'science', 'cell', 'lancet', 'jama', 'bmj', 'pnas'}
    publishers = {'elsevier', 'springer', 'wiley', 'oxford', 'cambridge', 'taylor_francis', 'sage', 'acs', 'plos'}
    code_data = {'github', 'huggingface'}

    if source_type in preprints:
        return 'Preprint'
    elif source_type in high_impact:
        return 'High-Impact Journal'
    elif source_type in publishers:
        return 'Publisher'
    elif source_type in code_data:
        return 'Code/Data'
    elif source_type == 'doi':
        return 'DOI (unclassified)'
    elif source_type == 'pubmed':
        return 'PubMed'
    else:
        return 'Other'


def analyze_arxiv_fields(df: pl.DataFrame) -> dict:
    """Analyze arXiv papers by field based on paper IDs."""
    # arXiv ID format: YYMM.NNNNN
    # First two digits of NNNNN indicate the primary category
    # But we can also look for category mentions in text

    category_pattern = re.compile(
        r'\b(astro-ph(?:\.[A-Z]{2})?|'
        r'cond-mat(?:\.[a-z-]+)?|'
        r'cs\.[A-Z]{2}|'
        r'econ\.[A-Z]{2}|'
        r'eess\.[A-Z]{2}|'
        r'gr-qc|'
        r'hep-(?:ex|lat|ph|th)|'
        r'math(?:\.[A-Z]{2})?|'
        r'math-ph|'
        r'nlin\.[A-Z]{2}|'
        r'nucl-(?:ex|th)|'
        r'physics\.[a-z-]+|'
        r'q-bio\.[A-Z]{2}|'
        r'q-fin\.[A-Z]{2}|'
        r'quant-ph|'
        r'stat\.[A-Z]{2})\b',
        re.IGNORECASE
    )

    categories = Counter()
    posts_with_category = 0

    for text in df["search_text"].to_list():
        if text:
            cats = category_pattern.findall(text.lower())
            if cats:
                posts_with_category += 1
                categories.update(cats)

    # Group into main fields
    field_groups = {
        'Computer Science': [c for c in categories if c.startswith('cs.')],
        'Physics': [c for c in categories if any(c.startswith(p) for p in ['physics.', 'hep-', 'gr-qc', 'quant-ph', 'nucl-', 'astro-ph', 'cond-mat'])],
        'Mathematics': [c for c in categories if c.startswith('math')],
        'Statistics': [c for c in categories if c.startswith('stat.')],
        'Biology': [c for c in categories if c.startswith('q-bio')],
        'Economics/Finance': [c for c in categories if c.startswith(('econ.', 'q-fin'))],
        'Electrical Engineering': [c for c in categories if c.startswith('eess.')],
    }

    field_counts = {}
    for field, cats in field_groups.items():
        field_counts[field] = sum(categories[c] for c in cats)

    return {
        'categories': categories,
        'field_counts': field_counts,
        'posts_with_category': posts_with_category
    }


def main():
    sql_path = Path(__file__).parent / "skygest-data.sql"
    output_dir = Path(__file__).parent / "output"
    output_dir.mkdir(exist_ok=True)

    print("Loading data...")
    df = load_data(sql_path)
    total = len(df)
    print(f"Total posts: {total:,}\n")

    # Extract all URLs from all posts
    print("Extracting and classifying URLs...")
    all_urls = []
    posts_by_source = defaultdict(list)

    for i, text in enumerate(df["search_text"].to_list()):
        urls = extract_all_urls(text)
        for url_info in urls:
            all_urls.append(url_info)
            posts_by_source[url_info['type']].append(i)

    # Count by source type
    source_counts = Counter(u['type'] for u in all_urls)

    print("\n" + "=" * 70)
    print("SOURCE BREAKDOWN (by URL count)")
    print("=" * 70)

    for source, count in source_counts.most_common(30):
        category = categorize_source(source)
        unique_posts = len(set(posts_by_source[source]))
        print(f"  {source:20} {count:6,} URLs in {unique_posts:5,} posts  [{category}]")

    # Group by category
    print("\n" + "=" * 70)
    print("SOURCE CATEGORIES")
    print("=" * 70)

    category_counts = Counter()
    for url_info in all_urls:
        category_counts[categorize_source(url_info['type'])] += 1

    for category, count in category_counts.most_common():
        pct = count / len(all_urls) * 100
        print(f"  {category:25} {count:6,} ({pct:5.1f}%)")

    # Unique arXiv papers
    arxiv_ids = set(u.get('id') for u in all_urls if u['type'] == 'arxiv' and u.get('id'))
    print(f"\n  Unique arXiv paper IDs: {len(arxiv_ids):,}")

    # Unique DOIs
    dois = set(u.get('doi') for u in all_urls if u.get('doi'))
    print(f"  Unique DOIs: {len(dois):,}")

    # arXiv field analysis
    print("\n" + "=" * 70)
    print("ARXIV FIELDS (from category mentions in text)")
    print("=" * 70)

    arxiv_analysis = analyze_arxiv_fields(df)

    print("\nBy major field:")
    for field, count in sorted(arxiv_analysis['field_counts'].items(), key=lambda x: -x[1]):
        if count > 0:
            print(f"  {field:25} {count:5,}")

    print("\nTop specific categories:")
    for cat, count in arxiv_analysis['categories'].most_common(20):
        print(f"  {cat:20} {count:5,}")

    # Sample posts by type
    print("\n" + "=" * 70)
    print("SAMPLE POSTS BY SOURCE TYPE")
    print("=" * 70)

    texts = df["search_text"].to_list()

    for source_type in ['arxiv', 'biorxiv', 'nature', 'doi', 'github']:
        print(f"\n--- {source_type.upper()} ---")
        sample_indices = posts_by_source[source_type][:3]
        for idx in sample_indices:
            text = texts[idx]
            if text:
                display = text[:250] + "..." if len(text) > 250 else text
                display = display.replace('\n', ' ')
                print(f"  • {display}\n")

    # Posts without recognized academic links
    posts_with_academic = set()
    academic_types = {'arxiv', 'biorxiv', 'medrxiv', 'doi', 'nature', 'science',
                      'pubmed', 'elsevier', 'springer', 'wiley', 'plos', 'ssrn',
                      'jama', 'lancet', 'bmj', 'pnas', 'cell', 'acs', 'oxford',
                      'cambridge', 'taylor_francis', 'sage'}

    for source_type in academic_types:
        posts_with_academic.update(posts_by_source[source_type])

    posts_without = total - len(posts_with_academic)
    print("\n" + "=" * 70)
    print("COVERAGE ANALYSIS")
    print("=" * 70)
    print(f"  Posts with recognized academic links: {len(posts_with_academic):,} ({len(posts_with_academic)/total*100:.1f}%)")
    print(f"  Posts without recognized links: {posts_without:,} ({posts_without/total*100:.1f}%)")

    # Sample posts without recognized links
    print("\n  Sample posts without recognized academic links:")
    no_academic_indices = [i for i in range(total) if i not in posts_with_academic][:5]
    for idx in no_academic_indices:
        text = texts[idx]
        if text:
            display = text[:200] + "..." if len(text) > 200 else text
            display = display.replace('\n', ' ')
            print(f"    • {display}\n")


if __name__ == "__main__":
    main()
