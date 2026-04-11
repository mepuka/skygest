import { Graph } from "effect";
import type { IngestEdge } from "./IngestEdge";
import type { IngestNode } from "./IngestNode";

export type IngestGraph = Graph.DirectedGraph<IngestNode, IngestEdge>;
