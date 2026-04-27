/**
 * SHACL violation tests for the Expert shape.
 *
 * Anchors the contract that the SHACL gate (build-time + test-only) and
 * `expertFromTriples` (the reverse mapping) reject the *same* class of
 * malformed graphs. Every required field that `expertFromTriples`
 * surfaces as an `RdfMappingError` must also be rejected by SHACL —
 * otherwise a graph could pass validation and then fail reverse
 * mapping, which is the exact mismatch this suite is designed to
 * prevent.
 *
 * Pattern: build a deliberately-malformed quad slab (omit the triple
 * under test), parse the shapes, run `ShaclService.validate`, assert
 * `conforms === false` and the violation message references the
 * missing predicate.
 */

import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { DataFactory } from "n3";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import type { RdfQuad } from "../src/Domain/Rdf";
import { RdfStoreService } from "../src/Service/RdfStore";
import { ShaclService } from "../src/Service/Shacl";
import { BFO, EI, FOAF, RDF } from "../src/iris";

const { quad, namedNode, literal } = DataFactory;

const TestLayer = Layer.mergeAll(RdfStoreService.Default, ShaclService.Default);

const shapesPath = fileURLToPath(
  new URL("../shapes/expert.ttl", import.meta.url)
);
const shapesText = readFileSync(shapesPath, "utf8");

const EI_DID = namedNode("https://w3id.org/energy-intel/did");

const FIXTURE_IRI = "https://w3id.org/energy-intel/expert/MarkZJacobson";
const FIXTURE_ROLE_IRI =
  "https://w3id.org/energy-intel/energyExpertRole/research";

/**
 * Build the canonical Expert quad slab and let the caller mutate it
 * before validation. Mirrors `expertToTriples` so the violation tests
 * stay aligned with the forward mapping; if a new triple is added to
 * the forward mapping, this builder has to be updated too.
 */
const buildExpertQuads = (
  options: { readonly omitDid?: boolean } = {}
): ReadonlyArray<RdfQuad> => {
  const subject = namedNode(FIXTURE_IRI);
  const role = namedNode(FIXTURE_ROLE_IRI);
  const triples: RdfQuad[] = [
    quad(subject, RDF.type, EI.Expert),
    quad(subject, RDF.type, FOAF.Person),
    quad(subject, FOAF.name, literal("Mark Z. Jacobson")),
    quad(role, RDF.type, EI.EnergyExpertRole),
    quad(role, BFO.inheresIn, subject),
    quad(subject, BFO.bearerOf, role)
  ];
  if (options.omitDid !== true) {
    triples.push(quad(subject, EI_DID, literal("did:plc:xyz")));
  }
  return triples;
};

describe("Expert SHACL violations", () => {
  it.effect("rejects an Expert with no ei:did literal", () =>
    Effect.gen(function* () {
      const rdf = yield* RdfStoreService;
      const shacl = yield* ShaclService;

      const triples = buildExpertQuads({ omitDid: true });

      const dataStore = yield* rdf.makeStore;
      yield* rdf.addQuads(dataStore, triples);
      const shapesStore = yield* shacl.loadShapes(shapesText);
      const report = yield* shacl.validate(dataStore, shapesStore);

      expect(report.conforms).toBe(false);
      const messages = report.violations.map((v) => v.message);
      const mentionsDid = messages.some((m) => m.includes("ei:did"));
      expect(mentionsDid).toBe(true);
    }).pipe(Effect.provide(TestLayer), Effect.scoped)
  );

  it.effect("accepts the same graph once ei:did is present", () =>
    Effect.gen(function* () {
      const rdf = yield* RdfStoreService;
      const shacl = yield* ShaclService;

      const triples = buildExpertQuads();

      const dataStore = yield* rdf.makeStore;
      yield* rdf.addQuads(dataStore, triples);
      const shapesStore = yield* shacl.loadShapes(shapesText);
      const report = yield* shacl.validate(dataStore, shapesStore);

      expect(report).toEqual({ conforms: true, violations: [] });
    }).pipe(Effect.provide(TestLayer), Effect.scoped)
  );
});
