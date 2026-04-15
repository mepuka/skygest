import { Schema } from "effect";

/**
 * IRI — a non-empty absolute IRI string. Branded so that call sites that
 * accept an IRI cannot be passed an arbitrary string without validation.
 *
 * The EmitSpec forward section produces IRIs by composing the instance
 * namespace prefix with branded entity IDs. The SHACL shapes file and the
 * reverse mapping both consume IRIs in this shape.
 */
export const IRI = Schema.String.pipe(
  Schema.check(Schema.isMinLength(1)),
  Schema.brand("IRI")
);
export type IRI = Schema.Schema.Type<typeof IRI>;

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
