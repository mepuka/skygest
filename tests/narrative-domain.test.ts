import { describe, expect, it } from "@effect/vitest";
import { Schema } from "effect";
import {
  ArgumentPatternFrontmatter,
  EditionFrontmatter,
  GraphEdge,
  GraphNode,
  NarrativeFrontmatter,
  PostAnnotationFrontmatter,
  StoryFrontmatter
} from "../src/domain/narrative";

const validStoryFrontmatter = {
  headline: "Texas solar additions are changing utility buildout assumptions",
  question: "Why are deployment milestones shifting power-sector strategy?",
  discourse_level: "strategic" as const,
  narrative_arcs: ["grid-transition", "solar-scale-up"],
  argument_pattern: "deployment-milestone",
  trigger: "A new capacity milestone changed the framing.",
  status: "draft" as const,
  editor_note: "Lead with the buildout signal, not the press release.",
  posts: [
    {
      annotation: "2026-04-06/ember-814gw",
      role: "lead" as const
    }
  ],
  experts: ["did:plc:expert123"],
  entities: ["utility-scale-solar"],
  source_providers: ["ember"],
  data_refs: ["ember-2026-global-electricity-review"],
  curation_date: "2026-04-06",
  created: "2026-04-06T18:00:00.000Z"
};

const validNarrativeFrontmatter = {
  title: "Global renewables growth",
  core_question: "How fast is generation buildout changing the grid mix?",
  status: "active" as const,
  related: ["grid-transition", "solar-scale-up"],
  last_updated: "2026-04-06"
};

const validPostAnnotationFrontmatter = {
  post_uri: "at://did:plc:expert123/app.bsky.feed.post/abc123",
  author: "did:plc:expert123",
  captured_at: "2026-04-06T17:30:00.000Z",
  curation_date: "2026-04-06",
  editorial_score: 82,
  enrichments: {
    vision: true,
    source_attribution: true
  },
  source_providers: ["ember"],
  data_refs: [],
  entities: [],
  argument_pattern: "deployment-milestone",
  discourse_level: "strategic" as const,
  editor_note: "Strong datapoint with a clean sourcing chain."
};

const validArgumentPatternFrontmatter = {
  title: "Deployment milestone",
  status: "active" as const,
  description: "Use when a capacity or adoption threshold materially shifts the narrative.",
  variants: ["record buildout", "capacity landmark"],
  editorial_value: "Gives the editor a durable frame for recurring progress signals.",
  related_patterns: ["cost-inflection", "policy-window"]
};

const validEditionFrontmatter = {
  title: "Daily energy brief",
  publication_date: "2026-04-06",
  status: "draft" as const,
  lead_story: "grid-transition/solar-scale-up",
  stories: [
    {
      narrative: "grid-transition",
      story: "grid-transition/solar-scale-up",
      position: "lead" as const
    }
  ]
};

describe("StoryFrontmatter", () => {
  it("accepts a valid story scaffold", () => {
    expect(Schema.decodeUnknownSync(StoryFrontmatter)(validStoryFrontmatter))
      .toEqual(validStoryFrontmatter);
  });

  it("rejects missing required fields", () => {
    const { question: _question, ...withoutQuestion } = validStoryFrontmatter;
    expect(() => Schema.decodeUnknownSync(StoryFrontmatter)(withoutQuestion))
      .toThrow();
  });

  it("rejects invalid discourse levels", () => {
    expect(() =>
      Schema.decodeUnknownSync(StoryFrontmatter)({
        ...validStoryFrontmatter,
        discourse_level: "culture"
      })
    ).toThrow();
  });

  it("rejects empty narrative arcs", () => {
    expect(() =>
      Schema.decodeUnknownSync(StoryFrontmatter)({
        ...validStoryFrontmatter,
        narrative_arcs: []
      })
    ).toThrow();
  });

  it("rejects invalid expert and provider identifiers", () => {
    expect(() =>
      Schema.decodeUnknownSync(StoryFrontmatter)({
        ...validStoryFrontmatter,
        experts: ["expert-123"]
      })
    ).toThrow();

    expect(() =>
      Schema.decodeUnknownSync(StoryFrontmatter)({
        ...validStoryFrontmatter,
        source_providers: ["BloombergNEF"]
      })
    ).toThrow();
  });
});

describe("NarrativeFrontmatter", () => {
  it("accepts a valid narrative frontmatter block", () => {
    expect(Schema.decodeUnknownSync(NarrativeFrontmatter)(validNarrativeFrontmatter))
      .toEqual(validNarrativeFrontmatter);
  });

  it("rejects invalid narrative statuses", () => {
    expect(() =>
      Schema.decodeUnknownSync(NarrativeFrontmatter)({
        ...validNarrativeFrontmatter,
        status: "paused"
      })
    ).toThrow();
  });
});

describe("PostAnnotationFrontmatter", () => {
  it("accepts a hydratable post annotation", () => {
    expect(
      Schema.decodeUnknownSync(PostAnnotationFrontmatter)(
        validPostAnnotationFrontmatter
      )
    ).toEqual(validPostAnnotationFrontmatter);
  });

  it("rejects invalid post URIs", () => {
    expect(() =>
      Schema.decodeUnknownSync(PostAnnotationFrontmatter)({
        ...validPostAnnotationFrontmatter,
        post_uri: "https://example.com/post/1"
      })
    ).toThrow();
  });

  it("rejects scores outside the editorial range", () => {
    expect(() =>
      Schema.decodeUnknownSync(PostAnnotationFrontmatter)({
        ...validPostAnnotationFrontmatter,
        editorial_score: 101
      })
    ).toThrow();
  });
});

describe("ArgumentPatternFrontmatter", () => {
  it("accepts a valid argument pattern definition", () => {
    expect(
      Schema.decodeUnknownSync(ArgumentPatternFrontmatter)(
        validArgumentPatternFrontmatter
      )
    ).toEqual(validArgumentPatternFrontmatter);
  });

  it("rejects empty editorial strings", () => {
    expect(() =>
      Schema.decodeUnknownSync(ArgumentPatternFrontmatter)({
        ...validArgumentPatternFrontmatter,
        title: ""
      })
    ).toThrow();
  });
});

describe("EditionFrontmatter", () => {
  it("accepts a valid edition frontmatter block", () => {
    expect(Schema.decodeUnknownSync(EditionFrontmatter)(validEditionFrontmatter))
      .toEqual(validEditionFrontmatter);
  });

  it("rejects lead stories that are not listed in stories", () => {
    expect(() =>
      Schema.decodeUnknownSync(EditionFrontmatter)({
        ...validEditionFrontmatter,
        lead_story: "grid-transition/missing-story"
      })
    ).toThrow();
  });
});

describe("GraphNode and GraphEdge", () => {
  it("accepts a story node through the narrative barrel export", () => {
    const node = {
      _tag: "story" as const,
      path: "narratives/grid-transition/stories/2026-04-06-solar-scale-up.md",
      id: "2026-04-06-solar-scale-up",
      primary_narrative: "grid-transition",
      frontmatter: validStoryFrontmatter,
      body: "A short draft body."
    };

    expect(Schema.decodeUnknownSync(GraphNode)(node)).toEqual(node);
  });

  it("rejects unknown edge types", () => {
    expect(() =>
      Schema.decodeUnknownSync(GraphEdge)({
        from: "story:2026-04-06-solar-scale-up",
        to: "annotation:2026-04-06/ember-814gw",
        type: "story_annotation"
      })
    ).toThrow();
  });
});
