import { Graph } from "effect";
import { IngestHarnessError } from "./errors";
import type { IngestEdge } from "./IngestEdge";
import type { IngestGraph } from "./IngestGraph";
import type { IngestNode } from "./IngestNode";

const nodeKey = (node: IngestNode): string => `${node._tag}::${node.data.id}`;

const nodeIndex = (indexById: Map<string, number>, node: IngestNode): number => {
  const index = indexById.get(nodeKey(node));
  if (index !== undefined) {
    return index;
  }

  throw new IngestHarnessError({
    message: `Missing node index for ${nodeKey(node)} while building graph`
  });
};

export const buildIngestGraph = (
  validatedNodes: ReadonlyArray<IngestNode>
): IngestGraph => {
  const indexById = new Map<string, number>();
  const seenNodeKeys = new Set<string>();

  for (const node of validatedNodes) {
    const key = nodeKey(node);
    if (seenNodeKeys.has(key)) {
      throw new IngestHarnessError({
        message: `Duplicate ingest graph node key ${key}`
      });
    }
    seenNodeKeys.add(key);
  }

  return Graph.directed<IngestNode, IngestEdge>((mutable) => {
    const agentNodes: Array<Extract<IngestNode, { _tag: "agent" }>> = [];
    const catalogNodes: Array<Extract<IngestNode, { _tag: "catalog" }>> = [];
    const dataServiceNodes: Array<
      Extract<IngestNode, { _tag: "data-service" }>
    > = [];
    const datasetNodes: Array<Extract<IngestNode, { _tag: "dataset" }>> = [];
    const distNodes: Array<Extract<IngestNode, { _tag: "distribution" }>> = [];
    const crNodes: Array<Extract<IngestNode, { _tag: "catalog-record" }>> = [];

    for (const node of validatedNodes) {
      indexById.set(nodeKey(node), Graph.addNode(mutable, node));
      switch (node._tag) {
        case "agent":
          agentNodes.push(node);
          break;
        case "catalog":
          catalogNodes.push(node);
          break;
        case "data-service":
          dataServiceNodes.push(node);
          break;
        case "dataset":
          datasetNodes.push(node);
          break;
        case "distribution":
          distNodes.push(node);
          break;
        case "catalog-record":
          crNodes.push(node);
          break;
      }
    }

    for (const agent of agentNodes) {
      const agentIdx = nodeIndex(indexById, agent);
      for (const catalog of catalogNodes) {
        if (catalog.data.publisherAgentId === agent.data.id) {
          Graph.addEdge(
            mutable,
            agentIdx,
            nodeIndex(indexById, catalog),
            "publishes"
          );
        }
      }
      for (const dataset of datasetNodes) {
        if (dataset.data.publisherAgentId === agent.data.id) {
          Graph.addEdge(
            mutable,
            agentIdx,
            nodeIndex(indexById, dataset),
            "publishes"
          );
        }
      }
      for (const dataService of dataServiceNodes) {
        if (dataService.data.publisherAgentId === agent.data.id) {
          Graph.addEdge(
            mutable,
            agentIdx,
            nodeIndex(indexById, dataService),
            "publishes"
          );
        }
      }
    }

    for (const catalog of catalogNodes) {
      const catalogIdx = nodeIndex(indexById, catalog);
      for (const catalogRecord of crNodes) {
        if (catalogRecord.data.catalogId === catalog.data.id) {
          Graph.addEdge(
            mutable,
            catalogIdx,
            nodeIndex(indexById, catalogRecord),
            "contains-record"
          );
        }
      }
    }

    for (const dataset of datasetNodes) {
      const datasetIdx = nodeIndex(indexById, dataset);
      for (const distribution of distNodes) {
        if (distribution.data.datasetId === dataset.data.id) {
          Graph.addEdge(
            mutable,
            datasetIdx,
            nodeIndex(indexById, distribution),
            "has-distribution"
          );
        }
      }
      for (const catalogRecord of crNodes) {
        if (catalogRecord.data.primaryTopicId === dataset.data.id) {
          Graph.addEdge(
            mutable,
            datasetIdx,
            nodeIndex(indexById, catalogRecord),
            "primary-topic-of"
          );
        }
      }
      for (const dataService of dataServiceNodes) {
        if (dataService.data.servesDatasetIds.includes(dataset.data.id)) {
          Graph.addEdge(
            mutable,
            datasetIdx,
            nodeIndex(indexById, dataService),
            "served-by"
          );
        }
      }
    }
  });
};
