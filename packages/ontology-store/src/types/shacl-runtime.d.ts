declare module "@rdfjs/data-model" {
  import type { NamedNode, Quad, BlankNode, DefaultGraph, Literal } from "n3";

  const rdfDataModel: {
    namedNode<Iri extends string = string>(value: Iri): NamedNode<Iri>;
    blankNode(value?: string): BlankNode;
    literal(
      value: string | number,
      languageOrDatatype?: string | NamedNode | null
    ): Literal;
    defaultGraph(): DefaultGraph;
    quad(
      subject: Quad["subject"],
      predicate: Quad["predicate"],
      object: Quad["object"],
      graph?: Quad["graph"]
    ): Quad;
    triple(
      subject: Quad["subject"],
      predicate: Quad["predicate"],
      object: Quad["object"]
    ): Quad;
  };

  export default rdfDataModel;
}

declare module "@rdfjs/dataset" {
  import type { Quad } from "n3";

  const rdfDataset: {
    dataset(quads?: Iterable<Quad>): unknown;
  };

  export default rdfDataset;
}

declare module "shacl-engine" {
  export type ShaclEnginePathStep = {
    readonly quantifier: string;
    readonly start: string;
    readonly end: string;
    readonly predicates: ReadonlyArray<{ readonly value: string }>;
  };

  export type ShaclEngineResult = {
    readonly focusNode?: { readonly term?: { readonly value?: string } };
    readonly shape?: { readonly ptr?: { readonly term?: { readonly value?: string } } };
    readonly constraintComponent?: { readonly value?: string };
    readonly severity?: { readonly value?: string };
    readonly message?: ReadonlyArray<{ readonly value?: string }>;
    readonly path?: ReadonlyArray<ShaclEnginePathStep>;
    readonly value?: { readonly term?: { readonly value?: string } };
  };

  export type ShaclEngineReport = {
    readonly conforms: boolean;
    readonly results: ReadonlyArray<ShaclEngineResult>;
  };

  export class Validator {
    constructor(
      dataset: unknown,
      options: {
        readonly factory: unknown;
        readonly coverage?: boolean;
        readonly debug?: boolean;
        readonly details?: boolean;
        readonly trace?: boolean;
        readonly validations?: ReadonlyArray<readonly [string, unknown]>;
        readonly targetResolvers?: ReadonlyArray<unknown>;
      }
    );

    validate(
      data: { readonly dataset: unknown; readonly terms?: Iterable<unknown> },
      shapes?: { readonly terms: Iterable<unknown> }
    ): Promise<ShaclEngineReport>;
  }
}
