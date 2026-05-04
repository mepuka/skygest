import { describe, expect, it } from "@effect/vitest";
import { Result, Schema } from "effect";
import {
  OntologyEntityIri,
  OntologyEntityType,
  SearchEntitiesInput,
  SearchEntitiesResult,
  SearchEntityHit
} from "../src/domain/entitySearch";

const decodeInput = Schema.decodeUnknownSync(SearchEntitiesInput);
const decodeInputResult = Schema.decodeUnknownResult(SearchEntitiesInput);
const decodeResult = Schema.decodeUnknownSync(SearchEntitiesResult);
const decodeHit = Schema.decodeUnknownSync(SearchEntityHit);
const decodeEntityType = Schema.decodeUnknownSync(OntologyEntityType);
const decodeIri = Schema.decodeUnknownSync(OntologyEntityIri);

describe("entitySearch domain", () => {
  it("accepts ontology search query input", () => {
    const input = decodeInput({
      query: "solar experts",
      entityTypes: ["Expert"],
      limit: 5
    });

    expect(input.query).toBe("solar experts");
    expect(input.entityTypes).toEqual([decodeEntityType("Expert")]);
    expect(input.limit).toBe(5);
  });

  it("accepts exact ontology IRI input", () => {
    const input = decodeInput({
      iri: "skygest:expert:solar-desk",
      limit: 1
    });

    expect(input.iri).toBe(decodeIri("skygest:expert:solar-desk"));
  });

  it("requires exactly one of query or iri", () => {
    expect(
      Result.isFailure(
        decodeInputResult({
          query: "solar",
          iri: "skygest:expert:solar-desk"
        })
      )
    ).toBe(true);

    expect(Result.isFailure(decodeInputResult({ limit: 5 }))).toBe(true);
  });

  it("rejects old probe fields instead of ignoring them", () => {
    expect(
      Result.isFailure(
        decodeInputResult({
          query: "solar",
          probes: {
            urls: ["https://example.com"],
            hostnames: ["example.com"],
            aliases: [{ scheme: "display-alias", value: "Solar Desk" }]
          }
        })
      )
    ).toBe(true);
  });

  it("rejects entity types outside the ontology runtime catalog", () => {
    expect(
      Result.isFailure(
        decodeInputResult({
          query: "catalog",
          entityTypes: ["Catalog"]
        })
      )
    ).toBe(true);
  });

  it("round-trips the v2 result shape", () => {
    const hit = decodeHit({
      entityType: "Expert",
      iri: "skygest:expert:solar-desk",
      label: "Solar Desk",
      summary: "Solar policy and market analysis.",
      rank: 1,
      score: 0.9,
      matchReason: "match",
      evidence: [
        {
          kind: "chunk",
          text: "Solar policy and market analysis.",
          source: "skygest:expert:solar-desk"
        }
      ]
    });

    expect(decodeResult({ hits: [hit] })).toEqual({ hits: [hit] });
  });
});
