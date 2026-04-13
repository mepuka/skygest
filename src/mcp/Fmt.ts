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

import * as Doc from "../platform/Doc";
import type {
  AdminExpertResult,
  KnowledgePostResult,
  KnowledgeLinkResult,
  ExpertListItem,
  OntologyListTopic,
  ExpandedTopicsOutput,
  ExplainPostTopicsOutput,
  SetExpertActiveResult
} from "../domain/bi.ts";
import type {
  EditorialPickBundle,
  EditorialPickOutput
} from "../domain/editorial.ts";
import type {
  BulkCurateOutput,
  CurationCandidateCountOutput,
  CurationCandidateExportItem,
  CurationCandidateOutput
} from "../domain/curation.ts";
import type {
  BulkStartEnrichmentOutput,
  GetPostEnrichmentsOutput,
  ListEnrichmentGapsOutput,
  ListEnrichmentIssuesOutput
} from "../domain/enrichment.ts";
import type { ImportPostsOutput } from "../domain/api.ts";
import type {
  FindCandidatesByDataRefHit,
  ResolveDataRefOutput
} from "../domain/data-layer/query.ts";
import type {
  PipelineStatusDetail,
  PipelineStatusOutput
} from "../domain/pipeline.ts";
import type { DataLayerRegistryEntity } from "../domain/data-layer/registry.ts";

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

const formatTimestampWithTime = (epochMs: number): string => {
  const d = new Date(epochMs);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  const hours = String(d.getUTCHours()).padStart(2, "0");
  const minutes = String(d.getUTCMinutes()).padStart(2, "0");
  return `${y}-${m}-${day} ${hours}:${minutes} UTC`;
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

const relativeTimeFromEpoch = (epochMs: number, now: Date): string =>
  relativeTime(new Date(epochMs).toISOString(), now);

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

export const formatAddExpertResult = (expert: AdminExpertResult): string =>
  [
    `Expert registered: ${personLabel(expert.handle, expert.displayName, expert.did)}`,
    `DID: ${expert.did}`,
    `Domain: ${expert.domain} · Tier: ${expert.tier} · Source: ${expert.source} · Active: ${expert.active ? "yes" : "no"}`,
    `Shard: ${expert.shard}`
  ].join("\n");

export const formatSetExpertActiveResult = (result: SetExpertActiveResult): string =>
  [
    `Expert ${result.did} is now ${result.active ? "active" : "inactive"}.`,
    `Shard: ${result.shard}`
  ].join("\n");

const dataLayerEntityLabel = (entity: DataLayerRegistryEntity): string => {
  switch (entity._tag) {
    case "Agent":
      return entity.name;
    case "Catalog":
    case "DataService":
    case "Dataset":
    case "DatasetSeries":
      return entity.title;
    case "CatalogRecord":
      return entity.primaryTopicId;
    case "Distribution":
      return entity.title ?? entity.downloadURL ?? entity.accessURL ?? entity.id;
    case "Series":
    case "Variable":
      return entity.label;
  }
};

export const formatResolveDataRef = (result: ResolveDataRefOutput): string =>
  result.entity === null
    ? "No data-layer entity found."
    : [
        `${result.entity._tag}: ${dataLayerEntityLabel(result.entity)}`,
        `ID: ${result.entity.id}`
      ].join("\n");

const formatObservationWindow = (
  value: FindCandidatesByDataRefHit["observationTime"]
): string => {
  if (value === null) {
    return "unknown";
  }

  if (value.start !== undefined && value.end !== undefined) {
    return `${value.start} -> ${value.end}`;
  }

  return value.start ?? value.end ?? value.label ?? "unknown";
};

export const formatFindCandidatesByDataRef = (
  result: {
    readonly items: ReadonlyArray<FindCandidatesByDataRefHit>;
    readonly nextCursor: unknown;
  }
): string => {
  if (result.items.length === 0) {
    return "No candidate citations found.";
  }

  const rows = result.items.map((item, index) => {
    const expert = personLabel(
      item.expert.handle,
      item.expert.displayName,
      item.expert.did
    );
    const assertedValue =
      item.assertedValue === null
        ? "n/a"
        : `${item.assertedValue}${item.assertedUnit === null ? "" : ` ${item.assertedUnit}`}`;

    return [
      `[C${index + 1}] ${expert} | ${item.resolutionState} | Observation: ${formatObservationWindow(item.observationTime)}`,
      `     Post: ${item.sourcePostUri}`,
      `     Value: ${assertedValue}`
    ].join("\n");
  });

  if (result.nextCursor !== null) {
    rows.push("More results are available.");
  }

  return rows.join("\n");
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

export const formatImportPosts = (result: ImportPostsOutput): string =>
  [
    "Post import completed.",
    `Imported: ${result.imported}`,
    `Flagged: ${result.flagged}`,
    `Skipped: ${result.skipped}`
  ].join("\n");

export const formatCurationCandidates = (items: ReadonlyArray<CurationCandidateOutput>): string => {
  if (items.length === 0) return "No curation candidates found.";

  const rows: SDoc[] = items.map((p, i) => {
    const tag = `[C${i + 1}]`;
    const handle = p.handle ? `@${p.handle}` : p.did;
    const readinessTag = p.enrichmentReadiness !== undefined && p.enrichmentReadiness !== "none"
      ? ` · ${p.enrichmentReadiness}`
      : "";
    const header = Doc.hsep([
      Doc.text(tag),
      Doc.text(handle),
      Doc.text("\u00B7"),
      Doc.text(p.tier),
      Doc.text("\u00B7"),
      Doc.text(formatTimestamp(p.createdAt)),
      Doc.text("\u00B7"),
      Doc.text(`score:${p.signalScore}${readinessTag}`)
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

const prependCurationPageHeader = (
  body: string,
  total: number,
  shown: number,
  nextCursor: string | null
) => {
  const lines = [
    `Showing ${shown} of ${total} curation candidates.`,
  ];

  if (nextCursor !== null) {
    lines.push(`Next cursor: ${nextCursor}`);
  }

  if (body.length === 0) {
    return lines.join("\n");
  }

  return `${lines.join("\n")}\n\n${body}`;
};

export const formatCurationCandidatePage = (page: {
  items: ReadonlyArray<CurationCandidateOutput>;
  total: number;
  nextCursor: string | null;
}): string =>
  page.items.length === 0
    ? `No curation candidates found. Total matching: ${page.total}.`
    : prependCurationPageHeader(
        formatCurationCandidates(page.items),
        page.total,
        page.items.length,
        page.nextCursor
      );

export const formatCurationCandidateExportPage = (page: {
  items: ReadonlyArray<CurationCandidateExportItem>;
  total: number;
  nextCursor: string | null;
}): string => {
  if (page.items.length === 0) {
    return `No curation candidates found. Total matching: ${page.total}.`;
  }

  const rows = page.items.map((item, index) => {
    const handle = item.handle ? `@${item.handle}` : "(no handle)";
    const header = `[X${index + 1}] ${item.platform} | ${handle} | ${item.tier} | ${formatTimestamp(item.createdAt)} | score:${item.signalScore}`;
    const text = `     ${truncate(collapse(item.text), 220)}`;
    const uri = `     URI: ${item.uri}`;
    const topics = item.topics.length > 0
      ? `     Topics: ${item.topics.join(", ")}`
      : null;
    const embedType = item.embedType !== null
      ? `     Embed: ${item.embedType}`
      : null;

    return [header, text, uri, topics, embedType].filter((line): line is string => line !== null).join("\n");
  }).join("\n\n");

  return prependCurationPageHeader(
    rows,
    page.total,
    page.items.length,
    page.nextCursor
  );
};

export const formatCurationCandidateCounts = (
  counts: CurationCandidateCountOutput
): string =>
  [
    `Matching curation candidates: ${counts.total}`,
    `By platform: bluesky ${counts.byPlatform.bluesky} | twitter ${counts.byPlatform.twitter}`
  ].join("\n");

export const formatBulkCurateResult = (result: BulkCurateOutput): string => {
  const lines = [
    "Bulk curation completed.",
    `Curated: ${result.curated}`,
    `Rejected: ${result.rejected}`,
    `Skipped: ${result.skipped}`,
    `Errors: ${result.errors.length}`
  ];

  for (const error of result.errors.slice(0, 20)) {
    lines.push(`  ${error.postUri}: ${error.error}`);
  }

  if (result.errors.length > 20) {
    lines.push(`  ... ${result.errors.length - 20} more errors`);
  }

  return lines.join("\n");
};

export const formatEnrichmentGaps = (
  output: ListEnrichmentGapsOutput
): string => {
  const lines = [
    `Vision gaps: ${output.vision.count}`,
    `Source-attribution gaps: ${output.sourceAttribution.count}`
  ];

  if (output.vision.postUris.length > 0) {
    lines.push("");
    lines.push("Vision:");
    for (const postUri of output.vision.postUris) {
      lines.push(`  ${postUri}`);
    }
  }

  if (output.sourceAttribution.postUris.length > 0) {
    lines.push("");
    lines.push("Source attribution:");
    for (const postUri of output.sourceAttribution.postUris) {
      lines.push(`  ${postUri}`);
    }
  }

  if (
    output.vision.postUris.length === 0 &&
    output.sourceAttribution.postUris.length === 0
  ) {
    lines.push("");
    lines.push("No enrichment gaps found.");
  }

  return lines.join("\n");
};

export const formatEnrichmentIssues = (
  output: ListEnrichmentIssuesOutput
): string => {
  if (output.items.length === 0) {
    return "No enrichment issues found.";
  }

  return output.items.map((item, index) => {
    const header = `[I${index + 1}] ${item.status} | ${item.enrichmentType} | ${item.postUri}`;
    const runLine = `     Run: ${item.runId}`;
    const progressLine = item.lastProgressAt === null
      ? null
      : `     Last progress: ${formatTimestamp(item.lastProgressAt)}`;
    const errorLine = item.error === null
      ? null
      : `     Error: ${item.error.tag}: ${truncate(collapse(item.error.message), 160)}`;

    return [header, runLine, progressLine, errorLine]
      .filter((line): line is string => line !== null)
      .join("\n");
  }).join("\n");
};

export const formatPipelineStatus = (
  output: PipelineStatusOutput,
  detail: PipelineStatusDetail = "summary"
): string => {
  const snapshotTime = new Date(output.asOf);
  const lines = [
    `As of: ${formatTimestampWithTime(output.asOf)}`,
    `Experts: ${output.experts.total} active | bluesky ${output.experts.bluesky} | twitter ${output.experts.twitter}`,
    `Expert tiers: energy-focused ${output.experts.byTier.energyFocused} | general-outlet ${output.experts.byTier.generalOutlet} | independent ${output.experts.byTier.independent}`,
    `Posts: ${output.posts.total} active | bluesky ${output.posts.bluesky} | twitter ${output.posts.twitter}`,
    `Curation: curated ${output.curation.curated} | rejected ${output.curation.rejected} | flagged ${output.curation.flagged} | uncurated ${output.curation.uncurated}`,
    "",
    `Stored enrichments: ${output.enrichments.stored.total} total | vision ${output.enrichments.stored.vision} | source-attribution ${output.enrichments.stored.sourceAttribution} | grounding ${output.enrichments.stored.grounding} | data-ref-resolution ${output.enrichments.stored.dataRefResolution}`,
    `Enrichment runs: queued ${output.enrichments.runs.queued} | running ${output.enrichments.runs.running} | complete ${output.enrichments.runs.complete} | failed ${output.enrichments.runs.failed} | needs-review ${output.enrichments.runs.needsReview}`
  ];

  if (output.lastSweep === null) {
    return [...lines, "", "Last sweep: none recorded."].join("\n");
  }

  if (detail === "summary") {
    return [
      ...lines,
      "",
      `Last sweep: ${output.lastSweep.runId} at ${formatTimestampWithTime(output.lastSweep.completedAt)} (${relativeTimeFromEpoch(output.lastSweep.completedAt, snapshotTime)}) | posts stored ${output.lastSweep.postsStored} | experts failed ${output.lastSweep.expertsFailed} | status ${output.lastSweep.status}`
    ].join("\n");
  }

  return [
    ...lines,
    "",
    `Last sweep: ${output.lastSweep.runId}`,
    `  Completed: ${formatTimestampWithTime(output.lastSweep.completedAt)} (${relativeTimeFromEpoch(output.lastSweep.completedAt, snapshotTime)})`,
    `  Status: ${output.lastSweep.status}`,
    `  Posts stored: ${output.lastSweep.postsStored}`,
    `  Experts failed: ${output.lastSweep.expertsFailed}`
  ].join("\n");
};

export const formatBulkStartEnrichmentResult = (
  result: BulkStartEnrichmentOutput
): string => {
  const lines = [
    "Bulk enrichment trigger completed.",
    `Queued: ${result.queued}`,
    `Skipped: ${result.skipped}`,
    `Failed: ${result.failed}`
  ];

  for (const error of result.errors.slice(0, 20)) {
    lines.push(`  ${error.postUri}: ${error.error}`);
  }

  if (result.errors.length > 20) {
    lines.push(`  ... ${result.errors.length - 20} more errors`);
  }

  return lines.join("\n");
};

/**
 * Format enrichment state and readiness for MCP display.
 *
 * Shows readiness status, validated enrichments (kind, key details),
 * and active run summaries.
 */
export const formatStartEnrichment = (result: {
  postUri: string;
  enrichmentType: string;
  status: string;
  runId: string;
}): string =>
  `Enrichment started: ${result.enrichmentType} for ${result.postUri}\n  Run ID: ${result.runId}\n  Status: ${result.status}\n  Use get_post_enrichments to check readiness.`;

export const formatEnrichments = (
  output: GetPostEnrichmentsOutput
): string => {
  const lines: string[] = [
    `Post: ${output.postUri}`,
    `Readiness: ${output.readiness}`
  ];

  if (output.enrichments.length === 0 && output.latestRuns.length === 0) {
    lines.push("No enrichments or active runs.");
    return lines.join("\n");
  }

  if (output.enrichments.length > 0) {
    lines.push("");
    for (const e of output.enrichments) {
      const date = formatTimestamp(e.enrichedAt);
      switch (e.kind) {
        case "vision": {
          const assetCount = e.payload.assets.length;
          const summary = truncate(collapse(e.payload.summary.text), 120);
          lines.push(`[V] vision \u00B7 ${assetCount} asset${assetCount !== 1 ? "s" : ""} \u00B7 ${date}`);
          lines.push(`    ${summary}`);
          break;
        }
        case "source-attribution": {
          const provider = e.payload.provider?.providerLabel ?? "no provider";
          const resolution = e.payload.resolution;
          lines.push(`[S] source-attribution \u00B7 ${resolution} \u00B7 ${provider} \u00B7 ${date}`);
          break;
        }
        case "grounding": {
          const evidenceCount = e.payload.supportingEvidence.length;
          const claim = truncate(collapse(e.payload.claimText), 100);
          lines.push(`[G] grounding \u00B7 ${evidenceCount} evidence \u00B7 ${date}`);
          lines.push(`    ${claim}`);
          break;
        }
        case "data-ref-resolution": {
          const matchCount = e.payload.stage1.matches.length;
          const residualCount = e.payload.stage1.residuals.length;
          const outcomeCounts = new Map<string, number>();
          for (const outcome of e.payload.kernel) {
            outcomeCounts.set(
              outcome._tag,
              (outcomeCounts.get(outcome._tag) ?? 0) + 1
            );
          }
          const outcomeSummary =
            outcomeCounts.size === 0
              ? "0 outcomes"
              : Array.from(outcomeCounts.entries())
                  .map(([tag, count]) => `${count} ${tag}`)
                  .join(", ");
          lines.push(
            `[R] data-ref-resolution \u00B7 ${matchCount} match${matchCount !== 1 ? "es" : ""} \u00B7 ${residualCount} residual${residualCount !== 1 ? "s" : ""} \u00B7 ${outcomeSummary} \u00B7 ${date}`
          );
          break;
        }
      }
    }
  }

  if (output.latestRuns.length > 0) {
    lines.push("");
    lines.push("Runs:");
    for (const r of output.latestRuns) {
      const progress = r.lastProgressAt !== null ? ` \u00B7 ${formatTimestamp(r.lastProgressAt)}` : "";
      lines.push(`  ${r.enrichmentType}: ${r.status} (${r.phase})${progress}`);
    }
  }

  return lines.join("\n");
};

export const formatEditorialPickBundle = (
  output: EditorialPickBundle
): string => {
  const lines = [
    `Pick: ${output.post_uri}`,
    `Author: ${output.post.author}`,
    `Score: ${output.editorial_pick.score} | Curator: ${output.editorial_pick.curator}`,
    `Picked at: ${output.editorial_pick.picked_at}`,
    `Readiness: ${output.enrichments.readiness}`,
    `Reason: ${truncate(collapse(output.editorial_pick.reason), 200)}`,
    `Text: ${truncate(collapse(output.post.text), 200)}`,
    `Captured at: ${output.post.captured_at}`
  ];

  if (output.editorial_pick.category !== undefined) {
    lines.push(`Category: ${output.editorial_pick.category}`);
  }

  if (output.editorial_pick.expires_at !== undefined) {
    lines.push(`Expires at: ${output.editorial_pick.expires_at}`);
  }

  if (output.source_providers.length > 0) {
    lines.push(`Providers: ${output.source_providers.join(", ")}`);
  }

  if (output.resolved_expert !== undefined) {
    lines.push(`Resolved expert: ${output.resolved_expert}`);
  }

  lines.push(
    `Enrichment lanes: vision=${output.enrichments.vision !== undefined ? "yes" : "no"} | source-attribution=${output.enrichments.source_attribution !== undefined ? "yes" : "no"} | grounding=${output.enrichments.grounding !== undefined ? "yes" : "no"}`
  );

  return lines.join("\n");
};
