import { describe, expect, it } from "@effect/vitest";
import { Graph, Result } from "effect";
import type { DataLayerRegistrySeed } from "../src/domain/data-layer";
import { prepareDataLayerRegistry } from "../src/resolution/dataLayerRegistry";
import {
  predecessorsByKinds,
  reachableByKinds,
  successorsByKinds,
} from "../src/data-layer/DataLayerGraphTraversal";

const iso = "2026-04-09T00:00:00.000Z" as const;
const agentId = "https://id.skygest.io/agent/ag_1234567890AB" as any;
const datasetId = "https://id.skygest.io/dataset/ds_1234567890AB" as any;
const distributionId =
  "https://id.skygest.io/distribution/dist_1234567890AB" as any;
const variableId = "https://id.skygest.io/variable/var_1234567890AB" as any;
const seriesId = "https://id.skygest.io/series/ser_1234567890AB" as any;

const makeSeed = (
  options: {
    readonly datasetVariableIds?: ReadonlyArray<typeof variableId>;
  } = {},
): DataLayerRegistrySeed => ({
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
      publisherAgentId: agentId,
      aliases: [],
      createdAt: iso as any,
      updatedAt: iso as any,
      distributionIds: [distributionId],
      variableIds: options.datasetVariableIds as any,
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

describe("data-layer graph", () => {
  it("builds graph-backed relationships for declared and derived lineage", () => {
    const prepared = prepareDataLayerRegistry(makeSeed());
    expect(Result.isSuccess(prepared)).toBe(true);

    if (Result.isFailure(prepared)) {
      throw new Error("expected prepared registry");
    }

    expect(Graph.nodeCount(prepared.success.graph.raw)).toBe(5);

    const publishedDatasets = successorsByKinds(
      prepared.success.graph,
      agentId,
      ["publishes"],
    );
    expect(publishedDatasets.map((neighbor) => neighbor.node.id)).toEqual([
      datasetId,
    ]);

    const datasetVariables = successorsByKinds(
      prepared.success.graph,
      datasetId,
      ["has-variable"],
    );
    expect(datasetVariables.map((neighbor) => neighbor.node.id)).toEqual([
      variableId,
    ]);
    expect(datasetVariables[0]?.edge.origin).toBe("derived-from-series");

    const seriesDatasets = successorsByKinds(prepared.success.graph, seriesId, [
      "in-dataset",
    ]);
    expect(seriesDatasets.map((neighbor) => neighbor.node.id)).toEqual([
      datasetId,
    ]);

    const seriesVariables = successorsByKinds(
      prepared.success.graph,
      seriesId,
      ["measures"],
    );
    expect(seriesVariables.map((neighbor) => neighbor.node.id)).toEqual([
      variableId,
    ]);

    const variableDatasets = predecessorsByKinds(
      prepared.success.graph,
      variableId,
      ["has-variable"],
    );
    expect(variableDatasets.map((neighbor) => neighbor.node.id)).toEqual([
      datasetId,
    ]);

    const reachableFromAgent = reachableByKinds(
      prepared.success.graph,
      agentId,
      "outgoing",
      ["publishes", "has-variable"],
    );
    expect(reachableFromAgent.map((neighbor) => neighbor.node.id)).toEqual([
      datasetId,
      variableId,
    ]);
  });

  it("prefers declared dataset-variable edges when the dataset already carries the variable", () => {
    const prepared = prepareDataLayerRegistry(
      makeSeed({ datasetVariableIds: [variableId] }),
    );
    expect(Result.isSuccess(prepared)).toBe(true);

    if (Result.isFailure(prepared)) {
      throw new Error("expected prepared registry");
    }

    const datasetVariables = successorsByKinds(
      prepared.success.graph,
      datasetId,
      ["has-variable"],
    );
    expect(datasetVariables).toHaveLength(1);
    expect(datasetVariables[0]?.edge.origin).toBe("declared");
  });
});
