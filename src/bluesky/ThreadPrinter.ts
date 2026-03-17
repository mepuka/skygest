/**
 * Thread reply filter pipeline.
 *
 * Pure functions — no Effect services, no side effects.
 * Each filter step is a pipeable endomorphism composed with `flow`.
 */

import { Schema, Order, Array as A } from "effect";
import { flow, identity } from "effect/Function";
import type { FlattenedPost } from "./ThreadFlatten.ts";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export const PrinterConfig = Schema.Struct({
  maxDepth: Schema.optional(Schema.Number),
  minLikes: Schema.optional(Schema.Number),
  topN: Schema.optional(Schema.Number)
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
