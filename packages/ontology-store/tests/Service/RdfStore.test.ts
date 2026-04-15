import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { Schema } from "effect";

import { IRI } from "../../src/Domain/Rdf";
import { RdfStoreService } from "../../src/Service/RdfStore";

const asIri = Schema.decodeUnknownSync(IRI);

const RDF_TYPE = asIri("http://www.w3.org/1999/02/22-rdf-syntax-ns#type");
const FOAF_AGENT = asIri("http://xmlns.com/foaf/0.1/Agent");
const NAMED_GRAPH = asIri("https://example.org/graph/catalog");

const agentFixture = `
  @prefix foaf: <http://xmlns.com/foaf/0.1/> .

  <https://example.org/a> a foaf:Agent ;
    foaf:name "Alice" .
`;

describe("RdfStoreService", () => {
  it("creates an empty store and reports size 0", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* RdfStoreService;
        const store = yield* service.makeStore;
        const size = yield* service.size(store);
        expect(size).toBe(0);
      }).pipe(Effect.provide(RdfStoreService.Default), Effect.scoped)
    ));

  it("parses Turtle, supports filtered query, and round-trips with stable quad count", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* RdfStoreService;
        const store = yield* service.makeStore;

        yield* service.parseTurtle(store, agentFixture);

        const typeQuads = yield* service.query(store, {
          predicate: RDF_TYPE,
          object: FOAF_AGENT
        });
        expect(typeQuads).toHaveLength(1);

        const size = yield* service.size(store);
        expect(size).toBe(2);

        const out = yield* service.toTurtle(store);
        expect(out).toContain("foaf:Agent");
        expect(out).toContain("Alice");

        const reparsedStore = yield* service.makeStore;
        yield* service.parseTurtle(reparsedStore, out);
        const reparsedSize = yield* service.size(reparsedStore);
        expect(reparsedSize).toBe(size);
      }).pipe(Effect.provide(RdfStoreService.Default), Effect.scoped)
    ));

  it("writes parsed Turtle into a named graph when targetGraph is provided", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* RdfStoreService;
        const store = yield* service.makeStore;

        yield* service.parseTurtle(store, agentFixture, NAMED_GRAPH);

        const quads = yield* service.query(store, { graph: NAMED_GRAPH });
        expect(quads).toHaveLength(2);
        expect(quads.every((quad) => quad.graph.termType === "NamedNode")).toBe(true);
        expect(quads.every((quad) => quad.graph.value === NAMED_GRAPH)).toBe(true);
      }).pipe(Effect.provide(RdfStoreService.Default), Effect.scoped)
    ));

  it("reassigns graphs on addQuads when targetGraph is provided", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* RdfStoreService;
        const sourceStore = yield* service.makeStore;
        const targetStore = yield* service.makeStore;

        yield* service.parseTurtle(sourceStore, agentFixture);
        const quads = yield* service.query(sourceStore);

        yield* service.addQuads(targetStore, quads, NAMED_GRAPH);

        const copied = yield* service.query(targetStore, { graph: NAMED_GRAPH });
        expect(copied).toHaveLength(quads.length);
        expect(copied.every((quad) => quad.graph.value === NAMED_GRAPH)).toBe(true);
      }).pipe(Effect.provide(RdfStoreService.Default), Effect.scoped)
    ));

  it("maps strict Turtle parse failures into RdfError", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* RdfStoreService;
        const store = yield* service.makeStore;

        const error = yield* service.parseTurtle(
          store,
          `GRAPH <https://example.org/g> { <https://example.org/a> <https://example.org/b> <https://example.org/c> . }`
        ).pipe(Effect.flip);

        expect(error._tag).toBe("RdfError");
        expect(error.operation).toBe("parseTurtle");
      }).pipe(Effect.provide(RdfStoreService.Default), Effect.scoped)
    ));
});
