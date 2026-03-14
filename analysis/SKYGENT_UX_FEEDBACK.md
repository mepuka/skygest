# Skygent CLI User Experience Feedback

**Date:** 2026-02-03
**Reviewer:** Claude Code (AI Agent)
**Context:** Network analysis and data collection for Skygest research project
**Skygent Version:** 0.5.0

---

## Executive Summary

This document captures UX issues identified while using Skygent CLI as an AI agent. Since Skygent is designed for agent use, these issues are particularly important because:

1. **Agents rely on consistent patterns** - Inconsistencies cause errors and retries
2. **Agents parse output programmatically** - Output format predictability matters
3. **Agents can't "remember" across sessions** - Each invocation starts fresh
4. **Agents benefit from self-documenting commands** - Good `--help` reduces errors

---

## Critical Issues for Agent Use

### 1. Environment Variable Dependency for Credentials

**Severity:** Critical for agents
**Impact:** Every command fails without manual env var setup

**Observed Behavior:**
```bash
$ skygent store add-source my-store --author user.bsky.social
Failed to resolve author: Failed to load credentials
(Credentials file exists but SKYGENT_CREDENTIALS_KEY is not set.)
```

**Why This Hurts Agents:**
- Agents typically run in fresh shell environments
- No way to persist the key securely across sessions
- The key must be set BEFORE every skygent command
- Error message doesn't tell you WHERE to get the key

**Reproduction:**
1. Set up credentials: `skygent config credentials set --identifier x --password y`
2. Close terminal
3. Open new terminal
4. Run any command requiring auth → fails

**Suggested Solutions:**

Option A: **Keychain integration** (Recommended for macOS/Linux)
```bash
# Automatically use system keychain
skygent config credentials set --identifier x --password y --use-keychain
# Key stored securely, no env var needed
```

Option B: **Config file with key derivation**
```bash
# Store encrypted credentials with machine-derived key
skygent config credentials set --identifier x --password y --persist
# Uses machine ID + user ID for key derivation
```

Option C: **Explicit key file** (for CI/agents)
```bash
# Point to key file instead of env var
export SKYGENT_KEY_FILE=~/.skygent/key
# Or in config: key_file = "~/.skygent/key"
```

**Minimum Fix:**
- Better error message with instructions:
```
Error: SKYGENT_CREDENTIALS_KEY not set.

To fix:
  1. Run: skygent config credentials show-key
  2. Add to your shell profile:
     export SKYGENT_CREDENTIALS_KEY="<your-key>"
  3. Source your profile or restart terminal
```

---

### 2. Command Syntax Inconsistency

**Severity:** High for agents
**Impact:** Agents must learn different patterns for each command

**Observed Patterns:**

| Command | Store Specification | Notes |
|---------|---------------------|-------|
| `store create` | Positional: `skygent store create my-store` | ✓ |
| `store sources` | Positional: `skygent store sources my-store` | ✓ |
| `store stats` | Positional: `skygent store stats my-store` | ✓ |
| `sync` | Flag: `skygent sync --store my-store` | ✗ Different |
| `query` | Positional: `skygent query my-store` | ✓ |
| `graph interactions` | Flag: `skygent graph interactions --store my-store` | ✗ Different |
| `graph centrality` | Flag: `skygent graph centrality --store my-store` | ✗ Different |

**Why This Hurts Agents:**
- Agents infer patterns from examples
- Inconsistency causes "trial and error" which wastes API calls
- My actual error during session:
```bash
$ skygent query --store skygest-papers --filter '...'
Invalid store name "--store": Expected a string matching ^[a-z0-9][a-z0-9-_]{1,63}$
```

**Suggested Solution:**
Standardize on **positional store name as first argument** for all commands:
```bash
skygent sync my-store [options]
skygent query my-store [filters]
skygent graph interactions my-store [options]
```

Or allow **both** patterns for backwards compatibility:
```bash
skygent sync my-store              # positional
skygent sync --store my-store      # flag (also works)
```

---

### 3. Filter Predicate Discovery

**Severity:** High for agents
**Impact:** Agents must guess filter syntax, leading to errors

**Observed Behavior:**
```bash
$ skygent query skygest-papers --filter 'author_did=did:plc:...'
Unknown filter type "author_did=did". Did you mean "author:handle"?
Tip: run "skygent filter help" for all predicates.
```

**My Actual Workflow:**
1. Guessed `author_did=...` based on SQL column name → Failed
2. Read error message suggesting `author:handle`
3. Had to run separate `skygent filter help` command
4. Still unclear what the full syntax is

**Why This Hurts Agents:**
- No introspection of available filters from main command
- Filter syntax doesn't match data model terminology
- Error message gives one example but not the full list

**Suggested Solutions:**

1. **Inline filter help:**
```bash
$ skygent query my-store --filter-help
Available filter predicates:
  author:handle    - Posts by specific author (e.g., "author:alice.bsky.social")
  author:did       - Posts by author DID
  has:link         - Posts containing links
  has:image        - Posts with images
  domain:x         - Posts linking to domain x
  text:word        - Posts containing word
  after:date       - Posts after date (ISO format)
  before:date      - Posts before date

Combine with AND/OR: "author:alice AND has:link"
```

2. **Better error with full list:**
```bash
Unknown filter "author_did". Available predicates:
  author:handle, author:did, has:link, has:image, domain:*, text:*, after:*, before:*

Example: --filter "author:alice.bsky.social AND has:link"
```

---

### 4. Missing Actor/Handle Resolution

**Severity:** Medium for agents
**Impact:** Common operation requires workarounds

**My Actual Need:**
After running network analysis, I had DIDs like `did:plc:32r7scd5hucgv552zjfuaigc` and needed handles.

**Attempted Solutions:**
```bash
$ skygent resolve did:plc:32r7scd5hucgv552zjfuaigc
Invalid subcommand for skygent

$ skygent query skygest-papers --filter 'author:did:plc:32r7scd5hucgv552zjfuaigc'
Unknown filter type...
```

**Workaround I Used:**
Had to parse the communities.json file in Python to find handle mappings.

**Suggested Addition:**
```bash
$ skygent actor resolve did:plc:32r7scd5hucgv552zjfuaigc
{
  "did": "did:plc:32r7scd5hucgv552zjfuaigc",
  "handle": "astroarxiv.bsky.social",
  "displayName": "Astro arXiv",
  "avatar": "https://..."
}

$ skygent actor resolve astroarxiv.bsky.social
{
  "did": "did:plc:32r7scd5hucgv552zjfuaigc",
  "handle": "astroarxiv.bsky.social",
  ...
}
```

---

### 5. Bulk Operations Missing

**Severity:** Medium for agents
**Impact:** Repetitive API calls for batch operations

**My Actual Workflow:**
To add 37 scientists to a store, I had to:
```bash
while IFS= read -r handle; do
    skygent store add-source skygest-scientists --author "$handle"
done < scientists.txt
```

This resulted in:
- 37 separate commands
- 37 separate API resolution calls
- ~40 seconds total

**Why This Hurts Agents:**
- Agents generate shell loops which are error-prone
- Each call has latency overhead
- If one fails, no easy retry

**Suggested Addition:**
```bash
# From file
$ skygent store add-source my-store --authors-file handles.txt
Added 37 authors to my-store

# From stdin
$ cat handles.txt | skygent store add-source my-store --stdin
Added 37 authors

# Multiple inline
$ skygent store add-source my-store \
    --author alice.bsky.social \
    --author bob.bsky.social \
    --author carol.bsky.social
Added 3 authors
```

---

### 6. Output Format Inconsistency

**Severity:** Medium for agents
**Impact:** Parsing requires format-specific handling

**Observed Patterns:**

| Command | Default Output |
|---------|---------------|
| `store create` | JSON object |
| `store sources` | JSON array of strings |
| `store stats` | JSON object |
| `graph centrality` | Table (unless `--format json`) |
| `graph communities` | Table (unless `--format json`) |
| `sync` | Streaming JSON lines |

**Why This Hurts Agents:**
- Must specify `--format json` inconsistently
- Some commands don't have format flag
- JSON line streaming vs single JSON object varies

**Suggested Solution:**
```bash
# Global flag that applies to all commands
$ skygent --output json store sources my-store

# Or environment variable
$ export SKYGENT_OUTPUT_FORMAT=json
```

---

### 7. Graph Analysis Feedback

**Severity:** Low
**Impact:** Hard to understand what was analyzed

**Observed Behavior:**
```bash
$ skygent graph interactions --store skygest-papers --limit 50000 --format json > output.json
# No output, just writes file
# File has 637 nodes and 800 edges from 231,680 posts
```

**Questions I Had:**
- Why only 637 nodes from 231k posts?
- What counts as an "interaction"?
- Were all posts scanned?
- What was filtered out?

**Suggested Improvement:**
```bash
$ skygent graph interactions --store skygest-papers --limit 50000
Analyzing interactions in skygest-papers...
  Scanned: 50,000 posts
  Found interactions:
    - Reposts: 406
    - Quotes: 28
    - Replies: 1
    - Mentions: 365
  Unique nodes: 637
  Total edges: 800

Output written to stdout (use --output file.json to save)
```

---

### 8. Store Metadata/Description

**Severity:** Low
**Impact:** Hard to remember store purposes

**Attempted:**
```bash
$ skygent store create skygest-scientists "Scientists and researchers from network"
Received unknown argument: 'Scientists and researchers...'
```

**Current State:**
- No way to add description to stores
- `skygent store list` shows names only
- Hard to remember what each store is for

**Suggested Addition:**
```bash
$ skygent store create my-store --description "Papers from academic feeds"
$ skygent store show my-store
{
  "name": "my-store",
  "description": "Papers from academic feeds",
  "created": "2026-02-03",
  "posts": 1234,
  ...
}
```

---

### 9. Sync Progress Feedback

**Severity:** Low
**Impact:** Long syncs have no ETA

**Observed:**
```
{"timestamp":"...","level":"INFO","message":"Starting sync","source":"AuthorSource:did:..."}
{"timestamp":"...","level":"INFO","message":"Starting sync","source":"AuthorSource:did:..."}
...
```

**Agent Need:**
- Predictable completion time for task planning
- Ability to know if stuck

**Suggested Improvement:**
```bash
$ skygent sync --store my-store
Syncing my-store (37 sources)...
[=====>                    ] 5/37 sources (13%)
  Current: labwaggoner.bsky.social (234 posts)
  ETA: ~2 minutes

Sync complete:
  Sources: 37
  New posts: 1,234
  Duration: 3m 42s
```

---

### 10. Community Detection Labeling

**Severity:** Low
**Impact:** Community IDs are opaque

**Observed:**
```
Community ID: did:plc:22co7ufljyuhla27fmqqrqsx
Size: 144
Members: csmm-bot.bsky.social, csne-bot.bsky.social, ...
```

**The Problem:**
Community "names" are just the DID of a member, not meaningful.

**Suggested Improvement:**
Auto-generate labels based on:
1. Common terms in handles: "arXiv Bots" (if 80%+ have "bot" or "arxiv")
2. Most central member: "Community around arxiv-cs-ai.bsky.social"
3. Topic modeling on post content: "Machine Learning Papers"

```json
{
  "id": "did:plc:22co7ufljyuhla27fmqqrqsx",
  "label": "arXiv Category Bots",
  "size": 144,
  "top_members": ["csmm-bot.bsky.social", "csne-bot.bsky.social"]
}
```

---

## Agent-Specific Recommendations

### 1. Machine-Readable Error Codes

Current errors are human-readable strings. For agents:

```json
{
  "error": true,
  "code": "AUTH_KEY_MISSING",
  "message": "SKYGENT_CREDENTIALS_KEY not set",
  "suggestion": "export SKYGENT_CREDENTIALS_KEY=...",
  "docs": "https://skygent.dev/docs/auth"
}
```

### 2. Command Introspection

Allow agents to discover capabilities:
```bash
$ skygent capabilities --format json
{
  "commands": ["store", "sync", "query", "graph", ...],
  "filters": ["author:handle", "has:link", ...],
  "output_formats": ["json", "table", "csv"],
  "version": "0.5.0"
}
```

### 3. Idempotent Operations

Agents may retry commands. Make operations idempotent:
```bash
$ skygent store add-source my-store --author alice.bsky.social
{"added": true, "source": "AuthorSource:did:..."}

$ skygent store add-source my-store --author alice.bsky.social
{"added": false, "reason": "already_exists", "source": "AuthorSource:did:..."}
# Exit code 0, not error
```

### 4. Dry Run Mode

Let agents preview operations:
```bash
$ skygent sync --store my-store --dry-run
Would sync 37 sources:
  - labwaggoner.bsky.social (estimated 500 posts)
  - bigearthdata.ai (estimated 300 posts)
  ...
Estimated total: ~15,000 new posts
Estimated time: ~5 minutes
```

---

## Summary Table

| Issue | Priority | Agent Impact | Effort |
|-------|----------|--------------|--------|
| Credentials env var | Critical | Blocks all auth commands | Medium |
| Command syntax inconsistency | High | Causes errors | Medium |
| Filter predicate discovery | High | Causes errors | Low |
| Actor/handle resolution | Medium | Requires workarounds | Low |
| Bulk operations | Medium | Slow batch processing | Medium |
| Output format inconsistency | Medium | Complex parsing | Low |
| Graph analysis feedback | Low | Unclear results | Low |
| Store metadata | Low | Documentation | Low |
| Sync progress | Low | No ETA | Medium |
| Community labeling | Low | Opaque results | Medium |

---

## Positive Aspects

Things that work well for agents:

1. **JSON output available** - Most commands support `--format json`
2. **Good error recovery** - Sync continues when individual posts fail
3. **Consistent store naming** - Valid store name regex is clear
4. **Graph algorithms** - PageRank, community detection work well
5. **Store lineage model** - Source → derived store concept is clear
6. **Quiet mode** - `--quiet` flag reduces noise

---

## Testing Environment

- **Skygent Version:** 0.5.0
- **OS:** macOS (Darwin 25.2.0)
- **Shell:** zsh
- **Agent:** Claude Code (Anthropic)
- **Session Duration:** ~1 hour
- **Commands Executed:** ~50
- **Errors Encountered:** ~12
