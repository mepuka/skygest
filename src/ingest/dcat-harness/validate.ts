import { Effect, Schema } from "effect";
import {
  Agent,
  Catalog,
  CatalogRecord,
  DataService,
  Dataset,
  Distribution
} from "../../domain/data-layer";
import type { IngestNode } from "./IngestNode";

const decodeNode = (
  node: IngestNode
): Effect.Effect<IngestNode, Schema.SchemaError> => {
  switch (node._tag) {
    case "agent":
      return Schema.decodeUnknownEffect(Agent)(node.data).pipe(
        Effect.map((data) => ({ ...node, data }))
      );
    case "catalog":
      return Schema.decodeUnknownEffect(Catalog)(node.data).pipe(
        Effect.map((data) => ({ ...node, data }))
      );
    case "data-service":
      return Schema.decodeUnknownEffect(DataService)(node.data).pipe(
        Effect.map((data) => ({ ...node, data }))
      );
    case "dataset":
      return Schema.decodeUnknownEffect(Dataset)(node.data).pipe(
        Effect.map((data) => ({ ...node, data }))
      );
    case "distribution":
      return Schema.decodeUnknownEffect(Distribution)(node.data).pipe(
        Effect.map((data) => ({ ...node, data }))
      );
    case "catalog-record":
      return Schema.decodeUnknownEffect(CatalogRecord)(node.data).pipe(
        Effect.map((data) => ({ ...node, data }))
      );
  }
};

export const validateNodeWith = <E>(
  node: IngestNode,
  mapError: (node: IngestNode, error: Schema.SchemaError) => E
): Effect.Effect<IngestNode, E> => decodeNode(node).pipe(
  Effect.mapError((error) => mapError(node, error))
);

export const validateCandidatesWith = <E, R>(
  candidates: ReadonlyArray<IngestNode>,
  validateNode: (candidate: IngestNode) => Effect.Effect<IngestNode, E, R>
): Effect.Effect<
  {
    readonly failures: ReadonlyArray<E>;
    readonly successes: ReadonlyArray<IngestNode>;
  },
  never,
  R
> =>
  Effect.partition(candidates, (candidate) => validateNode(candidate), {
    concurrency: "unbounded"
  }).pipe(
    Effect.map(([failures, successes]) => ({ failures, successes }))
  );
