import type { NamedNode } from "n3";

import { BFO, EI } from "../iris";
import { asPredicateIri, type PredicateIri } from "./EntityDefinition";

const predicate = (term: NamedNode): PredicateIri => asPredicateIri(term.value);

export interface PredicateSpec {
  readonly iri: PredicateIri;
  readonly subject: ReadonlyArray<string>;
  readonly object: ReadonlyArray<string>;
}

export const PREDICATES = {
  "ei:mentions": {
    iri: predicate(EI.mentions),
    subject: ["Expert", "Post"],
    object: ["Post", "Article", "Dataset", "Organization", "Expert"]
  },
  "ei:authoredBy": {
    iri: predicate(EI.authoredBy),
    subject: ["Post", "Article"],
    object: ["Expert"]
  },
  "bfo:bearerOf": {
    iri: predicate(BFO.bearerOf),
    subject: ["Expert", "Organization"],
    object: ["EnergyExpertRole", "PublisherRole", "DataProviderRole"]
  },
  "ei:affiliatedWith": {
    iri: predicate(EI.affiliatedWith),
    subject: ["Expert"],
    object: ["Organization"]
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
    readonly iri: string;
    readonly type: SubjectOf<P>;
  };
  readonly object: {
    readonly iri: string;
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
