import { Effect, Layer } from "effect";
import { describe, expect, it } from "@effect/vitest";
import snapshotJson from "../config/ontology/energy-snapshot.json";
import { OntologyCatalog } from "../src/services/OntologyCatalog";
import { CloudflareEnv, type EnvBindings } from "../src/platform/Env";

const withOntology = Effect.provide(OntologyCatalog.layer);

describe("ontology catalog", () => {
  it.effect("matches preferred and alternate labels deterministically", () =>
    Effect.gen(function* () {
      const ontology = yield* OntologyCatalog;
      const matches = yield* ontology.match({
        text: "Photovoltaic battery storage is expanding on the electric grid.",
        metadataTexts: ["Transmission planning remains the bottleneck."]
      });

      expect(matches.map((match) => match.topicSlug)).toEqual([
        "energy-storage",
        "grid-and-infrastructure",
        "solar"
      ]);
      expect(matches.find((match) => match.topicSlug === "solar")?.matchedTerm).toBe("photovoltaic");
      expect(matches.find((match) => match.topicSlug === "energy-storage")?.matchScore).toBe(2);
      expect(matches.find((match) => match.topicSlug === "grid-and-infrastructure")?.matchSignal).toBe("term");
    }).pipe(withOntology)
  );

  it.effect("lists curated facets and expands structural concepts to canonical topics", () =>
    Effect.gen(function* () {
      const ontology = yield* OntologyCatalog;
      const facets = yield* ontology.listTopics("facets");
      const concepts = yield* ontology.listTopics("concepts");
      const expanded = yield* ontology.expandTopics(["Renewable"], "descendants");

      expect(facets).toHaveLength(30);
      expect(concepts).toHaveLength(92);
      expect(facets.some((item) => item.slug === "energy-justice")).toBe(true);
      expect(expanded.canonicalTopicSlugs).toEqual([
        "geothermal",
        "hydro",
        "offshore-wind",
        "solar",
        "wind"
      ]);
    }).pipe(withOntology)
  );

  it.effect("matches hashtag signals", () =>
    Effect.gen(function* () {
      const ontology = yield* OntologyCatalog;
      const matches = yield* ontology.match({
        text: "New developments announced today.",
        hashtags: ["solarenergy"]
      });

      const solar = matches.find((m) => m.topicSlug === "solar");
      expect(solar).toBeDefined();
      expect(solar?.matchSignal).toBe("hashtag");
      expect(solar?.matchScore).toBe(3);
    }).pipe(withOntology)
  );

  it.effect("matches domain signals", () =>
    Effect.gen(function* () {
      const ontology = yield* OntologyCatalog;
      const matches = yield* ontology.match({
        text: "New developments announced today.",
        domains: ["pv-magazine.com"]
      });

      const solar = matches.find((m) => m.topicSlug === "solar");
      expect(solar).toBeDefined();
      expect(solar?.matchSignal).toBe("domain");
      expect(solar?.matchScore).toBe(4);
    }).pipe(withOntology)
  );

  it.effect("domain outranks term when both match", () =>
    Effect.gen(function* () {
      const ontology = yield* OntologyCatalog;
      const matches = yield* ontology.match({
        text: "Solar panel installations continue to grow.",
        domains: ["pv-magazine.com"]
      });

      const solar = matches.find((m) => m.topicSlug === "solar");
      expect(solar).toBeDefined();
      expect(solar?.matchSignal).toBe("domain");
      expect(solar?.matchScore).toBe(4);
    }).pipe(withOntology)
  );

  it.effect("filters ambiguous single-word terms", () =>
    Effect.gen(function* () {
      const ontology = yield* OntologyCatalog;

      const ambiguousOnly = yield* ontology.match({ text: "battery" });
      expect(ambiguousOnly.find((m) => m.topicSlug === "energy-storage")).toBeUndefined();

      const disambiguated = yield* ontology.match({ text: "battery storage" });
      expect(disambiguated.find((m) => m.topicSlug === "energy-storage")).toBeDefined();
    }).pipe(withOntology)
  );

  it.effect("returns empty matches for empty text", () =>
    Effect.gen(function* () {
      const ontology = yield* OntologyCatalog;
      const matches = yield* ontology.match({ text: "" });
      expect(matches).toHaveLength(0);
    }).pipe(withOntology)
  );

  it.effect("getTopic returns canonical topic by slug", () =>
    Effect.gen(function* () {
      const ontology = yield* OntologyCatalog;
      const topic = yield* ontology.getTopic("solar");
      expect(topic).not.toBeNull();
      expect(topic?.kind).toBe("canonical-topic");
      expect(topic?.label).toBe("Solar");
    }).pipe(withOntology)
  );

  it.effect("getTopic returns concept by slug", () =>
    Effect.gen(function* () {
      const ontology = yield* OntologyCatalog;
      const concept = yield* ontology.getTopic("RooftopSolar");
      expect(concept).not.toBeNull();
      expect(concept?.kind).toBe("concept");
      expect(concept?.label).toBe("rooftop solar");
      expect(concept?.canonicalTopicSlug).toBe("solar");
    }).pipe(withOntology)
  );

  it.effect("getTopic returns null for invalid slug", () =>
    Effect.gen(function* () {
      const ontology = yield* OntologyCatalog;
      const result = yield* ontology.getTopic("nonexistent-slug-xyz");
      expect(result).toBeNull();
    }).pipe(withOntology)
  );

  it.effect("expandTopics exact mode returns only requested concepts", () =>
    Effect.gen(function* () {
      const ontology = yield* OntologyCatalog;
      const expanded = yield* ontology.expandTopics(["Renewable"], "exact");
      expect(expanded.resolvedSlugs).toEqual(["Renewable"]);
    }).pipe(withOntology)
  );

  it.effect("expandTopics ancestors mode includes parent concepts and their canonical topics", () =>
    Effect.gen(function* () {
      const ontology = yield* OntologyCatalog;
      const expanded = yield* ontology.expandTopics(["RooftopSolar"], "ancestors");

      expect(expanded.resolvedSlugs).toContain("RooftopSolar");
      expect(expanded.resolvedSlugs).toContain("BuildingsAndEfficiency");
      expect(expanded.canonicalTopicSlugs).toContain("solar");
      expect(expanded.canonicalTopicSlugs).toContain("energy-efficiency");
    }).pipe(withOntology)
  );
});

describe("ontology KV fallback", () => {
  const makeKvSnapshot = (snapshotVersion: string, solarLabel: string) => ({
    ...snapshotJson,
    snapshotVersion,
    canonicalTopics: snapshotJson.canonicalTopics.map((topic) =>
      topic.slug === "solar"
        ? { ...topic, label: solarLabel }
        : topic
    )
  });

  const makeKvLayer = (kv: Partial<KVNamespace> | null) => {
    const env = {
      DB: {} as D1Database,
      ONTOLOGY_KV: (kv ?? undefined) as KVNamespace | undefined
    } as EnvBindings;

    return OntologyCatalog.layer.pipe(
      Layer.provideMerge(CloudflareEnv.layer(env, { required: [] }))
    );
  };

  it.effect("falls back to local snapshot when ONTOLOGY_KV is absent", () =>
    Effect.gen(function* () {
      const ontology = yield* OntologyCatalog;
      expect(ontology.snapshot.ontologyVersion).toBeDefined();
      expect(ontology.topics.length).toBe(30);
    }).pipe(Effect.provide(makeKvLayer(null)))
  );

  it.effect("falls back to local snapshot when pointer is missing", () =>
    Effect.gen(function* () {
      const ontology = yield* OntologyCatalog;
      expect(ontology.topics.length).toBe(30);
    }).pipe(Effect.provide(makeKvLayer({
      get: (async () => null) as any
    })))
  );

  it.effect("falls back to local snapshot with warning on malformed pointer", () =>
    Effect.gen(function* () {
      const ontology = yield* OntologyCatalog;
      expect(ontology.topics.length).toBe(30);
    }).pipe(Effect.provide(makeKvLayer({
      get: (async () => '{"bad": "data"}') as any
    })))
  );

  it.effect("falls back to local snapshot when KV read throws", () =>
    Effect.gen(function* () {
      const ontology = yield* OntologyCatalog;
      expect(ontology.topics.length).toBe(30);
    }).pipe(Effect.provide(makeKvLayer({
      get: (async () => { throw new Error("KV unavailable"); }) as any
    })))
  );

  it.effect("falls back to local snapshot on malformed snapshot payload", () =>
    Effect.gen(function* () {
      const ontology = yield* OntologyCatalog;
      expect(ontology.topics.length).toBe(30);
    }).pipe(Effect.provide(makeKvLayer({
      get: (async (key: string) => {
        if (key.includes("active")) {
          return { snapshotVersion: "v-test" };
        }
        return { totally: "wrong" };
      }) as any
    })))
  );

  it.effect("uses KV snapshot when pointer and snapshot are valid", () =>
    Effect.gen(function* () {
      const ontology = yield* OntologyCatalog;
      const topic = yield* ontology.getTopic("solar");

      expect(ontology.snapshot.snapshotVersion).toBe("v-kv-valid");
      expect(topic?.label).toBe("Solar (KV)");
      expect(ontology.topics.find((item) => item.slug === "solar")?.label).toBe("Solar (KV)");
    }).pipe(Effect.provide(makeKvLayer({
      get: (async (key: string) => {
        if (key.includes("active")) {
          return { snapshotVersion: "v-kv-valid" };
        }
        return makeKvSnapshot("v-kv-valid", "Solar (KV)");
      }) as any
    })))
  );

  it.effect("recovers from a transient KV failure without pinning the local fallback", () =>
    Effect.gen(function* () {
      const ontology = yield* OntologyCatalog;
      expect(ontology.snapshot.snapshotVersion).toBe(snapshotJson.snapshotVersion);

      const topic = yield* ontology.getTopic("solar");

      expect(topic?.label).toBe("Solar (Recovered)");
      expect(ontology.snapshot.snapshotVersion).toBe("v-kv-recovered");
      expect(ontology.topics.find((item) => item.slug === "solar")?.label).toBe("Solar (Recovered)");
    }).pipe(Effect.provide(makeKvLayer({
      get: (() => {
        let failedOnce = false;
        return async (key: string) => {
          if (key.includes("active")) {
            if (!failedOnce) {
              failedOnce = true;
              throw new Error("KV unavailable");
            }
            return { snapshotVersion: "v-kv-recovered" };
          }

          return makeKvSnapshot("v-kv-recovered", "Solar (Recovered)");
        };
      })() as any
    })))
  );
});
