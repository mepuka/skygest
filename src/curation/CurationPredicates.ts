import type { KnowledgePost, ExpertTier, MatchedTopic } from "../domain/bi";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PostContext {
  readonly post: KnowledgePost;
  readonly expertTier: ExpertTier | null;
  readonly publicationTiers: ReadonlyMap<string, string>;
}

export interface PredicateResult {
  readonly name: string;
  readonly score: number;
}

export type CurationPredicate = (ctx: PostContext) => PredicateResult | null;

export interface CurationSignal {
  readonly totalScore: number;
  readonly predicates: ReadonlyArray<PredicateResult>;
}

// ---------------------------------------------------------------------------
// Predicates (ingest-time — no engagement data)
// ---------------------------------------------------------------------------

export const isEnergyFocusedExpert: CurationPredicate = (ctx) =>
  ctx.expertTier === "energy-focused"
    ? { name: "energy-focused-expert", score: 30 }
    : null;

export const hasLinks: CurationPredicate = (ctx) =>
  ctx.post.hasLinks
    ? { name: "has-links", score: 10 }
    : null;

export const hasMultipleTopics: CurationPredicate = (ctx) =>
  ctx.post.topics.length >= 2
    ? { name: "multi-topic", score: 15 }
    : null;

export const highMatchScore = (threshold = 0.8): CurationPredicate => (ctx) => {
  const maxScore = ctx.post.topics.reduce(
    (max, t: MatchedTopic) => Math.max(max, t.matchScore),
    0
  );
  return maxScore >= threshold
    ? { name: "high-match-score", score: 20 }
    : null;
};

export const hasTier1Publication: CurationPredicate = (ctx) => {
  if (ctx.post.links.length === 0) return null;
  for (const link of ctx.post.links) {
    if (link.domain && ctx.publicationTiers.get(link.domain) === "energy-focused") {
      return { name: "tier-1-publication", score: 25 };
    }
  }
  return null;
};

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

export const evaluateSignal = (
  predicates: ReadonlyArray<CurationPredicate>,
  ctx: PostContext
): CurationSignal => {
  const results: PredicateResult[] = [];
  let total = 0;

  for (const predicate of predicates) {
    const result = predicate(ctx);
    if (result !== null) {
      results.push(result);
      total += result.score;
    }
  }

  return {
    totalScore: Math.min(total, 100),
    predicates: results
  };
};

export const shouldFlag = (signal: CurationSignal, threshold: number): boolean =>
  signal.totalScore >= threshold;

// ---------------------------------------------------------------------------
// Default predicate set
// ---------------------------------------------------------------------------

export const defaultPredicates: ReadonlyArray<CurationPredicate> = [
  isEnergyFocusedExpert,
  hasLinks,
  hasMultipleTopics,
  highMatchScore(0.8),
  hasTier1Publication
];
