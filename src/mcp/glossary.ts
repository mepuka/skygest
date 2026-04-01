export const GLOSSARY_CONTENT = `# Skygest Knowledge Base — Domain Glossary

## Entities

**Expert** — A Bluesky account tracked as a domain authority. Belongs to a knowledge domain (currently "energy"), has a tier classifying authority level. Identified by DID.

**KnowledgePost** — A Bluesky post by a tracked expert that matched at least one ontology topic. Contains text, AT Protocol URI, author DID, matched topics with scores, and extracted links.

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

**curate_post** — Advance a candidate to Enriching (curate) or Rejected (reject). Curating fetches live embed data from Bluesky, captures the payload, and queues enrichment. Requires curation:write scope.

**submit_editorial_pick** — Accept a reviewable brief into the curated feed with a quality score, reason, and optional category. Requires editorial:write scope.

## Decision Audit

All pipeline transitions are logged with actor and timestamp for audit trail reconstruction.`;
