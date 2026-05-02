/**
 * Hand-written EnergyTopic entity module.
 *
 * Energy topics are SKOS concepts supplied by the ontology snapshot, not
 * OWL classes generated from the energy-intel TTL modules. This module keeps
 * that boundary explicit: the entity identity is the concept IRI, while the
 * payload carries the snapshot fields needed for rendering and search.
 */

import { Effect, Schema } from "effect";
import { DataFactory, Store, type NamedNode } from "n3";

import {
  asPredicateIri,
  defineEntity,
  type EntityFact,
  type PredicateIri
} from "../Domain/EntityDefinition";
import { RdfMappingError } from "../Domain/Errors";
import {
  type EntityMetadata,
  type ProjectionContract,
  type ProjectionFixture
} from "../Domain/Projection";
import type { RdfQuad } from "../Domain/Rdf";
import { RDF, RDFS, SKOS } from "../iris";

const { quad, namedNode, literal } = DataFactory;
const predicate = (term: NamedNode): PredicateIri => asPredicateIri(term.value);

const ENERGY_NEWS_BASE = "http://example.org/ontology/energy-news#";
const ENERGY_TOPIC_CLASS = namedNode(`${ENERGY_NEWS_BASE}EnergyTopic`);
const ENERGY_TOPIC_SCHEME = namedNode(`${ENERGY_NEWS_BASE}EnergyTopicScheme`);
const SKOS_CONCEPT = namedNode("http://www.w3.org/2004/02/skos/core#Concept");
const SKOS_PREF_LABEL = namedNode("http://www.w3.org/2004/02/skos/core#prefLabel");
const SKOS_ALT_LABEL = namedNode("http://www.w3.org/2004/02/skos/core#altLabel");
const SKOS_BROADER = namedNode("http://www.w3.org/2004/02/skos/core#broader");
const SKOS_NARROWER = namedNode("http://www.w3.org/2004/02/skos/core#narrower");
const SKOS_IN_SCHEME = namedNode("http://www.w3.org/2004/02/skos/core#inScheme");
const SKOS_TOP_CONCEPT_OF = namedNode(
  "http://www.w3.org/2004/02/skos/core#topConceptOf"
);
const EI_CANONICAL_TOPIC_SLUG = namedNode(
  "https://w3id.org/energy-intel/canonicalTopicSlug"
);

export const EnergyTopicIri = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^https?:\/\/\S+$/)),
  Schema.brand("EnergyTopicIri")
);
export type EnergyTopicIri = typeof EnergyTopicIri.Type;

export class EnergyTopic extends Schema.Class<EnergyTopic>("EnergyTopic")({
  iri: EnergyTopicIri,
  slug: Schema.String,
  label: Schema.String,
  altLabels: Schema.Array(Schema.String),
  description: Schema.optionalKey(Schema.String),
  canonicalTopicSlug: Schema.optionalKey(Schema.String),
  topConcept: Schema.Boolean,
  broaderSlugs: Schema.Array(Schema.String),
  narrowerSlugs: Schema.Array(Schema.String)
}) {}

const decodeEnergyTopic = Schema.decodeUnknownEffect(EnergyTopic);

const conceptIriForSlug = (slug: string): NamedNode =>
  namedNode(`${ENERGY_NEWS_BASE}${slug}`);

const slugFromConceptTerm = (value: string): string =>
  value.startsWith(ENERGY_NEWS_BASE)
    ? value.slice(ENERGY_NEWS_BASE.length)
    : value;

export const energyTopicToTriples = (
  topic: EnergyTopic
): ReadonlyArray<RdfQuad> => {
  const subject = namedNode(topic.iri);
  const triples: RdfQuad[] = [
    quad(subject, RDF.type, ENERGY_TOPIC_CLASS),
    quad(subject, RDF.type, SKOS_CONCEPT),
    quad(subject, SKOS_PREF_LABEL, literal(topic.label)),
    quad(subject, RDFS.label, literal(topic.label)),
    quad(subject, SKOS_IN_SCHEME, ENERGY_TOPIC_SCHEME)
  ];
  if (topic.topConcept) {
    triples.push(quad(subject, SKOS_TOP_CONCEPT_OF, ENERGY_TOPIC_SCHEME));
  }
  if (topic.description !== undefined) {
    triples.push(quad(subject, SKOS.definition, literal(topic.description)));
  }
  if (topic.canonicalTopicSlug !== undefined) {
    triples.push(
      quad(subject, EI_CANONICAL_TOPIC_SLUG, literal(topic.canonicalTopicSlug))
    );
  }
  for (const label of topic.altLabels) {
    triples.push(quad(subject, SKOS_ALT_LABEL, literal(label)));
  }
  for (const broaderSlug of topic.broaderSlugs) {
    triples.push(quad(subject, SKOS_BROADER, conceptIriForSlug(broaderSlug)));
  }
  for (const narrowerSlug of topic.narrowerSlugs) {
    triples.push(quad(subject, SKOS_NARROWER, conceptIriForSlug(narrowerSlug)));
  }
  return triples;
};

const firstLiteral = (
  store: Store,
  subject: NamedNode,
  field: string,
  predicateIri: NamedNode,
  iri: string
): Effect.Effect<string, RdfMappingError> =>
  Effect.gen(function* () {
    const value = store.getQuads(subject, predicateIri, null, null)[0]?.object
      .value;
    if (value === undefined) {
      yield* new RdfMappingError({
        direction: "reverse",
        entity: "EnergyTopic",
        iri,
        message: `missing required ${field}`
      });
    }
    return value ?? "";
  });

const literalValues = (
  store: Store,
  subject: NamedNode,
  predicateIri: NamedNode
): ReadonlyArray<string> =>
  store.getQuads(subject, predicateIri, null, null).map((q) => q.object.value);

export const energyTopicFromTriples = (
  quads: ReadonlyArray<RdfQuad>,
  subject: string
): Effect.Effect<EnergyTopic, RdfMappingError | Schema.SchemaError> =>
  Effect.gen(function* () {
    const store = new Store([...quads]);
    const subjectNode = namedNode(subject);
    const hasConceptType =
      store.getQuads(subjectNode, RDF.type, ENERGY_TOPIC_CLASS, null).length >
        0 &&
      store.getQuads(subjectNode, RDF.type, SKOS_CONCEPT, null).length > 0;
    if (!hasConceptType) {
      yield* new RdfMappingError({
        direction: "reverse",
        entity: "EnergyTopic",
        iri: subject,
        message: "missing rdf:type enews:EnergyTopic and skos:Concept"
      });
    }
    const label = yield* firstLiteral(
      store,
      subjectNode,
      "skos:prefLabel",
      SKOS_PREF_LABEL,
      subject
    );
    const description =
      literalValues(store, subjectNode, SKOS.definition)[0] ?? undefined;
    const canonicalTopicSlug =
      literalValues(store, subjectNode, EI_CANONICAL_TOPIC_SLUG)[0] ??
      undefined;
    return yield* decodeEnergyTopic({
      iri: subject,
      slug: subject.split(/[#/]/u).at(-1) ?? subject,
      label,
      altLabels: literalValues(store, subjectNode, SKOS_ALT_LABEL),
      ...(description === undefined ? {} : { description }),
      ...(canonicalTopicSlug === undefined ? {} : { canonicalTopicSlug }),
      topConcept:
        store.getQuads(subjectNode, SKOS_TOP_CONCEPT_OF, ENERGY_TOPIC_SCHEME, null)
          .length > 0,
      broaderSlugs: literalValues(store, subjectNode, SKOS_BROADER).map(
        slugFromConceptTerm
      ),
      narrowerSlugs: literalValues(store, subjectNode, SKOS_NARROWER).map(
        slugFromConceptTerm
      )
    });
  });

export const renderEnergyTopicMarkdown = (topic: EnergyTopic): string => {
  const lines = [
    "---",
    `entity_type: EnergyTopic`,
    `iri: ${topic.iri}`,
    `slug: ${topic.slug}`,
    `label: ${topic.label}`
  ];
  if (topic.canonicalTopicSlug !== undefined) {
    lines.push(`canonical_topic: ${topic.canonicalTopicSlug}`);
  }
  lines.push("---", "", `# ${topic.label}`, "");
  if (topic.description !== undefined) {
    lines.push(topic.description, "");
  }
  if (topic.altLabels.length > 0) {
    lines.push(`Also known as: ${topic.altLabels.join(", ")}`, "");
  }
  lines.push(`Ontology concept: ${topic.slug}`);
  return lines.join("\n");
};

export const renderEnergyTopicSummary = (topic: EnergyTopic): string =>
  topic.description === undefined
    ? topic.label
    : `${topic.label}: ${topic.description}`;

export const energyTopicFacts = (
  topic: EnergyTopic
): ReadonlyArray<EntityFact<typeof EnergyTopicIri>> => [
  { subject: topic.iri, predicate: predicate(SKOS_PREF_LABEL), object: topic.label },
  ...(topic.description === undefined
    ? []
    : [
        {
          subject: topic.iri,
          predicate: predicate(SKOS.definition),
          object: topic.description
        }
      ])
];

const slugify = (value: string): string =>
  value.trim().replace(/[^A-Za-z0-9_-]+/g, "_");

export const EnergyTopicUnifiedProjection = {
  entityType: "EnergyTopic",
  toKey: (topic: EnergyTopic): `entities/energyTopic/${string}.md` =>
    `entities/energyTopic/${slugify(topic.slug)}.md`,
  toBody: renderEnergyTopicMarkdown,
  toMetadata: (topic: EnergyTopic): EntityMetadata => ({
    entity_type: "EnergyTopic",
    iri: topic.iri,
    topic: topic.canonicalTopicSlug ?? topic.slug,
    authority: "ontology",
    time_bucket: "unknown"
  })
} as const satisfies ProjectionContract<
  typeof EnergyTopic,
  EntityMetadata,
  `entities/energyTopic/${string}.md`
>;

export const EnergyTopicProjectionFixture = {
  entityType: "EnergyTopic",
  fixture: Schema.decodeUnknownSync(EnergyTopic)({
    iri: "http://example.org/ontology/energy-news#Hydrogen",
    slug: "Hydrogen",
    label: "Hydrogen",
    altLabels: ["hydrogen energy"],
    description: "Hydrogen as an energy carrier across production methods.",
    canonicalTopicSlug: "hydrogen",
    topConcept: true,
    broaderSlugs: [],
    narrowerSlugs: []
  }),
  projection: EnergyTopicUnifiedProjection
} as const satisfies ProjectionFixture<typeof EnergyTopic>;

export const EnergyTopicEntity = defineEntity({
  tag: "EnergyTopic" as const,
  schema: EnergyTopic,
  identity: {
    iri: EnergyTopicIri,
    iriOf: (topic) => topic.iri,
    derive: ({ handle }) =>
      Schema.decodeUnknownSync(EnergyTopicIri)(
        `http://example.org/ontology/energy-news#${slugify(handle)}`
      )
  },
  ontology: {
    classIri: ENERGY_TOPIC_CLASS.value,
    typeChain: [ENERGY_TOPIC_CLASS.value, SKOS_CONCEPT.value],
    shapeRef: "shapes/energyTopic.ttl",
    toTriples: energyTopicToTriples,
    fromTriples: energyTopicFromTriples
  },
  render: {
    summary: renderEnergyTopicSummary,
    fulltext: renderEnergyTopicMarkdown,
    facts: energyTopicFacts
  },
  relations: {},
  agentContext: {
    description:
      "A SKOS concept from the energy ontology used to classify posts and claims.",
    tools: ["search", "get", "linksIn"],
    summaryTemplate: renderEnergyTopicSummary
  }
});
