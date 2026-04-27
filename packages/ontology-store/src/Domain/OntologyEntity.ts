import type { Effect, Schema } from "effect";

import type { RdfQuad } from "./Rdf";

// Placeholder until Task 4 lands the real RdfMappingError tagged error.
// Will be replaced by `import type { RdfMappingError } from "./Errors"`.
type RdfMappingErrorPlaceholder = unknown;

/**
 * The contract every per-entity ontology module satisfies structurally.
 *
 * Schema is generated; transforms are hand-written; both live in the
 * same module per energy-intel architecture decisions (2026-04-27).
 */
export interface OntologyEntityModule<
  Self extends Schema.Top,
  Meta extends Readonly<Record<string, string>>,
> {
  readonly schema: Self;
  readonly iriOf: (e: Schema.Schema.Type<Self>) => string;
  readonly toTriples: (e: Schema.Schema.Type<Self>) => ReadonlyArray<RdfQuad>;
  readonly fromTriples: (
    quads: ReadonlyArray<RdfQuad>,
    subject: string,
  ) => Effect.Effect<Schema.Schema.Type<Self>, RdfMappingErrorPlaceholder | Schema.SchemaError>;
  readonly toAiSearchKey: (e: Schema.Schema.Type<Self>) => string;
  readonly toAiSearchBody: (e: Schema.Schema.Type<Self>) => string;
  readonly toAiSearchMetadata: (e: Schema.Schema.Type<Self>) => Meta;
}
