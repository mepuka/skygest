import { Effect, Schema } from "effect";
import { DataLayerRegistryEntity } from "../../../src/domain/data-layer";

import { RdfError } from "./Domain/Rdf";
import { emitEntityQuads } from "./mapping/forward";
import { type RdfStore, RdfStoreService } from "./Service/RdfStore";

const decodeEntity = Schema.decodeUnknownSync(DataLayerRegistryEntity);

const mapEmitError = (cause: unknown) =>
  new RdfError({
    operation: "emit",
    message: String(cause),
    cause: String(cause)
  });

export const emit = Effect.fn("emit")(function* (
  entity: unknown,
  store: RdfStore
) {
  const rdf = yield* RdfStoreService;
  const decoded = yield* Effect.try({
    try: () => decodeEntity(entity),
    catch: mapEmitError
  });
  const quads = yield* emitEntityQuads(decoded);
  yield* rdf.addQuads(store, quads);
});
