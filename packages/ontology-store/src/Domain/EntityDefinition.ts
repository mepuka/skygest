import { Schema } from "effect";
import type { Effect } from "effect";

import type { RdfMappingError } from "./Errors";
import type { RdfQuad } from "./Rdf";

export const PredicateIri = Schema.String.pipe(
  Schema.check(Schema.isMinLength(1)),
  Schema.brand("PredicateIri")
);
export type PredicateIri = typeof PredicateIri.Type;
export const asPredicateIri = Schema.decodeUnknownSync(PredicateIri);

export interface EntityFact<IriBrand extends Schema.Schema<string>> {
  readonly subject: Schema.Schema.Type<IriBrand>;
  readonly predicate: PredicateIri;
  readonly object: string | number | boolean;
}

export interface RelationDeclaration<TargetTag extends string> {
  readonly direction: "outbound" | "inbound";
  readonly predicate: PredicateIri;
  readonly target: TargetTag;
  readonly cardinality: "one" | "many";
}
export type RelationsSpec = Readonly<Record<string, RelationDeclaration<string>>>;

export interface IdentitySpec<
  Self extends Schema.Top,
  IriBrand extends Schema.Schema<string>
> {
  readonly iri: IriBrand;
  readonly iriOf: (entity: Schema.Schema.Type<Self>) => Schema.Schema.Type<IriBrand>;
  readonly derive: (input: {
    readonly handle: string;
  }) => Schema.Schema.Type<IriBrand>;
}

export interface OntologySpec<Self extends Schema.Top> {
  readonly classIri: string;
  readonly typeChain: ReadonlyArray<string>;
  readonly shapeRef: string;
  readonly toTriples: (
    entity: Schema.Schema.Type<Self>
  ) => ReadonlyArray<RdfQuad>;
  readonly fromTriples: (
    quads: ReadonlyArray<RdfQuad>,
    subject: string
  ) => Effect.Effect<
    Schema.Schema.Type<Self>,
    RdfMappingError | Schema.SchemaError
  >;
}

export interface RenderSpec<
  Self extends Schema.Top,
  IriBrand extends Schema.Schema<string>
> {
  readonly summary: (entity: Schema.Schema.Type<Self>) => string;
  readonly fulltext: (entity: Schema.Schema.Type<Self>) => string;
  readonly facts: (
    entity: Schema.Schema.Type<Self>
  ) => ReadonlyArray<EntityFact<IriBrand>>;
}

export interface AgentContextSpec<Self extends Schema.Top> {
  readonly description: string;
  readonly tools: ReadonlyArray<string>;
  readonly summaryTemplate: (entity: Schema.Schema.Type<Self>) => string;
}

export interface EntityDefinition<
  Self extends Schema.Top,
  IriBrand extends Schema.Schema<string>,
  Tag extends string,
  Relations extends RelationsSpec
> {
  readonly tag: Tag;
  readonly schema: Self;
  readonly identity: IdentitySpec<Self, IriBrand>;
  readonly ontology: OntologySpec<Self>;
  readonly render: RenderSpec<Self, IriBrand>;
  readonly relations: Relations;
  readonly agentContext: AgentContextSpec<Self>;
}

export type AnyEntityDefinition = EntityDefinition<
  Schema.Top,
  Schema.Schema<string>,
  string,
  RelationsSpec
>;

export interface StorageAdapter<Def extends AnyEntityDefinition> {
  readonly definition: Def;
  readonly load: (
    iri: Schema.Schema.Type<Def["identity"]["iri"]>
  ) => Effect.Effect<Schema.Schema.Type<Def["schema"]>, unknown>;
  readonly save: (
    entity: Schema.Schema.Type<Def["schema"]>
  ) => Effect.Effect<void, unknown>;
}

export const defineEntity = <
  Self extends Schema.Top,
  IriBrand extends Schema.Schema<string>,
  Tag extends string,
  Relations extends RelationsSpec
>(
  spec: EntityDefinition<Self, IriBrand, Tag, Relations>
): EntityDefinition<Self, IriBrand, Tag, Relations> => spec;
