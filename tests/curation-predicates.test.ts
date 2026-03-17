import { describe, expect, it } from "@effect/vitest";
import type { KnowledgePost, ExpertTier, MatchedTopic } from "../src/domain/bi";
import type { PostContext } from "../src/curation/CurationPredicates";
import {
  isEnergyFocusedExpert,
  hasLinks,
  hasMultipleTopics,
  highMatchScore,
  hasTier1Publication,
  evaluateSignal,
  shouldFlag,
  defaultPredicates
} from "../src/curation/CurationPredicates";

const makeTopic = (slug: string, score = 0.5): MatchedTopic =>
  ({
    topicSlug: slug,
    matchedTerm: slug,
    matchSignal: "term",
    matchValue: slug,
    matchScore: score,
    ontologyVersion: "test-v1",
    matcherVersion: "test-v1"
  }) as unknown as MatchedTopic;

const makePost = (overrides: Partial<KnowledgePost> = {}): KnowledgePost =>
  ({
    uri: "at://did:plc:test/app.bsky.feed.post/abc",
    did: "did:plc:test",
    cid: null,
    text: "Test post about solar energy",
    createdAt: 1_710_000_000_000,
    indexedAt: 1_710_000_000_000,
    hasLinks: false,
    status: "active",
    ingestId: "test-ingest-1",
    topics: [makeTopic("solar")],
    links: [],
    ...overrides
  }) as unknown as KnowledgePost;

const makeContext = (overrides: {
  post?: Partial<KnowledgePost>;
  expertTier?: ExpertTier | null;
  publicationTiers?: ReadonlyMap<string, string>;
} = {}): PostContext => ({
  post: makePost(overrides.post),
  expertTier: overrides.expertTier ?? null,
  publicationTiers: overrides.publicationTiers ?? new Map()
});

describe("CurationPredicates", () => {
  describe("isEnergyFocusedExpert", () => {
    it("returns score 30 for energy-focused tier", () => {
      const result = isEnergyFocusedExpert(makeContext({ expertTier: "energy-focused" }));
      expect(result).toEqual({ name: "energy-focused-expert", score: 30 });
    });

    it("returns null for general-outlet tier", () => {
      expect(isEnergyFocusedExpert(makeContext({ expertTier: "general-outlet" }))).toBeNull();
    });

    it("returns null for independent tier", () => {
      expect(isEnergyFocusedExpert(makeContext({ expertTier: "independent" }))).toBeNull();
    });

    it("returns null when tier is null", () => {
      expect(isEnergyFocusedExpert(makeContext({ expertTier: null }))).toBeNull();
    });
  });

  describe("hasLinks", () => {
    it("returns score 10 when post has links", () => {
      const result = hasLinks(makeContext({ post: { hasLinks: true } }));
      expect(result).toEqual({ name: "has-links", score: 10 });
    });

    it("returns null when post has no links", () => {
      expect(hasLinks(makeContext({ post: { hasLinks: false } }))).toBeNull();
    });
  });

  describe("hasMultipleTopics", () => {
    it("returns score 15 for 2+ topics", () => {
      const result = hasMultipleTopics(makeContext({
        post: { topics: [makeTopic("solar"), makeTopic("hydrogen")] }
      }));
      expect(result).toEqual({ name: "multi-topic", score: 15 });
    });

    it("returns null for single topic", () => {
      expect(hasMultipleTopics(makeContext({
        post: { topics: [makeTopic("solar")] }
      }))).toBeNull();
    });

    it("returns null for no topics", () => {
      expect(hasMultipleTopics(makeContext({
        post: { topics: [] }
      }))).toBeNull();
    });
  });

  describe("highMatchScore", () => {
    it("returns score 20 when max matchScore >= threshold", () => {
      const predicate = highMatchScore(0.8);
      const result = predicate(makeContext({
        post: { topics: [makeTopic("solar", 0.9)] }
      }));
      expect(result).toEqual({ name: "high-match-score", score: 20 });
    });

    it("returns score 20 at exact threshold", () => {
      const predicate = highMatchScore(0.8);
      const result = predicate(makeContext({
        post: { topics: [makeTopic("solar", 0.8)] }
      }));
      expect(result).toEqual({ name: "high-match-score", score: 20 });
    });

    it("returns null below threshold", () => {
      const predicate = highMatchScore(0.8);
      expect(predicate(makeContext({
        post: { topics: [makeTopic("solar", 0.7)] }
      }))).toBeNull();
    });

    it("returns null for empty topics", () => {
      const predicate = highMatchScore(0.8);
      expect(predicate(makeContext({
        post: { topics: [] }
      }))).toBeNull();
    });

    it("uses max score across multiple topics", () => {
      const predicate = highMatchScore(0.8);
      const result = predicate(makeContext({
        post: { topics: [makeTopic("solar", 0.3), makeTopic("hydrogen", 0.85)] }
      }));
      expect(result).toEqual({ name: "high-match-score", score: 20 });
    });
  });

  describe("hasTier1Publication", () => {
    it("returns score 25 when link domain is energy-focused", () => {
      const pubs = new Map([["reuters.com", "energy-focused"]]);
      const result = hasTier1Publication(makeContext({
        post: {
          hasLinks: true,
          links: [{
            url: "https://reuters.com/article",
            title: null,
            description: null,
            imageUrl: null,
            domain: "reuters.com",
            extractedAt: 1_710_000_000_000
          }] as any
        },
        publicationTiers: pubs
      }));
      expect(result).toEqual({ name: "tier-1-publication", score: 25 });
    });

    it("returns null when link domain is not tier 1", () => {
      const pubs = new Map([["reuters.com", "general-outlet"]]);
      expect(hasTier1Publication(makeContext({
        post: {
          links: [{
            url: "https://reuters.com/article",
            title: null,
            description: null,
            imageUrl: null,
            domain: "reuters.com",
            extractedAt: 1_710_000_000_000
          }] as any
        },
        publicationTiers: pubs
      }))).toBeNull();
    });

    it("returns null when no links", () => {
      expect(hasTier1Publication(makeContext())).toBeNull();
    });
  });

  describe("evaluateSignal", () => {
    it("sums scores from matching predicates", () => {
      const signal = evaluateSignal(defaultPredicates, makeContext({
        expertTier: "energy-focused",
        post: { hasLinks: true }
      }));
      expect(signal.totalScore).toBe(40); // 30 + 10
      expect(signal.predicates).toHaveLength(2);
    });

    it("clamps total to 100", () => {
      const expensivePredicates = [
        () => ({ name: "a", score: 60 }),
        () => ({ name: "b", score: 60 })
      ];
      const signal = evaluateSignal(expensivePredicates, makeContext());
      expect(signal.totalScore).toBe(100);
    });

    it("returns empty signal when no predicates match", () => {
      const signal = evaluateSignal(defaultPredicates, makeContext({
        expertTier: "independent",
        post: { hasLinks: false, topics: [makeTopic("solar", 0.3)] }
      }));
      expect(signal.totalScore).toBe(0);
      expect(signal.predicates).toHaveLength(0);
    });

    it("handles all predicates matching", () => {
      const pubs = new Map([["iea.org", "energy-focused"]]);
      const signal = evaluateSignal(defaultPredicates, makeContext({
        expertTier: "energy-focused",
        post: {
          hasLinks: true,
          topics: [makeTopic("solar", 0.9), makeTopic("hydrogen", 0.85)],
          links: [{
            url: "https://iea.org/report",
            title: null,
            description: null,
            imageUrl: null,
            domain: "iea.org",
            extractedAt: 1_710_000_000_000
          }] as any
        },
        publicationTiers: pubs
      }));
      // 30 + 10 + 15 + 20 + 25 = 100
      expect(signal.totalScore).toBe(100);
      expect(signal.predicates).toHaveLength(5);
    });
  });

  describe("shouldFlag", () => {
    it("returns true when score meets threshold", () => {
      expect(shouldFlag({ totalScore: 30, predicates: [] }, 30)).toBe(true);
    });

    it("returns true when score exceeds threshold", () => {
      expect(shouldFlag({ totalScore: 50, predicates: [] }, 30)).toBe(true);
    });

    it("returns false when score is below threshold", () => {
      expect(shouldFlag({ totalScore: 20, predicates: [] }, 30)).toBe(false);
    });
  });
});
