import { Effect } from "effect";
import { describe, expect, it } from "@effect/vitest";
import { OntologyCatalog } from "../src/services/OntologyCatalog";
import { matchTopics } from "../src/filter/TopicMatcher";

const withOntology = Effect.provide(OntologyCatalog.layer);

describe("TopicMatcher", () => {
  it.effect("matches topics from text and returns sorted results", () =>
    Effect.gen(function* () {
      const topics = yield* matchTopics({
        text: "Solar panel installations continue to grow across the electric grid.",
        links: [],
        metadataTexts: ["Transmission planning remains the bottleneck."]
      });

      const slugs = topics.map((t) => t.topicSlug);
      expect(slugs).toContain("solar");
      expect(slugs).toContain("grid-and-infrastructure");
      // results are sorted by topicSlug
      expect(slugs).toEqual([...slugs].sort());
    }).pipe(withOntology)
  );

  it.effect("returns empty array when no topics match", () =>
    Effect.gen(function* () {
      const topics = yield* matchTopics({
        text: "Nothing relevant here at all.",
        links: []
      });

      expect(topics).toHaveLength(0);
    }).pipe(withOntology)
  );

  it.effect("returns empty array for empty text and no signals", () =>
    Effect.gen(function* () {
      const topics = yield* matchTopics({
        text: "",
        links: []
      });

      expect(topics).toHaveLength(0);
    }).pipe(withOntology)
  );

  it.effect("extracts domains from links for domain signal matching", () =>
    Effect.gen(function* () {
      const topics = yield* matchTopics({
        text: "New developments announced today.",
        links: [{ domain: "pv-magazine.com" }]
      });

      const solar = topics.find((t) => t.topicSlug === "solar");
      expect(solar).toBeDefined();
      expect(solar?.matchSignal).toBe("domain");
      expect(solar?.matchScore).toBe(4);
    }).pipe(withOntology)
  );

  it.effect("filters out null and empty domains from links", () =>
    Effect.gen(function* () {
      const topics = yield* matchTopics({
        text: "Solar panel growth continues.",
        links: [
          { domain: null },
          {},
          { domain: "" },
          { domain: "pv-magazine.com" }
        ]
      });

      const solar = topics.find((t) => t.topicSlug === "solar");
      expect(solar).toBeDefined();
      // domain signal should win over term since it has higher score
      expect(solar?.matchSignal).toBe("domain");
    }).pipe(withOntology)
  );

  it.effect("matches hashtag signals", () =>
    Effect.gen(function* () {
      const topics = yield* matchTopics({
        text: "New developments announced today.",
        links: [],
        hashtags: ["solarenergy"]
      });

      const solar = topics.find((t) => t.topicSlug === "solar");
      expect(solar).toBeDefined();
      expect(solar?.matchSignal).toBe("hashtag");
      expect(solar?.matchScore).toBe(3);
    }).pipe(withOntology)
  );

  it.effect("uses metadataTexts for matching", () =>
    Effect.gen(function* () {
      const topics = yield* matchTopics({
        text: "Some generic text.",
        links: [],
        metadataTexts: ["Transmission planning remains the bottleneck."]
      });

      const grid = topics.find((t) => t.topicSlug === "grid-and-infrastructure");
      expect(grid).toBeDefined();
      expect(grid?.matchSignal).toBe("term");
    }).pipe(withOntology)
  );
});
