/**
 * Six-phase round-trip test for Expert.
 *
 * This is the integration gate that exercises Tasks 9-11's output:
 *   1. Load     — fixture Expert decoded via Schema.
 *   2. Emit     — expertToTriples produces RDF quads.
 *   3. SHACL    — quads validate against shapes/expert.ttl.
 *   4. Reparse  — serialize to Turtle (n3 Writer), parse back (n3 Parser),
 *                 verify quad count matches.
 *   5. Distill  — expertFromTriples reconstructs an Expert from the
 *                 reparsed quads via Schema.decodeUnknownEffect.
 *   6. Parity   — distilled value matches the original on every preserved
 *                 field. Lossy fields are documented in comments below.
 *
 * Failures pin to a phase. The test's whole purpose is to make the
 * "SHACL is build-time + test-only, never runtime" claim concrete: this
 * IS that build-time gate.
 *
 * Lossy fields (intentionally not asserted on parity):
 *   - tier, primaryTopic, affiliations: not represented as triples in
 *     this slice. agent.ttl needs property declarations before they can
 *     round-trip; see expert.ts file-level docstring.
 *
 * `did` is round-trip stable: it is stored as a `(expert, ei:did,
 * "did:plc:...")` literal triple and read back from the same triple,
 * so the reverse value matches the original even when the IRI is
 * keyed on a handle (e.g. `expert/MarkZJacobson`).
 */

import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  expertFromTriples,
  expertToTriples
} from "../src/agent/expert";
import { RdfStoreService } from "../src/Service/RdfStore";
import { ShaclService } from "../src/Service/Shacl";
import { fixtureExpert } from "./fixtures/expert.fixture";

const TestLayer = Layer.mergeAll(RdfStoreService.Default, ShaclService.Default);

const shapesPath = fileURLToPath(
  new URL("../shapes/expert.ttl", import.meta.url)
);
const shapesText = readFileSync(shapesPath, "utf8");

describe("Expert six-phase round-trip", () => {
  it.effect("phases 1-6 all green", () =>
    Effect.gen(function* () {
      const rdf = yield* RdfStoreService;
      const shacl = yield* ShaclService;

      // Phase 1: Load
      const original = fixtureExpert;
      expect(original.iri).toBe(
        "https://w3id.org/energy-intel/expert/MarkZJacobson"
      );

      // Phase 2: Emit
      const triples = expertToTriples(original);
      expect(triples.length).toBeGreaterThan(0);

      // Phase 3: SHACL
      const dataStore = yield* rdf.makeStore;
      yield* rdf.addQuads(dataStore, triples);
      const shapesStore = yield* shacl.loadShapes(shapesText);
      const report = yield* shacl.validate(dataStore, shapesStore);
      if (!report.conforms) {
        const summary = report.violations
          .map(
            (violation) =>
              `${violation.sourceShape} | ${violation.path ?? "<no-path>"} | ${violation.message}`
          )
          .join("\n");
        throw new Error(`SHACL validation failed:\n${summary}`);
      }
      expect(report).toEqual({ conforms: true, violations: [] });

      // Phase 4: Reparse
      const turtle = yield* rdf.toTurtle(dataStore);
      expect(turtle.length).toBeGreaterThan(0);
      const reparsedStore = yield* rdf.makeStore;
      yield* rdf.parseTurtle(reparsedStore, turtle);
      const reparsedQuads = yield* rdf.query(reparsedStore);
      expect(reparsedQuads).toHaveLength(triples.length);

      // Phase 5: Distill
      const distilled = yield* expertFromTriples(reparsedQuads, original.iri);

      // Phase 6: Parity (preserved fields)
      expect(distilled.iri).toBe(original.iri);
      expect(distilled.did).toBe(original.did);
      expect(distilled.displayName).toBe(original.displayName);
      expect(distilled.roles).toEqual(original.roles);
      expect(distilled.bio).toBe(original.bio);
    }).pipe(Effect.provide(TestLayer), Effect.scoped)
  );
});
