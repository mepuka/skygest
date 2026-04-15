import { Effect, Layer, Scope, ServiceMap } from "effect";
import { DataFactory, Parser, Store, Writer, type NamedNode, type Quad } from "n3";

import { stringifyUnknown } from "../../../../src/platform/Json";
import { type IRI, RdfError } from "../Domain/Rdf";

const DEFAULT_TURTLE_PREFIXES = {
  rdf: "http://www.w3.org/1999/02/22-rdf-syntax-ns#",
  rdfs: "http://www.w3.org/2000/01/rdf-schema#",
  xsd: "http://www.w3.org/2001/XMLSchema#",
  foaf: "http://xmlns.com/foaf/0.1/",
  dcat: "http://www.w3.org/ns/dcat#",
  dcterms: "http://purl.org/dc/terms/",
  prov: "http://www.w3.org/ns/prov#",
  skos: "http://www.w3.org/2004/02/skos/core#",
  schema: "https://schema.org/",
  sh: "http://www.w3.org/ns/shacl#"
} as const;

export type RdfStore = Store;
export type RdfQuad = Quad;

export type RdfQuery = {
  readonly subject?: IRI;
  readonly predicate?: IRI;
  readonly object?: IRI;
  readonly graph?: IRI;
};

const toNamedNode = (iri: IRI | undefined): NamedNode | null =>
  iri === undefined ? null : DataFactory.namedNode(iri);

const mapRdfError = (operation: string) => (cause: unknown) => {
  const detail = stringifyUnknown(cause);
  return new RdfError({
    operation,
    message: detail,
    cause: detail
  });
};

const withTargetGraph = (quad: RdfQuad, targetGraph: IRI | undefined): RdfQuad =>
  targetGraph === undefined
    ? quad
    : DataFactory.quad(
        quad.subject,
        quad.predicate,
        quad.object,
        DataFactory.namedNode(targetGraph)
      );

export class RdfStoreService extends ServiceMap.Service<
  RdfStoreService,
  {
    readonly makeStore: Effect.Effect<RdfStore, never, Scope.Scope>;
    readonly addQuads: (
      store: RdfStore,
      quads: ReadonlyArray<RdfQuad>,
      targetGraph?: IRI
    ) => Effect.Effect<void, RdfError>;
    readonly size: (store: RdfStore) => Effect.Effect<number>;
    readonly query: (
      store: RdfStore,
      query?: RdfQuery
    ) => Effect.Effect<ReadonlyArray<RdfQuad>, RdfError>;
    readonly parseTurtle: (
      store: RdfStore,
      text: string,
      targetGraph?: IRI
    ) => Effect.Effect<void, RdfError>;
    readonly toTurtle: (store: RdfStore) => Effect.Effect<string, RdfError>;
  }
>()("@skygest/ontology-store/RdfStoreService") {
  static readonly Default = Layer.effect(
    RdfStoreService,
    Effect.gen(function* () {
      const makeStore = Effect.acquireRelease(
        Effect.sync(() => new Store()),
        (store) =>
          Effect.sync(() => {
            store.deleteMatches(undefined, undefined, undefined, undefined);
          })
      );

      // Every mutation entry point accepts targetGraph so later per-source
      // graph routing can be added without widening the service surface.
      const addQuads = Effect.fn("RdfStoreService.addQuads")(function* (
        store: RdfStore,
        quads: ReadonlyArray<RdfQuad>,
        targetGraph?: IRI
      ) {
        yield* Effect.try({
          try: () => {
            store.addQuads(quads.map((quad) => withTargetGraph(quad, targetGraph)));
          },
          catch: mapRdfError("addQuads")
        });
      });

      const size = Effect.fn("RdfStoreService.size")(function* (store: RdfStore) {
        return store.size;
      });

      const query = Effect.fn("RdfStoreService.query")(function* (
        store: RdfStore,
        rdfQuery?: RdfQuery
      ) {
        return yield* Effect.try({
          try: () =>
            store.getQuads(
              toNamedNode(rdfQuery?.subject),
              toNamedNode(rdfQuery?.predicate),
              toNamedNode(rdfQuery?.object),
              toNamedNode(rdfQuery?.graph)
            ),
          catch: mapRdfError("query")
        });
      });

      const parseTurtle = Effect.fn("RdfStoreService.parseTurtle")(function* (
        store: RdfStore,
        text: string,
        targetGraph?: IRI
      ) {
        const quads = yield* Effect.try({
          try: () => new Parser({ format: "text/turtle" }).parse(text),
          catch: mapRdfError("parseTurtle")
        });

        yield* addQuads(store, quads, targetGraph);
      });

      const toTurtle = Effect.fn("RdfStoreService.toTurtle")(function* (
        store: RdfStore
      ) {
        const quads = yield* query(store);
        const writer = yield* Effect.try({
          try: () =>
            new Writer({
              format: "text/turtle",
              prefixes: DEFAULT_TURTLE_PREFIXES
            }),
          catch: mapRdfError("toTurtle")
        });

        yield* Effect.try({
          try: () => {
            writer.addQuads(quads);
          },
          catch: mapRdfError("toTurtle")
        });

        return yield* Effect.effectify(
          (
            callback: (error: Error | null, result?: string) => void
          ) => writer.end(callback as (error: Error, result: any) => void),
          (error) => mapRdfError("toTurtle")(error),
          (error) => mapRdfError("toTurtle")(error)
        )().pipe(Effect.map((result) => result ?? ""));
      });

      return RdfStoreService.of({
        makeStore,
        addQuads,
        size,
        query,
        parseTurtle,
        toTurtle
      });
    })
  );
}
