/**
 * Pure display-formatting module for MCP tool output.
 *
 * Converts domain result types into compact ASCII strings optimised for LLM
 * consumption using `@effect/printer` Doc combinators.
 *
 * Design rules:
 * - `Doc<never>` only (no annotations — plain text for MCP)
 * - ASCII separators: `|`, `-`, `·`, `:`
 * - Deterministic timestamps: `YYYY-MM-DD`
 * - Collapse whitespace before truncation
 * - Prefer `snippet` over `text` when present on posts
 */

import * as Doc from "@effect/printer/Doc";
import type {
  KnowledgePostResult,
  KnowledgeLinkResult,
  ExpertListItem,
  OntologyListTopic,
  ExpandedTopicsOutput,
  ExplainPostTopicsOutput
} from "../domain/bi.ts";
import type { EditorialPickOutput } from "../domain/editorial.ts";

// ---------------------------------------------------------------------------
// Internal helpers (not exported)
// ---------------------------------------------------------------------------

type SDoc = Doc.Doc<never>;

/** Render a Doc to a plain string. Uses compact layout to avoid
 *  stack overflow on large result sets (pretty layout is recursive). */
const render = (doc: SDoc): string =>
  Doc.render(doc, { style: "compact" });

/** Collapse all whitespace (newlines, tabs, runs of spaces) to single spaces and trim. */
const collapse = (s: string): string => s.replace(/\s+/g, " ").trim();

/** Truncate a string to `max` characters, appending `…` if truncated. */
const truncate = (s: string, max: number): string =>
  s.length <= max ? s : `${s.slice(0, max - 1)}\u2026`;

/**
 * Format an epoch-millisecond timestamp as a deterministic `YYYY-MM-DD` string.
 * Uses UTC to avoid timezone drift.
 */
const formatTimestamp = (epochMs: number): string => {
  const d = new Date(epochMs);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

/**
 * Build a human label for an expert / person.
 * Prefer `displayName (@handle)`, fallback to `@handle`, fallback to DID prefix.
 */
const personLabel = (
  handle: string | null,
  displayName: string | null,
  did: string
): string => {
  if (displayName && handle) return `${displayName} (@${handle})`;
  if (handle) return `@${handle}`;
  return did.length > 24 ? `${did.slice(0, 24)}...` : did;
};

// ---------------------------------------------------------------------------
// Exported formatters
// ---------------------------------------------------------------------------

/**
 * Format an array of knowledge posts for MCP display.
 *
 * ```
 * [P1] @handle · tier · 2025-03-15
 *      Truncated post text up to 110 chars...
 *      Topics: solar, energy-storage
 * ```
 */
export const formatPosts = (items: ReadonlyArray<KnowledgePostResult>): string => {
  if (items.length === 0) return "No posts found.";

  const rows: SDoc[] = items.map((p, i) => {
    const tag = `[P${i + 1}]`;
    const handle = p.handle ? `@${p.handle}` : p.did;
    const header = Doc.hsep([
      Doc.text(tag),
      Doc.text(handle),
      Doc.text("\u00B7"),
      Doc.text(p.tier),
      Doc.text("\u00B7"),
      Doc.text(formatTimestamp(p.createdAt))
    ]);

    const bodyText = truncate(collapse(p.snippet ?? p.text), 200);
    const body = Doc.text(`     ${bodyText}`);

    const uriLine = Doc.text(`     URI: ${p.uri}`);

    const topicLine =
      p.topics.length > 0
        ? Doc.text(`     Topics: ${p.topics.join(", ")}`)
        : Doc.empty;

    const parts: SDoc[] = [header, body, uriLine];
    if (p.topics.length > 0) parts.push(topicLine);
    return Doc.vsep(parts);
  });

  return render(Doc.vsep(rows));
};

/**
 * Format an array of knowledge links for MCP display.
 *
 * ```
 * [L1] domain.com — Title text · 2025-03-15
 * ```
 */
export const formatLinks = (items: ReadonlyArray<KnowledgeLinkResult>): string => {
  if (items.length === 0) return "No links found.";

  const rows: SDoc[] = items.map((l, i) => {
    const tag = `[L${i + 1}]`;
    const domain = l.domain ?? "unknown";
    const title = l.title ? truncate(collapse(l.title), 60) : "(untitled)";
    const header = Doc.hsep([
      Doc.text(tag),
      Doc.text(domain),
      Doc.text("\u2014"),
      Doc.text(title),
      Doc.text("\u00B7"),
      Doc.text(formatTimestamp(l.createdAt))
    ]);
    const urlLine = Doc.text(`     URL: ${l.url}`);
    const postLine = Doc.text(`     Post: ${l.postUri}`);
    return Doc.vsep([header, urlLine, postLine]);
  });

  return render(Doc.vsep(rows));
};

/**
 * Format an array of experts for MCP display.
 *
 * ```
 * [E1] Display Name (@handle) · energy-focused · energy
 * ```
 */
export const formatExperts = (items: ReadonlyArray<ExpertListItem>): string => {
  if (items.length === 0) return "No experts found.";

  const rows: SDoc[] = items.map((e, i) => {
    const tag = `[E${i + 1}]`;
    const label = personLabel(e.handle, e.displayName, e.did);
    const header = Doc.hsep([
      Doc.text(tag),
      Doc.text(label),
      Doc.text("\u00B7"),
      Doc.text(e.tier),
      Doc.text("\u00B7"),
      Doc.text(e.domain)
    ]);
    const didLine = Doc.text(`     DID: ${e.did}`);
    return Doc.vsep([header, didLine]);
  });

  return render(Doc.vsep(rows));
};

/**
 * Format a list of ontology topics for MCP display.
 *
 * For `"facets"` view: show label, slug, child concepts.
 * For `"concepts"` view: flat list with canonical topic association.
 */
export const formatTopics = (
  items: ReadonlyArray<OntologyListTopic>,
  view: string
): string => {
  if (items.length === 0) return "No topics found.";

  if (view === "facets") {
    const rows: SDoc[] = items.map((t, i) => {
      const tag = `[T${i + 1}]`;
      const concepts =
        t.conceptSlugs.length > 0
          ? `Concepts: ${t.conceptSlugs.join(", ")}`
          : "";
      const header = Doc.hsep([
        Doc.text(tag),
        Doc.text(t.label),
        Doc.text(`(${t.slug})`),
        Doc.text("\u00B7"),
        Doc.text(t.kind)
      ]);
      return concepts
        ? Doc.vsep([header, Doc.text(`     ${concepts}`)])
        : header;
    });
    return render(Doc.vsep(rows));
  }

  // concepts view — flat list
  const rows: SDoc[] = items.map((t, i) => {
    const tag = `[T${i + 1}]`;
    const canonical = t.canonicalTopicSlug
      ? `topic:${t.canonicalTopicSlug}`
      : "no-topic";
    return Doc.hsep([
      Doc.text(tag),
      Doc.text(t.label),
      Doc.text(`(${t.slug})`),
      Doc.text("\u00B7"),
      Doc.text(canonical)
    ]);
  });
  return render(Doc.vsep(rows));
};

/**
 * Format a single ontology topic detail for MCP display.
 *
 * Shows label, slug, kind, description, terms, parents, children.
 */
export const formatTopic = (item: OntologyListTopic): string => {
  const lines: SDoc[] = [
    Doc.hsep([Doc.text(item.label), Doc.text(`(${item.slug})`), Doc.text("\u00B7"), Doc.text(item.kind)])
  ];

  if (item.description) {
    lines.push(Doc.text(`Description: ${truncate(collapse(item.description), 200)}`));
  }

  if (item.terms.length > 0) {
    lines.push(Doc.text(`Terms: ${item.terms.join(", ")}`));
  }

  if (item.parentSlugs.length > 0) {
    lines.push(Doc.text(`Parents: ${item.parentSlugs.join(", ")}`));
  }

  if (item.childSlugs.length > 0) {
    lines.push(Doc.text(`Children: ${item.childSlugs.join(", ")}`));
  }

  if (item.conceptSlugs.length > 0) {
    lines.push(Doc.text(`Concepts: ${item.conceptSlugs.join(", ")}`));
  }

  if (item.hashtags.length > 0) {
    lines.push(Doc.text(`Hashtags: ${item.hashtags.join(", ")}`));
  }

  if (item.domains.length > 0) {
    lines.push(Doc.text(`Domains: ${item.domains.join(", ")}`));
  }

  return render(Doc.vsep(lines));
};

/**
 * Format expanded topics output for MCP display.
 *
 * Shows mode, inputSlugs, resolvedSlugs, canonicalTopicSlugs, then rendered topic rows.
 */
export const formatExpandedTopics = (result: ExpandedTopicsOutput): string => {
  const meta: SDoc[] = [
    Doc.text(`Mode: ${result.mode}`),
    Doc.text(`Input: ${result.inputSlugs.join(", ") || "(none)"}`),
    Doc.text(`Resolved: ${result.resolvedSlugs.join(", ") || "(none)"}`),
    Doc.text(`Canonical topics: ${result.canonicalTopicSlugs.join(", ") || "(none)"}`)
  ];

  if (result.items.length === 0) {
    meta.push(Doc.text("No topics resolved."));
    return render(Doc.vsep(meta));
  }

  const rows: SDoc[] = result.items.map((t, i) => {
    const tag = `[T${i + 1}]`;
    const desc = t.description ? ` - ${truncate(collapse(t.description), 80)}` : "";
    return Doc.text(`${tag} ${t.label} (${t.slug}) \u00B7 ${t.kind}${desc}`);
  });

  return render(Doc.vsep([...meta, Doc.empty, ...rows]));
};

/**
 * Format explained post topics for MCP display.
 *
 * ```
 * Post: at://...
 * [M1] Topic Label (slug) — signal:matchValue score:0.8
 * ```
 */
export const formatExplainedPostTopics = (result: ExplainPostTopicsOutput): string => {
  const header = Doc.text(`Post: ${result.postUri}`);

  if (result.items.length === 0) {
    return render(Doc.vsep([header, Doc.text("No topic matches found.")]));
  }

  const rows: SDoc[] = result.items.map((m, i) => {
    const tag = `[M${i + 1}]`;
    const signal = m.matchValue
      ? `${m.matchSignal}:${m.matchValue}`
      : m.matchSignal;
    const score = m.matchScore != null ? `score:${m.matchScore}` : "";
    const parts = [tag, `${m.topicLabel} (${m.topicSlug})`, "\u2014", signal];
    if (score) parts.push(score);
    return Doc.hsep(parts.map(Doc.text));
  });

  return render(Doc.vsep([header, ...rows]));
};

/**
 * Format editorial picks for MCP display.
 *
 * ```
 * [K1] ★85 analysis | curator · 2025-03-15
 *      Reason text...
 *      URI: at://...
 * ```
 */
export const formatEditorialPicks = (items: ReadonlyArray<EditorialPickOutput>): string => {
  if (items.length === 0) return "No editorial picks found.";

  const rows: SDoc[] = items.map((p, i) => {
    const tag = `[K${i + 1}]`;
    const category = p.category ?? "uncategorised";
    const header = Doc.hsep([
      Doc.text(tag),
      Doc.text(`\u2605${p.score}`),
      Doc.text(category),
      Doc.text("|"),
      Doc.text(p.curator),
      Doc.text("\u00B7"),
      Doc.text(formatTimestamp(p.pickedAt))
    ]);

    const reason = Doc.text(`     ${truncate(collapse(p.reason), 150)}`);
    const uri = Doc.text(`     URI: ${p.postUri}`);

    return Doc.vsep([header, reason, uri]);
  });

  return render(Doc.vsep(rows));
};
