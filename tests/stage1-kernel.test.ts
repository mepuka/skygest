import { describe, expect, it } from "@effect/vitest";
import { Result } from "effect";
import type { DataLayerRegistrySeed } from "../src/domain/data-layer";
import type { VisionOrganizationMention } from "../src/domain/sourceMatching";
import { runStage1 } from "../src/resolution/Stage1";
import {
  DATASET_TITLE_FUZZY_THRESHOLD,
  findDatasetMatchesForName,
  stripPeripheralYear
} from "../src/resolution/datasetNameMatch";
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

const makeSourceLineInput = (
  datasetName: string,
  options: {
    readonly providerLabel?: string;
    readonly providerDomain?: string;
    readonly organizationMentions?: ReadonlyArray<VisionOrganizationMention>;
  } = {}
) => ({
  postContext: {
    postUri: "at://did:plc:test/app.bsky.feed.post/dataset-title-match" as any,
    text: "",
    links: [],
    linkCards: [],
    threadCoverage: "focus-only" as const
  },
  sourceAttribution:
    options.providerLabel === undefined && options.providerDomain === undefined
      ? null
      : {
          kind: "source-attribution" as const,
          provider:
            options.providerLabel === undefined
              ? null
              : {
                  providerId: options.providerLabel.toLowerCase() as any,
                  providerLabel: options.providerLabel,
                  sourceFamily: null
                },
          resolution: "matched" as const,
          providerCandidates: [],
          contentSource:
            options.providerDomain === undefined
              ? null
              : {
                  url: `https://${options.providerDomain}`,
                  title: null,
                  domain: options.providerDomain,
                  publication: options.providerLabel ?? null
                },
          socialProvenance: null,
          processedAt: 0
        },
  vision: {
    kind: "vision" as const,
    summary: {
      text: "Summary",
      mediaTypes: ["chart"] as const,
      chartTypes: ["line-chart"] as const,
      titles: [],
      keyFindings: []
    },
    assets: [
      {
        assetKey: "asset-1",
        assetType: "image" as const,
        source: "embed" as const,
        index: 0,
        originalAltText: null,
        extractionRoute: "full" as const,
        analysis: {
          mediaType: "chart" as const,
          chartTypes: ["line-chart"] as const,
          altText: null,
          altTextProvenance: "absent" as const,
          xAxis: null,
          yAxis: null,
          series: [],
          sourceLines: [
            {
              sourceText: `Source: ${options.providerLabel ?? "Example source"}`,
              datasetName
            }
          ],
          temporalCoverage: null,
          keyFindings: [],
          visibleUrls: [],
          organizationMentions: [...(options.organizationMentions ?? [])],
          logoText: [],
          title: null,
          modelId: "test",
          processedAt: 0
        }
      }
    ],
    modelId: "test",
    promptVersion: "v1",
    processedAt: 0
  }
});

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
      "DeferredToKernelResidual",
      "DeferredToKernelResidual",
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

  it("strips peripheral years without changing embedded year-like text", () => {
    expect(stripPeripheralYear("World Energy Outlook (2024)")).toBe(
      "World Energy Outlook"
    );
    expect(stripPeripheralYear("[2024] NREL ATB")).toBe("NREL ATB");
    expect(stripPeripheralYear("World Energy Outlook - 2024")).toBe(
      "World Energy Outlook"
    );
    expect(stripPeripheralYear("World Energy Outlook, 2024")).toBe(
      "World Energy Outlook"
    );
    expect(stripPeripheralYear("2024: NREL ATB")).toBe("NREL ATB");
    expect(stripPeripheralYear("Hydrogen Roadmap 2035 Edition")).toBe(
      "Hydrogen Roadmap 2035 Edition"
    );
  });

  it("keeps fuzzy dataset title matches at the 0.75 boundary and rejects lower scores", () => {
    const seed = makeSeed();
    const lookup = makeLookup({
      ...seed,
      datasets: [
        ...seed.datasets,
        {
          _tag: "Dataset",
          id: "https://id.skygest.io/dataset/ds_AEOREPORTBOUND" as any,
          title: "Annual Energy Outlook Report",
          publisherAgentId: "https://id.skygest.io/agent/ag_1234567890AB" as any,
          aliases: [],
          createdAt: iso as any,
          updatedAt: iso as any,
          distributionIds: []
        },
        {
          _tag: "Dataset",
          id: "https://id.skygest.io/dataset/ds_AEOARCHIVELOW" as any,
          title: "Annual Energy Outlook Report Archive",
          publisherAgentId: "https://id.skygest.io/agent/ag_1234567890AB" as any,
          aliases: [],
          createdAt: iso as any,
          updatedAt: iso as any,
          distributionIds: []
        }
      ]
    });

    const matches = findDatasetMatchesForName("Annual Energy Outlook", lookup);

    expect(matches).toHaveLength(1);
    expect(matches[0]?._tag).toBe("DatasetTitleFuzzyMatch");
    expect(matches[0]?.dataset.title).toBe("Annual Energy Outlook Report");
    if (matches[0]?._tag !== "DatasetTitleFuzzyMatch") {
      throw new Error("expected fuzzy dataset title match at the threshold");
    }
    expect(matches[0].score).toBeCloseTo(DATASET_TITLE_FUZZY_THRESHOLD);
  });

  it("falls back to the full registry when no preferred agents are available", () => {
    const seed = makeSeed();

    const matches = findDatasetMatchesForName(
      "Annual Energy Outlook Report Dataset",
      makeLookup({
        ...seed,
        datasets: [
          ...seed.datasets,
          {
            _tag: "Dataset",
            id: "https://id.skygest.io/dataset/ds_FALLBACKMATCH01" as any,
            title: "Annual Energy Outlook Report Dataset Archive",
            publisherAgentId: "https://id.skygest.io/agent/ag_1234567890AB" as any,
            aliases: [],
            createdAt: iso as any,
            updatedAt: iso as any,
            distributionIds: []
          }
        ]
      }),
      { preferredAgentIds: [] }
    );

    expect(matches).toHaveLength(1);
    expect(matches[0]?.dataset.title).toBe(
      "Annual Energy Outlook Report Dataset Archive"
    );
  });

  it("pre-filters by preferredAgentIds when the preferred agent has any passing match", () => {
    const seed = makeSeed();
    const preferredAgentId =
      "https://id.skygest.io/agent/ag_1234567890AB" as any;
    const otherAgentId = "https://id.skygest.io/agent/ag_OTHERSOURCE01" as any;

    const matches = findDatasetMatchesForName(
      "Annual Energy Outlook Report Dataset",
      makeLookup({
        ...seed,
        agents: [
          ...seed.agents,
          {
            _tag: "Agent",
            id: otherAgentId,
            kind: "organization",
            name: "Independent Outlook Lab",
            alternateNames: ["IOL"],
            homepage: "https://www.example.com" as any,
            aliases: [],
            createdAt: iso as any,
            updatedAt: iso as any
          }
        ],
        datasets: [
          ...seed.datasets,
          {
            _tag: "Dataset",
            id: "https://id.skygest.io/dataset/ds_PREFERREDWEAK1" as any,
            title: "Annual Energy Outlook Report",
            publisherAgentId: preferredAgentId,
            aliases: [],
            createdAt: iso as any,
            updatedAt: iso as any,
            distributionIds: []
          },
          {
            _tag: "Dataset",
            id: "https://id.skygest.io/dataset/ds_GLOBALBETTER01" as any,
            title: "Annual Energy Outlook Report Dataset Archive",
            publisherAgentId: otherAgentId,
            aliases: [],
            createdAt: iso as any,
            updatedAt: iso as any,
            distributionIds: []
          }
        ]
      }),
      { preferredAgentIds: [preferredAgentId] }
    );

    // Even though "Annual Energy Outlook Report Dataset Archive" has a
    // higher raw Jaccard against the query, publisher scope pre-filters the
    // candidate set to the preferred agent's datasets, so the less-specific
    // "Annual Energy Outlook Report" wins within that scope.
    expect(matches).toHaveLength(1);
    expect(matches[0]?._tag).toBe("DatasetTitleFuzzyMatch");
    expect(matches[0]?.dataset.title).toBe("Annual Energy Outlook Report");
  });

  it("falls back to the full registry when the preferred agent has no passing match", () => {
    const seed = makeSeed();
    const preferredAgentId =
      "https://id.skygest.io/agent/ag_EMPTYPREFERRED" as any;
    const otherAgentId = "https://id.skygest.io/agent/ag_OTHERSOURCE01" as any;

    const matches = findDatasetMatchesForName(
      "Annual Energy Outlook Report Dataset",
      makeLookup({
        ...seed,
        agents: [
          ...seed.agents,
          {
            _tag: "Agent",
            id: preferredAgentId,
            kind: "organization",
            name: "Sparse Publisher",
            alternateNames: [],
            homepage: "https://sparse.example" as any,
            aliases: [],
            createdAt: iso as any,
            updatedAt: iso as any
          },
          {
            _tag: "Agent",
            id: otherAgentId,
            kind: "organization",
            name: "Independent Outlook Lab",
            alternateNames: ["IOL"],
            homepage: "https://www.example.com" as any,
            aliases: [],
            createdAt: iso as any,
            updatedAt: iso as any
          }
        ],
        // preferredAgentId owns no datasets; only otherAgentId does
        datasets: [
          ...seed.datasets,
          {
            _tag: "Dataset",
            id: "https://id.skygest.io/dataset/ds_GLOBALONLY01" as any,
            title: "Annual Energy Outlook Report Dataset Archive",
            publisherAgentId: otherAgentId,
            aliases: [],
            createdAt: iso as any,
            updatedAt: iso as any,
            distributionIds: []
          }
        ]
      }),
      { preferredAgentIds: [preferredAgentId] }
    );

    // Preferred agent has no dataset clearing the threshold, so the matcher
    // falls through to the unrestricted search.
    expect(matches).toHaveLength(1);
    expect(matches[0]?._tag).toBe("DatasetTitleFuzzyMatch");
    expect(matches[0]?.dataset.title).toBe(
      "Annual Energy Outlook Report Dataset Archive"
    );
  });

  it("returns tied fuzzy matches in deterministic order", () => {
    const seed = makeSeed();

    const matches = findDatasetMatchesForName(
      "Annual Energy Outlook",
      makeLookup({
        ...seed,
        datasets: [
          ...seed.datasets,
          {
            _tag: "Dataset",
            id: "https://id.skygest.io/dataset/ds_ARCHIVETIE001" as any,
            title: "Annual Energy Outlook Archive",
            publisherAgentId: "https://id.skygest.io/agent/ag_1234567890AB" as any,
            aliases: [],
            createdAt: iso as any,
            updatedAt: iso as any,
            distributionIds: []
          },
          {
            _tag: "Dataset",
            id: "https://id.skygest.io/dataset/ds_REPORTTIE0001" as any,
            title: "Annual Energy Outlook Report",
            publisherAgentId: "https://id.skygest.io/agent/ag_1234567890AB" as any,
            aliases: [],
            createdAt: iso as any,
            updatedAt: iso as any,
            distributionIds: []
          }
        ]
      })
    );

    expect(matches.map((match) => match.dataset.title)).toEqual([
      "Annual Energy Outlook Archive",
      "Annual Energy Outlook Report"
    ]);
    expect(matches.every((match) => match._tag === "DatasetTitleFuzzyMatch")).toBe(
      true
    );
  });

  it("keeps the fuzzy dataset title score in Stage 1 evidence", () => {
    const seed = makeSeed();

    const result = runStage1(
      makeSourceLineInput("Annual Energy Outlook", {
        providerLabel: "EIA",
        providerDomain: "www.eia.gov"
      }),
      makeLookup({
        ...seed,
        datasets: [
          ...seed.datasets,
          {
            _tag: "Dataset",
            id: "https://id.skygest.io/dataset/ds_STAGE1FUZZY01" as any,
            title: "Annual Energy Outlook Report",
            publisherAgentId: "https://id.skygest.io/agent/ag_1234567890AB" as any,
            aliases: [],
            createdAt: iso as any,
            updatedAt: iso as any,
            distributionIds: []
          }
        ]
      })
    );

    const datasetMatch = result.matches.find(
      (match) =>
        match._tag === "DatasetMatch" &&
        match.title === "Annual Energy Outlook Report"
    );

    expect(datasetMatch?._tag).toBe("DatasetMatch");
    expect(datasetMatch?.bestRank).toBe(3);
    if (datasetMatch?._tag !== "DatasetMatch") {
      throw new Error("expected dataset match");
    }
    expect(datasetMatch.evidence).toContainEqual(
      expect.objectContaining({
        _tag: "DatasetTitleEvidence",
        rank: 3,
        fuzzyScore: DATASET_TITLE_FUZZY_THRESHOLD
      })
    );
  });

  it("matches dataset titles when the catalog title carries a publisher prefix", () => {
    const seed = makeSeed();

    const result = runStage1(
      makeSourceLineInput("Electric Power Monthly", {
        providerLabel: "EIA",
        providerDomain: "www.eia.gov"
      }),
      makeLookup({
        ...seed,
        datasets: [
          ...seed.datasets,
          {
            _tag: "Dataset",
            id: "https://id.skygest.io/dataset/ds_ELECTRICPOWERMONTHLY" as any,
            title: "EIA Electric Power Monthly",
            publisherAgentId: "https://id.skygest.io/agent/ag_1234567890AB" as any,
            aliases: [],
            createdAt: iso as any,
            updatedAt: iso as any,
            distributionIds: []
          }
        ]
      })
    );

    expect(
      result.matches.some(
        (match) =>
          match._tag === "DatasetMatch" &&
          match.title === "EIA Electric Power Monthly"
      )
    ).toBe(true);
    expect(
      result.residuals.some(
        (residual) => residual._tag === "UnmatchedDatasetTitleResidual"
      )
    ).toBe(false);
  });

  it("matches dataset titles with trailing years against unversioned catalog titles", () => {
    const seed = makeSeed();

    const result = runStage1(
      makeSourceLineInput("World Energy Outlook 2024", {
        providerLabel: "IEA",
        providerDomain: "www.iea.org"
      }),
      makeLookup({
        ...seed,
        agents: [
          ...seed.agents,
          {
            _tag: "Agent",
            id: "https://id.skygest.io/agent/ag_IEAIEAIEAIEA" as any,
            kind: "organization",
            name: "International Energy Agency",
            alternateNames: ["IEA"],
            homepage: "https://www.iea.org" as any,
            aliases: [],
            createdAt: iso as any,
            updatedAt: iso as any
          }
        ],
        datasets: [
          ...seed.datasets,
          {
            _tag: "Dataset",
            id: "https://id.skygest.io/dataset/ds_WORLDEOUTLOOK" as any,
            title: "IEA World Energy Outlook",
            publisherAgentId: "https://id.skygest.io/agent/ag_IEAIEAIEAIEA" as any,
            aliases: [],
            createdAt: iso as any,
            updatedAt: iso as any,
            distributionIds: []
          }
        ]
      })
    );

    expect(
      result.matches.some(
        (match) =>
          match._tag === "DatasetMatch" &&
          match.title === "IEA World Energy Outlook"
      )
    ).toBe(true);
    expect(
      result.residuals.some(
        (residual) => residual._tag === "UnmatchedDatasetTitleResidual"
      )
    ).toBe(false);
  });

  it("matches dataset titles with leading years against alias-backed catalog titles", () => {
    const seed = makeSeed();

    const result = runStage1(
      makeSourceLineInput("2024 NREL ATB", {
        providerLabel: "NREL",
        providerDomain: "www.nrel.gov"
      }),
      makeLookup({
        ...seed,
        agents: [
          ...seed.agents,
          {
            _tag: "Agent",
            id: "https://id.skygest.io/agent/ag_NRELNRELNREL" as any,
            kind: "organization",
            name: "National Renewable Energy Laboratory",
            alternateNames: ["NREL"],
            homepage: "https://www.nrel.gov" as any,
            aliases: [],
            createdAt: iso as any,
            updatedAt: iso as any
          }
        ],
        datasets: [
          ...seed.datasets,
          {
            _tag: "Dataset",
            id: "https://id.skygest.io/dataset/ds_NRELATBNRELATB" as any,
            title: "NREL Annual Technology Baseline",
            publisherAgentId: "https://id.skygest.io/agent/ag_NRELNRELNREL" as any,
            aliases: [
              {
                scheme: "display-alias",
                value: "NREL ATB",
                relation: "closeMatch"
              }
            ],
            createdAt: iso as any,
            updatedAt: iso as any,
            distributionIds: []
          }
        ]
      })
    );

    expect(
      result.matches.some(
        (match) =>
          match._tag === "DatasetMatch" &&
          match.title === "NREL Annual Technology Baseline"
      )
    ).toBe(true);
    expect(
      result.residuals.some(
        (residual) => residual._tag === "UnmatchedDatasetTitleResidual"
      )
    ).toBe(false);
  });

  it("matches slug-style catalog titles against human-readable dataset names", () => {
    const seed = makeSeed();

    const result = runStage1(
      makeSourceLineInput("CAISO Today's Outlook", {
        organizationMentions: [
          {
            name: "CAISO",
            location: "footer"
          }
        ]
      }),
      makeLookup({
        ...seed,
        agents: [
          ...seed.agents,
          {
            _tag: "Agent",
            id: "https://id.skygest.io/agent/ag_CAISOCAISOCA" as any,
            kind: "organization",
            name: "California ISO",
            alternateNames: ["CAISO"],
            homepage: "https://www.caiso.com" as any,
            aliases: [],
            createdAt: iso as any,
            updatedAt: iso as any
          }
        ],
        datasets: [
          ...seed.datasets,
          {
            _tag: "Dataset",
            id: "https://id.skygest.io/dataset/ds_CAISOTODAYOUT" as any,
            title: "caiso-todays-outlook",
            publisherAgentId: "https://id.skygest.io/agent/ag_CAISOCAISOCA" as any,
            aliases: [],
            createdAt: iso as any,
            updatedAt: iso as any,
            distributionIds: []
          }
        ]
      })
    );

    expect(
      result.matches.some(
        (match) =>
          match._tag === "DatasetMatch" &&
          match.title === "caiso-todays-outlook"
      )
    ).toBe(true);
    expect(
      result.residuals.some(
        (residual) => residual._tag === "UnmatchedDatasetTitleResidual"
      )
    ).toBe(false);
  });
});
