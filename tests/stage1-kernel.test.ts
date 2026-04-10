import { describe, expect, it } from "@effect/vitest";
import { Result } from "effect";
import type { DataLayerRegistrySeed } from "../src/domain/data-layer";
import { runStage1 } from "../src/resolution/Stage1";
import { prepareDataLayerRegistry, toDataLayerRegistryLookup } from "../src/resolution/dataLayerRegistry";

const iso = "2026-04-09T00:00:00.000Z" as const;

const makeSeed = (): DataLayerRegistrySeed => ({
  agents: [
    {
      _tag: "Agent",
      id: "https://id.skygest.io/agent/ag_1234567890AB" as any,
      kind: "organization",
      name: "Energy Information Administration",
      alternateNames: ["EIA"],
      homepage: "https://www.eia.gov" as any,
      aliases: [],
      createdAt: iso as any,
      updatedAt: iso as any
    }
  ],
  catalogs: [],
  catalogRecords: [],
  datasets: [
    {
      _tag: "Dataset",
      id: "https://id.skygest.io/dataset/ds_1234567890AB" as any,
      title: "EIA Emissions Data",
      publisherAgentId: "https://id.skygest.io/agent/ag_1234567890AB" as any,
      aliases: [
        {
          scheme: "eia-route",
          value: "EMISS",
          relation: "exactMatch"
        }
      ],
      createdAt: iso as any,
      updatedAt: iso as any,
      distributionIds: [
        "https://id.skygest.io/distribution/dist_1234567890AB" as any
      ]
    }
  ],
  distributions: [
    {
      _tag: "Distribution",
      id: "https://id.skygest.io/distribution/dist_1234567890AB" as any,
      datasetId: "https://id.skygest.io/dataset/ds_1234567890AB" as any,
      kind: "api-access",
      title: "EIA Emissions API",
      accessURL:
        "https://api.eia.gov/v2/emissions/emissions-co2-by-state-by-fuel/data/?frequency=annual" as any,
      aliases: [],
      createdAt: iso as any,
      updatedAt: iso as any
    }
  ],
  dataServices: [],
  datasetSeries: [],
  variables: [
    {
      _tag: "Variable",
      id: "https://id.skygest.io/variable/var_1234567890AB" as any,
      label: "Net generation",
      aliases: [
        {
          scheme: "eia-series",
          value: "ELEC.GEN.ALL-US-99.M",
          relation: "exactMatch"
        }
      ],
      createdAt: iso as any,
      updatedAt: iso as any
    }
  ],
  series: []
});

const makeLookup = (seed: DataLayerRegistrySeed = makeSeed()) => {
  const prepared = prepareDataLayerRegistry(seed);
  if (Result.isFailure(prepared)) {
    throw new Error(`expected prepared registry: ${prepared.failure.root}`);
  }

  return toDataLayerRegistryLookup(prepared.success);
};

describe("runStage1", () => {
  it("matches direct-grain entities, merges corroborating evidence, and preserves deferred text", () => {
    const result = runStage1(
      {
        postContext: {
          postUri: "at://did:plc:test/app.bsky.feed.post/abc123" as any,
          text: "EMISS ELEC.GEN.ALL-US-99.M https://api.eia.gov/v2/emissions/emissions-co2-by-state-by-fuel/data/?frequency=monthly https://example.com/no-match",
          links: [],
          linkCards: [
            {
              source: "embed",
              uri: "https://api.eia.gov/v2/emissions/emissions-co2-by-state-by-fuel/data/?frequency=annual",
              title: null,
              description: null,
              thumb: null
            }
          ],
          threadCoverage: "focus-only"
        },
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
            url: "https://www.eia.gov",
            title: null,
            domain: "www.eia.gov",
            publication: null
          },
          socialProvenance: null,
          processedAt: 0
        },
        vision: {
          kind: "vision",
          summary: {
            text: "Summary",
            mediaTypes: ["chart"],
            chartTypes: ["line-chart"],
            titles: ["Texas emissions overview"],
            keyFindings: []
          },
          assets: [
            {
              assetKey: "asset-1",
              assetType: "image",
              source: "embed",
              index: 0,
              originalAltText: null,
              extractionRoute: "full",
              analysis: {
                mediaType: "chart",
                chartTypes: ["line-chart"],
                altText: null,
                altTextProvenance: "absent",
                xAxis: {
                  label: "ELEC.GEN.ALL-US-99.M",
                  unit: null
                },
                yAxis: {
                  label: "Monthly total",
                  unit: null
                },
                series: [],
                sourceLines: [
                  {
                    sourceText:
                      "Source: https://api.eia.gov/v2/emissions/emissions-co2-by-state-by-fuel/data/?frequency=annual",
                    datasetName: "EIA Emissions Data"
                  }
                ],
                temporalCoverage: null,
                keyFindings: [],
                visibleUrls: [
                  "https://api.eia.gov/v2/emissions/emissions-co2-by-state-by-fuel/data/?frequency=monthly"
                ],
                organizationMentions: [
                  {
                    name: "EIA",
                    location: "footer"
                  }
                ],
                logoText: [],
                title: "Texas emissions overview",
                modelId: "test",
                processedAt: 0
              }
            }
          ],
          modelId: "test",
          promptVersion: "v1",
          processedAt: 0
        }
      },
      makeLookup()
    );

    expect(result.matches.map((match) => match._tag)).toEqual([
      "DistributionMatch",
      "DatasetMatch",
      "AgentMatch",
      "VariableMatch"
    ]);

    const distributionMatch = result.matches[0];
    expect(distributionMatch?._tag).toBe("DistributionMatch");
    if (distributionMatch?._tag !== "DistributionMatch") {
      throw new Error("expected distribution match");
    }

    expect(distributionMatch.evidence.length).toBeGreaterThan(1);
    expect("datasetId" in distributionMatch).toBe(false);

    expect(result.residuals.map((residual) => residual._tag)).toEqual([
      "DeferredToStage2Residual",
      "DeferredToStage2Residual",
      "UnmatchedUrlResidual",
      "UnmatchedUrlResidual"
    ]);
  });

  it("turns same-grain ties into ambiguity residuals instead of accepting a winner", () => {
    const seed = makeSeed();
    const ambiguousSeed: DataLayerRegistrySeed = {
      ...seed,
      distributions: [
        ...seed.distributions,
        {
          _tag: "Distribution",
          id: "https://id.skygest.io/distribution/dist_ABCDEFGHIJKL" as any,
          datasetId: "https://id.skygest.io/dataset/ds_1234567890AB" as any,
          kind: "landing-page",
          title: "Charts landing page A",
          accessURL: "https://charts.example.com/report-a" as any,
          aliases: [],
          createdAt: iso as any,
          updatedAt: iso as any
        },
        {
          _tag: "Distribution",
          id: "https://id.skygest.io/distribution/dist_ZYXWVUTSRQPO" as any,
          datasetId: "https://id.skygest.io/dataset/ds_1234567890AB" as any,
          kind: "landing-page",
          title: "Charts landing page B",
          accessURL: "https://charts.example.com/report-b" as any,
          aliases: [],
          createdAt: iso as any,
          updatedAt: iso as any
        }
      ]
    };

    const result = runStage1(
      {
        postContext: {
          postUri: "at://did:plc:test/app.bsky.feed.post/xyz987" as any,
          text: "https://charts.example.com/unknown-page",
          links: [],
          linkCards: [],
          threadCoverage: "focus-only"
        },
        sourceAttribution: null,
        vision: null
      },
      makeLookup(ambiguousSeed)
    );

    expect(result.matches.some((match) => match._tag === "DistributionMatch")).toBe(
      false
    );
    expect(
      result.residuals.some(
        (residual) =>
          residual._tag === "AmbiguousCandidatesResidual" &&
          residual.grain === "Distribution" &&
          residual.candidates.length === 2
      )
    ).toBe(true);
  });
});
