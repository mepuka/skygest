import { describe, expect, it } from "@effect/vitest";
import { Chunk, Option, Result } from "effect";
import type { DataLayerRegistrySeed } from "../src/domain/data-layer";
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
    ).toBe("https://id.skygest.io/agent/ag_1234567890AB");
    expect(
      Option.getOrNull(lookup.findDatasetByTitle("EIA Emissions Data"))?.id
    ).toBe("https://id.skygest.io/dataset/ds_1234567890AB");
    expect(
      Option.getOrNull(lookup.findDatasetByAlias("eia-route", "EMISS"))?.id
    ).toBe("https://id.skygest.io/dataset/ds_1234567890AB");
    expect(
      Option.getOrNull(
        lookup.findDistributionByUrl(
          "https://api.eia.gov/v2/emissions/emissions-co2-by-state-by-fuel/data/?frequency=monthly#table"
        )
      )?.id
    ).toBe("https://id.skygest.io/distribution/dist_1234567890AB");
    expect(
      Chunk.size(
        lookup.findDistributionsByHostname(
          "https://api.eia.gov/v2/emissions/emissions-co2-by-state-by-fuel/data/"
        )
      )
    ).toBe(1);
    expect(
      Option.getOrNull(
        lookup.findVariableByAlias("eia-series", "ELEC.GEN.ALL-US-99.M")
      )?.id
    ).toBe("https://id.skygest.io/variable/var_1234567890AB");
  });

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
});
