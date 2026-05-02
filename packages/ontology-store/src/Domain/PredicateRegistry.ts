import type { NamedNode } from "n3";

import { BFO, EI, IAO } from "../iris";
import { asPredicateIri, type PredicateIri } from "./EntityDefinition";
import type { EntityIri } from "./EntityGraph";

const predicate = (term: NamedNode): PredicateIri => asPredicateIri(term.value);

export interface PredicateSpec {
  readonly iri: PredicateIri;
  readonly subject: ReadonlyArray<string>;
  readonly object: ReadonlyArray<string>;
}

export const PREDICATES = {
  "iao:mentions": {
    iri: predicate(IAO.mentions),
    subject: ["Expert", "Post"],
    object: ["Post", "Article", "Dataset", "Organization", "Expert", "EnergyTopic"]
  },
  "ei:authoredBy": {
    iri: predicate(EI.authoredBy),
    subject: ["Post", "Article"],
    object: ["Expert"]
  },
  "ei:aboutTechnology": {
    iri: predicate(EI.aboutTechnology),
    subject: ["CanonicalMeasurementClaim"],
    object: ["EnergyTopic"]
  },
  "bfo:bearerOf": {
    iri: predicate(BFO.bearerOf),
    subject: ["Expert", "Organization"],
    object: ["EnergyExpertRole", "PublisherRole", "DataProviderRole"]
  }
} as const satisfies Record<string, PredicateSpec>;

export type PredicateRegistry = typeof PREDICATES;
export type PredicateName = keyof PredicateRegistry;
export type SubjectOf<P extends PredicateName> =
  PredicateRegistry[P]["subject"][number];
export type ObjectOf<P extends PredicateName> =
  PredicateRegistry[P]["object"][number];

export interface TypedLinkInput<P extends PredicateName> {
  readonly predicate: P;
  readonly subject: {
    readonly iri: EntityIri;
    readonly type: SubjectOf<P>;
  };
  readonly object: {
    readonly iri: EntityIri;
    readonly type: ObjectOf<P>;
  };
  readonly effectiveFrom: number;
}

export const predicateSpec = <P extends PredicateName>(
  name: P
): PredicateRegistry[P] => PREDICATES[name];

export const isPredicateTypeAllowed = (
  predicateName: PredicateName,
  subjectType: string,
  objectType: string
): boolean => {
  const spec = PREDICATES[predicateName];
  return (
    (spec.subject as ReadonlyArray<string>).includes(subjectType) &&
    (spec.object as ReadonlyArray<string>).includes(objectType)
  );
};
