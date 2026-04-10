import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer, Result } from "effect";
import type { DataLayerRegistrySeed } from "../src/domain/data-layer";
import { DataLayerRegistry } from "../src/services/DataLayerRegistry";
import { prepareDataLayerRegistry } from "../src/resolution/dataLayerRegistry";
import { Stage1Resolver } from "../src/resolution/Stage1Resolver";

const iso = "2026-04-09T00:00:00.000Z" as const;

const makeSeed = (): DataLayerRegistrySeed => ({
  agents: [
    {
      _tag: "Agent",
      id: "https://id.skygest.io/agent/ag_1234567890AB" as any,
      kind: "organization",
      name: "Energy Information Administration",
      alternateNames: ["EIA"],
      aliases: [],
      createdAt: iso as any,
      updatedAt: iso as any
    }
  ],
  catalogs: [],
  catalogRecords: [],
  datasets: [],
  distributions: [],
  dataServices: [],
  datasetSeries: [],
  variables: [],
  series: []
});

const makeResolverLayer = () => {
  const prepared = prepareDataLayerRegistry(makeSeed());
  if (Result.isFailure(prepared)) {
    throw new Error("expected prepared registry");
  }

  return Stage1Resolver.layer.pipe(
    Layer.provide(DataLayerRegistry.layerFromPrepared(prepared.success))
  );
};

describe("Stage1Resolver", () => {
  it.effect("decodes valid input and resolves through the registry service", () =>
    Effect.gen(function* () {
      const resolver = yield* Stage1Resolver;
      const result = yield* resolver.resolve({
        postContext: {
          postUri: "at://did:plc:test/app.bsky.feed.post/abc123",
          text: "EIA",
          links: [],
          linkCards: [],
          threadCoverage: "focus-only"
        },
        vision: null,
        sourceAttribution: {
          kind: "source-attribution",
          provider: {
            providerId: "eia",
            providerLabel: "EIA",
            sourceFamily: null
          },
          resolution: "matched",
          providerCandidates: [],
          contentSource: null,
          socialProvenance: null,
          processedAt: 0
        }
      });

      expect(result.matches.some((match) => match._tag === "AgentMatch")).toBe(true);
    }).pipe(Effect.provide(makeResolverLayer()))
  );

  it.effect("wraps bad input decode failures in EnrichmentSchemaDecodeError", () =>
    Effect.gen(function* () {
      const resolver = yield* Stage1Resolver;
      const failure = yield* resolver.resolve({
        postContext: {
          postUri: "not-a-post-uri",
          text: "text",
          links: [],
          linkCards: [],
          threadCoverage: "focus-only"
        },
        vision: null,
        sourceAttribution: null
      }).pipe(Effect.flip);

      expect(failure._tag).toBe("EnrichmentSchemaDecodeError");
    }).pipe(Effect.provide(makeResolverLayer()))
  );
});
