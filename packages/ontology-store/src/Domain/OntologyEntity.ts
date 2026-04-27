import type { Effect, Schema } from "effect";

import type { RdfMappingError } from "./Errors";
import type { RdfQuad } from "./Rdf";

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
  /**
   * Reverse mapping. `R = never` is by design: per-entity contracts must
   * stay free of injected services so they can be composed without leaking
   * environment requirements. Anything that needs IO/config belongs in a
   * consumer service, not the entity module.
   */
  readonly fromTriples: (
    quads: ReadonlyArray<RdfQuad>,
    subject: string,
  ) => Effect.Effect<Schema.Schema.Type<Self>, RdfMappingError | Schema.SchemaError>;
  readonly toAiSearchKey: (e: Schema.Schema.Type<Self>) => string;
  readonly toAiSearchBody: (e: Schema.Schema.Type<Self>) => string;
  /**
   * Cloudflare AI Search rejects nested objects/arrays in metadata; the
   * `Readonly<Record<string, string>>` constraint enforces the API's
   * string-only requirement at the type level.
   */
  readonly toAiSearchMetadata: (e: Schema.Schema.Type<Self>) => Meta;
}
