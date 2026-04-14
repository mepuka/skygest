import type { DataLayerRegistryEntity } from "./registry";

export type DataLayerGraphNode = DataLayerRegistryEntity;
export type DataLayerGraphNodeKind = DataLayerGraphNode["_tag"];
export type DataLayerGraphNodeKey = `${DataLayerGraphNodeKind}::${string}`;

export type DataLayerGraphEdge =
  | {
      readonly kind: "publishes";
      readonly origin: "declared";
    }
  | {
      readonly kind: "parent-agent";
      readonly origin: "declared";
    }
  | {
      readonly kind: "contains-record";
      readonly origin: "declared";
    }
  | {
      readonly kind: "primary-topic-of";
      readonly origin: "declared";
    }
  | {
      readonly kind: "has-distribution";
      readonly origin: "declared";
    }
  | {
      readonly kind: "served-by";
      readonly origin: "declared";
    }
  | {
      readonly kind: "has-series-member";
      readonly origin: "declared";
    }
  | {
      readonly kind: "has-variable";
      readonly origin: "declared" | "derived-from-series";
    }
  | {
      readonly kind: "in-dataset";
      readonly origin: "declared";
    }
  | {
      readonly kind: "measures";
      readonly origin: "declared";
    }
  | {
      readonly kind: "sources-from";
      readonly origin: "declared" | "projected";
    };

export type DataLayerGraphEdgeKind = DataLayerGraphEdge["kind"];

export const makeDataLayerGraphNodeKey = (
  node: Pick<DataLayerGraphNode, "_tag" | "id">,
): DataLayerGraphNodeKey => `${node._tag}::${node.id}`;
