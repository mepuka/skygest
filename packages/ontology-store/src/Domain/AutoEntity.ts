/**
 * Auto-entity primitive.
 *
 * Generates an EntityDefinition + ProjectionContract + ProjectionFixture
 * from (schema, IRI brand, classIri, tag, description) — the load-bearing
 * inputs that already come for free from the codegen pipeline.
 *
 * Used to register the structural entity types (Roles, MediaAttachment,
 * Excerpt, PodcastEpisode, Series, Variable, etc.) into the runtime
 * catalog without per-entity boilerplate. Hand-written entities (Expert,
 * Organization, Post) keep their richer renders + RDF mappings; this
 * primitive is the default path for everything else.
 *
 * Conventions:
 *   - tag (e.g. "PodcastEpisode") → IRI path segment ("podcastEpisode/")
 *     by lowercasing the first character.
 *   - iriOf assumes the schema has an `iri` field (every codegen-emitted
 *     class does).
 *   - derive({ handle }) constructs `<prefix><slugified-handle>`.
 *   - Minimal forward / reverse RDF mapping: emits/reads only the
 *     rdf:type triple. Full per-property mapping is per-entity work.
 *   - Default render: frontmatter + class name + IRI. No rich body —
 *     auto-entities don't carry user-visible content unless extended.
 *   - Default metadata: entity_type + iri only; topic / authority /
 *     time_bucket all "unknown" until linked-entity hydration lands.
 *   - Default fixture IRI: `<prefix>fixture` — sufficient to satisfy the
 *     EntityRuntimeCatalog invariant checks.
 */

import { Effect, Schema } from "effect";
import { DataFactory, Store, type NamedNode } from "n3";

import {
  asPredicateIri,
  defineEntity,
  type EntityDefinition,
  type EntityFact,
  type RelationsSpec
} from "./EntityDefinition";
import { RdfMappingError } from "./Errors";
import {
  type EntityMetadata,
  type ProjectionContract,
  type ProjectionFixture
} from "./Projection";
import type { RdfQuad } from "./Rdf";
import { RDF } from "../iris";

const { quad, namedNode } = DataFactory;
const SLUG_DISALLOWED = /[^A-Za-z0-9_-]+/g;
const slugify = (value: string): string => value.replace(SLUG_DISALLOWED, "_");

const tagToIriPath = <Tag extends string>(tag: Tag): string =>
  tag.charAt(0).toLowerCase() + tag.slice(1);

const iriPrefixForTag = <Tag extends string>(tag: Tag): string =>
  `https://w3id.org/energy-intel/${tagToIriPath(tag)}/`;

export interface AutoEntityInput<
  Self extends Schema.Top,
  IriBrand extends Schema.Schema<string>,
  Tag extends string,
  Relations extends RelationsSpec
> {
  readonly tag: Tag;
  readonly schema: Self;
  readonly iri: IriBrand;
  readonly classIri: string;
  readonly description: string;
  /** Optional fixture override; defaults to `<iriPrefix>fixture`. */
  readonly fixtureIri?: string;
  /** Extra fields to satisfy schemas with required non-iri fields. */
  readonly fixtureFields?: Readonly<Record<string, unknown>>;
  /** Optional outbound relation declarations. */
  readonly relations?: Relations;
  /** Optional summary override (default: `<Tag> <iri>`). */
  readonly summary?: (entity: Schema.Schema.Type<Self>) => string;
}

const autoToTriples = (classIri: string) =>
  (entity: { readonly iri: string }): ReadonlyArray<RdfQuad> => [
    quad(namedNode(entity.iri), RDF.type, namedNode(classIri))
  ];

const autoFromTriples = <
  Self extends Schema.Top,
  Tag extends string
>(
  schema: Self,
  classIri: string,
  tag: Tag
) =>
  (
    quads: ReadonlyArray<RdfQuad>,
    subject: string
  ): Effect.Effect<Schema.Schema.Type<Self>, RdfMappingError | Schema.SchemaError> =>
    Effect.gen(function* () {
      const store = new Store([...quads]);
      const subjectNode = namedNode(subject);
      const classNode = namedNode(classIri);
      const typeQuads = store.getQuads(subjectNode, RDF.type, classNode, null);
      if (typeQuads.length === 0) {
        yield* new RdfMappingError({
          direction: "reverse",
          entity: tag,
          iri: subject,
          message: `missing rdf:type ${classIri}`
        });
      }
      const decode = Schema.decodeUnknownEffect(schema as never);
      return (yield* decode({ iri: subject })) as Schema.Schema.Type<Self>;
    });

const autoRender = <Self extends Schema.Top, Tag extends string>(
  tag: Tag,
  summary: (entity: Schema.Schema.Type<Self>) => string
) => ({
  summary,
  fulltext: (entity: Schema.Schema.Type<Self>): string => {
    const iri = (entity as unknown as { iri: string }).iri;
    return [
      "---",
      `entity_type: ${tag}`,
      `iri: ${iri}`,
      "---",
      "",
      `# ${tag}`,
      "",
      iri
    ].join("\n");
  },
  facts: (): ReadonlyArray<EntityFact<Schema.Schema<string>>> => []
});

const autoProjection = <Self extends Schema.Top, Tag extends string>(
  tag: Tag
): ProjectionContract<Self, EntityMetadata, `entities/${string}.md`> => {
  const path = tagToIriPath(tag);
  return {
    entityType: tag,
    toKey: (entity) => {
      const iri = (entity as unknown as { iri: string }).iri;
      const prefix = iriPrefixForTag(tag);
      const suffix = iri.startsWith(prefix)
        ? iri.slice(prefix.length)
        : slugify(iri);
      return `entities/${path}/${suffix}.md`;
    },
    toBody: (entity) => {
      const iri = (entity as unknown as { iri: string }).iri;
      return [
        "---",
        `entity_type: ${tag}`,
        `iri: ${iri}`,
        "---",
        "",
        `# ${tag}`,
        "",
        iri
      ].join("\n");
    },
    toMetadata: (entity): EntityMetadata => ({
      entity_type: tag,
      iri: (entity as unknown as { iri: string }).iri,
      topic: "unknown",
      authority: "unknown",
      time_bucket: "unknown"
    })
  };
};

const autoFixture = <Self extends Schema.Top, Tag extends string>(
  tag: Tag,
  schema: Self,
  fixtureIri: string,
  extraFields: Readonly<Record<string, unknown>>
): ProjectionFixture<Self> => ({
  entityType: tag,
  fixture: Schema.decodeUnknownSync(schema as never)({
    iri: fixtureIri,
    ...extraFields
  }) as Schema.Schema.Type<Self>,
  projection: autoProjection<Self, Tag>(tag)
});

export interface AutoRuntimeModule<
  Self extends Schema.Top,
  IriBrand extends Schema.Schema<string>,
  Tag extends string,
  Relations extends RelationsSpec
> {
  readonly definition: EntityDefinition<Self, IriBrand, Tag, Relations>;
  readonly projection: ProjectionContract<Self, EntityMetadata>;
  readonly fixture: ProjectionFixture<Self>;
}

export const defineAutoRuntimeModule = <
  Self extends Schema.Top,
  IriBrand extends Schema.Schema<string>,
  Tag extends string,
  Relations extends RelationsSpec = Record<string, never>
>(
  input: AutoEntityInput<Self, IriBrand, Tag, Relations>
): AutoRuntimeModule<Self, IriBrand, Tag, Relations> => {
  const prefix = iriPrefixForTag(input.tag);
  const fixtureIri = input.fixtureIri ?? `${prefix}fixture`;
  const summary =
    input.summary ??
    ((entity: Schema.Schema.Type<Self>) => {
      const iri = (entity as unknown as { iri: string }).iri;
      return `${input.tag} ${iri}`;
    });

  const definition = defineEntity({
    tag: input.tag,
    schema: input.schema,
    identity: {
      iri: input.iri,
      iriOf: (entity: Schema.Schema.Type<Self>) =>
        (entity as unknown as { iri: Schema.Schema.Type<IriBrand> }).iri,
      derive: ({ handle }) =>
        Schema.decodeUnknownSync(input.iri as never)(
          `${prefix}${slugify(handle)}`
        ) as Schema.Schema.Type<IriBrand>
    },
    ontology: {
      classIri: input.classIri,
      typeChain: [input.classIri],
      shapeRef: `shapes/${tagToIriPath(input.tag)}.ttl`,
      toTriples: autoToTriples(input.classIri) as (
        entity: Schema.Schema.Type<Self>
      ) => ReadonlyArray<RdfQuad>,
      fromTriples: autoFromTriples<Self, Tag>(
        input.schema,
        input.classIri,
        input.tag
      )
    },
    render: autoRender<Self, Tag>(input.tag, summary) as EntityDefinition<
      Self,
      IriBrand,
      Tag,
      Relations
    >["render"],
    relations: (input.relations ?? ({} as Relations)),
    agentContext: {
      description: input.description,
      tools: ["search", "get", "linksOut", "linksIn"],
      summaryTemplate: summary
    }
  });

  return {
    definition,
    projection: autoProjection<Self, Tag>(input.tag),
    fixture: autoFixture<Self, Tag>(
      input.tag,
      input.schema,
      fixtureIri,
      input.fixtureFields ?? {}
    )
  };
};

// Re-export internal helpers callers may want.
export { iriPrefixForTag, slugify as slugifyHandle, tagToIriPath };

// Re-import to avoid yet-another circular: predicate constructors used
// by callers that want richer relations on top of the auto module.
export const autoPredicate = (term: NamedNode) => asPredicateIri(term.value);
