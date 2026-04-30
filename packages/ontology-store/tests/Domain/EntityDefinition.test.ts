import { describe, expect, it } from "@effect/vitest";
import { Effect, Schema } from "effect";

import {
  ENTITY_METADATA_FIELDS,
  EntityRuntimeCatalogError,
  Expert,
  ExpertEntity,
  ExpertProjectionFixture,
  ExpertUnifiedProjection,
  OrganizationEntity,
  OrganizationProjectionFixture,
  defineEntityRuntimeCatalog,
  PREDICATES,
  assertNoMetadataDrift,
  isPredicateTypeAllowed
} from "../../src";

const expert = () =>
  Schema.decodeUnknownSync(Expert)({
    iri: "https://w3id.org/energy-intel/expert/MarkZJacobson",
    did: "did:plc:xyz",
    displayName: "Mark Z. Jacobson",
    roles: ["https://w3id.org/energy-intel/energyExpertRole/research"],
    affiliations: ["https://w3id.org/energy-intel/organization/Stanford"],
    tier: "top",
    primaryTopic: "grid"
  });

describe("EntityDefinition foundation", () => {
  it("normalizes generated NamedNode predicates into branded string IRIs", () => {
    expect(PREDICATES["ei:affiliatedWith"].iri).toBe(
      "https://w3id.org/energy-intel/affiliatedWith"
    );
    expect(PREDICATES["ei:authoredBy"].iri).toBe(
      "https://w3id.org/energy-intel/authoredBy"
    );
    expect(PREDICATES["ei:mentions"].iri).toBe(
      "https://w3id.org/energy-intel/mentions"
    );
  });

  it("rejects predicate subject/object drift at runtime boundaries", () => {
    expect(isPredicateTypeAllowed("ei:affiliatedWith", "Expert", "Organization")).toBe(
      true
    );
    expect(isPredicateTypeAllowed("ei:affiliatedWith", "Organization", "Expert")).toBe(
      false
    );
  });

  it("keeps entity definitions pure and projection metadata separate", () => {
    const entity = expert();
    const facts = ExpertEntity.render.facts(entity);
    const metadata = ExpertUnifiedProjection.toMetadata(entity);

    expect(ExpertEntity.tag).toBe("Expert");
    expect(ExpertEntity.ontology.classIri).toBe(
      "https://w3id.org/energy-intel/Expert"
    );
    expect(Object.keys(metadata).sort()).toEqual(
      ENTITY_METADATA_FIELDS.map((field) => field.field_name).sort()
    );
    expect(facts.some((fact) => fact.predicate === PREDICATES["bfo:bearerOf"].iri)).toBe(
      true
    );
  });

  it.effect("proves projection fixtures match the unified metadata fields", () =>
    Effect.gen(function* () {
      yield* assertNoMetadataDrift([
        ExpertProjectionFixture,
        OrganizationProjectionFixture
      ]);
      expect(OrganizationEntity.tag).toBe("Organization");
    })
  );

  it("fails fast when runtime catalog tags drift", () => {
    expect(() =>
      defineEntityRuntimeCatalog([
        {
          definition: ExpertEntity,
          projection: {
            ...ExpertUnifiedProjection,
            entityType: "Organization"
          },
          fixture: ExpertProjectionFixture
        } as never
      ])
    ).toThrow(EntityRuntimeCatalogError);
  });
});
