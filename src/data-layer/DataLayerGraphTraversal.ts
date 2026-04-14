import type {
  DataLayerGraphEdgeKind,
  DataLayerGraphNode,
} from "../domain/data-layer/graph";
import type {
  DataLayerGraph,
  DataLayerGraphDirection,
  DataLayerGraphNeighbor,
} from "./DataLayerGraph";

export type DataLayerGraphNodeRef = string;

export type { DataLayerGraphNeighbor } from "./DataLayerGraph";

export const findDataLayerGraphNode = (
  graph: DataLayerGraph,
  entityId: string,
): DataLayerGraphNode | undefined => graph.findNode(entityId);

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

const collectNeighborsByKinds = (
  graph: DataLayerGraph,
  ref: DataLayerGraphNodeRef,
  direction: DataLayerGraphDirection,
  kinds: ReadonlyArray<DataLayerGraphEdgeKind>,
): ReadonlyArray<DataLayerGraphNeighbor> =>
  graph.collectNeighborsByKinds(ref, direction, kinds);

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
  direction: DataLayerGraphDirection,
  kinds: ReadonlyArray<DataLayerGraphEdgeKind>,
): ReadonlyArray<DataLayerGraphNeighbor> =>
  graph.reachableByKinds(ref, direction, kinds);
