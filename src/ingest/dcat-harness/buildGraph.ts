import { Graph, Result } from "effect";
import {
  buildDataLayerGraph,
  type DataLayerGraph,
} from "../../data-layer/DataLayerGraph";
import type { DataLayerGraphEdge } from "../../domain/data-layer/graph";
import { IngestGraphBuildError, IngestHarnessError } from "./errors";
import type { IngestEdge } from "./IngestEdge";
import type { IngestGraph } from "./IngestGraph";
import type { IngestNode } from "./IngestNode";

export type BuiltIngestGraphs = {
  readonly graph: IngestGraph;
  readonly dataLayerGraph: DataLayerGraph;
};

// Ingest nodes wrap the shared entity as `{ _tag, slug, data }`, so the
// harness keeps its own key helper instead of reusing makeDataLayerGraphNodeKey.
const nodeKey = (node: IngestNode): string => `${node._tag}::${node.data.id}`;

const missingNodeIndexError = (node: IngestNode) =>
  new IngestHarnessError({
    message: `Missing node index for ${nodeKey(node)} while building graph`,
  });

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
      // The shared graph intentionally carries richer runtime-only edges such
      // as series / variable lineage that the compatibility graph must omit.
      return undefined;
  }
};

const buildCompatibilityGraph = (
  validatedNodes: ReadonlyArray<IngestNode>,
  dataLayerGraph: DataLayerGraph,
): Result.Result<IngestGraph, IngestHarnessError> => {
  const indexById = new Map<string, number>();
  const nodeByEntityId = new Map<string, IngestNode>(
    validatedNodes.map((node) => [node.data.id, node]),
  );
  const mutable = Graph.beginMutation(Graph.directed<IngestNode, IngestEdge>());

  for (const node of validatedNodes) {
    indexById.set(nodeKey(node), Graph.addNode(mutable, node));
  }

  for (const { source: sourceNode, target: targetNode, edge } of dataLayerGraph.edgeRecords()) {
    const source = nodeByEntityId.get(sourceNode.id);
    const target = nodeByEntityId.get(targetNode.id);
    if (source === undefined || target === undefined) {
      continue;
    }

    const compatibleEdge = compatibleIngestEdge(source, target, edge);
    if (compatibleEdge === undefined) {
      continue;
    }

    const sourceNodeIndex = indexById.get(nodeKey(source));
    if (sourceNodeIndex === undefined) {
      return Result.fail(missingNodeIndexError(source));
    }

    const targetNodeIndex = indexById.get(nodeKey(target));
    if (targetNodeIndex === undefined) {
      return Result.fail(missingNodeIndexError(target));
    }

    Graph.addEdge(mutable, sourceNodeIndex, targetNodeIndex, compatibleEdge);
  }

  return Result.succeed(Graph.endMutation(mutable));
};

export const buildIngestGraphs = (
  validatedNodes: ReadonlyArray<IngestNode>,
): Result.Result<
  BuiltIngestGraphs,
  IngestGraphBuildError | IngestHarnessError
> => {
  const seenNodeKeys = new Set<string>();

  for (const node of validatedNodes) {
    const key = nodeKey(node);
    if (seenNodeKeys.has(key)) {
      return Result.fail(
        new IngestHarnessError({
          message: `Duplicate ingest graph node key ${key}`,
        }),
      );
    }
    seenNodeKeys.add(key);
  }

  const dataLayerGraph = buildDataLayerGraph(
    validatedNodes.map((node) => node.data),
  );
  if (Result.isFailure(dataLayerGraph)) {
    return Result.fail(
      new IngestGraphBuildError({
        message:
          "Shared data-layer graph validation failed while building the ingest graph",
        issues: dataLayerGraph.failure,
      }),
    );
  }

  const compatibilityGraph = buildCompatibilityGraph(
    validatedNodes,
    dataLayerGraph.success,
  );
  if (Result.isFailure(compatibilityGraph)) {
    return Result.fail(compatibilityGraph.failure);
  }

  return Result.succeed({
    dataLayerGraph: dataLayerGraph.success,
    graph: compatibilityGraph.success,
  });
};

export const buildIngestGraph = (
  validatedNodes: ReadonlyArray<IngestNode>,
): Result.Result<IngestGraph, IngestGraphBuildError | IngestHarnessError> => {
  const built = buildIngestGraphs(validatedNodes);
  return Result.isFailure(built)
    ? Result.fail(built.failure)
    : Result.succeed(built.success.graph);
};
