import { Graph, Option, Result } from "effect";
import type {
  DataLayerGraphEdge,
  DataLayerGraphEdgeKind,
  DataLayerGraphNode,
  DataLayerGraphNodeKey,
} from "../domain/data-layer/graph";
import { makeDataLayerGraphNodeKey } from "../domain/data-layer/graph";
import type {
  DataLayerGraphCardinalityIssue,
  DataLayerGraphDuplicateNodeIssue,
  DataLayerGraphInvariantIssue,
  DataLayerGraphUnexpectedTargetIssue,
  DataLayerRegistryIssue,
  MissingReferenceIssue,
} from "../domain/data-layer/registry";

export type DataLayerGraphDirection = "outgoing" | "incoming";

export type DataLayerGraphNeighbor = {
  readonly node: DataLayerGraphNode;
  readonly edge: DataLayerGraphEdge;
};

export type DataLayerGraphEdgeRecord = {
  readonly source: DataLayerGraphNode;
  readonly target: DataLayerGraphNode;
  readonly edge: DataLayerGraphEdge;
};

type BuildOptions = {
  readonly pathById?: ReadonlyMap<string, string>;
};

type BuildContext = {
  readonly entityById: ReadonlyMap<string, DataLayerGraphNode>;
  readonly pathById: ReadonlyMap<string, string>;
  readonly issues: Array<DataLayerRegistryIssue>;
};

type EdgeCountKey = `${string}\u0000${DataLayerGraphEdgeKind}`;

const defaultPathFor = (entity: Pick<DataLayerGraphNode, "_tag" | "id">) =>
  `${entity._tag}:${entity.id}`;

const edgePairKey = (source: Graph.NodeIndex, target: Graph.NodeIndex) =>
  `${String(source)}\u0000${String(target)}`;

const edgeCountKey = (sourceId: string, kind: DataLayerGraphEdgeKind) =>
  `${sourceId}\u0000${kind}` as const;

const getNodeOrUndefined = (
  graph: Graph.DirectedGraph<DataLayerGraphNode, DataLayerGraphEdge>,
  nodeIndex: Graph.NodeIndex,
): DataLayerGraphNode | undefined =>
  Option.getOrUndefined(Graph.getNode(graph, nodeIndex));

const makeMissingReferenceIssue = (
  path: string,
  field: string,
  targetId: string,
  expectedTag: string,
): MissingReferenceIssue => ({
  _tag: "MissingReferenceIssue",
  path,
  field,
  targetId,
  expectedTag,
});

const makeUnexpectedTargetIssue = (
  path: string,
  field: string,
  targetId: string,
  expectedTags: ReadonlyArray<string>,
  actualTag: string,
): DataLayerGraphUnexpectedTargetIssue => ({
  _tag: "DataLayerGraphUnexpectedTargetIssue",
  path,
  field,
  targetId,
  expectedTags: [...expectedTags],
  actualTag,
});

const makeDuplicateNodeIssue = (
  path: string,
  nodeKey: string,
  entityId: string,
  reason: DataLayerGraphDuplicateNodeIssue["reason"],
): DataLayerGraphDuplicateNodeIssue => ({
  _tag: "DataLayerGraphDuplicateNodeIssue",
  path,
  nodeKey,
  entityId,
  reason,
});

const makeInvariantIssue = (
  path: string,
  message: string,
): DataLayerGraphInvariantIssue => ({
  _tag: "DataLayerGraphInvariantIssue",
  path,
  message,
});

const makeCardinalityIssue = (
  path: string,
  edgeKind: DataLayerGraphEdgeKind,
  expectedCount: number,
  actualCount: number,
): DataLayerGraphCardinalityIssue => ({
  _tag: "DataLayerGraphCardinalityIssue",
  path,
  edgeKind,
  expectedCount,
  actualCount,
});

const pathFor = (
  pathById: ReadonlyMap<string, string>,
  entity: Pick<DataLayerGraphNode, "_tag" | "id">,
) => pathById.get(entity.id) ?? defaultPathFor(entity);

const getTargetEntity = <A extends DataLayerGraphNode["_tag"]>(
  context: BuildContext,
  source: DataLayerGraphNode,
  field: string,
  targetId: string | undefined,
  expectedTags: ReadonlyArray<A>,
): Extract<DataLayerGraphNode, { _tag: A }> | undefined => {
  if (targetId === undefined) {
    return undefined;
  }

  const target = context.entityById.get(targetId);
  if (target === undefined) {
    context.issues.push(
      makeMissingReferenceIssue(
        pathFor(context.pathById, source),
        field,
        targetId,
        expectedTags.join(" | "),
      ),
    );
    return undefined;
  }

  if (!expectedTags.includes(target._tag as A)) {
    context.issues.push(
      makeUnexpectedTargetIssue(
        pathFor(context.pathById, source),
        field,
        targetId,
        expectedTags,
        target._tag,
      ),
    );
    return undefined;
  }

  return target as Extract<DataLayerGraphNode, { _tag: A }>;
};

const getRequiredTargetEntity = <A extends DataLayerGraphNode["_tag"]>(
  context: BuildContext,
  source: DataLayerGraphNode,
  field: string,
  targetId: string,
  expectedTags: ReadonlyArray<A>,
): Extract<DataLayerGraphNode, { _tag: A }> | undefined =>
  getTargetEntity(context, source, field, targetId, expectedTags);

const addOutgoingEdgeCount = (
  edgeCountsBySourceAndKind: Map<EdgeCountKey, number>,
  sourceId: string,
  kind: DataLayerGraphEdgeKind,
) => {
  const key = edgeCountKey(sourceId, kind);
  edgeCountsBySourceAndKind.set(key, (edgeCountsBySourceAndKind.get(key) ?? 0) + 1);
};

const getOutgoingEdgeCount = (
  edgeCountsBySourceAndKind: ReadonlyMap<EdgeCountKey, number>,
  sourceId: string,
  kind: DataLayerGraphEdgeKind,
) => edgeCountsBySourceAndKind.get(edgeCountKey(sourceId, kind)) ?? 0;

const addEdge = (
  mutable: Graph.MutableDirectedGraph<DataLayerGraphNode, DataLayerGraphEdge>,
  context: BuildContext,
  nodeIndexByEntityId: ReadonlyMap<string, Graph.NodeIndex>,
  edgeDataByPairKey: Map<string, Array<DataLayerGraphEdge>>,
  edgeCountsBySourceAndKind: Map<EdgeCountKey, number>,
  source: DataLayerGraphNode,
  target: DataLayerGraphNode,
  edge: DataLayerGraphEdge,
) => {
  const sourceNodeIndex = nodeIndexByEntityId.get(source.id);
  const targetNodeIndex = nodeIndexByEntityId.get(target.id);
  if (sourceNodeIndex === undefined || targetNodeIndex === undefined) {
    context.issues.push(
      makeInvariantIssue(
        pathFor(context.pathById, source),
        `missing graph node index while adding ${edge.kind} from ${source.id} to ${target.id}`,
      ),
    );
    return;
  }

  Graph.addEdge(mutable, sourceNodeIndex, targetNodeIndex, edge);
  const key = edgePairKey(sourceNodeIndex, targetNodeIndex);
  const existing = edgeDataByPairKey.get(key) ?? [];
  existing.push(edge);
  edgeDataByPairKey.set(key, existing);
  addOutgoingEdgeCount(edgeCountsBySourceAndKind, source.id, edge.kind);
};

export class DataLayerGraph {
  private readonly rawGraph: Graph.DirectedGraph<
    DataLayerGraphNode,
    DataLayerGraphEdge
  >;
  private readonly nodeIndexByEntityId: ReadonlyMap<string, Graph.NodeIndex>;
  private readonly edgeDataByPairKey: ReadonlyMap<
    string,
    ReadonlyArray<DataLayerGraphEdge>
  >;
  private readonly filteredGraphsByKinds = new Map<
    string,
    Graph.DirectedGraph<DataLayerGraphNode, DataLayerGraphEdge>
  >();

  constructor(args: {
    readonly rawGraph: Graph.DirectedGraph<DataLayerGraphNode, DataLayerGraphEdge>;
    readonly nodeIndexByEntityId: ReadonlyMap<string, Graph.NodeIndex>;
    readonly edgeDataByPairKey: ReadonlyMap<string, ReadonlyArray<DataLayerGraphEdge>>;
  }) {
    this.rawGraph = args.rawGraph;
    this.nodeIndexByEntityId = args.nodeIndexByEntityId;
    this.edgeDataByPairKey = args.edgeDataByPairKey;
  }

  nodeCount(): number {
    return Graph.nodeCount(this.rawGraph);
  }

  hasNode(entityId: string): boolean {
    return this.nodeIndexByEntityId.has(entityId);
  }

  findNode(entityId: string): DataLayerGraphNode | undefined {
    const nodeIndex = this.resolveNodeIndex(entityId);
    return nodeIndex === undefined
      ? undefined
      : getNodeOrUndefined(this.rawGraph, nodeIndex);
  }

  topoNodes(): ReadonlyArray<DataLayerGraphNode> {
    return Array.from(Graph.values(Graph.topo(this.rawGraph)));
  }

  edgeRecords(): ReadonlyArray<DataLayerGraphEdgeRecord> {
    const records: Array<DataLayerGraphEdgeRecord> = [];

    for (const edge of Graph.values(Graph.edges(this.rawGraph))) {
      const source = getNodeOrUndefined(this.rawGraph, edge.source);
      const target = getNodeOrUndefined(this.rawGraph, edge.target);
      if (source === undefined || target === undefined) {
        continue;
      }

      records.push({
        source,
        target,
        edge: edge.data,
      });
    }

    return records;
  }

  collectNeighborsByKinds(
    entityId: string,
    direction: DataLayerGraphDirection,
    kinds: ReadonlyArray<DataLayerGraphEdgeKind>,
  ): ReadonlyArray<DataLayerGraphNeighbor> {
    const nodeIndex = this.resolveNodeIndex(entityId);
    if (nodeIndex === undefined) {
      return [];
    }

    const allowedKinds = new Set(kinds);
    const seenNodeIds = new Set<string>();
    const neighbors: Array<DataLayerGraphNeighbor> = [];

    for (const neighborNodeIndex of Graph.neighborsDirected(
      this.rawGraph,
      nodeIndex,
      direction,
    )) {
      const edge = this.findEdgeBetween(
        direction === "incoming" ? neighborNodeIndex : nodeIndex,
        direction === "incoming" ? nodeIndex : neighborNodeIndex,
        allowedKinds,
      );
      if (edge === undefined) {
        continue;
      }

      const node = getNodeOrUndefined(this.rawGraph, neighborNodeIndex);
      if (node === undefined || seenNodeIds.has(node.id)) {
        continue;
      }

      seenNodeIds.add(node.id);
      neighbors.push({ node, edge });
    }

    return neighbors;
  }

  reachableByKinds(
    entityId: string,
    direction: DataLayerGraphDirection,
    kinds: ReadonlyArray<DataLayerGraphEdgeKind>,
  ): ReadonlyArray<DataLayerGraphNeighbor> {
    const start = this.resolveNodeIndex(entityId);
    if (start === undefined) {
      return [];
    }

    const filteredGraph = this.filteredGraphForKinds(kinds);
    const visited = new Set<Graph.NodeIndex>();
    const reachable: Array<DataLayerGraphNeighbor> = [];
    const reverseDirection = direction === "outgoing" ? "incoming" : "outgoing";

    for (const nodeIndex of Graph.indices(
      Graph.bfs(filteredGraph, { start: [start], direction }),
    )) {
      if (nodeIndex === start) {
        visited.add(nodeIndex);
        continue;
      }

      const predecessor = Graph.neighborsDirected(
        filteredGraph,
        nodeIndex,
        reverseDirection,
      ).find((candidate) => visited.has(candidate));
      if (predecessor === undefined) {
        visited.add(nodeIndex);
        continue;
      }

      const edge = this.findEdgeBetween(predecessor, nodeIndex, new Set(kinds));
      const node = getNodeOrUndefined(this.rawGraph, nodeIndex);
      if (edge !== undefined && node !== undefined) {
        reachable.push({ node, edge });
      }

      visited.add(nodeIndex);
    }

    return reachable;
  }

  private resolveNodeIndex(entityId: string): Graph.NodeIndex | undefined {
    return this.nodeIndexByEntityId.get(entityId);
  }

  private findEdgeBetween(
    sourceNodeIndex: Graph.NodeIndex,
    targetNodeIndex: Graph.NodeIndex,
    allowedKinds: ReadonlySet<DataLayerGraphEdgeKind>,
  ): DataLayerGraphEdge | undefined {
    return this.edgeDataByPairKey
      .get(edgePairKey(sourceNodeIndex, targetNodeIndex))
      ?.find((edge) => allowedKinds.has(edge.kind));
  }

  private filteredGraphForKinds(
    kinds: ReadonlyArray<DataLayerGraphEdgeKind>,
  ): Graph.DirectedGraph<DataLayerGraphNode, DataLayerGraphEdge> {
    const cacheKey = [...new Set(kinds)].sort().join("\u0000");
    const cached = this.filteredGraphsByKinds.get(cacheKey);
    if (cached !== undefined) {
      return cached;
    }

    const allowedKinds = new Set(kinds);
    const mutable = Graph.beginMutation(this.rawGraph);
    Graph.filterEdges(mutable, (edge) => allowedKinds.has(edge.kind));
    const filtered = Graph.endMutation(mutable);
    this.filteredGraphsByKinds.set(cacheKey, filtered);
    return filtered;
  }
}

export const buildDataLayerGraph = (
  entities: ReadonlyArray<DataLayerGraphNode>,
  options: BuildOptions = {},
): Result.Result<DataLayerGraph, ReadonlyArray<DataLayerRegistryIssue>> => {
  const pathById = new Map<string, string>(
    entities.map((entity) => [entity.id, pathFor(options.pathById ?? new Map(), entity)]),
  );
  const entityById = new Map<string, DataLayerGraphNode>();
  const issues: Array<DataLayerRegistryIssue> = [];

  for (const entity of entities) {
    entityById.set(entity.id, entity);
  }

  const context: BuildContext = {
    entityById,
    pathById,
    issues,
  };

  const nodeIndexByKey = new Map<DataLayerGraphNodeKey, Graph.NodeIndex>();
  const nodeIndexByEntityId = new Map<string, Graph.NodeIndex>();
  const edgeDataByPairKey = new Map<string, Array<DataLayerGraphEdge>>();
  const edgeCountsBySourceAndKind = new Map<EdgeCountKey, number>();
  const mutable = Graph.beginMutation(
    Graph.directed<DataLayerGraphNode, DataLayerGraphEdge>(),
  );

  for (const entity of entities) {
    const key = makeDataLayerGraphNodeKey(entity);
    const duplicateReason = nodeIndexByKey.has(key)
      ? "duplicate-node-key"
      : nodeIndexByEntityId.has(entity.id)
        ? "duplicate-entity-id"
        : null;

    if (duplicateReason !== null) {
      issues.push(
        makeDuplicateNodeIssue(
          pathFor(pathById, entity),
          key,
          entity.id,
          duplicateReason,
        ),
      );
      continue;
    }

    const nodeIndex = Graph.addNode(mutable, entity);
    nodeIndexByKey.set(key, nodeIndex);
    nodeIndexByEntityId.set(entity.id, nodeIndex);
  }

  for (const entity of entities) {
    switch (entity._tag) {
      case "Agent": {
        const parentAgent = getTargetEntity(
          context,
          entity,
          "parentAgentId",
          entity.parentAgentId,
          ["Agent"],
        );
        if (parentAgent !== undefined) {
          addEdge(
            mutable,
            context,
            nodeIndexByEntityId,
            edgeDataByPairKey,
            edgeCountsBySourceAndKind,
            parentAgent,
            entity,
            {
              kind: "parent-agent",
              origin: "declared",
            },
          );
        }
        break;
      }
      case "Catalog": {
        const publisher = getTargetEntity(
          context,
          entity,
          "publisherAgentId",
          entity.publisherAgentId,
          ["Agent"],
        );
        if (publisher !== undefined) {
          addEdge(
            mutable,
            context,
            nodeIndexByEntityId,
            edgeDataByPairKey,
            edgeCountsBySourceAndKind,
            publisher,
            entity,
            {
              kind: "publishes",
              origin: "declared",
            },
          );
        }
        break;
      }
      case "CatalogRecord": {
        const catalog = getRequiredTargetEntity(
          context,
          entity,
          "catalogId",
          entity.catalogId,
          ["Catalog"],
        );
        if (catalog !== undefined) {
          addEdge(
            mutable,
            context,
            nodeIndexByEntityId,
            edgeDataByPairKey,
            edgeCountsBySourceAndKind,
            catalog,
            entity,
            {
              kind: "contains-record",
              origin: "declared",
            },
          );
        }

        const primaryTopic = getRequiredTargetEntity(
          context,
          entity,
          "primaryTopicId",
          entity.primaryTopicId,
          entity.primaryTopicType === "dataset"
            ? ["Dataset"]
            : ["DataService"],
        );
        if (primaryTopic !== undefined) {
          addEdge(
            mutable,
            context,
            nodeIndexByEntityId,
            edgeDataByPairKey,
            edgeCountsBySourceAndKind,
            primaryTopic,
            entity,
            {
              kind: "primary-topic-of",
              origin: "declared",
            },
          );
        }
        break;
      }
      case "Dataset": {
        const publisher = getTargetEntity(
          context,
          entity,
          "publisherAgentId",
          entity.publisherAgentId,
          ["Agent"],
        );
        if (publisher !== undefined) {
          addEdge(
            mutable,
            context,
            nodeIndexByEntityId,
            edgeDataByPairKey,
            edgeCountsBySourceAndKind,
            publisher,
            entity,
            {
              kind: "publishes",
              origin: "declared",
            },
          );
        }

        const datasetSeries = getTargetEntity(
          context,
          entity,
          "inSeries",
          entity.inSeries,
          ["DatasetSeries"],
        );
        if (datasetSeries !== undefined) {
          addEdge(
            mutable,
            context,
            nodeIndexByEntityId,
            edgeDataByPairKey,
            edgeCountsBySourceAndKind,
            datasetSeries,
            entity,
            {
              kind: "has-series-member",
              origin: "declared",
            },
          );
        }

        for (const variableId of entity.variableIds ?? []) {
          const variable = getRequiredTargetEntity(
            context,
            entity,
            "variableIds",
            variableId,
            ["Variable"],
          );
          if (variable === undefined) {
            continue;
          }

          addEdge(
            mutable,
            context,
            nodeIndexByEntityId,
            edgeDataByPairKey,
            edgeCountsBySourceAndKind,
            entity,
            variable,
            {
              kind: "has-variable",
              origin: "declared",
            },
          );
        }

        for (const dataServiceId of entity.dataServiceIds ?? []) {
          const dataService = getRequiredTargetEntity(
            context,
            entity,
            "dataServiceIds",
            dataServiceId,
            ["DataService"],
          );
          if (dataService === undefined) {
            continue;
          }

          addEdge(
            mutable,
            context,
            nodeIndexByEntityId,
            edgeDataByPairKey,
            edgeCountsBySourceAndKind,
            entity,
            dataService,
            {
              kind: "served-by",
              origin: "declared",
            },
          );
        }
        break;
      }
      case "Distribution": {
        const dataset = getRequiredTargetEntity(
          context,
          entity,
          "datasetId",
          entity.datasetId,
          ["Dataset"],
        );
        if (dataset !== undefined) {
          addEdge(
            mutable,
            context,
            nodeIndexByEntityId,
            edgeDataByPairKey,
            edgeCountsBySourceAndKind,
            dataset,
            entity,
            {
              kind: "has-distribution",
              origin: "declared",
            },
          );
        }
        break;
      }
      case "DataService": {
        const publisher = getTargetEntity(
          context,
          entity,
          "publisherAgentId",
          entity.publisherAgentId,
          ["Agent"],
        );
        if (publisher !== undefined) {
          addEdge(
            mutable,
            context,
            nodeIndexByEntityId,
            edgeDataByPairKey,
            edgeCountsBySourceAndKind,
            publisher,
            entity,
            {
              kind: "publishes",
              origin: "declared",
            },
          );
        }

        for (const datasetId of entity.servesDatasetIds) {
          const dataset = getRequiredTargetEntity(
            context,
            entity,
            "servesDatasetIds",
            datasetId,
            ["Dataset"],
          );
          if (dataset === undefined || (dataset.dataServiceIds ?? []).includes(entity.id)) {
            continue;
          }

          addEdge(
            mutable,
            context,
            nodeIndexByEntityId,
            edgeDataByPairKey,
            edgeCountsBySourceAndKind,
            dataset,
            entity,
            {
              kind: "served-by",
              origin: "declared",
            },
          );
        }
        break;
      }
      case "DatasetSeries": {
        const publisher = getTargetEntity(
          context,
          entity,
          "publisherAgentId",
          entity.publisherAgentId,
          ["Agent"],
        );
        if (publisher !== undefined) {
          addEdge(
            mutable,
            context,
            nodeIndexByEntityId,
            edgeDataByPairKey,
            edgeCountsBySourceAndKind,
            publisher,
            entity,
            {
              kind: "publishes",
              origin: "declared",
            },
          );
        }
        break;
      }
      case "Variable":
        break;
      case "Series": {
        const variable = getRequiredTargetEntity(
          context,
          entity,
          "variableId",
          entity.variableId,
          ["Variable"],
        );
        if (variable !== undefined) {
          addEdge(
            mutable,
            context,
            nodeIndexByEntityId,
            edgeDataByPairKey,
            edgeCountsBySourceAndKind,
            entity,
            variable,
            {
              kind: "implements-variable",
              origin: "declared",
            },
          );
        }

        const dataset = getTargetEntity(
          context,
          entity,
          "datasetId",
          entity.datasetId,
          ["Dataset"],
        );
        if (dataset !== undefined) {
          addEdge(
            mutable,
            context,
            nodeIndexByEntityId,
            edgeDataByPairKey,
            edgeCountsBySourceAndKind,
            entity,
            dataset,
            {
              kind: "published-in-dataset",
              origin: "declared",
            },
          );

          if (variable !== undefined && !(dataset.variableIds ?? []).includes(entity.variableId)) {
            addEdge(
              mutable,
              context,
              nodeIndexByEntityId,
              edgeDataByPairKey,
              edgeCountsBySourceAndKind,
              dataset,
              variable,
              {
                kind: "has-variable",
                origin: "derived-from-series",
              },
            );
          }
        }
        break;
      }
    }
  }

  for (const entity of entities) {
    if (entity._tag !== "Series") {
      continue;
    }

    const implementsVariableCount = getOutgoingEdgeCount(
      edgeCountsBySourceAndKind,
      entity.id,
      "implements-variable",
    );
    if (implementsVariableCount !== 1) {
      issues.push(
        makeCardinalityIssue(
          pathFor(pathById, entity),
          "implements-variable",
          1,
          implementsVariableCount,
        ),
      );
    }

    const publishedInDatasetCount = getOutgoingEdgeCount(
      edgeCountsBySourceAndKind,
      entity.id,
      "published-in-dataset",
    );
    if (publishedInDatasetCount !== 1) {
      issues.push(
        makeCardinalityIssue(
          pathFor(pathById, entity),
          "published-in-dataset",
          1,
          publishedInDatasetCount,
        ),
      );
    }
  }

  if (issues.length > 0) {
    return Result.fail(issues);
  }

  return Result.succeed(
    new DataLayerGraph({
      rawGraph: Graph.endMutation(mutable),
      nodeIndexByEntityId,
      edgeDataByPairKey,
    }),
  );
};

export const hasDataLayerGraphNode = (
  graph: DataLayerGraph,
  entityId: string,
): boolean => graph.hasNode(entityId);
