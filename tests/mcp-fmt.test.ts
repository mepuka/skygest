import { describe, expect, it } from "@effect/vitest";
import {
  formatPosts,
  formatLinks,
  formatExperts,
  formatTopics,
  formatTopic,
  formatExpandedTopics,
  formatExplainedPostTopics,
  formatEditorialPicks,
  formatPostThread
} from "../src/mcp/Fmt";

// ---------------------------------------------------------------------------
// Deterministic timestamp: 1710000000000 = 2024-03-09T16:00:00Z
// ---------------------------------------------------------------------------
const EPOCH = 1710000000000;

// ---------------------------------------------------------------------------
// formatPosts
// ---------------------------------------------------------------------------
describe("formatPosts", () => {
  it("returns empty message for empty array", () => {
    expect(formatPosts([])).toBe("No posts found.");
  });

  it("renders a single post with [P1], handle, tier, date, text, and topics", () => {
    const out = formatPosts([
      {
        uri: "at://did:plc:abc/app.bsky.feed.post/1" as any,
        did: "did:plc:abc" as any,
        handle: "alice.bsky.social",
        avatar: null,
        text: "Solar capacity additions are accelerating worldwide.",
        createdAt: EPOCH,
        topics: ["solar", "energy-storage"],
        tier: "energy-focused" as const
      }
    ]);

    expect(out).toContain("[P1]");
    expect(out).toContain("@alice.bsky.social");
    expect(out).toContain("energy-focused");
    expect(out).toContain("2024-03-09");
    expect(out).toContain("Solar capacity");
    expect(out).toContain("Topics: solar, energy-storage");
    // Follow-up identifier: URI must be present for tool chaining
    expect(out).toContain("URI: at://did:plc:abc/app.bsky.feed.post/1");
  });

  it("assigns sequential IDs [P1], [P2], [P3]", () => {
    const posts = Array.from({ length: 3 }, (_, i) => ({
      uri: `at://did:plc:abc/app.bsky.feed.post/${i}` as any,
      did: "did:plc:abc" as any,
      handle: "alice.bsky.social",
      avatar: null,
      text: `Post number ${i}`,
      createdAt: EPOCH + i * 1000,
      topics: [] as string[],
      tier: "independent" as const
    }));

    const out = formatPosts(posts);
    expect(out).toContain("[P1]");
    expect(out).toContain("[P2]");
    expect(out).toContain("[P3]");
  });

  it("prefers snippet over text when present", () => {
    const out = formatPosts([
      {
        uri: "at://did:plc:abc/app.bsky.feed.post/1" as any,
        did: "did:plc:abc" as any,
        handle: "h.bsky.social",
        avatar: null,
        text: "This is the full post text that should not appear.",
        snippet: "This is the snippet that should appear.",
        createdAt: EPOCH,
        topics: [],
        tier: "independent" as const
      }
    ]);

    expect(out).toContain("This is the snippet that should appear.");
    expect(out).not.toContain("This is the full post text that should not appear.");
  });

  it("uses DID when handle is null", () => {
    const out = formatPosts([
      {
        uri: "at://did:plc:abc/app.bsky.feed.post/1" as any,
        did: "did:plc:abc" as any,
        handle: null,
        avatar: null,
        text: "test",
        createdAt: EPOCH,
        topics: [],
        tier: "independent" as const
      }
    ]);

    expect(out).toContain("did:plc:abc");
    expect(out).not.toContain("@");
  });

  it("produces ASCII-only output (no fancy unicode beyond design chars)", () => {
    const out = formatPosts([
      {
        uri: "at://did:plc:abc/app.bsky.feed.post/1" as any,
        did: "did:plc:abc" as any,
        handle: "alice.bsky.social",
        avatar: null,
        text: "Hello world",
        createdAt: EPOCH,
        topics: ["solar"],
        tier: "energy-focused" as const
      }
    ]);

    // Only allowed non-ASCII: middle-dot (U+00B7) and ellipsis (U+2026)
    const stripped = out.replace(/[\u00B7\u2026\u2014\u2605]/g, "");
    // eslint-disable-next-line no-control-regex
    expect(stripped).toMatch(/^[\x00-\x7F]*$/);
  });
});

// ---------------------------------------------------------------------------
// formatLinks
// ---------------------------------------------------------------------------
describe("formatLinks", () => {
  it("returns empty message for empty array", () => {
    expect(formatLinks([])).toBe("No links found.");
  });

  it("renders a single link with [L1], domain, title, date", () => {
    const out = formatLinks([
      {
        postUri: "at://did:plc:abc/app.bsky.feed.post/1" as any,
        url: "https://reuters.com/article/solar",
        domain: "reuters.com",
        title: "Solar capacity hits record",
        description: null,
        imageUrl: null,
        createdAt: EPOCH
      }
    ]);

    expect(out).toContain("[L1]");
    expect(out).toContain("reuters.com");
    expect(out).toContain("Solar capacity hits record");
    expect(out).toContain("2024-03-09");
    // Follow-up identifiers: URL and postUri must be present for tool chaining
    expect(out).toContain("URL: https://reuters.com/article/solar");
    expect(out).toContain("Post: at://did:plc:abc/app.bsky.feed.post/1");
  });

  it("shows (untitled) when title is null", () => {
    const out = formatLinks([
      {
        postUri: "at://did:plc:abc/app.bsky.feed.post/1" as any,
        url: "https://example.com",
        domain: "example.com",
        title: null,
        description: null,
        imageUrl: null,
        createdAt: EPOCH
      }
    ]);

    expect(out).toContain("(untitled)");
  });

  it("shows 'unknown' when domain is null", () => {
    const out = formatLinks([
      {
        postUri: "at://did:plc:abc/app.bsky.feed.post/1" as any,
        url: "https://example.com",
        domain: null,
        title: "Test",
        description: null,
        imageUrl: null,
        createdAt: EPOCH
      }
    ]);

    expect(out).toContain("unknown");
  });
});

// ---------------------------------------------------------------------------
// formatExperts
// ---------------------------------------------------------------------------
describe("formatExperts", () => {
  it("returns empty message for empty array", () => {
    expect(formatExperts([])).toBe("No experts found.");
  });

  it("renders expert with handle as [E1] @handle tier", () => {
    const out = formatExperts([
      {
        did: "did:plc:abc" as any,
        handle: "alice.bsky.social",
        displayName: "Alice",
        avatar: null,
        domain: "energy",
        source: "manual" as const,
        active: true,
        tier: "energy-focused" as const
      }
    ]);

    expect(out).toContain("[E1]");
    expect(out).toContain("Alice (@alice.bsky.social)");
    expect(out).toContain("energy-focused");
    expect(out).toContain("energy");
    // Follow-up identifier: DID must always be present for tool chaining
    expect(out).toContain("DID: did:plc:abc");
  });

  it("falls back to DID prefix when handle is null", () => {
    const out = formatExperts([
      {
        did: "did:plc:abcdefghijklmnopqrstuvwxyz1234" as any,
        handle: null,
        displayName: null,
        avatar: null,
        domain: "energy",
        source: "manual" as const,
        active: true,
        tier: "independent" as const
      }
    ]);

    expect(out).toContain("[E1]");
    // DID prefix truncated at 24 chars
    expect(out).toContain("did:plc:abcdefghijklmnop...");
    expect(out).not.toContain("@");
  });

  it("uses @handle when displayName is null but handle exists", () => {
    const out = formatExperts([
      {
        did: "did:plc:abc" as any,
        handle: "bob.bsky.social",
        displayName: null,
        avatar: null,
        domain: "energy",
        source: "manual" as const,
        active: true,
        tier: "independent" as const
      }
    ]);

    expect(out).toContain("@bob.bsky.social");
  });
});

// ---------------------------------------------------------------------------
// formatTopics
// ---------------------------------------------------------------------------
describe("formatTopics", () => {
  it("returns empty message for empty array", () => {
    expect(formatTopics([], "facets")).toBe("No topics found.");
    expect(formatTopics([], "concepts")).toBe("No topics found.");
  });

  it("renders facets view with label, slug, child concepts", () => {
    const out = formatTopics(
      [
        {
          slug: "solar",
          kind: "canonical-topic" as const,
          label: "Solar Energy",
          description: "All about solar",
          canonicalTopicSlug: null,
          topConcept: false,
          conceptSlugs: ["pv-solar", "csp"],
          parentSlugs: [],
          childSlugs: [],
          terms: [],
          hashtags: [],
          domains: []
        }
      ],
      "facets"
    );

    expect(out).toContain("[T1]");
    expect(out).toContain("Solar Energy");
    expect(out).toContain("(solar)");
    expect(out).toContain("canonical-topic");
    expect(out).toContain("Concepts: pv-solar, csp");
  });

  it("renders concepts view with canonical topic association", () => {
    const out = formatTopics(
      [
        {
          slug: "pv-solar",
          kind: "concept" as const,
          label: "PV Solar",
          description: null,
          canonicalTopicSlug: "solar" as any,
          topConcept: false,
          conceptSlugs: [],
          parentSlugs: ["solar"],
          childSlugs: [],
          terms: [],
          hashtags: [],
          domains: []
        }
      ],
      "concepts"
    );

    expect(out).toContain("[T1]");
    expect(out).toContain("PV Solar");
    expect(out).toContain("(pv-solar)");
    expect(out).toContain("topic:solar");
  });

  it("shows no-topic for concepts without canonical topic", () => {
    const out = formatTopics(
      [
        {
          slug: "orphan-concept",
          kind: "concept" as const,
          label: "Orphan",
          description: null,
          canonicalTopicSlug: null,
          topConcept: false,
          conceptSlugs: [],
          parentSlugs: [],
          childSlugs: [],
          terms: [],
          hashtags: [],
          domains: []
        }
      ],
      "concepts"
    );

    expect(out).toContain("no-topic");
  });
});

// ---------------------------------------------------------------------------
// formatTopic
// ---------------------------------------------------------------------------
describe("formatTopic", () => {
  it("renders label, slug, kind, description, terms", () => {
    const out = formatTopic({
      slug: "solar",
      kind: "canonical-topic" as const,
      label: "Solar Energy",
      description: "Solar power generation and photovoltaics",
      canonicalTopicSlug: null,
      topConcept: false,
      conceptSlugs: ["pv-solar"],
      parentSlugs: ["renewables"],
      childSlugs: ["rooftop-solar"],
      terms: ["solar panel", "photovoltaic"],
      hashtags: ["#solar"],
      domains: ["energy"]
    });

    expect(out).toContain("Solar Energy");
    expect(out).toContain("(solar)");
    expect(out).toContain("canonical-topic");
    expect(out).toContain("Description: Solar power generation");
    expect(out).toContain("Terms: solar panel, photovoltaic");
    expect(out).toContain("Parents: renewables");
    expect(out).toContain("Children: rooftop-solar");
    expect(out).toContain("Concepts: pv-solar");
    expect(out).toContain("Hashtags: #solar");
    expect(out).toContain("Domains: energy");
  });

  it("omits empty sections", () => {
    const out = formatTopic({
      slug: "minimal",
      kind: "concept" as const,
      label: "Minimal",
      description: null,
      canonicalTopicSlug: null,
      topConcept: false,
      conceptSlugs: [],
      parentSlugs: [],
      childSlugs: [],
      terms: [],
      hashtags: [],
      domains: []
    });

    expect(out).toContain("Minimal");
    expect(out).not.toContain("Description:");
    expect(out).not.toContain("Terms:");
    expect(out).not.toContain("Parents:");
    expect(out).not.toContain("Children:");
  });
});

// ---------------------------------------------------------------------------
// formatExpandedTopics
// ---------------------------------------------------------------------------
describe("formatExpandedTopics", () => {
  it("shows mode, input slugs, resolved slugs, and topic rows", () => {
    const out = formatExpandedTopics({
      mode: "descendants" as any,
      inputSlugs: ["solar"],
      resolvedSlugs: ["solar", "pv-solar"],
      canonicalTopicSlugs: ["solar" as any],
      items: [
        {
          slug: "pv-solar",
          kind: "concept" as const,
          label: "PV Solar",
          description: "Photovoltaic solar",
          canonicalTopicSlug: "solar" as any,
          topConcept: false,
          conceptSlugs: [],
          parentSlugs: ["solar"],
          childSlugs: [],
          terms: [],
          hashtags: [],
          domains: []
        }
      ]
    });

    expect(out).toContain("Mode: descendants");
    expect(out).toContain("Input: solar");
    expect(out).toContain("Resolved: solar, pv-solar");
    expect(out).toContain("Canonical topics: solar");
    expect(out).toContain("[T1]");
    expect(out).toContain("PV Solar");
  });

  it("handles empty items", () => {
    const out = formatExpandedTopics({
      mode: "exact" as any,
      inputSlugs: ["nonexistent"],
      resolvedSlugs: [],
      canonicalTopicSlugs: [],
      items: []
    });

    expect(out).toContain("Mode: exact");
    expect(out).toContain("No topics resolved.");
  });
});

// ---------------------------------------------------------------------------
// formatExplainedPostTopics
// ---------------------------------------------------------------------------
describe("formatExplainedPostTopics", () => {
  it("shows empty matches message", () => {
    const out = formatExplainedPostTopics({
      postUri: "at://did:plc:abc/app.bsky.feed.post/1" as any,
      items: []
    });

    expect(out).toContain("Post: at://did:plc:abc/app.bsky.feed.post/1");
    expect(out).toContain("No topic matches found.");
  });

  it("renders matches with [M1], signal, value, score", () => {
    const out = formatExplainedPostTopics({
      postUri: "at://did:plc:abc/app.bsky.feed.post/1" as any,
      items: [
        {
          postUri: "at://did:plc:abc/app.bsky.feed.post/1" as any,
          topicSlug: "solar" as any,
          topicLabel: "Solar Energy",
          conceptSlugs: ["pv-solar" as any],
          matchedTerm: "solar panel",
          matchSignal: "term" as const,
          matchValue: "solar panel",
          matchScore: 0.8,
          ontologyVersion: "1.0.0",
          matcherVersion: "1.0.0"
        },
        {
          postUri: "at://did:plc:abc/app.bsky.feed.post/1" as any,
          topicSlug: "energy-storage" as any,
          topicLabel: "Energy Storage",
          conceptSlugs: [],
          matchedTerm: "#battery",
          matchSignal: "hashtag" as const,
          matchValue: "#battery",
          matchScore: 0.6,
          ontologyVersion: "1.0.0",
          matcherVersion: "1.0.0"
        }
      ]
    });

    expect(out).toContain("[M1]");
    expect(out).toContain("[M2]");
    expect(out).toContain("Solar Energy (solar)");
    expect(out).toContain("term:solar panel");
    expect(out).toContain("score:0.8");
    expect(out).toContain("Energy Storage (energy-storage)");
    expect(out).toContain("hashtag:#battery");
    expect(out).toContain("score:0.6");
  });
});

// ---------------------------------------------------------------------------
// formatEditorialPicks
// ---------------------------------------------------------------------------
describe("formatEditorialPicks", () => {
  it("returns empty message for empty array", () => {
    expect(formatEditorialPicks([])).toBe("No editorial picks found.");
  });

  it("renders picks with [K1], score star, category, curator, reason, URI", () => {
    const out = formatEditorialPicks([
      {
        postUri: "at://did:plc:abc/app.bsky.feed.post/1" as any,
        score: 85 as any,
        reason: "Important solar analysis worth reading",
        category: "analysis" as const,
        curator: "test-curator",
        pickedAt: EPOCH
      }
    ]);

    expect(out).toContain("[K1]");
    // Star + score
    expect(out).toContain("\u260585");
    expect(out).toContain("analysis");
    expect(out).toContain("test-curator");
    expect(out).toContain("2024-03-09");
    expect(out).toContain("Important solar analysis worth reading");
    expect(out).toContain("URI: at://did:plc:abc/app.bsky.feed.post/1");
  });

  it("shows 'uncategorised' when category is null", () => {
    const out = formatEditorialPicks([
      {
        postUri: "at://did:plc:abc/app.bsky.feed.post/1" as any,
        score: 50 as any,
        reason: "A pick",
        category: null,
        curator: "curator",
        pickedAt: EPOCH
      }
    ]);

    expect(out).toContain("uncategorised");
  });

  it("assigns sequential IDs [K1], [K2]", () => {
    const out = formatEditorialPicks([
      {
        postUri: "at://did:plc:abc/app.bsky.feed.post/1" as any,
        score: 90 as any,
        reason: "First pick",
        category: "breaking" as const,
        curator: "curator",
        pickedAt: EPOCH
      },
      {
        postUri: "at://did:plc:abc/app.bsky.feed.post/2" as any,
        score: 70 as any,
        reason: "Second pick",
        category: "discussion" as const,
        curator: "curator",
        pickedAt: EPOCH + 1000
      }
    ]);

    expect(out).toContain("[K1]");
    expect(out).toContain("[K2]");
  });
});

// ---------------------------------------------------------------------------
// formatPostThread
// ---------------------------------------------------------------------------
describe("formatPostThread", () => {
  const makePost = (overrides: Partial<{
    handle: string | null;
    did: string;
    text: string;
    createdAt: string;
    likeCount: number | null;
    repostCount: number | null;
    replyCount: number | null;
    uri: string;
  }> = {}) => ({
    handle: "alice.bsky.social",
    did: "did:plc:abc",
    text: "Hello world",
    createdAt: "2024-03-09T16:00:00.000Z",
    likeCount: 5,
    repostCount: 2,
    replyCount: 1,
    uri: "at://did:plc:abc/app.bsky.feed.post/1",
    ...overrides
  });

  it("renders focus-only thread with header and [F] tag", () => {
    const out = formatPostThread({
      focusUri: "at://did:plc:abc/app.bsky.feed.post/1",
      ancestors: [],
      focus: makePost(),
      replies: []
    });

    expect(out).toContain("Thread for at://did:plc:abc/app.bsky.feed.post/1");
    expect(out).toContain("--- Focus ---");
    expect(out).toContain("[F]");
    expect(out).toContain("@alice.bsky.social");
    expect(out).toContain("2024-03-09");
    expect(out).toContain("Hello world");
    expect(out).toContain("URI: at://did:plc:abc/app.bsky.feed.post/1");
    expect(out).not.toContain("--- Ancestors ---");
    expect(out).not.toContain("--- Replies");
  });

  it("renders ancestors with [A1], [A2] tags", () => {
    const out = formatPostThread({
      focusUri: "at://did:plc:abc/app.bsky.feed.post/3",
      ancestors: [
        makePost({ uri: "at://did:plc:abc/app.bsky.feed.post/1", text: "First ancestor", handle: "bob.bsky.social" }),
        makePost({ uri: "at://did:plc:abc/app.bsky.feed.post/2", text: "Second ancestor" })
      ],
      focus: makePost({ uri: "at://did:plc:abc/app.bsky.feed.post/3" }),
      replies: []
    });

    expect(out).toContain("--- Ancestors ---");
    expect(out).toContain("[A1]");
    expect(out).toContain("@bob.bsky.social");
    expect(out).toContain("First ancestor");
    expect(out).toContain("[A2]");
    expect(out).toContain("Second ancestor");
  });

  it("renders replies with [R1], [R2] tags and count", () => {
    const out = formatPostThread({
      focusUri: "at://did:plc:abc/app.bsky.feed.post/1",
      ancestors: [],
      focus: makePost(),
      replies: [
        makePost({ uri: "at://did:plc:abc/app.bsky.feed.post/r1", text: "Reply one" }),
        makePost({ uri: "at://did:plc:abc/app.bsky.feed.post/r2", text: "Reply two" })
      ]
    });

    expect(out).toContain("--- Replies (2) ---");
    expect(out).toContain("[R1]");
    expect(out).toContain("Reply one");
    expect(out).toContain("[R2]");
    expect(out).toContain("Reply two");
  });

  it("uses DID when handle is null", () => {
    const out = formatPostThread({
      focusUri: "at://did:plc:abc/app.bsky.feed.post/1",
      ancestors: [],
      focus: makePost({ handle: null }),
      replies: []
    });

    expect(out).toContain("did:plc:abc");
    expect(out).not.toContain("@");
  });

  it("shows engagement metrics", () => {
    const out = formatPostThread({
      focusUri: "at://did:plc:abc/app.bsky.feed.post/1",
      ancestors: [],
      focus: makePost({ likeCount: 42, repostCount: 7, replyCount: 3 }),
      replies: []
    });

    expect(out).toContain("42");
    expect(out).toContain("7");
    expect(out).toContain("3");
  });

  it("handles null engagement counts gracefully", () => {
    const out = formatPostThread({
      focusUri: "at://did:plc:abc/app.bsky.feed.post/1",
      ancestors: [],
      focus: makePost({ likeCount: null, repostCount: null, replyCount: null }),
      replies: []
    });

    // Should show 0 for null counts
    expect(out).toContain("0");
  });
});
