#!/usr/bin/env python3
"""
Advanced Network Analysis for Skygest Data

Uses NetworkX for robust graph analysis including:
- Multiple centrality measures (degree, betweenness, closeness, eigenvector)
- Community detection with modularity scoring
- Network statistics and diagnostics
- Bot vs human classification
- Bridge node identification
"""

import json
import networkx as nx
import numpy as np
from pathlib import Path
from collections import defaultdict
import warnings
warnings.filterwarnings('ignore')

# Paths
BASE_DIR = Path(__file__).parent.parent
OUTPUT_DIR = BASE_DIR / "output"
NETWORK_DIR = OUTPUT_DIR / "network"
DATA_DIR = OUTPUT_DIR / "data"

def load_d3_network(filepath: Path) -> nx.DiGraph:
    """Load D3 network JSON into NetworkX DiGraph"""
    with open(filepath) as f:
        data = json.load(f)

    G = nx.DiGraph()

    # Add nodes with attributes
    for node in data['nodes']:
        G.add_node(
            node['id'],
            label=node.get('label', ''),
            pagerank=node.get('pagerank', 0),
            community=node.get('community', ''),
            community_size=node.get('community_size', 1)
        )

    # Add edges
    for edge in data['links']:
        G.add_edge(
            edge['source'],
            edge['target'],
            weight=edge.get('weight', 1),
            type=edge.get('type', 'unknown')
        )

    return G

def classify_account_type(label: str) -> str:
    """Classify account as bot, aggregator, institution, or human"""
    label_lower = label.lower()

    # Bot patterns
    bot_patterns = ['bot', 'arxiv-', 'biorxiv-', 'medrxiv-', 'papers.', '-papers']
    if any(p in label_lower for p in bot_patterns):
        return 'bot'

    # Aggregator patterns
    agg_patterns = ['firehose', 'news', 'feed', 'daily']
    if any(p in label_lower for p in agg_patterns):
        return 'aggregator'

    # Institution patterns (domain handles)
    if '.org' in label_lower or '.gov' in label_lower or '.edu' in label_lower:
        if 'bsky.social' not in label_lower:
            return 'institution'

    # Verified/notable patterns
    if '.com' in label_lower and 'bsky.social' not in label_lower:
        return 'notable'

    return 'human'

def compute_centrality_measures(G: nx.DiGraph) -> dict:
    """Compute multiple centrality measures"""
    print("Computing centrality measures...")

    # Convert to undirected for some measures
    G_undirected = G.to_undirected()

    centralities = {}

    # Degree centrality (in, out, total)
    centralities['in_degree'] = dict(G.in_degree())
    centralities['out_degree'] = dict(G.out_degree())
    centralities['degree'] = nx.degree_centrality(G_undirected)

    # Betweenness - identifies bridges
    centralities['betweenness'] = nx.betweenness_centrality(G_undirected, k=min(100, len(G)))

    # Closeness - how quickly info spreads from this node
    centralities['closeness'] = nx.closeness_centrality(G_undirected)

    # Eigenvector - connection to well-connected nodes
    try:
        centralities['eigenvector'] = nx.eigenvector_centrality(G_undirected, max_iter=500)
    except nx.PowerIterationFailedConvergence:
        print("  Warning: Eigenvector centrality did not converge")
        centralities['eigenvector'] = {}

    # PageRank
    centralities['pagerank'] = nx.pagerank(G, alpha=0.85)

    # HITS (hubs and authorities)
    try:
        hubs, authorities = nx.hits(G, max_iter=500)
        centralities['hubs'] = hubs
        centralities['authorities'] = authorities
    except nx.PowerIterationFailedConvergence:
        print("  Warning: HITS did not converge")
        centralities['hubs'] = {}
        centralities['authorities'] = {}

    return centralities

def detect_communities_louvain(G: nx.DiGraph) -> dict:
    """Detect communities using Louvain algorithm"""
    print("Detecting communities (Louvain)...")

    G_undirected = G.to_undirected()

    # Use greedy modularity communities
    from networkx.algorithms import community
    communities = community.greedy_modularity_communities(G_undirected)

    # Create node -> community mapping
    node_to_community = {}
    community_members = {}

    for i, comm in enumerate(communities):
        community_members[i] = list(comm)
        for node in comm:
            node_to_community[node] = i

    # Calculate modularity
    modularity = community.modularity(G_undirected, communities)

    return {
        'node_to_community': node_to_community,
        'community_members': community_members,
        'modularity': modularity,
        'n_communities': len(communities)
    }

def compute_network_statistics(G: nx.DiGraph) -> dict:
    """Compute comprehensive network statistics"""
    print("Computing network statistics...")

    G_undirected = G.to_undirected()

    stats = {
        'n_nodes': G.number_of_nodes(),
        'n_edges': G.number_of_edges(),
        'density': nx.density(G),
        'is_connected': nx.is_weakly_connected(G),
    }

    # Degree statistics
    degrees = [d for n, d in G.degree()]
    stats['avg_degree'] = np.mean(degrees)
    stats['std_degree'] = np.std(degrees)
    stats['max_degree'] = max(degrees)
    stats['min_degree'] = min(degrees)

    # In/out degree for directed
    in_degrees = [d for n, d in G.in_degree()]
    out_degrees = [d for n, d in G.out_degree()]
    stats['avg_in_degree'] = np.mean(in_degrees)
    stats['avg_out_degree'] = np.mean(out_degrees)

    # Clustering coefficient
    stats['avg_clustering'] = nx.average_clustering(G_undirected)

    # Connected components
    if nx.is_weakly_connected(G):
        stats['n_weakly_connected_components'] = 1
    else:
        stats['n_weakly_connected_components'] = nx.number_weakly_connected_components(G)

    # Strongly connected components
    stats['n_strongly_connected_components'] = nx.number_strongly_connected_components(G)

    # Reciprocity (for directed graphs)
    stats['reciprocity'] = nx.reciprocity(G)

    # Assortativity (degree correlation)
    try:
        stats['degree_assortativity'] = nx.degree_assortativity_coefficient(G)
    except:
        stats['degree_assortativity'] = None

    return stats

def identify_bridge_nodes(G: nx.DiGraph, centralities: dict, top_n: int = 20) -> list:
    """Identify nodes that bridge different communities"""
    print("Identifying bridge nodes...")

    # Bridges have high betweenness but potentially lower degree
    # They connect otherwise disconnected parts of the network

    betweenness = centralities['betweenness']
    degree = centralities['degree']

    # Calculate bridge score: high betweenness relative to degree
    bridge_scores = {}
    for node in G.nodes():
        if degree.get(node, 0) > 0:
            bridge_scores[node] = betweenness.get(node, 0) / (degree.get(node, 0.01))
        else:
            bridge_scores[node] = 0

    # Sort by bridge score
    sorted_bridges = sorted(bridge_scores.items(), key=lambda x: x[1], reverse=True)

    return sorted_bridges[:top_n]

def analyze_account_types(G: nx.DiGraph, centralities: dict) -> dict:
    """Analyze network by account type"""
    print("Analyzing by account type...")

    # Classify all nodes
    classifications = {}
    for node in G.nodes():
        label = G.nodes[node].get('label', '')
        classifications[node] = classify_account_type(label)

    # Aggregate statistics by type
    type_stats = defaultdict(lambda: {
        'count': 0,
        'total_pagerank': 0,
        'total_betweenness': 0,
        'total_in_degree': 0,
        'total_out_degree': 0,
        'nodes': []
    })

    for node, account_type in classifications.items():
        type_stats[account_type]['count'] += 1
        type_stats[account_type]['total_pagerank'] += centralities['pagerank'].get(node, 0)
        type_stats[account_type]['total_betweenness'] += centralities['betweenness'].get(node, 0)
        type_stats[account_type]['total_in_degree'] += centralities['in_degree'].get(node, 0)
        type_stats[account_type]['total_out_degree'] += centralities['out_degree'].get(node, 0)
        type_stats[account_type]['nodes'].append({
            'id': node,
            'label': G.nodes[node].get('label', ''),
            'pagerank': centralities['pagerank'].get(node, 0)
        })

    # Calculate averages
    for account_type, stats in type_stats.items():
        if stats['count'] > 0:
            stats['avg_pagerank'] = stats['total_pagerank'] / stats['count']
            stats['avg_betweenness'] = stats['total_betweenness'] / stats['count']
            stats['avg_in_degree'] = stats['total_in_degree'] / stats['count']
            stats['avg_out_degree'] = stats['total_out_degree'] / stats['count']
            # Sort nodes by pagerank
            stats['top_nodes'] = sorted(stats['nodes'], key=lambda x: x['pagerank'], reverse=True)[:10]
            del stats['nodes']  # Remove full list to save space

    return dict(type_stats)

def create_combined_ranking(centralities: dict, G: nx.DiGraph) -> list:
    """Create a combined ranking using multiple centrality measures"""
    print("Creating combined ranking...")

    # Normalize each centrality measure
    def normalize(d):
        if not d:
            return {}
        max_val = max(d.values()) if d.values() else 1
        if max_val == 0:
            return {k: 0 for k in d}
        return {k: v / max_val for k, v in d.items()}

    normalized = {
        'pagerank': normalize(centralities['pagerank']),
        'betweenness': normalize(centralities['betweenness']),
        'closeness': normalize(centralities['closeness']),
        'degree': normalize(centralities['degree']),
    }

    if centralities.get('eigenvector'):
        normalized['eigenvector'] = normalize(centralities['eigenvector'])

    # Weighted combination
    weights = {
        'pagerank': 0.3,
        'betweenness': 0.25,
        'closeness': 0.15,
        'degree': 0.15,
        'eigenvector': 0.15
    }

    combined_scores = {}
    for node in G.nodes():
        score = 0
        for metric, weight in weights.items():
            if metric in normalized:
                score += weight * normalized[metric].get(node, 0)
        combined_scores[node] = score

    # Sort and return with labels
    sorted_nodes = sorted(combined_scores.items(), key=lambda x: x[1], reverse=True)

    results = []
    for node, score in sorted_nodes[:50]:
        results.append({
            'id': node,
            'label': G.nodes[node].get('label', ''),
            'combined_score': round(score, 6),
            'pagerank': round(centralities['pagerank'].get(node, 0), 6),
            'betweenness': round(centralities['betweenness'].get(node, 0), 6),
            'closeness': round(centralities['closeness'].get(node, 0), 6),
            'degree_centrality': round(centralities['degree'].get(node, 0), 6),
            'in_degree': centralities['in_degree'].get(node, 0),
            'out_degree': centralities['out_degree'].get(node, 0),
            'account_type': classify_account_type(G.nodes[node].get('label', ''))
        })

    return results

def main():
    print("=" * 60)
    print("Advanced Network Analysis for Skygest")
    print("=" * 60)

    # Load network
    network_file = NETWORK_DIR / "d3_network.json"
    if not network_file.exists():
        print(f"Error: Network file not found: {network_file}")
        return

    G = load_d3_network(network_file)
    print(f"\nLoaded network: {G.number_of_nodes()} nodes, {G.number_of_edges()} edges")

    # Compute all analyses
    centralities = compute_centrality_measures(G)
    communities = detect_communities_louvain(G)
    stats = compute_network_statistics(G)
    bridges = identify_bridge_nodes(G, centralities)
    account_types = analyze_account_types(G, centralities)
    combined_ranking = create_combined_ranking(centralities, G)

    # Compile results
    results = {
        'network_statistics': stats,
        'community_detection': {
            'algorithm': 'greedy_modularity (Louvain-like)',
            'n_communities': communities['n_communities'],
            'modularity': round(communities['modularity'], 4),
            'community_sizes': {str(k): len(v) for k, v in communities['community_members'].items()}
        },
        'account_type_analysis': account_types,
        'combined_ranking_top_50': combined_ranking,
        'bridge_nodes': [
            {
                'id': node,
                'label': G.nodes[node].get('label', ''),
                'bridge_score': round(score, 6),
                'account_type': classify_account_type(G.nodes[node].get('label', ''))
            }
            for node, score in bridges
        ],
        'methodology': {
            'centrality_measures': ['pagerank', 'betweenness', 'closeness', 'degree', 'eigenvector', 'HITS'],
            'community_detection': 'Greedy modularity optimization',
            'combined_ranking_weights': {
                'pagerank': 0.3,
                'betweenness': 0.25,
                'closeness': 0.15,
                'degree': 0.15,
                'eigenvector': 0.15
            },
            'account_classification': 'Pattern-based (bot, aggregator, institution, notable, human)'
        }
    }

    # Save results
    output_file = NETWORK_DIR / "advanced_network_analysis.json"
    with open(output_file, 'w') as f:
        json.dump(results, f, indent=2, default=str)
    print(f"\nResults saved to: {output_file}")

    # Print summary
    print("\n" + "=" * 60)
    print("SUMMARY")
    print("=" * 60)
    print(f"\nNetwork Statistics:")
    print(f"  Nodes: {stats['n_nodes']}")
    print(f"  Edges: {stats['n_edges']}")
    print(f"  Density: {stats['density']:.4f}")
    print(f"  Avg Clustering: {stats['avg_clustering']:.4f}")
    print(f"  Reciprocity: {stats['reciprocity']:.4f}")
    print(f"  Degree Assortativity: {stats['degree_assortativity']:.4f}" if stats['degree_assortativity'] else "  Degree Assortativity: N/A")

    print(f"\nCommunity Detection:")
    print(f"  Communities found: {communities['n_communities']}")
    print(f"  Modularity score: {communities['modularity']:.4f}")

    print(f"\nAccount Type Distribution:")
    for atype, astats in account_types.items():
        print(f"  {atype}: {astats['count']} accounts, avg PageRank: {astats['avg_pagerank']:.6f}")

    print(f"\nTop 10 by Combined Ranking:")
    for i, node in enumerate(combined_ranking[:10], 1):
        print(f"  {i}. {node['label']} ({node['account_type']}) - score: {node['combined_score']:.4f}")

    print(f"\nTop Bridge Nodes (connecting different communities):")
    for node in bridges[:5]:
        label = G.nodes[node[0]].get('label', '')
        print(f"  {label} - bridge score: {node[1]:.6f}")

if __name__ == "__main__":
    main()
