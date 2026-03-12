/**
 * Catalog preparation: takes a decoded OntologySnapshot and builds the
 * in-memory prepared catalog with normalized terms, hierarchy closures,
 * and node lookups.
 */
import type {
  OntologyConcept as OntologyConceptType,
  OntologyListTopic as OntologyListTopicType,
  OntologySnapshot as OntologySnapshotType,
  OntologyTopic as OntologyTopicType
} from "../domain/bi";
import { normalizeWord, normalizeHashtag, normalizeDomain } from "./normalize";

export type PreparedTerm = {
  readonly raw: string;
  readonly normalized: string;
  readonly score: number;
};

export type PreparedTopic = OntologyTopicType & {
  readonly normalizedTerms: ReadonlyArray<PreparedTerm>;
  readonly normalizedHashtags: ReadonlySet<string>;
  readonly normalizedDomains: ReadonlySet<string>;
};

export type PreparedCatalog = {
  readonly snapshot: OntologySnapshotType;
  readonly topics: ReadonlyArray<PreparedTopic>;
  readonly concepts: ReadonlyArray<OntologyConceptType>;
  readonly topicBySlug: ReadonlyMap<string, PreparedTopic>;
  readonly conceptBySlug: ReadonlyMap<string, OntologyConceptType>;
  readonly nodeBySlug: ReadonlyMap<string, OntologyListTopicType>;
  readonly conceptDescendants: ReadonlyMap<string, ReadonlySet<string>>;
  readonly conceptAncestors: ReadonlyMap<string, ReadonlySet<string>>;
  readonly sortedFacetNodes: ReadonlyArray<OntologyListTopicType>;
  readonly sortedConceptNodes: ReadonlyArray<OntologyListTopicType>;
};

export const compareEvidence = (left: PreparedTerm | null, right: PreparedTerm | null) => {
  if (left === null) {
    return 1;
  }
  if (right === null) {
    return -1;
  }
  if (left.score !== right.score) {
    return right.score - left.score;
  }
  if (left.raw.length !== right.raw.length) {
    return right.raw.length - left.raw.length;
  }
  return left.raw.localeCompare(right.raw);
};

export const makeTopicNode = (topic: OntologyTopicType): OntologyListTopicType => ({
  slug: topic.slug,
  kind: "canonical-topic",
  label: topic.label,
  description: topic.description,
  canonicalTopicSlug: topic.slug,
  topConcept: false,
  conceptSlugs: topic.conceptSlugs,
  parentSlugs: [],
  childSlugs: topic.conceptSlugs,
  terms: topic.terms,
  hashtags: topic.hashtags,
  domains: topic.domains
});

export const makeConceptNode = (concept: OntologyConceptType): OntologyListTopicType => ({
  slug: concept.slug,
  kind: "concept",
  label: concept.label,
  description: concept.description,
  canonicalTopicSlug: concept.canonicalTopicSlug,
  topConcept: concept.topConcept,
  conceptSlugs: [concept.slug],
  parentSlugs: concept.broaderSlugs,
  childSlugs: concept.narrowerSlugs,
  terms: concept.matcherTerms,
  hashtags: [],
  domains: []
});

const buildAncestors = (
  conceptBySlug: ReadonlyMap<string, OntologyConceptType>,
  slug: string,
  seen = new Set<string>()
): ReadonlySet<string> => {
  const concept = conceptBySlug.get(slug);
  if (concept === undefined) {
    return seen;
  }

  for (const parent of concept.broaderSlugs) {
    if (!seen.has(parent)) {
      seen.add(parent);
      buildAncestors(conceptBySlug, parent, seen);
    }
  }

  return seen;
};

const buildDescendants = (
  conceptBySlug: ReadonlyMap<string, OntologyConceptType>,
  slug: string,
  seen = new Set<string>()
): ReadonlySet<string> => {
  const concept = conceptBySlug.get(slug);
  if (concept === undefined) {
    return seen;
  }

  for (const child of concept.narrowerSlugs) {
    if (!seen.has(child)) {
      seen.add(child);
      buildDescendants(conceptBySlug, child, seen);
    }
  }

  return seen;
};

export const prepareCatalog = (snapshot: OntologySnapshotType): PreparedCatalog => {
  const topics = snapshot.canonicalTopics.map((topic) => ({
    ...topic,
    normalizedTerms: topic.terms
      .map((raw) => {
        const normalized = normalizeWord(raw);
        return {
          raw,
          normalized,
          score: normalized.includes(" ") ? 2 : 1
        } satisfies PreparedTerm;
      })
      .filter((term, index, array) =>
        term.normalized.length > 0 &&
        array.findIndex((candidate) => candidate.normalized === term.normalized) === index
      )
      .sort(compareEvidence),
    normalizedHashtags: new Set(topic.hashtags.map(normalizeHashtag).filter((value) => value.length > 0)),
    normalizedDomains: new Set(topic.domains.map(normalizeDomain).filter((value) => value.length > 0))
  }));
  const topicBySlug = new Map(topics.map((topic) => [topic.slug, topic] as const));
  const conceptBySlug = new Map(snapshot.concepts.map((concept) => [concept.slug, concept] as const));
  const conceptDescendants = new Map(
    snapshot.concepts.map((concept) => [concept.slug, buildDescendants(conceptBySlug, concept.slug)] as const)
  );
  const conceptAncestors = new Map(
    snapshot.concepts.map((concept) => [concept.slug, buildAncestors(conceptBySlug, concept.slug)] as const)
  );
  const nodeBySlug = new Map<string, OntologyListTopicType>([
    ...snapshot.canonicalTopics.map((topic) => [topic.slug, makeTopicNode(topic)] as const),
    ...snapshot.concepts.map((concept) => [concept.slug, makeConceptNode(concept)] as const)
  ]);

  const sortByLabel = (a: OntologyListTopicType, b: OntologyListTopicType) =>
    a.label.localeCompare(b.label);

  const sortedFacetNodes = snapshot.canonicalTopics
    .map(makeTopicNode)
    .sort(sortByLabel);
  const sortedConceptNodes = snapshot.concepts
    .map(makeConceptNode)
    .sort(sortByLabel);

  return {
    snapshot,
    topics,
    concepts: snapshot.concepts,
    topicBySlug,
    conceptBySlug,
    nodeBySlug,
    conceptDescendants,
    conceptAncestors,
    sortedFacetNodes,
    sortedConceptNodes
  };
};
