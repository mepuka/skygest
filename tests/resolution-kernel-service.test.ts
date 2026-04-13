import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer, Result } from "effect";
import type { DataLayerRegistrySeed } from "../src/domain/data-layer/registry";
import {
  makeAgentId,
  makeDatasetId,
  makeVariableId
} from "../src/domain/data-layer/ids";
import { DataLayerRegistry } from "../src/services/DataLayerRegistry";
import { ResolutionKernel } from "../src/resolution/ResolutionKernel";
import { FacetVocabulary } from "../src/resolution/facetVocabulary";
import { prepareDataLayerRegistry } from "../src/resolution/dataLayerRegistry";

const ISO = "2026-04-09T00:00:00.000Z" as const;

const agentAId = makeAgentId("https://id.skygest.io/agent/ag_1234567890AB");
const agentBId = makeAgentId("https://id.skygest.io/agent/ag_ABCDEFGHIJKL");
const datasetAId = makeDatasetId("https://id.skygest.io/dataset/ds_1234567890AB");
const datasetBId = makeDatasetId("https://id.skygest.io/dataset/ds_ABCDEFGHIJKL");
const variableAId = makeVariableId("https://id.skygest.io/variable/var_1234567890AB");
const variableBId = makeVariableId("https://id.skygest.io/variable/var_ABCDEFGHIJKL");

const prepare = (seed: DataLayerRegistrySeed) => {
  const prepared = prepareDataLayerRegistry(seed);
  if (Result.isFailure(prepared)) {
    throw new Error("expected custom registry seed to prepare successfully");
  }

  return prepared.success;
};

const customRegistryLayer = DataLayerRegistry.layerFromPrepared(
  prepare({
    agents: [
      {
        _tag: "Agent",
        id: agentAId,
        kind: "organization",
        name: "Energy Information Administration",
        alternateNames: ["EIA"],
        homepage: "https://www.eia.gov/" as any,
        aliases: [],
        createdAt: ISO as any,
        updatedAt: ISO as any
      },
      {
        _tag: "Agent",
        id: agentBId,
        kind: "organization",
        name: "International Energy Agency",
        alternateNames: ["IEA"],
        homepage: "https://www.iea.org/" as any,
        aliases: [],
        createdAt: ISO as any,
        updatedAt: ISO as any
      }
    ],
    catalogs: [],
    catalogRecords: [],
    datasets: [
      {
        _tag: "Dataset",
        id: datasetAId,
        title: "EIA wind generation",
        publisherAgentId: agentAId,
        aliases: [],
        distributionIds: [],
        variableIds: [variableAId],
        createdAt: ISO as any,
        updatedAt: ISO as any
      },
      {
        _tag: "Dataset",
        id: datasetBId,
        title: "IEA wind generation",
        publisherAgentId: agentBId,
        aliases: [],
        distributionIds: [],
        variableIds: [variableBId],
        createdAt: ISO as any,
        updatedAt: ISO as any
      }
    ],
    distributions: [],
    dataServices: [],
    datasetSeries: [],
    variables: [
      {
        _tag: "Variable",
        id: variableAId,
        label: "EIA wind electricity generation",
        aliases: [],
        measuredProperty: "generation",
        domainObject: "electricity",
        technologyOrFuel: "wind",
        statisticType: "flow",
        unitFamily: "energy",
        createdAt: ISO as any,
        updatedAt: ISO as any
      },
      {
        _tag: "Variable",
        id: variableBId,
        label: "IEA wind electricity generation",
        aliases: [],
        measuredProperty: "generation",
        domainObject: "electricity",
        technologyOrFuel: "wind",
        statisticType: "flow",
        unitFamily: "energy",
        createdAt: ISO as any,
        updatedAt: ISO as any
      }
    ],
    series: []
  })
);

const kernelLayer = ResolutionKernel.layer.pipe(
  Layer.provideMerge(Layer.mergeAll(customRegistryLayer, FacetVocabulary.layer))
);

describe("ResolutionKernel service", () => {
  it.effect("uses source attribution to narrow an ambiguous candidate set", () =>
    Effect.gen(function* () {
      const kernel = yield* ResolutionKernel;

      const outcomes = yield* kernel.resolve({
        postContext: {
          postUri: "at://did:plc:test/app.bsky.feed.post/kernel-service",
          text: "Wind electricity generation",
          links: [],
          linkCards: [],
          threadCoverage: "focus-only"
        },
        vision: null,
        sourceAttribution: {
          kind: "source-attribution",
          provider: {
            providerId: "eia" as any,
            providerLabel: "EIA",
            sourceFamily: null
          },
          resolution: "matched",
          providerCandidates: [],
          contentSource: {
            url: "https://www.eia.gov/electricity/",
            title: "EIA electricity",
            domain: "eia.gov",
            publication: "EIA"
          },
          socialProvenance: null,
          processedAt: 1
        }
      });

      expect(outcomes).toHaveLength(1);
      expect(outcomes[0]?._tag).toBe("Resolved");
      if (outcomes[0]?._tag !== "Resolved") {
        return;
      }

      expect(outcomes[0].items[0]?._tag).toBe("bound");
      if (outcomes[0].items[0]?._tag !== "bound") {
        return;
      }

      expect(outcomes[0].items[0].variableId).toBe(variableAId);
    }).pipe(Effect.provide(kernelLayer))
  );

  it.effect("returns one outcome per vision asset bundle", () =>
    Effect.gen(function* () {
      const kernel = yield* ResolutionKernel;

      const outcomes = yield* kernel.resolve({
        postContext: {
          postUri: "at://did:plc:test/app.bsky.feed.post/kernel-service-multi",
          text: "Wind electricity generation",
          links: [],
          linkCards: [],
          threadCoverage: "focus-only"
        },
        vision: {
          kind: "vision",
          summary: {
            text: "Two charts",
            mediaTypes: ["chart"],
            chartTypes: ["line-chart"],
            titles: [],
            keyFindings: []
          },
          assets: [
            {
              assetKey: "asset:1",
              assetType: "image",
              source: "embed",
              index: 0,
              originalAltText: null,
              extractionRoute: "full",
              analysis: {
                mediaType: "chart",
                chartTypes: ["line-chart"],
                altText: "Wind generation",
                altTextProvenance: "synthetic",
                xAxis: null,
                yAxis: { label: "Generation", unit: "TWh" },
                series: [{ legendLabel: "Wind", unit: "TWh" }],
                sourceLines: [],
                temporalCoverage: null,
                keyFindings: [],
                visibleUrls: [],
                organizationMentions: [],
                logoText: [],
                title: "Wind electricity generation",
                modelId: "gemini-2.5-flash",
                processedAt: 1
              }
            },
            {
              assetKey: "asset:2",
              assetType: "image",
              source: "embed",
              index: 1,
              originalAltText: null,
              extractionRoute: "full",
              analysis: {
                mediaType: "chart",
                chartTypes: ["line-chart"],
                altText: "Wind generation",
                altTextProvenance: "synthetic",
                xAxis: null,
                yAxis: { label: "Generation", unit: "TWh" },
                series: [{ legendLabel: "Wind", unit: "TWh" }],
                sourceLines: [],
                temporalCoverage: null,
                keyFindings: [],
                visibleUrls: [],
                organizationMentions: [],
                logoText: [],
                title: "Wind electricity generation",
                modelId: "gemini-2.5-flash",
                processedAt: 1
              }
            }
          ],
          modelId: "gemini-2.5-flash",
          promptVersion: "v2",
          processedAt: 1
        },
        sourceAttribution: null
      });

      expect(outcomes).toHaveLength(2);
      expect(outcomes.every((outcome) => outcome._tag === "Ambiguous")).toBe(true);
    }).pipe(Effect.provide(kernelLayer))
  );
});
