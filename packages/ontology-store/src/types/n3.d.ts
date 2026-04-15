declare module "n3" {
  export interface BaseTerm {
    readonly termType: string;
    readonly value: string;
    equals(other: unknown): boolean;
  }

  export interface NamedNode extends BaseTerm {
    readonly termType: "NamedNode";
  }

  export interface BlankNode extends BaseTerm {
    readonly termType: "BlankNode";
  }

  export interface DefaultGraph extends BaseTerm {
    readonly termType: "DefaultGraph";
  }

  export interface Literal extends BaseTerm {
    readonly termType: "Literal";
    readonly language: string;
    readonly datatype: NamedNode;
  }

  export type SubjectTerm = NamedNode | BlankNode | Quad;
  export type PredicateTerm = NamedNode;
  export type ObjectTerm = NamedNode | BlankNode | Literal | Quad;
  export type GraphTerm = NamedNode | BlankNode | DefaultGraph;

  export interface Quad extends BaseTerm {
    readonly termType: "Quad";
    readonly subject: SubjectTerm;
    readonly predicate: PredicateTerm;
    readonly object: ObjectTerm;
    readonly graph: GraphTerm;
  }

  export class Store {
    constructor(quads?: ReadonlyArray<Quad>);
    readonly size: number;
    addQuads(quads: ReadonlyArray<Quad>): void;
    getQuads(
      subject?: SubjectTerm | null,
      predicate?: PredicateTerm | null,
      object?: ObjectTerm | null,
      graph?: GraphTerm | null
    ): Array<Quad>;
    countQuads(
      subject?: SubjectTerm | null,
      predicate?: PredicateTerm | null,
      object?: ObjectTerm | null,
      graph?: GraphTerm | null
    ): number;
    deleteMatches(
      subject?: SubjectTerm | null,
      predicate?: PredicateTerm | null,
      object?: ObjectTerm | null,
      graph?: GraphTerm | null
    ): Store;
  }

  export type ParserOptions = {
    readonly format?: string;
    readonly baseIRI?: string;
  };

  export class Parser {
    constructor(options?: ParserOptions);
    parse(input: string): Array<Quad>;
  }

  export type WriterOptions = {
    readonly format?: string;
    readonly prefixes?: Record<string, string | NamedNode>;
    readonly baseIRI?: string;
    readonly end?: boolean;
  };

  export class Writer {
    constructor(options?: WriterOptions);
    addQuads(quads: ReadonlyArray<Quad>): void;
    end(done?: (error?: Error | null, result?: string) => void): void;
  }

  export const DataFactory: {
    namedNode(value: string): NamedNode;
    literal(value: string, languageOrDatatype?: string | NamedNode): Literal;
    defaultGraph(): DefaultGraph;
    quad(
      subject: SubjectTerm,
      predicate: PredicateTerm,
      object: ObjectTerm,
      graph?: GraphTerm
    ): Quad;
    blankNode(value?: string): BlankNode;
  };
}
