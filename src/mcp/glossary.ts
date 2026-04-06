export const GLOSSARY_CONTENT = `# Skygest Knowledge Base — Domain Glossary

## Entities

**Expert** — A Bluesky account tracked as a domain authority. Belongs to a knowledge domain (currently "energy"), has a tier classifying authority level. Identified by DID.

**KnowledgePost** — A Bluesky post by a tracked expert that matched at least one ontology topic. Contains text, AT Protocol URI, author DID, matched topics with scores, and extracted links.

**search_posts** — Full-text search over KnowledgePosts. Matches post body text, tracked expert handles, and stored topic-match terms. Full handle strings like \`solar-desk.bsky.social\` are treated as exact handle phrases. Query syntax supports quoted phrases (e.g. \`"solar storage"\`), boolean logic (\`solar OR hydrogen\`, \`solar NOT wind\`), and prefix search with \`*\` (e.g. \`electro*\`). Use \`topic\`, \`since\`, and \`until\` to narrow broad searches.

**Link** — A URL embedded in a KnowledgePost with extracted metadata: title, description, image URL, and hostname. Filterable by hostname (e.g., "reuters.com", "canary.media").

**Topic (Canonical Topic)** — A human-facing category for post classification. ~30 topics (e.g., "solar", "hydrogen", "offshore-wind", "energy-storage", "grid-and-infrastructure", "carbon-capture", "energy-policy", "energy-markets", "critical-minerals"). Each aggregates ontology concepts and defines matching terms, hashtags, and signal domains.

**Concept (Ontology Concept)** — Fine-grained node in the SKOS-style ontology hierarchy. ~92 concepts (e.g., "Perovskite", "SMR", "HeatPumps", "EVCharging"). Have broader/narrower relationships and map to at most one canonical topic.

**Publication** — A news domain tracked by hostname (e.g., "utilitydive.com", "heatmap.news"). Has a tier and source classification.

**Editorial Pick** — A post selected for the curated feed, annotated with score (0-100), reason, and optional category. The MCP tool returns only active, non-expired picks; status and expiry are managed internally.

**Thread** — A conversation on Bluesky: a chain of reply posts. The \`get_post_thread\` tool fetches ancestors (parent posts), the focus post, and replies with engagement counts (likes, reposts, reply counts). Thread data comes from the live Bluesky API, not the local knowledge store. The \`createdAt\` field is an ISO timestamp from the post record (authored time).

## Enums

**ExpertTier** — "energy-focused" (dedicated energy journalists/analysts), "general-outlet" (mainstream media), "independent" (default; individual commentators).

**MatchSignal** — How a post matched a topic: "term" (keyword in text), "hashtag" (tag on post), "domain" (hostname of embedded link).

**EditorialPickCategory** — "breaking" (time-sensitive), "analysis" (deep dives), "discussion" (debate), "data" (statistics), "opinion" (commentary). Category may be null.

**PublicationTier** — "energy-focused" (dedicated energy outlets), "general-outlet" (mainstream media), "unknown" (discovered but unclassified).

**PublicationSource** — "seed" (from ontology manifest), "discovered" (observed in ingested links).

**OntologyTopicView** — "facets" returns ~30 canonical topics; "concepts" returns all ~92 ontology nodes.

**OntologyExpandMode** — "exact" (direct match), "descendants" (narrower sub-topics), "ancestors" (broader parents).

## Identifiers

**DID** — Decentralized Identifier, e.g. did:plc:abc123. Persistent Bluesky identity.

**AT URI** — AT Protocol resource address: at://did/collection/rkey. Primary key for posts.

**Knowledge Domain** — Subject area (currently only "energy").

## Data Flow

Experts post on Bluesky → ingest pipeline fetches posts → ontology matcher classifies by topic (term/hashtag/domain signals) → matched posts stored with extracted link metadata (title, description, image, hostname) → curators submit editorial picks with scores → curated feed serves top picks by score, filterable by topic.

Search reads both the post body and selected derived metadata. That means a query can match because the text says it directly, because the author handle is indexed, or because the ontology matcher attached a topic term such as \`pv\` or \`interconnection\`.

## Display Convention

Tool responses include a \`_display\` field with a compact text summary using addressable IDs:
- \`[P1]\`, \`[P2]\` — Posts (with URI on a separate line for follow-up)
- \`[L1]\`, \`[L2]\` — Links (with URL and postUri)
- \`[E1]\`, \`[E2]\` — Experts (with DID)
- \`[T1]\`, \`[T2]\` — Topics (with slug)
- \`[M1]\`, \`[M2]\` — Topic match explanations
- \`[K1]\`, \`[K2]\` — Editorial picks (with postUri)
- \`[A1]\`, \`[A2]\` — Thread ancestors (oldest first)
- \`[F]\` — Thread focus post
- \`[R1]\`, \`[R2]\` — Thread replies

Use \`_display\` for reading results at a glance. Reference items by their identifier from the structured \`items\` array for follow-up tool calls (e.g., \`items[n].uri\` for posts, \`items[n].did\` for experts).

## Pipeline Stages

**Discovered** — Raw post ingested, no curation record yet.

**Candidate** — Post flagged by curation predicates, awaiting review. Has a signal score (0-100) and list of matched predicates.

**Enriching** — Post curated, enrichment in progress. Vision analyzes charts/screenshots; source attribution identifies content providers.

**Reviewable** — All enrichments complete. Ready for editorial decision.

**Accepted** — Editorial pick submitted. Brief is in the curated feed with score, reason, and category.

**Rejected** — Curator dismissed the candidate.

**Retracted** — Accepted brief withdrawn from feed.

**Expired** — Accepted brief auto-expired by time.

## Enrichment Readiness

**none** — Not curated, no enrichment queued.

**pending** — Enrichment queued or running.

**complete** — All enrichments finished successfully.

**failed** — At least one enrichment failed.

**needs-review** — Enrichment output flagged by quality gate for manual review.

## Read Tools

**get_post_enrichments** — Inspect enrichment state and readiness for a post. Returns validated enrichment payloads and run summaries. Use to verify a candidate is Reviewable before accepting as a brief.

## Write Tools

**import_posts** — Import normalized experts and posts through the same pipeline as the admin import endpoint. Stores experts and posts, captures embed payloads when present, and flags imported posts for curation review. Requires ops:refresh scope.

**curate_post** — Advance a candidate to Enriching (curate) or Rejected (reject). Curating captures embed data for enrichment. For Bluesky posts, fetches live data. For Twitter posts, uses stored import data. Call start_enrichment separately to queue enrichment processing. Requires curation:write scope.

**start_enrichment** — Queue enrichment for a curated post. Auto-detects type from embed (vision for charts/screenshots, source-attribution for links). For visual posts, source-attribution is automatically chained after vision completes. Use get_post_enrichments to poll readiness. Requires curation:write scope.

**submit_editorial_pick** — Accept a reviewable brief into the curated feed with a quality score, reason, and optional category. Post must have enrichment readiness = complete. Requires editorial:write scope.

## Decision Audit

All pipeline transitions are logged with actor and timestamp for audit trail reconstruction.

## Editorial Concepts

**Expert-Data-Argument Link** — The core unit of editorial value. Which expert chose which data to make which argument at which discourse level. A post is valuable when this link is strong: the expert is making a specific argument using specific data. A chart alone is not the product; an expert name alone is not the product. It is the expert's choice to use this specific data to make this specific argument.

**Discourse Level** — A five-level hierarchy describing where an expert's argument operates. A single data point ripples upward through all levels:
- Technical: can the technology do what is claimed?
- Economic: do the unit economics work?
- Policy: is the regulatory/market framework supportive?
- Political: what political forces shape the discourse?
- Strategic: what is the right long-term pathway?

**Story Mode** — The lifecycle stage of a story cluster:
- Breaking (0-6h): speed + attribution
- Developing (6-48h): facts + expert interpretation
- Analysis (48h+): depth, authoritative data, consensus/dissent
- Recurring (periodic): known data release drops with chart analysis

**Question-Based Clustering** — Stories are clustered by the implicit question being debated, not by topic overlap. "Can new nuclear be built affordably?" is a story; "Nuclear news roundup" is not. Story headlines name the question and the tension.

**Expert Credibility** — Three dimensions orthogonal to domain tier:
- Analytical honesty: derives conclusions from data, not ideology
- Track record: directionally correct over time, updates positions
- Rigorous data treatment: cites primary sources, contextualizes data, notes limitations

**Narrative Arc** — A long-running thematic question tracked across multiple story clusters over weeks or months. Stories belong to narrative arcs; arcs provide context for future curation.`;

