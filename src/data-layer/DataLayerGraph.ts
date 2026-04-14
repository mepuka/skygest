import { Graph } from "effect";
import type {
  DataLayerGraphEdge,
  DataLayerGraphNode,
  DataLayerGraphNodeKey,
} from "../domain/data-layer/graph";
import { makeDataLayerGraphNodeKey } from "../domain/data-layer/graph";

export type DataLayerGraph = {
  readonly raw: Graph.DirectedGraph<DataLayerGraphNode, DataLayerGraphEdge>;
  readonly nodeIndexByKey: ReadonlyMap<DataLayerGraphNodeKey, Graph.NodeIndex>;
  readonly nodeIndexByEntityId: ReadonlyMap<string, Graph.NodeIndex>;
  readonly keyByNodeIndex: ReadonlyMap<Graph.NodeIndex, DataLayerGraphNodeKey>;
};

const missingEntityError = (
  source: DataLayerGraphNode,
  field: string,
  targetId: string,
) =>
  new Error(
    `Missing graph target for ${source._tag} ${source.id} via ${field}: ${targetId}`,
  );

const unexpectedEntityKindError = (
  source: DataLayerGraphNode,
  field: string,
  targetId: string,
  expected: ReadonlyArray<DataLayerGraphNode["_tag"]>,
  actual: DataLayerGraphNode["_tag"],
) =>
  new Error(
    `Unexpected graph target for ${source._tag} ${source.id} via ${field}: ${targetId} is ${actual}, expected ${expected.join(" | ")}`,
  );

const getTargetEntity = <A extends DataLayerGraphNode["_tag"]>(
  entityById: ReadonlyMap<string, DataLayerGraphNode>,
  source: DataLayerGraphNode,
  field: string,
  targetId: string | undefined,
  expectedTags: ReadonlyArray<A>,
): Extract<DataLayerGraphNode, { _tag: A }> | undefined => {
  if (targetId === undefined) {
    return undefined;
  }

  const target = entityById.get(targetId);
  if (target === undefined) {
    throw missingEntityError(source, field, targetId);
  }

  if (!expectedTags.includes(target._tag as A)) {
    throw unexpectedEntityKindError(
      source,
      field,
      targetId,
      expectedTags,
      target._tag,
    );
  }

  return target as Extract<DataLayerGraphNode, { _tag: A }>;
};

const getRequiredTargetEntity = <A extends DataLayerGraphNode["_tag"]>(
  entityById: ReadonlyMap<string, DataLayerGraphNode>,
  source: DataLayerGraphNode,
  field: string,
  targetId: string,
  expectedTags: ReadonlyArray<A>,
): Extract<DataLayerGraphNode, { _tag: A }> => {
  const target = getTargetEntity(
    entityById,
    source,
    field,
    targetId,
    expectedTags,
  );
  if (target === undefined) {
    throw missingEntityError(source, field, targetId);
  }

  return target;
};

const addEdge = (
  mutable: Graph.MutableDirectedGraph<DataLayerGraphNode, DataLayerGraphEdge>,
  nodeIndexByEntityId: ReadonlyMap<string, Graph.NodeIndex>,
  sourceId: string,
  targetId: string,
  edge: DataLayerGraphEdge,
) => {
  const sourceNodeIndex = nodeIndexByEntityId.get(sourceId);
  const targetNodeIndex = nodeIndexByEntityId.get(targetId);
  if (sourceNodeIndex === undefined || targetNodeIndex === undefined) {
    throw new Error(`Missing graph node index while adding ${edge.kind}`);
  }

  Graph.addEdge(mutable, sourceNodeIndex, targetNodeIndex, edge);
};

export const buildDataLayerGraph = (
  entities: ReadonlyArray<DataLayerGraphNode>,
): DataLayerGraph => {
  const entityById = new Map<string, DataLayerGraphNode>();
  const nodeIndexByKey = new Map<DataLayerGraphNodeKey, Graph.NodeIndex>();
  const nodeIndexByEntityId = new Map<string, Graph.NodeIndex>();
  const keyByNodeIndex = new Map<Graph.NodeIndex, DataLayerGraphNodeKey>();

  for (const entity of entities) {
    entityById.set(entity.id, entity);
  }

  const raw = Graph.directed<DataLayerGraphNode, DataLayerGraphEdge>(
    (mutable) => {
      for (const entity of entities) {
        const key = makeDataLayerGraphNodeKey(entity);
        if (nodeIndexByKey.has(key) || nodeIndexByEntityId.has(entity.id)) {
          throw new Error(`Duplicate graph node key ${key}`);
        }

        const nodeIndex = Graph.addNode(mutable, entity);
        nodeIndexByKey.set(key, nodeIndex);
        nodeIndexByEntityId.set(entity.id, nodeIndex);
        keyByNodeIndex.set(nodeIndex, key);
      }

      for (const entity of entities) {
        switch (entity._tag) {
          case "Agent": {
            const parentAgent = getTargetEntity(
              entityById,
              entity,
              "parentAgentId",
              entity.parentAgentId,
              ["Agent"],
            );
            if (parentAgent !== undefined) {
              addEdge(mutable, nodeIndexByEntityId, parentAgent.id, entity.id, {
                kind: "parent-agent",
                origin: "declared",
              });
            }
            break;
          }
          case "Catalog": {
            const publisher = getTargetEntity(
              entityById,
              entity,
              "publisherAgentId",
              entity.publisherAgentId,
              ["Agent"],
            );
            if (publisher !== undefined) {
              addEdge(mutable, nodeIndexByEntityId, publisher.id, entity.id, {
                kind: "publishes",
                origin: "declared",
              });
            }
            break;
          }
          case "CatalogRecord": {
            const catalog = getRequiredTargetEntity(
              entityById,
              entity,
              "catalogId",
              entity.catalogId,
              ["Catalog"],
            );
            addEdge(mutable, nodeIndexByEntityId, catalog.id, entity.id, {
              kind: "contains-record",
              origin: "declared",
            });

            const primaryTopic = getRequiredTargetEntity(
              entityById,
              entity,
              "primaryTopicId",
              entity.primaryTopicId,
              entity.primaryTopicType === "dataset"
                ? ["Dataset"]
                : ["DataService"],
            );
            addEdge(mutable, nodeIndexByEntityId, primaryTopic.id, entity.id, {
              kind: "primary-topic-of",
              origin: "declared",
            });
            break;
          }
          case "Dataset": {
            const publisher = getTargetEntity(
              entityById,
              entity,
              "publisherAgentId",
              entity.publisherAgentId,
              ["Agent"],
            );
            if (publisher !== undefined) {
              addEdge(mutable, nodeIndexByEntityId, publisher.id, entity.id, {
                kind: "publishes",
                origin: "declared",
              });
            }

            const datasetSeries = getTargetEntity(
              entityById,
              entity,
              "inSeries",
              entity.inSeries,
              ["DatasetSeries"],
            );
            if (datasetSeries !== undefined) {
              addEdge(
                mutable,
                nodeIndexByEntityId,
                datasetSeries.id,
                entity.id,
                {
                  kind: "has-series-member",
                  origin: "declared",
                },
              );
            }

            for (const variableId of entity.variableIds ?? []) {
              const variable = getRequiredTargetEntity(
                entityById,
                entity,
                "variableIds",
                variableId,
                ["Variable"],
              );
              addEdge(mutable, nodeIndexByEntityId, entity.id, variable.id, {
                kind: "has-variable",
                origin: "declared",
              });
            }

            for (const dataServiceId of entity.dataServiceIds ?? []) {
              const dataService = getRequiredTargetEntity(
                entityById,
                entity,
                "dataServiceIds",
                dataServiceId,
                ["DataService"],
              );
              addEdge(mutable, nodeIndexByEntityId, entity.id, dataService.id, {
                kind: "served-by",
                origin: "declared",
              });
            }
            break;
          }
          case "Distribution": {
            const dataset = getRequiredTargetEntity(
              entityById,
              entity,
              "datasetId",
              entity.datasetId,
              ["Dataset"],
            );
            addEdge(mutable, nodeIndexByEntityId, dataset.id, entity.id, {
              kind: "has-distribution",
              origin: "declared",
            });
            break;
          }
          case "DataService": {
            const publisher = getTargetEntity(
              entityById,
              entity,
              "publisherAgentId",
              entity.publisherAgentId,
              ["Agent"],
            );
            if (publisher !== undefined) {
              addEdge(mutable, nodeIndexByEntityId, publisher.id, entity.id, {
                kind: "publishes",
                origin: "declared",
              });
            }

            for (const datasetId of entity.servesDatasetIds) {
              const dataset = getRequiredTargetEntity(
                entityById,
                entity,
                "servesDatasetIds",
                datasetId,
                ["Dataset"],
              );
              if ((dataset.dataServiceIds ?? []).includes(entity.id)) {
                continue;
              }

              addEdge(mutable, nodeIndexByEntityId, dataset.id, entity.id, {
                kind: "served-by",
                origin: "declared",
              });
            }
            break;
          }
          case "DatasetSeries": {
            const publisher = getTargetEntity(
              entityById,
              entity,
              "publisherAgentId",
              entity.publisherAgentId,
              ["Agent"],
            );
            if (publisher !== undefined) {
              addEdge(mutable, nodeIndexByEntityId, publisher.id, entity.id, {
                kind: "publishes",
                origin: "declared",
              });
            }
            break;
          }
          case "Variable":
            break;
          case "Series": {
            const variable = getRequiredTargetEntity(
              entityById,
              entity,
              "variableId",
              entity.variableId,
              ["Variable"],
            );
            addEdge(mutable, nodeIndexByEntityId, entity.id, variable.id, {
              kind: "implements-variable",
              origin: "declared",
            });

            const dataset = getTargetEntity(
              entityById,
              entity,
              "datasetId",
              entity.datasetId,
              ["Dataset"],
            );
            if (dataset !== undefined) {
              addEdge(mutable, nodeIndexByEntityId, entity.id, dataset.id, {
                kind: "published-in-dataset",
                origin: "declared",
              });

              if (!(dataset.variableIds ?? []).includes(entity.variableId)) {
                addEdge(mutable, nodeIndexByEntityId, dataset.id, variable.id, {
                  kind: "has-variable",
                  origin: "derived-from-series",
                });
              }
            }
            break;
          }
        }
      }
    },
  );

  return {
    raw,
    nodeIndexByKey,
    nodeIndexByEntityId,
    keyByNodeIndex,
  };
};

export const findDataLayerGraphNodeIndex = (
  graph: DataLayerGraph,
  entityId: string,
): Graph.NodeIndex | undefined => graph.nodeIndexByEntityId.get(entityId);

export const hasDataLayerGraphNode = (
  graph: DataLayerGraph,
  entityId: string,
): boolean => graph.nodeIndexByEntityId.has(entityId);
