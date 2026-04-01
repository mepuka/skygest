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
import type { CurationCandidateOutput } from "../domain/curation.ts";

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
 * Format a relative time string like "3h ago", "2d ago", "5mo ago".
 * Uses the provided `now` to keep output deterministic in tests.
 */
const relativeTime = (isoDate: string, now: Date): string => {
  const then = new Date(isoDate);
  const diffMs = now.getTime() - then.getTime();
  if (diffMs < 0) return "just now";
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  const years = Math.floor(months / 12);
  return `${years}y ago`;
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
/** Thread post shape expected by formatPostThread */
interface ThreadDisplayPost {
  handle: string | null;
  did: string;
  text: string;
  createdAt: string;
  likeCount: number | null;
  repostCount: number | null;
  replyCount: number | null;
  quoteCount: number | null;
  uri: string;
  depth: number;
  parentUri: string | null;
  embedType: string | null;
  embedContent?: unknown | null;
}

/** Render embed content as display lines with appropriate emoji prefixes. */
const formatEmbedLines = (embedType: string | null, embedContent: unknown | null, indent: string): string[] => {
  if (!embedType || !embedContent || typeof embedContent !== "object") return [];
  const ec = embedContent as Record<string, any>;
  const lines: string[] = [];

  if (embedType === "img" && Array.isArray(ec.images)) {
    for (const img of ec.images.slice(0, 4)) {
      const alt = img.alt ? ` (alt: ${truncate(collapse(img.alt), 80)})` : "";
      lines.push(`${indent}\uD83D\uDCF7 ${img.fullsize}${alt}`);
    }
  } else if (embedType === "link" && ec.uri) {
    const title = ec.title ? ` \u2014 ${truncate(collapse(ec.title), 60)}` : "";
    lines.push(`${indent}\uD83D\uDD17 ${ec.uri}${title}`);
  } else if (embedType === "video") {
    const thumb = ec.thumbnail ? ` (thumb: ${ec.thumbnail})` : "";
    const alt = ec.alt ? ` (alt: ${truncate(collapse(ec.alt), 80)})` : "";
    lines.push(`${indent}\uD83C\uDFAC ${ec.playlist ?? "video"}${thumb}${alt}`);
  } else if (embedType === "quote" && ec.uri) {
    const author = ec.author ? `@${ec.author}` : "unknown";
    const text = ec.text ? ` \u00B7 ${truncate(collapse(ec.text), 80)}` : "";
    lines.push(`${indent}\uD83D\uDCAC ${author}${text} (${ec.uri})`);
  } else if (embedType === "media") {
    if (ec.record) {
      const author = ec.record.author ? `@${ec.record.author}` : "unknown";
      const text = ec.record.text ? ` \u00B7 ${truncate(collapse(ec.record.text), 60)}` : "";
      lines.push(`${indent}\uD83D\uDCAC ${author}${text} (${ec.record.uri ?? ""})`);
    }
    if (ec.media && typeof ec.media === "object") {
      const mediaEc = ec.media as Record<string, any>;
      if (Array.isArray(mediaEc.images)) {
        lines.push(...formatEmbedLines("img", mediaEc, indent));
      } else if (mediaEc.uri) {
        lines.push(...formatEmbedLines("link", mediaEc, indent));
      } else if (mediaEc.playlist) {
        lines.push(...formatEmbedLines("video", mediaEc, indent));
      }
    }
  }

  return lines;
};

/**
 * Format a post thread (ancestors, focus, replies) for MCP display.
 *
 * Ancestors: compact single-line with URI inlined.
 * Focus: expanded with full text.
 * Replies: depth-indented (2 spaces per depth level), engagement-sorted.
 *
 * Uses plain string concatenation (not Doc) to avoid stack overflow
 * on large thread trees.
 */
export const formatPostThread = (
  result: {
    focusUri: string;
    ancestors: ReadonlyArray<ThreadDisplayPost>;
    focus: ThreadDisplayPost;
    replies: ReadonlyArray<ThreadDisplayPost>;
  }
): string => {
  const lines: string[] = [];
  const now = new Date();
  const retrieved = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-${String(now.getUTCDate()).padStart(2, "0")}`;
  lines.push(`Thread for ${result.focusUri} (retrieved ${retrieved})`);

  const engagementStr = (p: ThreadDisplayPost): string => {
    const parts = [
      `\u2661${p.likeCount ?? 0}`,
      `\u21BB${p.repostCount ?? 0}`,
      `\uD83D\uDCAC${p.replyCount ?? 0}`,
      `\u275D${p.quoteCount ?? 0}`
    ];
    return parts.join(" ");
  };

  const embedTag = (p: ThreadDisplayPost): string =>
    p.embedType ? ` [${p.embedType}]` : "";

  // --- Ancestors: compact single-line ---
  if (result.ancestors.length > 0) {
    lines.push("");
    lines.push("--- Ancestors ---");
    for (const [i, a] of result.ancestors.entries()) {
      const handle = a.handle ? `@${a.handle}` : a.did;
      const text = truncate(collapse(a.text), 100);
      const dateStr = `${a.createdAt.slice(0, 10)} (${relativeTime(a.createdAt, now)})`;
      lines.push(`[A${i + 1}] ${handle} \u00B7 ${dateStr} \u00B7 ${engagementStr(a)}${embedTag(a)} \u00B7 ${text} (${a.uri})`);
    }
  }

  // --- Focus: expanded ---
  lines.push("");
  lines.push("--- Focus ---");
  const f = result.focus;
  const fHandle = f.handle ? `@${f.handle}` : f.did;
  const fDateStr = `${f.createdAt.slice(0, 10)} (${relativeTime(f.createdAt, now)})`;
  lines.push(`[F] ${fHandle} \u00B7 ${fDateStr} \u00B7 ${engagementStr(f)}${embedTag(f)}`);
  lines.push(`    ${truncate(collapse(f.text), 200)}`);
  lines.push(...formatEmbedLines(f.embedType, f.embedContent, "    "));
  lines.push(`    URI: ${f.uri}`);

  // --- Replies: depth-indented ---
  if (result.replies.length > 0) {
    lines.push("");
    lines.push(`--- Replies (${result.replies.length}) ---`);
    for (const [i, r] of result.replies.entries()) {
      const handle = r.handle ? `@${r.handle}` : r.did;
      // 2 spaces indent per depth level (depth 1 = 0 indent, depth 2 = 2 spaces, etc.)
      const indent = "  ".repeat(Math.max(0, r.depth - 1));
      const text = truncate(collapse(r.text), 150);
      const rDateStr = `${r.createdAt.slice(0, 10)} (${relativeTime(r.createdAt, now)})`;
      lines.push(`${indent}[R${i + 1}] ${handle} \u00B7 ${rDateStr} \u00B7 ${engagementStr(r)}${embedTag(r)}`);
      lines.push(`${indent}     ${text}`);
      lines.push(...formatEmbedLines(r.embedType, r.embedContent, `${indent}     `));
    }
  }

  return lines.join("\n");
};

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

/**
 * Format curation candidates for MCP display.
 *
 * ```
 * [C1] @handle · energy-focused · 2025-03-15 · score:65
 *      Post text truncated...
 *      Predicates: expert-tier-1, has-links, multi-topic
 *      URI: at://...
 * ```
 */
export const formatCuratePostResult = (result: { postUri: string; action: string; previousStatus: string | null; newStatus: string }) =>
  `${result.action === "curate" ? "Curated" : "Rejected"}: ${result.postUri}\n  Status: ${result.previousStatus ?? "none"} → ${result.newStatus}`;

export const formatSubmitPickResult = (result: { postUri: string; created: boolean }) =>
  result.created
    ? `Editorial pick created: ${result.postUri}`
    : `Editorial pick updated: ${result.postUri}`;

export const formatCurationCandidates = (items: ReadonlyArray<CurationCandidateOutput>): string => {
  if (items.length === 0) return "No curation candidates found.";

  const rows: SDoc[] = items.map((p, i) => {
    const tag = `[C${i + 1}]`;
    const handle = p.handle ? `@${p.handle}` : p.did;
    const header = Doc.hsep([
      Doc.text(tag),
      Doc.text(handle),
      Doc.text("\u00B7"),
      Doc.text(p.tier),
      Doc.text("\u00B7"),
      Doc.text(formatTimestamp(p.createdAt)),
      Doc.text("\u00B7"),
      Doc.text(`score:${p.signalScore}`)
    ]);

    const bodyText = truncate(collapse(p.text), 200);
    const body = Doc.text(`     ${bodyText}`);

    const predicatesLine = p.predicatesApplied.length > 0
      ? Doc.text(`     Predicates: ${p.predicatesApplied.join(", ")}`)
      : Doc.empty;

    const uriLine = Doc.text(`     URI: ${p.uri}`);

    const topicLine = p.topics.length > 0
      ? Doc.text(`     Topics: ${p.topics.join(", ")}`)
      : Doc.empty;

    const parts: SDoc[] = [header, body];
    if (p.predicatesApplied.length > 0) parts.push(predicatesLine);
    parts.push(uriLine);
    if (p.topics.length > 0) parts.push(topicLine);
    return Doc.vsep(parts);
  });

  return render(Doc.vsep(rows));
};

/**
 * Format enrichment read model output for MCP display.
 *
 * Stub -- implementation in SKY-77 Task 5.
 */
export const formatEnrichments = (_output: unknown): string =>
  "Enrichment formatting not yet implemented.";
