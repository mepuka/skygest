import { Graph, Option } from "effect";
import {
  buildDataLayerGraph,
  type DataLayerGraph,
} from "../../data-layer/DataLayerGraph";
import type { DataLayerGraphEdge } from "../../domain/data-layer/graph";
import { IngestHarnessError } from "./errors";
import type { IngestEdge } from "./IngestEdge";
import type { IngestGraph } from "./IngestGraph";
import type { IngestNode } from "./IngestNode";

export type BuiltIngestGraphs = {
  readonly graph: IngestGraph;
  readonly dataLayerGraph: DataLayerGraph;
};

const nodeKey = (node: IngestNode): string => `${node._tag}::${node.data.id}`;

const nodeIndex = (
  indexById: Map<string, number>,
  node: IngestNode,
): number => {
  const index = indexById.get(nodeKey(node));
  if (index !== undefined) {
    return index;
  }

  throw new IngestHarnessError({
    message: `Missing node index for ${nodeKey(node)} while building graph`,
  });
};

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const compatibleIngestEdge = (
  source: IngestNode | undefined,
  target: IngestNode | undefined,
  edge: DataLayerGraphEdge,
): IngestEdge | undefined => {
  if (source === undefined || target === undefined) {
    return undefined;
  }

  switch (edge.kind) {
    case "publishes":
      return source._tag === "agent" &&
        (target._tag === "catalog" ||
          target._tag === "dataset" ||
          target._tag === "dataset-series" ||
          target._tag === "data-service")
        ? "publishes"
        : undefined;
    case "contains-record":
      return source._tag === "catalog" && target._tag === "catalog-record"
        ? "contains-record"
        : undefined;
    case "has-series-member":
      return source._tag === "dataset-series" && target._tag === "dataset"
        ? "has-series-member"
        : undefined;
    case "has-distribution":
      return source._tag === "dataset" && target._tag === "distribution"
        ? "has-distribution"
        : undefined;
    case "primary-topic-of":
      return source._tag === "dataset" && target._tag === "catalog-record"
        ? "primary-topic-of"
        : undefined;
    case "served-by":
      return source._tag === "dataset" && target._tag === "data-service"
        ? "served-by"
        : undefined;
    default:
      return undefined;
  }
};

const buildCompatibilityGraph = (
  validatedNodes: ReadonlyArray<IngestNode>,
  dataLayerGraph: DataLayerGraph,
): IngestGraph => {
  const indexById = new Map<string, number>();
  const nodeByEntityId = new Map<string, IngestNode>(
    validatedNodes.map((node) => [node.data.id, node]),
  );

  return Graph.directed<IngestNode, IngestEdge>((mutable) => {
    for (const node of validatedNodes) {
      indexById.set(nodeKey(node), Graph.addNode(mutable, node));
    }

    for (const edgeIndex of Graph.indices(Graph.edges(dataLayerGraph.raw))) {
      const edge = Option.getOrUndefined(
        Graph.getEdge(dataLayerGraph.raw, edgeIndex),
      );
      if (edge === undefined) {
        continue;
      }

      const sourceNode = Option.getOrUndefined(
        Graph.getNode(dataLayerGraph.raw, edge.source),
      );
      const targetNode = Option.getOrUndefined(
        Graph.getNode(dataLayerGraph.raw, edge.target),
      );
      if (sourceNode === undefined || targetNode === undefined) {
        throw new IngestHarnessError({
          message: `Missing shared graph node while rebuilding ingest compatibility graph`,
        });
      }

      const source = nodeByEntityId.get(sourceNode.id);
      const target = nodeByEntityId.get(targetNode.id);
      if (source === undefined || target === undefined) {
        continue;
      }

      const compatibleEdge = compatibleIngestEdge(source, target, edge.data);
      if (compatibleEdge === undefined) {
        continue;
      }

      Graph.addEdge(
        mutable,
        nodeIndex(indexById, source),
        nodeIndex(indexById, target),
        compatibleEdge,
      );
    }
  });
};

export const buildIngestGraphs = (
  validatedNodes: ReadonlyArray<IngestNode>,
): BuiltIngestGraphs => {
  const seenNodeKeys = new Set<string>();

  for (const node of validatedNodes) {
    const key = nodeKey(node);
    if (seenNodeKeys.has(key)) {
      throw new IngestHarnessError({
        message: `Duplicate ingest graph node key ${key}`,
      });
    }
    seenNodeKeys.add(key);
  }

  try {
    const dataLayerGraph = buildDataLayerGraph(
      validatedNodes.map((node) => node.data),
    );

    return {
      dataLayerGraph,
      graph: buildCompatibilityGraph(validatedNodes, dataLayerGraph),
    };
  } catch (error) {
    throw error instanceof IngestHarnessError
      ? error
      : new IngestHarnessError({
          message: errorMessage(error),
        });
  }
};

export const buildIngestGraph = (
  validatedNodes: ReadonlyArray<IngestNode>,
): IngestGraph => buildIngestGraphs(validatedNodes).graph;
