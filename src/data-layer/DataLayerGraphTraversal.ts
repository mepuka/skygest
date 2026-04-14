import { Graph } from "effect";
import type {
  DataLayerGraphEdge,
  DataLayerGraphEdgeKind,
  DataLayerGraphNode,
} from "../domain/data-layer/graph";
import type { DataLayerGraph } from "./DataLayerGraph";

export type DataLayerGraphNodeRef = Graph.NodeIndex | string;

export type DataLayerGraphNeighbor = {
  readonly nodeIndex: Graph.NodeIndex;
  readonly node: DataLayerGraphNode;
  readonly edge: DataLayerGraphEdge;
};

const resolveNodeIndex = (
  graph: DataLayerGraph,
  ref: DataLayerGraphNodeRef,
): Graph.NodeIndex | undefined =>
  typeof ref === "string" ? graph.nodeIndexByEntityId.get(ref) : ref;

const collectNeighborsByKinds = (
  graph: DataLayerGraph,
  ref: DataLayerGraphNodeRef,
  direction: "outgoing" | "incoming",
  kinds: ReadonlyArray<DataLayerGraphEdgeKind>,
): ReadonlyArray<DataLayerGraphNeighbor> => {
  const nodeIndex = resolveNodeIndex(graph, ref);
  if (nodeIndex === undefined) {
    return [];
  }

  const allowedKinds = new Set(kinds);
  const adjacency =
    direction === "incoming" ? graph.raw.reverseAdjacency : graph.raw.adjacency;
  const edgeIndexes = adjacency.get(nodeIndex) ?? [];
  const seenNodeIndexes = new Set<Graph.NodeIndex>();
  const neighbors: Array<DataLayerGraphNeighbor> = [];

  for (const edgeIndex of edgeIndexes) {
    const edge = graph.raw.edges.get(edgeIndex);
    if (edge === undefined || !allowedKinds.has(edge.data.kind)) {
      continue;
    }

    const neighborNodeIndex =
      direction === "incoming" ? edge.source : edge.target;
    if (seenNodeIndexes.has(neighborNodeIndex)) {
      continue;
    }

    const node = graph.raw.nodes.get(neighborNodeIndex);
    if (node === undefined) {
      continue;
    }

    seenNodeIndexes.add(neighborNodeIndex);
    neighbors.push({
      nodeIndex: neighborNodeIndex,
      node,
      edge: edge.data,
    });
  }

  return neighbors;
};

export const findDataLayerGraphNode = (
  graph: DataLayerGraph,
  entityId: string,
): DataLayerGraphNode | undefined => {
  const nodeIndex = graph.nodeIndexByEntityId.get(entityId);
  return nodeIndex === undefined ? undefined : graph.raw.nodes.get(nodeIndex);
};

export const findDataLayerGraphNodeByTag = <
  A extends DataLayerGraphNode["_tag"],
>(
  graph: DataLayerGraph,
  entityId: string,
  tag: A,
): Extract<DataLayerGraphNode, { _tag: A }> | undefined => {
  const node = findDataLayerGraphNode(graph, entityId);
  return node?._tag === tag
    ? (node as Extract<DataLayerGraphNode, { _tag: A }>)
    : undefined;
};

export const successorsByKinds = (
  graph: DataLayerGraph,
  ref: DataLayerGraphNodeRef,
  kinds: ReadonlyArray<DataLayerGraphEdgeKind>,
): ReadonlyArray<DataLayerGraphNeighbor> =>
  collectNeighborsByKinds(graph, ref, "outgoing", kinds);

export const predecessorsByKinds = (
  graph: DataLayerGraph,
  ref: DataLayerGraphNodeRef,
  kinds: ReadonlyArray<DataLayerGraphEdgeKind>,
): ReadonlyArray<DataLayerGraphNeighbor> =>
  collectNeighborsByKinds(graph, ref, "incoming", kinds);

export const successorNodesByKinds = (
  graph: DataLayerGraph,
  ref: DataLayerGraphNodeRef,
  kinds: ReadonlyArray<DataLayerGraphEdgeKind>,
): ReadonlyArray<DataLayerGraphNode> =>
  successorsByKinds(graph, ref, kinds).map((neighbor) => neighbor.node);

export const predecessorNodesByKinds = (
  graph: DataLayerGraph,
  ref: DataLayerGraphNodeRef,
  kinds: ReadonlyArray<DataLayerGraphEdgeKind>,
): ReadonlyArray<DataLayerGraphNode> =>
  predecessorsByKinds(graph, ref, kinds).map((neighbor) => neighbor.node);

export const successorNodesByKindsAndTag = <
  A extends DataLayerGraphNode["_tag"],
>(
  graph: DataLayerGraph,
  ref: DataLayerGraphNodeRef,
  kinds: ReadonlyArray<DataLayerGraphEdgeKind>,
  tag: A,
): ReadonlyArray<Extract<DataLayerGraphNode, { _tag: A }>> =>
  successorNodesByKinds(graph, ref, kinds).filter(
    (node): node is Extract<DataLayerGraphNode, { _tag: A }> =>
      node._tag === tag,
  );

export const predecessorNodesByKindsAndTag = <
  A extends DataLayerGraphNode["_tag"],
>(
  graph: DataLayerGraph,
  ref: DataLayerGraphNodeRef,
  kinds: ReadonlyArray<DataLayerGraphEdgeKind>,
  tag: A,
): ReadonlyArray<Extract<DataLayerGraphNode, { _tag: A }>> =>
  predecessorNodesByKinds(graph, ref, kinds).filter(
    (node): node is Extract<DataLayerGraphNode, { _tag: A }> =>
      node._tag === tag,
  );

export const firstSuccessorNodeByKindsAndTag = <
  A extends DataLayerGraphNode["_tag"],
>(
  graph: DataLayerGraph,
  ref: DataLayerGraphNodeRef,
  kinds: ReadonlyArray<DataLayerGraphEdgeKind>,
  tag: A,
): Extract<DataLayerGraphNode, { _tag: A }> | undefined =>
  successorNodesByKindsAndTag(graph, ref, kinds, tag)[0];

export const firstPredecessorNodeByKindsAndTag = <
  A extends DataLayerGraphNode["_tag"],
>(
  graph: DataLayerGraph,
  ref: DataLayerGraphNodeRef,
  kinds: ReadonlyArray<DataLayerGraphEdgeKind>,
  tag: A,
): Extract<DataLayerGraphNode, { _tag: A }> | undefined =>
  predecessorNodesByKindsAndTag(graph, ref, kinds, tag)[0];

export const reachableByKinds = (
  graph: DataLayerGraph,
  ref: DataLayerGraphNodeRef,
  direction: "outgoing" | "incoming",
  kinds: ReadonlyArray<DataLayerGraphEdgeKind>,
): ReadonlyArray<DataLayerGraphNeighbor> => {
  const start = resolveNodeIndex(graph, ref);
  if (start === undefined) {
    return [];
  }

  const discovered = new Set<Graph.NodeIndex>([start]);
  const queue: Array<Graph.NodeIndex> = [start];
  const reachable: Array<DataLayerGraphNeighbor> = [];

  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const neighbor of collectNeighborsByKinds(
      graph,
      current,
      direction,
      kinds,
    )) {
      if (discovered.has(neighbor.nodeIndex)) {
        continue;
      }

      discovered.add(neighbor.nodeIndex);
      queue.push(neighbor.nodeIndex);
      reachable.push(neighbor);
    }
  }

  return reachable;
};
