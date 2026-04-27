import { Schema } from "effect";

import { stringifyUnknown } from "../../../../src/platform/Json";

/**
 * IRI — a non-empty absolute IRI string. Branded so that call sites that
 * accept an IRI cannot be passed an arbitrary string without validation.
 *
 * IRIs in this package are consumed by the SHACL harness and the per-entity
 * ontology modules introduced in later tasks. The brand carries no runtime
 * information beyond its namespace pattern.
 */
export const IRI = Schema.String.pipe(
  Schema.check(Schema.isMinLength(1)),
  Schema.brand("IRI")
);
export type IRI = Schema.Schema.Type<typeof IRI>;
export const asIri = Schema.decodeUnknownSync(IRI);

/**
 * RdfError — tagged error for failures inside the N3-backed RDF store
 * service layer. Covers parse failures, serialization failures, and any
 * store-side operation that fails at runtime.
 *
 * Non-conforming SHACL reports are NOT errors — they are successful values
 * on the ShaclService.validate result channel. ShaclValidationError covers
 * actual engine failures (see Domain/Shacl.ts).
 */
export class RdfError extends Schema.TaggedErrorClass<RdfError>()("RdfError", {
  operation: Schema.String,
  message: Schema.String,
  cause: Schema.optionalKey(Schema.String)
}) {}

export const mapRdfError = (operation: string) => (cause: unknown) => {
  const detail = stringifyUnknown(cause);
  return new RdfError({
    operation,
    message: detail,
    cause: detail
  });
};
