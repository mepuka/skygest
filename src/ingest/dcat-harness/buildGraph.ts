import { Graph } from "effect";
import type { IngestEdge } from "./IngestEdge";
import type { IngestGraph } from "./IngestGraph";
import type { IngestNode } from "./IngestNode";

const nodeKey = (node: IngestNode): string => `${node._tag}::${node.data.id}`;

export const buildIngestGraph = (
  validatedNodes: ReadonlyArray<IngestNode>
): IngestGraph =>
  Graph.directed<IngestNode, IngestEdge>((mutable) => {
    const indexById = new Map<string, number>();

    for (const node of validatedNodes) {
      indexById.set(nodeKey(node), Graph.addNode(mutable, node));
    }

    const agentNodes: Array<Extract<IngestNode, { _tag: "agent" }>> = [];
    const catalogNodes: Array<Extract<IngestNode, { _tag: "catalog" }>> = [];
    const dataServiceNodes: Array<
      Extract<IngestNode, { _tag: "data-service" }>
    > = [];
    const datasetNodes: Array<Extract<IngestNode, { _tag: "dataset" }>> = [];
    const distNodes: Array<Extract<IngestNode, { _tag: "distribution" }>> = [];
    const crNodes: Array<Extract<IngestNode, { _tag: "catalog-record" }>> = [];

    for (const node of validatedNodes) {
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
      const agentIdx = indexById.get(nodeKey(agent))!;
      for (const catalog of catalogNodes) {
        if (catalog.data.publisherAgentId === agent.data.id) {
          Graph.addEdge(
            mutable,
            agentIdx,
            indexById.get(nodeKey(catalog))!,
            "publishes"
          );
        }
      }
      for (const dataset of datasetNodes) {
        if (dataset.data.publisherAgentId === agent.data.id) {
          Graph.addEdge(
            mutable,
            agentIdx,
            indexById.get(nodeKey(dataset))!,
            "publishes"
          );
        }
      }
      for (const dataService of dataServiceNodes) {
        if (dataService.data.publisherAgentId === agent.data.id) {
          Graph.addEdge(
            mutable,
            agentIdx,
            indexById.get(nodeKey(dataService))!,
            "publishes"
          );
        }
      }
    }

    for (const catalog of catalogNodes) {
      const catalogIdx = indexById.get(nodeKey(catalog))!;
      for (const catalogRecord of crNodes) {
        if (catalogRecord.data.catalogId === catalog.data.id) {
          Graph.addEdge(
            mutable,
            catalogIdx,
            indexById.get(nodeKey(catalogRecord))!,
            "contains-record"
          );
        }
      }
    }

    for (const dataset of datasetNodes) {
      const datasetIdx = indexById.get(nodeKey(dataset))!;
      for (const distribution of distNodes) {
        if (distribution.data.datasetId === dataset.data.id) {
          Graph.addEdge(
            mutable,
            datasetIdx,
            indexById.get(nodeKey(distribution))!,
            "has-distribution"
          );
        }
      }
      for (const catalogRecord of crNodes) {
        if (catalogRecord.data.primaryTopicId === dataset.data.id) {
          Graph.addEdge(
            mutable,
            datasetIdx,
            indexById.get(nodeKey(catalogRecord))!,
            "primary-topic-of"
          );
        }
      }
      for (const dataService of dataServiceNodes) {
        if (dataService.data.servesDatasetIds.includes(dataset.data.id)) {
          Graph.addEdge(
            mutable,
            datasetIdx,
            indexById.get(nodeKey(dataService))!,
            "served-by"
          );
        }
      }
    }
  });
