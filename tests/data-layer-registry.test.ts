import { describe, expect, it } from "@effect/vitest";
import { Chunk, Effect, Option, Result } from "effect";
import type { DataLayerRegistrySeed } from "../src/domain/data-layer";
import { prepareDataLayerRegistry, toDataLayerRegistryLookup } from "../src/resolution/dataLayerRegistry";
import { DataLayerRegistry } from "../src/services/DataLayerRegistry";

const iso = "2026-04-09T00:00:00.000Z" as const;
const agentId = "https://id.skygest.io/agent/ag_1234567890AB" as any;
const datasetId = "https://id.skygest.io/dataset/ds_1234567890AB" as any;
const distributionId = "https://id.skygest.io/distribution/dist_1234567890AB" as any;
const variableId = "https://id.skygest.io/variable/var_1234567890AB" as any;

const makeSeed = (): DataLayerRegistrySeed => ({
  agents: [
    {
      _tag: "Agent",
      id: agentId,
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
      id: datasetId,
      title: "EIA Emissions Data",
      publisherAgentId: agentId,
      aliases: [
        {
          scheme: "eia-route",
          value: "EMISS",
          relation: "exactMatch"
        }
      ],
      createdAt: iso as any,
      updatedAt: iso as any,
      distributionIds: [distributionId],
      variableIds: [variableId]
    }
  ],
  distributions: [
    {
      _tag: "Distribution",
      id: distributionId,
      datasetId,
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
      id: variableId,
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

describe("data layer registry prep", () => {
  it("builds deterministic typed lookups", () => {
    const prepared = prepareDataLayerRegistry(makeSeed());
    expect(Result.isSuccess(prepared)).toBe(true);

    if (Result.isFailure(prepared)) {
      throw new Error("expected prepared registry");
    }

    const lookup = toDataLayerRegistryLookup(prepared.success);

    expect(
      Option.getOrNull(lookup.findAgentByLabel("EIA"))?.id
    ).toBe(agentId);
    expect(
      Option.getOrNull(lookup.findDatasetByTitle("EIA Emissions Data"))?.id
    ).toBe(datasetId);
    expect(
      Option.getOrNull(lookup.findDatasetByAlias("eia-route", "EMISS"))?.id
    ).toBe(datasetId);
    expect(
      Option.getOrNull(
        lookup.findDistributionByUrl(
          "https://api.eia.gov/v2/emissions/emissions-co2-by-state-by-fuel/data/?frequency=monthly#table"
        )
      )?.id
    ).toBe(distributionId);
    expect(
      Chunk.size(
        lookup.findDistributionsByHostname(
          "https://api.eia.gov/v2/emissions/emissions-co2-by-state-by-fuel/data/"
        )
      )
    ).toBe(1);
    expect([...lookup.findDatasetsByVariableId(variableId)]).toEqual([
      prepared.success.seed.datasets[0]
    ]);
    expect([...lookup.findDatasetsByAgentId(agentId)]).toEqual([
      prepared.success.seed.datasets[0]
    ]);
    expect([
      ...(prepared.success.variablesByAgentId.get(agentId) ?? Chunk.empty())
    ]).toEqual([prepared.success.seed.variables[0]]);
    expect([...lookup.findVariablesByAgentId(agentId)]).toEqual([
      prepared.success.seed.variables[0]
    ]);
    expect([...lookup.findVariablesByDatasetId(datasetId)]).toEqual([
      prepared.success.seed.variables[0]
    ]);
    expect(
      Option.getOrNull(
        lookup.findVariableByAlias("eia-series", "ELEC.GEN.ALL-US-99.M")
      )?.id
    ).toBe(variableId);
  });

  it.effect("exposes only the public prepared core through the service", () =>
    (() => {
      const prepared = prepareDataLayerRegistry(makeSeed());
      expect(Result.isSuccess(prepared)).toBe(true);

      if (Result.isFailure(prepared)) {
        throw new Error("expected prepared registry");
      }

      return Effect.gen(function* () {
        const registry = yield* DataLayerRegistry;

        expect(registry.prepared.seed.datasets).toHaveLength(1);
        expect(
          "variablesByAgentId" in (registry.prepared as Record<string, unknown>)
        ).toBe(false);
        expect(
          Option.getOrNull(registry.lookup.findAgentByLabel("EIA"))?.id
        ).toBe(agentId);
      }).pipe(
        Effect.provide(DataLayerRegistry.layerFromPrepared(prepared.success))
      );
    })()
  );

  it("rejects normalized exact-match collisions during preparation", () => {
    const seed = makeSeed();
    const prepared = prepareDataLayerRegistry({
      ...seed,
      agents: [
        ...seed.agents,
        {
          _tag: "Agent",
          id: "https://id.skygest.io/agent/ag_ABCDEFGHIJKL" as any,
          kind: "organization",
          name: "EIA",
          aliases: [],
          createdAt: iso as any,
          updatedAt: iso as any
        }
      ]
    });
    expect(Result.isFailure(prepared)).toBe(true);

    if (Result.isSuccess(prepared)) {
      throw new Error("expected collision failure");
    }

    expect(
      prepared.failure.issues.some(
        (issue) =>
          issue._tag === "LookupCollisionIssue" &&
          issue.lookup === "agent-label"
      )
    ).toBe(true);
  });

  it("does not treat dataset close-match urls as unique registry keys", () => {
    const seed = makeSeed();
    const firstDataset = seed.datasets[0]!;
    const sharedUrl = "https://example.com/shared-catalog-page";
    const prepared = prepareDataLayerRegistry({
      ...seed,
      datasets: [
        {
          ...firstDataset,
          aliases: [
            {
              scheme: "url",
              value: sharedUrl,
              relation: "closeMatch"
            }
          ]
        },
        {
          ...firstDataset,
          id: "https://id.skygest.io/dataset/ds_ABCDEFGHIJKL" as any,
          title: "Sibling dataset",
          distributionIds: [],
          aliases: [
            {
              scheme: "url",
              value: sharedUrl,
              relation: "closeMatch"
            }
          ]
        }
      ]
    });

    expect(Result.isSuccess(prepared)).toBe(true);

    if (Result.isFailure(prepared)) {
      throw new Error("expected registry prep to ignore dataset url collisions");
    }

    const lookup = toDataLayerRegistryLookup(prepared.success);
    expect(
      Option.getOrNull(lookup.findDatasetByAlias("url", sharedUrl))
    ).toBeNull();
  });

  it("rejects unknown canonical values on populated semantic facets", () => {
    const seed = makeSeed();
    const prepared = prepareDataLayerRegistry({
      ...seed,
      variables: [
        {
          ...seed.variables[0]!,
          policyInstrument: "not-a-real-policy"
        }
      ]
    });
    expect(Result.isFailure(prepared)).toBe(true);

    if (Result.isSuccess(prepared)) {
      throw new Error("expected unknown canonical value failure");
    }

    expect(prepared.failure.issues).toContainEqual({
      _tag: "UnknownVocabularyValueIssue",
      path: `Variable:${variableId}`,
      facet: "policyInstrument",
      value: "not-a-real-policy"
    });
  });

  it("indexes dataset.landingPage for exact URL lookups", () => {
    const seed = makeSeed();
    const landingPage = "https://www.eia.gov/electricity/monthly/";
    const prepared = prepareDataLayerRegistry({
      ...seed,
      datasets: [
        {
          ...seed.datasets[0]!,
          landingPage: landingPage as any
        }
      ]
    });

    expect(Result.isSuccess(prepared)).toBe(true);
    if (Result.isFailure(prepared)) {
      throw new Error("expected landing-page dataset to prepare cleanly");
    }

    const lookup = toDataLayerRegistryLookup(prepared.success);
    expect(
      Option.getOrNull(lookup.findDatasetByLandingPage(landingPage))?.id
    ).toBe(datasetId);
    // normalization should tolerate tracking-param noise / fragments
    expect(
      Option.getOrNull(
        lookup.findDatasetByLandingPage(
          "https://www.eia.gov/electricity/monthly/?utm_source=bsky#top"
        )
      )?.id
    ).toBe(datasetId);
  });

  it("keeps format-changing distribution query params in exact url lookups", () => {
    const seed = makeSeed();
    const firstDataset = seed.datasets[0]!;
    const firstDistribution = seed.distributions[0]!;
    const prepared = prepareDataLayerRegistry({
      ...seed,
      datasets: [
        {
          ...firstDataset,
          distributionIds: [
            "https://id.skygest.io/distribution/dist_1234567890AB" as any,
            "https://id.skygest.io/distribution/dist_ABCDEFGHIJKL" as any
          ]
        }
      ],
      distributions: [
        {
          ...firstDistribution,
          id: "https://id.skygest.io/distribution/dist_1234567890AB" as any,
          accessURL:
            "https://api.gridstatus.io/v1/datasets/pjm_load_forecast/query?return_format=json" as any
        },
        {
          ...firstDistribution,
          id: "https://id.skygest.io/distribution/dist_ABCDEFGHIJKL" as any,
          kind: "download",
          title: "PJM Load Forecast CSV",
          downloadURL:
            "https://api.gridstatus.io/v1/datasets/pjm_load_forecast/query?return_format=csv&download=true" as any
        }
      ]
    });

    expect(Result.isSuccess(prepared)).toBe(true);

    if (Result.isFailure(prepared)) {
      throw new Error("expected query-distinct distributions to prepare cleanly");
    }

    const lookup = toDataLayerRegistryLookup(prepared.success);
    expect(
      Option.getOrNull(
        lookup.findDistributionByUrl(
          "https://api.gridstatus.io/v1/datasets/pjm_load_forecast/query?return_format=json&utm_source=test"
        )
      )?.id
    ).toBe("https://id.skygest.io/distribution/dist_1234567890AB");
    expect(
      Option.getOrNull(
        lookup.findDistributionByUrl(
          "https://api.gridstatus.io/v1/datasets/pjm_load_forecast/query?download=true&return_format=csv#fragment"
        )
      )?.id
    ).toBe("https://id.skygest.io/distribution/dist_ABCDEFGHIJKL");
  });
});
