// Named graph reads live here so consumers can reuse stable relationship
// queries without restating edge-kind tuples across the runtime.
import type {
  Agent,
  Dataset,
  Distribution,
  Series,
  Variable,
} from "../domain/data-layer";
import type { DataLayerGraph } from "./DataLayerGraph";
import {
  findDataLayerGraphNodeByTag,
  firstPredecessorNodeByKindsAndTag,
  firstSuccessorNodeByKindsAndTag,
  predecessorNodesByKindsAndTag,
  successorNodesByKindsAndTag,
} from "./DataLayerGraphTraversal";

export const datasetsForPublisherAgent = (
  graph: DataLayerGraph,
  agentId: string,
): ReadonlyArray<Dataset> =>
  successorNodesByKindsAndTag(graph, agentId, ["publishes"], "Dataset");

export const parentAgentsForAgent = (
  graph: DataLayerGraph,
  agentId: string,
): ReadonlyArray<Agent> =>
  predecessorNodesByKindsAndTag(graph, agentId, ["parent-agent"], "Agent");

export const agentLineageChain = (
  graph: DataLayerGraph,
  agentId: string,
): ReadonlyArray<Agent> => {
  const agent = findDataLayerGraphNodeByTag(graph, agentId, "Agent");
  if (agent === undefined) {
    return [];
  }

  const chain: Array<Agent> = [agent];
  const seen = new Set<string>([agent.id]);
  let current = agent;
  const maxDepth = graph.nodeCount();

  while (chain.length < maxDepth) {
    const parent = firstPredecessorNodeByKindsAndTag(
      graph,
      current.id,
      ["parent-agent"],
      "Agent",
    );
    if (parent === undefined || seen.has(parent.id)) {
      break;
    }

    chain.push(parent);
    seen.add(parent.id);
    current = parent;
  }

  return chain;
};

export const publisherAgentsForDataset = (
  graph: DataLayerGraph,
  datasetId: string,
): ReadonlyArray<Agent> =>
  predecessorNodesByKindsAndTag(graph, datasetId, ["publishes"], "Agent");

export const variablesForDataset = (
  graph: DataLayerGraph,
  datasetId: string,
): ReadonlyArray<Variable> =>
  successorNodesByKindsAndTag(graph, datasetId, ["has-variable"], "Variable");

export const distributionsForDataset = (
  graph: DataLayerGraph,
  datasetId: string,
): ReadonlyArray<Distribution> =>
  successorNodesByKindsAndTag(
    graph,
    datasetId,
    ["has-distribution"],
    "Distribution",
  );

export const seriesForDataset = (
  graph: DataLayerGraph,
  datasetId: string,
): ReadonlyArray<Series> =>
  predecessorNodesByKindsAndTag(
    graph,
    datasetId,
    ["published-in-dataset"],
    "Series",
  );

export const datasetForDistribution = (
  graph: DataLayerGraph,
  distributionId: string,
): Dataset | undefined =>
  firstPredecessorNodeByKindsAndTag(
    graph,
    distributionId,
    ["has-distribution"],
    "Dataset",
  );

export const datasetsForVariable = (
  graph: DataLayerGraph,
  variableId: string,
): ReadonlyArray<Dataset> =>
  predecessorNodesByKindsAndTag(graph, variableId, ["has-variable"], "Dataset");

export const seriesForVariable = (
  graph: DataLayerGraph,
  variableId: string,
): ReadonlyArray<Series> =>
  predecessorNodesByKindsAndTag(
    graph,
    variableId,
    ["implements-variable"],
    "Series",
  );

export const datasetForSeries = (
  graph: DataLayerGraph,
  seriesId: string,
): Dataset | undefined =>
  firstSuccessorNodeByKindsAndTag(
    graph,
    seriesId,
    ["published-in-dataset"],
    "Dataset",
  );

export const variableForSeries = (
  graph: DataLayerGraph,
  seriesId: string,
): Variable | undefined =>
  firstSuccessorNodeByKindsAndTag(
    graph,
    seriesId,
    ["implements-variable"],
    "Variable",
  );
