import { describe, expect, it } from "@effect/vitest";
import { Result } from "effect";
import {
  agentLineageChain,
  datasetForDistribution,
  datasetForSeries,
  datasetsForPublisherAgent,
  datasetsForVariable,
  distributionsForDataset,
  parentAgentsForAgent,
  publisherAgentsForDataset,
  seriesForDataset,
  seriesForVariable,
  variableForSeries,
  variablesForDataset,
} from "../src/data-layer/DataLayerGraphViews";
import type { DataLayerRegistrySeed } from "../src/domain/data-layer";
import { prepareDataLayerRegistry } from "../src/resolution/dataLayerRegistry";

const iso = "2026-04-09T00:00:00.000Z" as const;
const parentAgentId = "https://id.skygest.io/agent/ag_PARENT123456" as any;
const childAgentId = "https://id.skygest.io/agent/ag_CHILD1234567" as any;
const datasetId = "https://id.skygest.io/dataset/ds_1234567890AB" as any;
const distributionId =
  "https://id.skygest.io/distribution/dist_1234567890AB" as any;
const variableId = "https://id.skygest.io/variable/var_1234567890AB" as any;
const seriesId = "https://id.skygest.io/series/ser_1234567890AB" as any;

const makeSeed = (): DataLayerRegistrySeed => ({
  agents: [
    {
      _tag: "Agent",
      id: parentAgentId,
      kind: "organization",
      name: "Department of Energy",
      alternateNames: ["DOE"],
      homepage: "https://www.energy.gov" as any,
      aliases: [],
      createdAt: iso as any,
      updatedAt: iso as any,
    },
    {
      _tag: "Agent",
      id: childAgentId,
      kind: "organization",
      name: "Energy Information Administration",
      alternateNames: ["EIA"],
      homepage: "https://www.eia.gov" as any,
      parentAgentId,
      aliases: [],
      createdAt: iso as any,
      updatedAt: iso as any,
    },
  ],
  catalogs: [],
  catalogRecords: [],
  datasets: [
    {
      _tag: "Dataset",
      id: datasetId,
      title: "EIA Emissions Data",
      publisherAgentId: childAgentId,
      aliases: [],
      createdAt: iso as any,
      updatedAt: iso as any,
      distributionIds: [distributionId],
    },
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
      updatedAt: iso as any,
    },
  ],
  dataServices: [],
  datasetSeries: [],
  variables: [
    {
      _tag: "Variable",
      id: variableId,
      label: "Net generation",
      aliases: [],
      createdAt: iso as any,
      updatedAt: iso as any,
    },
  ],
  series: [
    {
      _tag: "Series",
      id: seriesId,
      label: "Net generation (annual)",
      variableId,
      datasetId,
      fixedDims: {},
      aliases: [],
      createdAt: iso as any,
      updatedAt: iso as any,
    },
  ],
});

describe("data-layer graph views", () => {
  it("provides shared graph-backed reads for dataset, variable, series, and distribution relationships", () => {
    const prepared = prepareDataLayerRegistry(makeSeed());
    expect(Result.isSuccess(prepared)).toBe(true);

    if (Result.isFailure(prepared)) {
      throw new Error("expected prepared registry");
    }

    expect(
      datasetsForPublisherAgent(prepared.success.graph, childAgentId).map(
        (dataset) => dataset.id,
      ),
    ).toEqual([datasetId]);

    expect(
      publisherAgentsForDataset(prepared.success.graph, datasetId).map(
        (agent) => agent.id,
      ),
    ).toEqual([childAgentId]);

    expect(
      variablesForDataset(prepared.success.graph, datasetId).map(
        (variable) => variable.id,
      ),
    ).toEqual([variableId]);

    expect(
      distributionsForDataset(prepared.success.graph, datasetId).map(
        (distribution) => distribution.id,
      ),
    ).toEqual([distributionId]);

    expect(
      seriesForDataset(prepared.success.graph, datasetId).map(
        (series) => series.id,
      ),
    ).toEqual([seriesId]);

    expect(
      datasetsForVariable(prepared.success.graph, variableId).map(
        (dataset) => dataset.id,
      ),
    ).toEqual([datasetId]);

    expect(
      seriesForVariable(prepared.success.graph, variableId).map(
        (series) => series.id,
      ),
    ).toEqual([seriesId]);

    expect(
      datasetForDistribution(prepared.success.graph, distributionId)?.id,
    ).toBe(datasetId);
    expect(datasetForSeries(prepared.success.graph, seriesId)?.id).toBe(
      datasetId,
    );
    expect(variableForSeries(prepared.success.graph, seriesId)?.id).toBe(
      variableId,
    );
  });

  it("walks parent-agent lineage through the shared graph", () => {
    const prepared = prepareDataLayerRegistry(makeSeed());
    expect(Result.isSuccess(prepared)).toBe(true);

    if (Result.isFailure(prepared)) {
      throw new Error("expected prepared registry");
    }

    expect(
      parentAgentsForAgent(prepared.success.graph, childAgentId).map(
        (agent) => agent.id,
      ),
    ).toEqual([parentAgentId]);

    expect(
      agentLineageChain(prepared.success.graph, childAgentId).map(
        (agent) => agent.id,
      ),
    ).toEqual([childAgentId, parentAgentId]);
  });
});
