---
name: cloudflare
description: Comprehensive Cloudflare platform reference for Workers, Pages, D1, R2, Durable Objects, AI, and more. Use when working on any Cloudflare development task.
---

# Cloudflare Platform Skill

Use this skill for any Cloudflare development task.

## Workflow

### Step 1: Load the skill reference

Read `.claude/skills/cloudflare/SKILL.md` for decision trees and overview.

### Step 2: Identify the right product

Use the decision trees in SKILL.md to determine which Cloudflare product(s) you need:
- **Running code**: Workers, Pages, Durable Objects, Workflows
- **Storing data**: KV, D1, R2, Queues, Vectorize
- **AI/ML**: Workers AI, Vectorize, Agents SDK, AI Gateway
- **Networking**: Tunnel, Spectrum, Argo

### Step 3: Read relevant reference files

Based on task type, read from `.claude/skills/cloudflare/references/<product>/`:

| Task | Files to Read |
|------|---------------|
| New project | `README.md` + `configuration.md` |
| Implement feature | `README.md` + `api.md` + `patterns.md` |
| Debug/troubleshoot | `gotchas.md` |

### Step 4: Execute task

Apply Cloudflare-specific patterns and APIs from references to complete the request.

### Step 5: Summarize

```
=== Cloudflare Task Complete ===

Product(s): <products used>
Files referenced: <reference files consulted>

<brief summary of what was done>
```
