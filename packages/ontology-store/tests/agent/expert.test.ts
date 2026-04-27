import { describe, expect, it } from "@effect/vitest";
import { Effect, Schema } from "effect";

import {
  EXPERT_METADATA_KEYS,
  Expert,
  ExpertModule,
  expertFromLegacyRow,
  expertFromTriples,
  expertToTriples
} from "../../src/agent/expert";

const sampleExpert = (): Expert =>
  Schema.decodeUnknownSync(Expert)({
    iri: "https://w3id.org/energy-intel/expert/MarkZJacobson",
    did: "did:plc:xyz",
    displayName: "Mark Z. Jacobson",
    roles: ["https://w3id.org/energy-intel/energyExpertRole/research"],
    bio: "Energy researcher.",
    tier: "top",
    primaryTopic: "renewables-grid"
  });

describe("ExpertModule", () => {
  it("toAiSearchKey produces expert/{did}.md", () => {
    expect(ExpertModule.toAiSearchKey(sampleExpert())).toBe(
      "expert/did:plc:xyz.md"
    );
  });

  it("toAiSearchMetadata returns the 5 declared keys", () => {
    const meta = ExpertModule.toAiSearchMetadata(sampleExpert());
    expect(Object.keys(meta).sort()).toEqual([...EXPERT_METADATA_KEYS].sort());
    expect(meta.entity_type).toBe("Expert");
    expect(meta.did).toBe("did:plc:xyz");
    expect(meta.iri).toBe(
      "https://w3id.org/energy-intel/expert/MarkZJacobson"
    );
    expect(meta.tier).toBe("top");
    expect(meta.topic).toBe("renewables-grid");
  });

  it("toAiSearchBody includes displayName, did, roles, and bio", () => {
    const body = ExpertModule.toAiSearchBody(sampleExpert());
    expect(body).toContain("Mark Z. Jacobson");
    expect(body).toContain("did:plc:xyz");
    expect(body).toContain("Energy researcher.");
    expect(body).toContain(
      "https://w3id.org/energy-intel/energyExpertRole/research"
    );
  });

  it("toTriples emits BFO inherence for each role", () => {
    const triples = expertToTriples(sampleExpert());
    const bearerOfTriples = triples.filter(
      (t) =>
        t.predicate.value === "http://purl.obolibrary.org/obo/BFO_0000053"
    );
    expect(bearerOfTriples).toHaveLength(1);

    const inheresInTriples = triples.filter(
      (t) =>
        t.predicate.value === "http://purl.obolibrary.org/obo/BFO_0000052"
    );
    expect(inheresInTriples).toHaveLength(1);
  });

  it.effect("fromTriples round-trips an emitted expert", () =>
    Effect.gen(function* () {
      const original = sampleExpert();
      const triples = expertToTriples(original);
      const distilled = yield* expertFromTriples(triples, original.iri);
      expect(distilled.iri).toBe(original.iri);
      expect(distilled.did).toBe(original.did);
      expect(distilled.displayName).toBe(original.displayName);
      expect(distilled.roles).toEqual(original.roles);
      expect(distilled.bio).toBe(original.bio);
    })
  );

  it.effect("fromTriples round-trips an expert without a bio", () =>
    Effect.gen(function* () {
      // Regression: under exactOptionalPropertyTypes + Schema.optionalKey,
      // passing `{ bio: undefined }` to the decoder fails because the key
      // must be absent, not present-as-undefined. The fix builds the
      // candidate object with conditional assignment.
      const original = Schema.decodeUnknownSync(Expert)({
        iri: "https://w3id.org/energy-intel/expert/NoBio",
        did: "did:plc:nobio",
        displayName: "No Bio",
        roles: ["https://w3id.org/energy-intel/energyExpertRole/research"]
      });
      const triples = expertToTriples(original);
      const distilled = yield* expertFromTriples(triples, original.iri);
      expect(distilled.iri).toBe(original.iri);
      expect(distilled.did).toBe(original.did);
      expect(distilled.displayName).toBe(original.displayName);
      expect(distilled.roles).toEqual(original.roles);
      expect(distilled.bio).toBeUndefined();
    })
  );

  it.effect("fromLegacyRow constructs valid Expert", () =>
    Effect.gen(function* () {
      const expert = yield* expertFromLegacyRow({
        did: "did:plc:abc",
        handle: "alice.bsky.social",
        displayName: "Alice",
        bio: "Solar engineer.",
        tier: "core"
      });
      expect(expert.iri).toBe(
        "https://w3id.org/energy-intel/expert/alice_bsky_social"
      );
      expect(expert.did).toBe("did:plc:abc");
      expect(expert.displayName).toBe("Alice");
      expect(expert.roles).toHaveLength(1);
    })
  );
});
