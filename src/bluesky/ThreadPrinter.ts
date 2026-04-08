/**
 * Thread reply filter pipeline and Doc-based render pipeline.
 *
 * Pure functions — no Effect services, no side effects.
 * Each filter step is a pipeable endomorphism composed with `flow`.
 */

import { Schema, Order, Array as A } from "effect";
import { flow, identity } from "effect/Function";
import * as Doc from "../platform/Doc";
import type { FlattenedPost, FlattenedThread } from "./ThreadFlatten.ts";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export const PrinterConfig = Schema.Struct({
  maxDepth: Schema.optionalKey(Schema.Number),
  minLikes: Schema.optionalKey(Schema.Number),
  topN: Schema.optionalKey(Schema.Number)
});
export type PrinterConfig = Schema.Schema.Type<typeof PrinterConfig>;

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------

/** Engagement: likes DESC, reposts DESC, replies DESC */
const byEngagement: Order.Order<FlattenedPost> = Order.make((a, b) => {
  const aLikes = a.post.likeCount ?? 0;
  const bLikes = b.post.likeCount ?? 0;
  if (aLikes !== bLikes) return bLikes > aLikes ? 1 : -1;
  const aReposts = a.post.repostCount ?? 0;
  const bReposts = b.post.repostCount ?? 0;
  if (aReposts !== bReposts) return bReposts > aReposts ? 1 : -1;
  const aReplies = a.post.replyCount ?? 0;
  const bReplies = b.post.replyCount ?? 0;
  if (aReplies !== bReplies) return bReplies > aReplies ? 1 : -1;
  return 0;
});

/** DFS position: ascending by dfsIndex */
const byDfsPosition: Order.Order<FlattenedPost> = Order.make((a, b) =>
  a.dfsIndex < b.dfsIndex ? -1 : a.dfsIndex > b.dfsIndex ? 1 : 0
);

// ---------------------------------------------------------------------------
// Predicates
// ---------------------------------------------------------------------------

const withinDepth = (max: number) => (p: FlattenedPost): boolean =>
  p.depth <= max;

const meetsEngagement = (min: number) => (p: FlattenedPost): boolean =>
  (p.post.likeCount ?? 0) >= min;

// ---------------------------------------------------------------------------
// Pipeable transforms (endomorphisms on ReadonlyArray<FlattenedPost>)
// ---------------------------------------------------------------------------

type ReplyTransform = (rs: ReadonlyArray<FlattenedPost>) => ReadonlyArray<FlattenedPost>;

const capDepth = (max: number | undefined): ReplyTransform =>
  max == null ? identity : (rs) => rs.filter(withinDepth(max));

const requireEngagement = (min: number | undefined): ReplyTransform =>
  min == null ? identity : (rs) => rs.filter(meetsEngagement(min));

const takeTopN = (n: number | undefined): ReplyTransform =>
  n == null
    ? identity
    : (rs) => {
        // Sort by engagement DESC, take top N, then re-sort by DFS position
        const sorted = A.sort(byEngagement)([...rs]);
        const top = sorted.slice(0, n);
        return A.sort(byDfsPosition)([...top]);
      };

/**
 * Structural closure: walk parentUri chains and restore missing ancestors
 * so indentation is always coherent. Stops at the focus boundary (depth <= 0).
 */
const ensureClosure = (allReplies: ReadonlyArray<FlattenedPost>): ReplyTransform =>
  (kept) => {
    const byUri = new Map<string, FlattenedPost>();
    for (const r of allReplies) {
      byUri.set(r.post.uri, r);
    }

    const keptUris = new Set<string>(kept.map(r => r.post.uri));

    for (const r of kept) {
      let currentUri = r.parentUri;
      while (currentUri != null) {
        if (keptUris.has(currentUri)) break;
        const parent = byUri.get(currentUri);
        if (!parent || parent.depth <= 0) break;
        keptUris.add(currentUri);
        currentUri = parent.parentUri;
      }
    }

    // Filter allReplies to preserve original DFS order
    return allReplies.filter(r => keptUris.has(r.post.uri));
  };

// ---------------------------------------------------------------------------
// Pipeline composition
// ---------------------------------------------------------------------------

const buildFilterPipeline = (
  config: PrinterConfig,
  allReplies: ReadonlyArray<FlattenedPost>
): ReplyTransform =>
  flow(
    capDepth(config.maxDepth),
    requireEngagement(config.minLikes),
    takeTopN(config.topN),
    ensureClosure(allReplies)
  );

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export const filterReplies = (
  replies: ReadonlyArray<FlattenedPost>,
  config: PrinterConfig
): { filtered: ReadonlyArray<FlattenedPost>; total: number } => {
  const pipeline = buildFilterPipeline(config, replies);
  return {
    filtered: pipeline(replies),
    total: replies.length
  };
};

// ---------------------------------------------------------------------------
// ThreadDocument
// ---------------------------------------------------------------------------

export type ThreadDocument = import("../domain/bi").ThreadDocumentOutput;

// ---------------------------------------------------------------------------
// Text extraction helpers
// ---------------------------------------------------------------------------

const extractText = (record: unknown): string => {
  if (typeof record === "object" && record !== null && "text" in record) {
    return typeof (record as any).text === "string" ? (record as any).text : "";
  }
  return "";
};

const extractCreatedAt = (record: unknown, fallbackIndexedAt: string): string => {
  if (typeof record === "object" && record !== null && "createdAt" in record) {
    return typeof (record as any).createdAt === "string" ? (record as any).createdAt : fallbackIndexedAt;
  }
  return fallbackIndexedAt;
};

// ---------------------------------------------------------------------------
// Atomic Doc renderers
// ---------------------------------------------------------------------------

type SDoc = Doc.Doc<never>;

const renderHandle = (post: FlattenedPost): SDoc => {
  const handle = post.post.author.handle ?? post.post.author.did;
  return Doc.text(`@${handle}`);
};

const renderEngagement = (post: FlattenedPost): SDoc => {
  const parts: SDoc[] = [];
  const likes = post.post.likeCount ?? 0;
  const reposts = post.post.repostCount ?? 0;
  const replies = post.post.replyCount ?? 0;
  if (likes > 0) parts.push(Doc.text(`\u2661${likes}`));
  if (reposts > 0) parts.push(Doc.text(`\u21BB${reposts}`));
  if (replies > 0) parts.push(Doc.text(`\u{1F4AC}${replies}`));
  return parts.length > 0 ? Doc.hsep(parts) : Doc.empty;
};

const renderEmbedLine = (embed: any | undefined): SDoc => {
  if (!embed || !embed.$type) return Doc.empty;
  const type: string = embed.$type;

  if (type.includes("images")) {
    const images = embed.images ?? embed.media?.images ?? [];
    const altTexts = images
      .map((img: any) => img.alt)
      .filter((a: unknown) => typeof a === "string" && a.length > 0);
    const altSuffix = altTexts.length > 0 ? ` ${altTexts.join("; ")}` : "";
    return Doc.text(`\u{1F4CA}${altSuffix}`);
  }

  if (type.includes("external")) {
    const ext = embed.external;
    const title = ext?.title ?? ext?.uri ?? "";
    return Doc.text(`\u{1F517} ${title}`);
  }

  if (type.includes("video")) {
    const alt = embed.alt ?? "";
    return Doc.text(`\u{1F3AC}${alt ? ` ${alt}` : ""}`);
  }

  // recordWithMedia — check media sub-object
  if (type.includes("record") && embed.media) {
    return renderEmbedLine({ ...embed.media, $type: embed.media.$type ?? type });
  }

  return Doc.empty;
};

// ---------------------------------------------------------------------------
// Section renderers
// ---------------------------------------------------------------------------

const renderAuthorPost = (total: number) => (post: FlattenedPost, index: number): SDoc => {
  const tag = Doc.text(`[${index + 1}/${total}]`);
  const handle = renderHandle(post);
  const authorTag = Doc.hsep([tag, handle]);
  const text = Doc.text(extractText(post.post.record));
  const embedLine = renderEmbedLine(post.post.embed);

  const parts: SDoc[] = [authorTag, text];
  if (embedLine._tag !== "Empty") parts.push(embedLine);
  return Doc.vsep(parts);
};

const renderReplyPost = (post: FlattenedPost): SDoc => {
  const handle = renderHandle(post);
  const engagement = renderEngagement(post);
  const header = engagement._tag !== "Empty"
    ? Doc.hsep([handle, engagement])
    : handle;
  const body = Doc.nest(Doc.text(extractText(post.post.record)), 2);
  const inner = Doc.vsep([header, body]);
  const indentLevel = Math.max(0, (post.depth - 1)) * 2;
  return indentLevel > 0 ? Doc.indent(inner, indentLevel) : inner;
};

// ---------------------------------------------------------------------------
// Document assembly
// ---------------------------------------------------------------------------

const renderDocument = (
  thread: FlattenedThread,
  filtered: ReadonlyArray<FlattenedPost>,
  totalReplies: number
): SDoc => {
  const allAuthorPosts = [...thread.ancestors, thread.focus];
  const total = allAuthorPosts.length;
  const render = renderAuthorPost(total);

  const authorDocs = allAuthorPosts.map((p, i) => render(p, i));

  const parts: SDoc[] = [];

  // Title line
  const focusHandle = thread.focus.post.author.handle ?? thread.focus.post.author.did;
  const createdAt = extractCreatedAt(thread.focus.post.record, thread.focus.post.indexedAt);
  const dateStr = createdAt.slice(0, 10);
  parts.push(Doc.text(`@${focusHandle} \u00B7 ${dateStr}`));
  parts.push(Doc.hardLine);

  // Author posts
  parts.push(Doc.vsep(authorDocs));

  // Reply section
  if (filtered.length > 0) {
    const filterNote = filtered.length < totalReplies
      ? `--- Expert Discussion (${filtered.length} ${filtered.length === 1 ? "reply" : "replies"}, filtered from ${totalReplies}) ---`
      : `--- Discussion (${filtered.length} ${filtered.length === 1 ? "reply" : "replies"}) ---`;
    parts.push(Doc.text(filterNote));

    const replyDocs = filtered.map(renderReplyPost);
    parts.push(Doc.vsep(replyDocs));
  }

  return Doc.vsep(parts);
};

// ---------------------------------------------------------------------------
// Title builder
// ---------------------------------------------------------------------------

const buildTitle = (thread: FlattenedThread): string => {
  const focusText = extractText(thread.focus.post.record);
  const snippet = focusText.length > 60 ? focusText.slice(0, 60) + "\u2026" : focusText;
  const handle = thread.focus.post.author.handle ?? thread.focus.post.author.did;
  const createdAt = extractCreatedAt(thread.focus.post.record, thread.focus.post.indexedAt);
  const dateStr = createdAt.slice(0, 10);
  return `${snippet} \u2014 @${handle} \u00B7 ${dateStr}`;
};

// ---------------------------------------------------------------------------
// Top-level entry point
// ---------------------------------------------------------------------------

export const printThread = (
  thread: FlattenedThread,
  config: PrinterConfig = {}
): ThreadDocument => {
  const { filtered, total } = filterReplies(thread.replies, config);
  const doc = renderDocument(thread, filtered, total);
  return {
    title: buildTitle(thread),
    postCount: thread.ancestors.length + 1,
    replyCount: filtered.length,
    totalReplies: total,
    body: Doc.render(doc, { style: "pretty", options: { lineWidth: 200 } })
  };
};
