export const GLOSSARY_CONTENT = `# Skygest Knowledge Base — Domain Glossary

## Entities

**Expert** — A Bluesky account tracked as a domain authority. Belongs to a knowledge domain (currently "energy"), has a tier classifying authority level. Identified by DID.

**KnowledgePost** — A Bluesky post by a tracked expert that matched at least one ontology topic. Contains text, AT Protocol URI, author DID, matched topics with scores, and extracted links.

**Link** — A URL embedded in a KnowledgePost with extracted metadata: title, description, image URL, and hostname. Filterable by hostname (e.g., "reuters.com", "canary.media").

**Topic (Canonical Topic)** — A human-facing category for post classification. ~30 topics (e.g., "solar", "hydrogen", "offshore-wind", "energy-storage", "grid-and-infrastructure", "carbon-capture", "energy-policy", "energy-markets", "critical-minerals"). Each aggregates ontology concepts and defines matching terms, hashtags, and signal domains.

**Concept (Ontology Concept)** — Fine-grained node in the SKOS-style ontology hierarchy. ~92 concepts (e.g., "Perovskite", "SMR", "HeatPumps", "EVCharging"). Have broader/narrower relationships and map to at most one canonical topic.

**Publication** — A news domain tracked by hostname (e.g., "utilitydive.com", "heatmap.news"). Has a tier and source.

**Editorial Pick** — A post selected for the curated feed, annotated with score (0-100), reason, and category. Status: active, expired, or retracted.

## Enums

**ExpertTier** — "energy-focused" (dedicated energy journalists/analysts), "general-outlet" (mainstream media), "independent" (default; individual commentators).

**MatchSignal** — How a post matched a topic: "term" (keyword in text), "hashtag" (tag on post), "domain" (hostname of embedded link).

**EditorialPickCategory** — "breaking" (time-sensitive), "analysis" (deep dives), "discussion" (debate), "data" (statistics), "opinion" (commentary).

**OntologyTopicView** — "facets" returns ~30 canonical topics; "concepts" returns all ~92 ontology nodes.

**OntologyExpandMode** — "exact" (direct match), "descendants" (narrower sub-topics), "ancestors" (broader parents).

## Identifiers

**DID** — Decentralized Identifier, e.g. did:plc:abc123. Persistent Bluesky identity.

**AT URI** — AT Protocol resource address: at://did/collection/rkey. Primary key for posts.

**Knowledge Domain** — Subject area (currently only "energy").

## Data Flow

Experts post on Bluesky → ingest pipeline fetches posts → ontology matcher classifies by topic (term/hashtag/domain signals) → matched posts stored → curators submit editorial picks with scores → curated feed serves top picks by score, filterable by topic.`;
