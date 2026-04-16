import { describe, expect, it } from "@effect/vitest";
import { Effect, Logger, References } from "effect";

import { asIri } from "../src/Domain/Rdf";
import { emitAliases } from "../src/aliasEmitter";

const SUBJECT = asIri("https://example.org/entity/agent");
const SKOS_ALT_LABEL = "http://www.w3.org/2004/02/skos/core#altLabel";
const SKOS_EXACT_MATCH = "http://www.w3.org/2004/02/skos/core#exactMatch";
const SKOS_CLOSE_MATCH = "http://www.w3.org/2004/02/skos/core#closeMatch";

const annotationValue = (
  options: { readonly annotations: Record<string, unknown> },
  key: string
) => options.annotations[key];

const captureLogs = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const seen: Array<{
      readonly message: unknown;
      readonly annotations: Record<string, unknown>;
    }> = [];
    const captureLayer = Logger.layer([
      Logger.make((options) => {
        seen.push({
          message: options.message,
          annotations: options.fiber.getRef(References.CurrentLogAnnotations)
        });
      })
    ]);

    const result = yield* effect.pipe(
      Effect.provide(captureLayer),
      Effect.provideService(References.MinimumLogLevel, "All")
    );

    return { result, seen } as const;
  });

describe("emitAliases", () => {
  it.effect("emits a wikidata alias as one skos:exactMatch triple", () =>
    Effect.gen(function* () {
      const quads = yield* emitAliases(SUBJECT, [
        {
          scheme: "wikidata",
          value: "Q12345",
          relation: "exactMatch"
        }
      ]);

      expect(quads).toHaveLength(1);
      expect(quads[0]?.subject.value).toBe(SUBJECT);
      expect(quads[0]?.predicate.value).toBe(SKOS_EXACT_MATCH);
      expect(quads[0]?.object.termType).toBe("NamedNode");
      expect(quads[0]?.object.value).toBe("https://www.wikidata.org/entity/Q12345");
    })
  );

  it.effect("emits a bare ROR alias against the canonical ror.org URI", () =>
    Effect.gen(function* () {
      const quads = yield* emitAliases(SUBJECT, [
        {
          scheme: "ror",
          value: "04xfq0j82",
          relation: "exactMatch"
        }
      ]);

      expect(quads).toHaveLength(1);
      expect(quads[0]?.predicate.value).toBe(SKOS_EXACT_MATCH);
      expect(quads[0]?.object.termType).toBe("NamedNode");
      expect(quads[0]?.object.value).toBe("https://ror.org/04xfq0j82");
    })
  );

  it.effect("emits a DOI alias against the canonical doi.org URI", () =>
    Effect.gen(function* () {
      const quads = yield* emitAliases(SUBJECT, [
        {
          scheme: "doi",
          value: "10.5281/zenodo.12345",
          relation: "exactMatch"
        }
      ]);

      expect(quads).toHaveLength(1);
      expect(quads[0]?.predicate.value).toBe(SKOS_EXACT_MATCH);
      expect(quads[0]?.object.termType).toBe("NamedNode");
      expect(quads[0]?.object.value).toBe("https://doi.org/10.5281/zenodo.12345");
    })
  );

  it.effect("emits display-alias as skos:altLabel with an English language tag", () =>
    Effect.gen(function* () {
      const quads = yield* emitAliases(SUBJECT, [
        {
          scheme: "display-alias",
          value: "Canada Energy Regulator",
          relation: "closeMatch"
        }
      ]);

      expect(quads).toHaveLength(1);
      expect(quads[0]?.predicate.value).toBe(SKOS_ALT_LABEL);
      expect(quads[0]?.object.termType).toBe("Literal");
      if (quads[0]?.object.termType === "Literal") {
        expect(quads[0].object.value).toBe("Canada Energy Regulator");
        expect(quads[0].object.language).toBe("en");
      }
    })
  );

  it.effect("emits no triples for non-whitelisted schemes and logs a warning", () =>
    Effect.gen(function* () {
      const { result, seen } = yield* captureLogs(
        emitAliases(SUBJECT, [
          {
            scheme: "eia-series",
            value: "ELEC.GEN.ALL-99.A",
            relation: "exactMatch"
          }
        ])
      );

      expect(result).toEqual([]);
      expect(seen).toHaveLength(1);
      expect(seen[0]?.message).toEqual(["alias omitted from RDF emit"]);
      expect(annotationValue(seen[0]!, "reason")).toBe("unsupportedScheme");
      expect(annotationValue(seen[0]!, "scheme")).toBe("eia-series");
    })
  );

  it.effect("emits no triples for methodologyVariant relations and logs a warning", () =>
    Effect.gen(function* () {
      const { result, seen } = yield* captureLogs(
        emitAliases(SUBJECT, [
          {
            scheme: "wikidata",
            value: "Q12345",
            relation: "methodologyVariant"
          }
        ])
      );

      expect(result).toEqual([]);
      expect(seen).toHaveLength(1);
      expect(seen[0]?.message).toEqual(["alias omitted from RDF emit"]);
      expect(annotationValue(seen[0]!, "reason")).toBe("unsupportedRelation");
      expect(annotationValue(seen[0]!, "relation")).toBe("methodologyVariant");
    })
  );

  it.effect("uses the SKOS predicate named by a supported mapping relation", () =>
    Effect.gen(function* () {
      const quads = yield* emitAliases(SUBJECT, [
        {
          scheme: "wikidata",
          value: "Q4712345",
          relation: "closeMatch"
        }
      ]);

      expect(quads).toHaveLength(1);
      expect(quads[0]?.predicate.value).toBe(SKOS_CLOSE_MATCH);
      expect(quads[0]?.object.value).toBe("https://www.wikidata.org/entity/Q4712345");
    })
  );

  it.effect("preserves a pre-formed absolute URI for URL aliases", () =>
    Effect.gen(function* () {
      const quads = yield* emitAliases(SUBJECT, [
        {
          scheme: "url",
          value: "https://example.org/custom/alias",
          relation: "exactMatch"
        }
      ]);

      expect(quads).toHaveLength(1);
      expect(quads[0]?.object.value).toBe("https://example.org/custom/alias");
    })
  );
});
