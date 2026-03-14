# Search Infrastructure Specification

**Date:** 2026-03-14
**Scope:** FTS5 on Cloudflare D1, ontology-powered topic resolution, API surface, and recommendations

---

## 1. Executive Summary

Skygest runs a **hybrid search architecture** on Cloudflare D1:

- **FTS5** for keyword/relevance ranking (BM25)
- **Ontology-powered topic filtering** with a SKOS concept hierarchy (31 canonical topics, 92 concepts)
- **Multi-signal matching** at ingest time (term, hashtag, domain) stored as provenance in `post_topics`

The current implementation is **fundamentally sound** — clean layering, Effect-based error propagation, schema-validated I/O, and proper FTS5 usage. However, several FTS5 capabilities are left on the table, the ontology-to-search bridge has a resolution gap, and the FTS table design carries an unnecessary storage penalty. This document catalogs specific findings and actionable recommendations.

---

## 2. Current Architecture

### 2.1 Data Flow

```
Ingest Pipeline
  ┌─────────────┐     ┌──────────────────┐     ┌───────────────────┐
  │ Bluesky Post │────▶│ OntologyCatalog  │────▶│  KnowledgeRepoD1  │
  │  (text, URIs │     │   .match()       │     │  upsertPosts()    │
  │   hashtags)  │     │ multi-signal     │     │  ▸ posts table    │
  └─────────────┘     │ matcher          │     │  ▸ post_topics    │
                      └──────────────────┘     │  ▸ posts_fts      │
                                                │  ▸ links          │
                                                └───────────────────┘

Query Pipeline
  ┌───────────────┐    ┌────────────────────┐    ┌──────────────────┐
  │ API / MCP     │───▶│ KnowledgeQuery     │───▶│ KnowledgeRepoD1  │
  │ ?q=solar      │    │ Service            │    │  searchPosts()   │
  │ &topic=solar  │    │ resolveTopicSlugs  │    │  FTS5 MATCH +    │
  └───────────────┘    │ expandTopics(desc) │    │  topic EXISTS    │
                       └────────────────────┘    └──────────────────┘
```

### 2.2 FTS5 Table Definition

```sql
CREATE VIRTUAL TABLE IF NOT EXISTS posts_fts USING fts5(
  uri UNINDEXED,
  text
)
```

**Design:** Standalone FTS5 table (not external-content). The `uri` column is stored `UNINDEXED` for row identification. The `text` column is the full-text indexed content.

### 2.3 Search Query (KnowledgeRepoD1.ts:476-497)

```sql
SELECT p.uri, p.did, e.handle, p.text, p.created_at,
       group_concat(DISTINCT pt.topic_slug) as topicsCsv
FROM (
  SELECT uri, rank FROM posts_fts
  WHERE posts_fts MATCH ${trimmed}
) search
JOIN posts p ON p.uri = search.uri
JOIN experts e ON e.did = p.did
LEFT JOIN post_topics pt ON pt.post_uri = p.uri
WHERE p.status = 'active'
  [AND p.created_at >= ${since}]
  [AND p.created_at <= ${until}]
  [AND EXISTS (topic filter)]
GROUP BY p.uri, p.did, e.handle, p.text, p.created_at, search.rank
ORDER BY search.rank, p.created_at DESC, p.uri ASC
LIMIT ${limit ?? 20}
```

### 2.4 Ontology Matching Pipeline

```
MatchInput { text, hashtags?, domains?, metadataTexts? }
    │
    ▼
normalizeText() → haystack: " normalized text content "
    │
    ▼
For each canonical topic (31):
  ├── Text terms:    ` ${normalizedTerm} ` in haystack? (score: 1 single-word, 2 multi-word)
  ├── Hashtags:      exact set membership (score: 3)
  └── Domains:       exact or subdomain match (score: 4)
    │
    ▼
Winner by: score DESC → term length DESC → alphabetical
    │
    ▼
MatchedTopic { topicSlug, matchSignal, matchValue, matchScore, ontologyVersion, matcherVersion }
```

### 2.5 Topic Expansion at Query Time

```
resolveTopicSlugs("solar")
  → expandTopics(["solar"], "descendants")
  → {canonicalTopicSlugs: ["solar"]}  // Only solar — no descendant TOPICS
  → SQL: WHERE post_topics.topic_slug = 'solar'
```

---

## 3. Findings

### 3.1 FTS5 Configuration Gaps

#### F1: No tokenizer specified — defaults to `unicode61`

**Current:** `USING fts5(uri UNINDEXED, text)` — no `tokenize` clause.

**Impact:** The default `unicode61` tokenizer does exact word matching only. A search for "connecting" will **not** match a post containing "connected" or "connection". For an energy domain knowledge base where morphological variation is common (e.g., "generating"/"generation"/"generated"), this is a significant recall loss.

**Recommendation:** Add Porter stemming:

```sql
CREATE VIRTUAL TABLE IF NOT EXISTS posts_fts USING fts5(
  uri UNINDEXED,
  text,
  tokenize='porter unicode61'
)
```

Porter stemming maps "generating" → "generat", "connected" → "connect", etc. This is the standard choice for English-language FTS5 corpora and is natively supported in D1.

#### F2: No prefix indexes for typeahead

**Current:** No `prefix` option. Prefix queries (`solar*`) work but require a full index scan.

**Impact:** If you ever expose typeahead/autocomplete, prefix queries will be slow.

**Recommendation:** Add `prefix='2 3'` if/when typeahead is needed. Not urgent for current API.

#### F3: Standalone FTS5 table duplicates content

**Current:** `posts_fts` stores its own copy of `text`. The same text is also in `posts.text`. This doubles the storage for post content.

**Impact:** D1 has a 10 GB limit per database. With full content duplication, you hit that ceiling at ~5 GB of actual post content. For a growing knowledge base, this is material.

**Recommendation:** Switch to an **external-content FTS5 table** that indexes the content from `posts` without storing it:

```sql
CREATE VIRTUAL TABLE IF NOT EXISTS posts_fts USING fts5(
  text,
  content='posts',
  content_rowid='rowid',
  tokenize='porter unicode61'
);
```

**Trade-off:** External-content tables require manual sync (inserts/deletes into the FTS table mirror the base table). The current upsert code already does this explicitly (delete-then-insert pattern in `makeUpsertStatements`), so the migration path is straightforward. The `uri UNINDEXED` column becomes unnecessary since you join on rowid.

**Caveat:** D1 has a [known bug](https://github.com/cloudflare/workers-sdk/issues/9519) where exporting databases with virtual tables can crash the database. Design FTS tables to be rebuildable from the base `posts` table.

#### F4: `highlight()` and `snippet()` not used

**Current:** The search query returns raw `p.text` from the base table, not from FTS5 auxiliary functions.

**Impact:** Consumers (MCP clients, API callers) receive full post text with no indication of which parts matched the query. For MCP tool consumers, this makes search results harder to parse.

**Recommendation:** Add `snippet()` to the search response:

```sql
SELECT ...,
  snippet(posts_fts, 0, '<mark>', '</mark>', '...', 30) as matchSnippet
FROM posts_fts ...
```

This requires either the standalone table (current) or external-content with `content=`. Contentless tables cannot use `highlight()`/`snippet()`.

#### F5: No FTS5 `optimize` maintenance

**Current:** No periodic optimization of the FTS index.

**Impact:** As posts accumulate, the FTS5 b-tree structure fragments across multiple segments. Query performance degrades over time.

**Recommendation:** Run `INSERT INTO posts_fts(posts_fts) VALUES('optimize')` periodically — e.g., after each ingest run completes, or via a scheduled cron trigger. This merges all b-tree segments. On D1, this should complete well within the 30-second query timeout for datasets under a few hundred thousand posts.

### 3.2 Ontology-to-Search Resolution Gap

#### F6: Topic expansion only resolves to canonical topic slugs, not concept slugs

**Current flow:**
1. User queries `?topic=solar`
2. `resolveTopicSlugs("solar")` calls `expandTopics(["solar"], "descendants")`
3. `resolveExpansion` adds the canonical topic slug `"solar"` and its `conceptSlugs` (`["RooftopSolar", "Solar"]`) to `resolved`
4. But then extracts only `canonicalTopicSlugs` — which is just `["solar"]`
5. SQL filters: `WHERE topic_slug = 'solar'`

**Problem:** At ingest time, `matchTopics()` returns `topicSlug` set to the **canonical topic slug** (e.g., `"solar"`), not the SKOS concept slug. So the stored `post_topics.topic_slug` is always a canonical topic slug. This means the resolution gap doesn't cause data loss today.

**However:** The `resolveTopicSlugs` function is doing unnecessary work — it expands to descendants and collects concepts, but only canonical topic slugs end up in the SQL. The expansion is conceptually correct (preparing for the future) but operationally a no-op. If the matcher ever starts storing concept-level slugs (e.g., `"RooftopSolar"` instead of `"solar"`), the current SQL filter would silently miss them.

**Recommendation:** Document this as an intentional design decision or change the matcher to store concept-level granularity in `post_topics`. If concept-level storage is adopted, the existing expansion logic already handles it correctly.

#### F7: FTS5 query is ontology-unaware

**Current:** FTS5 `MATCH` operates on raw post text. The ontology's rich term vocabulary is not used to expand search queries.

**Example:** User searches `?q=photovoltaic`. FTS5 matches only posts containing the literal word "photovoltaic". Posts about "solar panels" (same ontology topic, different terms) are not returned unless they also contain "photovoltaic".

**Recommendation:** Implement **ontology-aware query expansion** at the query service layer:

```typescript
// KnowledgeQueryService.searchPosts
const searchPosts = Effect.fn("...")(function* (input: SearchPostsInput) {
  const topicSlugs = yield* resolveTopicSlugs(input.topic);

  // NEW: If query matches a known ontology term, expand to include synonyms
  const expandedQuery = yield* expandSearchQuery(input.query);

  return yield* knowledgeRepo.searchPosts({
    query: expandedQuery,  // e.g., "photovoltaic OR solar OR pv"
    ...
  });
});
```

FTS5 supports boolean queries natively: `photovoltaic OR "solar panel" OR pv`. The ontology already contains the synonym/term mappings per topic. This bridges the gap between FTS5 lexical search and the ontology's semantic model.

**Trade-off:** This expands recall at the potential cost of precision. It should be opt-in (e.g., `?expand=true` query parameter) or applied only when the initial FTS5 query returns few results.

### 3.3 Query Safety and Performance

#### F8: No input sanitization for FTS5 MATCH syntax

**Current:** The raw trimmed query string is passed directly to `MATCH`:

```typescript
WHERE posts_fts MATCH ${trimmed}
```

**Impact:** FTS5 MATCH has its own query syntax. Users can inject operators: `solar NOT wind`, `solar*`, `"exact phrase"`, `NEAR(solar wind)`, `title:solar`. If the query contains unbalanced quotes or invalid syntax, FTS5 throws an error.

**Recommendation:** Either:

1. **Sanitize:** Strip or escape FTS5 operators from user input before passing to MATCH. Treat all queries as simple term lists.
2. **Expose:** Document the FTS5 query syntax as a feature and handle parse errors gracefully with a `400 Bad Request` response.
3. **Hybrid:** Default to sanitized mode, offer a `?syntax=fts5` parameter for power users.

Minimal sanitization:
```typescript
const sanitizeFtsQuery = (query: string) =>
  query
    .replace(/[":*^{}()\[\]]/g, ' ')  // strip FTS5 special chars
    .replace(/\b(AND|OR|NOT|NEAR)\b/gi, '')  // strip boolean operators
    .replace(/\s+/g, ' ')
    .trim();
```

#### F9: No search result count / total

**Current:** `searchPosts` returns at most `limit` rows with no total count or pagination cursor.

**Impact:** API consumers cannot determine if more results exist. The search endpoint returns `page.nextCursor: null` always (hardcoded in `Router.ts:142`).

**Recommendation:** Add cursor-based pagination to search results using the same `(rank, created_at, uri)` compound sort. This requires returning `limit + 1` rows and using the last row as the cursor, mirroring the pattern already used in `getRecentPostsPage`.

#### F10: Missing index on `post_topics(post_uri)` for the topic filter subquery

**Current indexes:**
- `idx_post_topics_topic_slug_post_uri` — `(topic_slug, post_uri)` — covers lookup by topic
- `idx_post_topics_post_uri_topic_slug` — `(post_uri, topic_slug)` — covers EXISTS subquery

**Assessment:** The existing composite index `(post_uri, topic_slug)` covers the `EXISTS` subquery correctly. No action needed.

### 3.4 API and Domain Modeling

#### F11: Search and browse are separate code paths with no shared abstraction

**Current:**
- `searchPosts` — FTS5 MATCH + relevance ranking
- `getRecentPosts` / `getRecentPostsPage` — chronological scan with optional topic filter

These share the same output type (`KnowledgePostResult`) but have completely separate SQL queries, parameter handling, and pagination logic.

**Assessment:** This is actually fine. The two access patterns have fundamentally different indexing strategies (FTS5 rank vs. `created_at DESC`). Forcing them into a shared query builder would add complexity for no performance gain. The current separation is a strength.

#### F12: MCP tools mirror the API surface cleanly

**Assessment:** The `KnowledgeMcpToolkit` has a 1:1 mapping with `KnowledgeQueryService` methods. Each tool is annotated `Readonly`, `Idempotent`, and `!Destructive`. The MCP layer adds no business logic — it's a thin adapter. This is correct.

#### F13: `KnowledgePostResult.topics` is a flat string array

**Current:** Search and browse results return `topics: string[]` — just slugs.

**Impact:** MCP consumers and API callers cannot determine *why* a post matched a topic or *which signal* drove the match without a separate `explainPostTopics` call.

**Recommendation:** Consider a richer result format for search specifically:

```typescript
// Enhanced search result
{
  uri, did, handle, text, createdAt,
  topics: ["solar", "energy-policy"],
  matchSnippet: "...new <mark>solar</mark> farm in Nevada...",
  relevanceScore: -2.34  // raw BM25 rank
}
```

This adds the snippet (F4) and exposes the FTS5 rank score. The current flat `topics` array is sufficient for browse/recent but undersells search.

### 3.5 Ontology Model Integrity

#### F14: Multi-signal matcher correctly prioritizes domain > hashtag > text

**Assessment:** The scoring model (domain:4, hashtag:3, multi-word-term:2, single-word-term:1) with ambiguity filtering for single-word terms is well-designed. The `compareEvidence` tiebreaker (score → term length → alpha) produces deterministic results.

#### F15: Ambiguity terms are global, not per-topic

**Current:** `signalCatalog.ambiguityTerms` is a flat list (e.g., "battery", "grid", "gas"). Single-word terms in this list are suppressed for *all* topics.

**Impact:** If "battery" is ambiguous, it's filtered even for the "energy-storage" topic where it's highly relevant. The current workaround is that multi-word terms like "battery storage" (score:2) bypass the ambiguity filter.

**Recommendation:** This is acceptable as long as multi-word synonyms exist for every ambiguous term. Validate this in the ontology build step: for each ambiguous single-word term, ensure at least one multi-word term or hashtag exists for the same topic as a fallback.

#### F16: Concept hierarchy closure is pre-computed — correct

**Assessment:** `buildDescendants` and `buildAncestors` run at catalog preparation time with cycle detection (`seen` set). The resulting `Map<string, Set<string>>` provides O(1) lookup at query time. This is the right approach for a 92-concept hierarchy.

#### F17: Ontology hot-swap via KV is safe

**Assessment:** The `loadCatalogFromKv` pattern with a pointer key (`ontology:energy:active`) and versioned snapshot keys is robust. Fallback to the bundled `energy-snapshot.json` on any KV error ensures the system never blocks on an ontology load failure. The 30-second cache TTL prevents stale reads without excessive KV lookups.

---

## 4. Recommendations by Priority

### P0 — High Impact, Low Risk

| # | Finding | Action | Effort |
|---|---------|--------|--------|
| 1 | F1 | Add `tokenize='porter unicode61'` to FTS5 table | Migration + rebuild FTS index |
| 2 | F8 | Sanitize FTS5 MATCH input to prevent syntax errors | Small utility function |
| 3 | F5 | Run `INSERT INTO posts_fts(posts_fts) VALUES('optimize')` after ingest | One line in ingest pipeline |

### P1 — High Impact, Medium Risk

| # | Finding | Action | Effort |
|---|---------|--------|--------|
| 4 | F3 | Migrate to external-content FTS5 table to halve storage | New migration, update upsert logic |
| 5 | F9 | Add cursor pagination to search results | Extend searchPosts query + API schema |
| 6 | F4 | Add `snippet()` to search results | SQL change + new response field |

### P2 — Medium Impact, Exploratory

| # | Finding | Action | Effort |
|---|---------|--------|--------|
| 7 | F7 | Ontology-aware query expansion (synonym injection) | New service method, FTS5 OR queries |
| 8 | F13 | Enrich search results with snippet + relevance score | API schema change |
| 9 | F6 | Document or resolve topic-slug vs concept-slug storage | Decision + possible matcher change |

### P3 — Defensive / Future-Proofing

| # | Finding | Action | Effort |
|---|---------|--------|--------|
| 10 | F15 | Validate ambiguity terms have multi-word fallbacks in build step | Build script check |
| 11 | D1 export bug | Design FTS tables to be rebuildable; document `DROP + CREATE` recovery | Documentation |

---

## 5. Detailed Implementation Plans

### 5.1 Porter Stemming Migration (P0 #1)

```typescript
// Migration 7: Rebuild FTS5 with Porter stemming
const migration7: D1Migration = {
  id: 7,
  name: "fts_porter_stemming",
  statements: [
    `DROP TABLE IF EXISTS posts_fts`,
    `CREATE VIRTUAL TABLE posts_fts USING fts5(
      uri UNINDEXED,
      text,
      tokenize='porter unicode61'
    )`,
    `INSERT INTO posts_fts (uri, text)
      SELECT uri, text FROM posts WHERE status = 'active'`
  ]
};
```

**Risk:** The rebuild `INSERT ... SELECT` must complete within D1's 30-second query timeout. For large datasets, batch the rebuild:

```sql
INSERT INTO posts_fts (uri, text)
  SELECT uri, text FROM posts
  WHERE status = 'active' AND rowid > ? AND rowid <= ?
```

### 5.2 FTS5 Input Sanitization (P0 #2)

```typescript
// src/query/sanitizeFts.ts
const FTS5_SPECIAL = /[":*^{}()\[\]]/g;
const FTS5_OPERATORS = /\b(AND|OR|NOT|NEAR)\b/gi;

export const sanitizeFtsQuery = (raw: string): string =>
  raw
    .replace(FTS5_SPECIAL, ' ')
    .replace(FTS5_OPERATORS, '')
    .replace(/\s+/g, ' ')
    .trim();
```

Apply in `KnowledgeRepoD1.searchPosts` before the `MATCH` clause:

```typescript
const trimmed = sanitizeFtsQuery(validated.query);
```

### 5.3 External-Content FTS5 Migration (P1 #4)

```typescript
const migration8: D1Migration = {
  id: 8,
  name: "fts_external_content",
  statements: [
    `DROP TABLE IF EXISTS posts_fts`,
    `CREATE VIRTUAL TABLE posts_fts USING fts5(
      text,
      content='posts',
      content_rowid='rowid',
      tokenize='porter unicode61'
    )`,
    `INSERT INTO posts_fts (rowid, text)
      SELECT rowid, text FROM posts WHERE status = 'active'`
  ]
};
```

**Upsert change:** Replace the current `uri`-based FTS operations with `rowid`-based:

```typescript
// Before:
db.prepare("DELETE FROM posts_fts WHERE uri = ?").bind(post.uri)
db.prepare("INSERT INTO posts_fts (uri, text) VALUES (?, ?)").bind(post.uri, post.text)

// After:
db.prepare(`
  INSERT INTO posts_fts(posts_fts, rowid, text)
  VALUES('delete', (SELECT rowid FROM posts WHERE uri = ?),
         (SELECT text FROM posts WHERE uri = ?))
`).bind(post.uri, post.uri)
// The external-content table auto-indexes from `posts` on insert
// but we need to explicitly handle deletes
```

**Note:** External-content FTS5 does NOT auto-sync. You must manually issue the `'delete'` command with the *old* content before updating, then re-insert. The current delete-then-insert pattern already does this, but the SQL syntax changes.

### 5.4 Ontology-Aware Query Expansion (P2 #7)

```typescript
// src/query/expandQuery.ts
export const expandSearchQuery = (
  catalog: PreparedCatalog,
  rawQuery: string
): string => {
  const normalized = normalizeWord(rawQuery);
  const matchingTopics = catalog.topics.filter((topic) =>
    topic.normalizedTerms.some((term) => term.normalized === normalized)
  );

  if (matchingTopics.length === 0) {
    return rawQuery; // No ontology match — use raw query
  }

  // Collect top synonyms from matching topics
  const synonyms = new Set<string>();
  for (const topic of matchingTopics) {
    for (const term of topic.normalizedTerms.slice(0, 5)) {
      synonyms.add(term.raw);
    }
  }

  // Build FTS5 OR query
  const terms = Array.from(synonyms)
    .map((term) => term.includes(' ') ? `"${term}"` : term);

  return terms.join(' OR ');
};
```

**Usage:** Opt-in via `?expand=ontology` query parameter. Default behavior remains unchanged.

---

## 6. Platform Constraints (D1 + FTS5)

| Constraint | Value | Implication |
|---|---|---|
| D1 database size | 10 GB | External-content FTS saves ~50% storage |
| D1 query timeout | 30 seconds | FTS rebuild must be chunked for large datasets |
| D1 bound params | 100 per query | Topic expansion with many slugs must chunk OR clauses |
| D1 concurrency | Single-threaded | Slow FTS queries block all other DB ops |
| FTS5 `optimize` | Merges b-tree segments | Run after large write batches |
| FTS5 `MATCH` syntax | Not sanitized by D1 | Must sanitize user input |
| FTS5 export bug | [workers-sdk #9519](https://github.com/cloudflare/workers-sdk/issues/9519) | FTS tables must be rebuildable |
| Module name case | Must use lowercase `fts5` | Uppercase causes auth errors |
| Trigger syntax | Must use uppercase `BEGIN` | Lowercase fails on remote D1 |

---

## 7. Comparison: Current vs. Recommended

| Aspect | Current | Recommended |
|---|---|---|
| **Tokenizer** | `unicode61` (exact match only) | `porter unicode61` (stemming) |
| **Storage** | Standalone (content duplicated) | External-content (no duplication) |
| **Query safety** | Raw user input to MATCH | Sanitized or structured |
| **Search pagination** | No cursor, no total | Cursor-based, consistent with browse |
| **Match highlighting** | None | `snippet()` in response |
| **Index maintenance** | None | `optimize` after ingest |
| **Query expansion** | None | Ontology-aware synonym injection (opt-in) |
| **Result richness** | Flat topic slugs | + snippet + relevance score |

---

## 8. What's Already Excellent

These aspects of the current implementation are production-grade and should not change:

1. **Effect-based error propagation** — `SqlError | DbError` tracked through the entire stack, never swallowed
2. **Schema validation on all boundaries** — `decodeWithDbError` on every query result, every input
3. **Ontology match provenance** — `post_topics` stores signal, value, score, and version for full explainability
4. **Cursor-based pagination** on browse/links — compound `(created_at, uri)` sort with deterministic ordering
5. **Idempotent upserts** — `ingest_id` check prevents duplicate processing
6. **Ontology hot-swap** — KV-backed with versioned snapshots and graceful fallback
7. **Clean service layering** — `KnowledgeRepo` (data) → `KnowledgeQueryService` (business) → `Router`/`Toolkit` (surface)
8. **MCP tool annotations** — `Readonly`, `Idempotent`, `!Destructive`, `!OpenWorld` are correct
9. **Batch statement chunking** — D1's 50-statement batch limit is handled correctly
10. **SKOS hierarchy closure** — Pre-computed ancestors/descendants with O(1) lookup at query time

---

## 9. Decision Log

| Decision | Rationale |
|---|---|
| Keep FTS5 (not Vectorize) | Keyword search is the right primitive for a curated expert knowledge base. Semantic/vector search adds value for "find similar" queries but is complementary, not a replacement. FTS5 + ontology expansion covers the semantic gap. |
| Porter over trigram tokenizer | Porter handles morphological variation (generating/generation) while preserving precision. Trigram enables substring matching but produces noisy results and much larger indexes. |
| External-content over contentless | We need `snippet()`/`highlight()` for search result enrichment. Contentless tables return NULL for column reads. External-content gives us zero-duplication storage AND auxiliary function support. |
| Sanitize rather than expose FTS5 syntax | The primary consumers are MCP clients (LLMs). Exposing FTS5 boolean syntax to LLMs is unreliable. Sanitization provides predictable behavior. |
| Defer Vectorize integration | The current ontology-powered topic system provides structured semantic awareness. Vectorize adds value for open-ended "find similar" queries but requires embedding pipeline infrastructure. Recommended as a future phase. |
