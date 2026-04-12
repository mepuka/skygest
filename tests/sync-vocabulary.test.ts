import { describe, expect, it } from "@effect/vitest";
import { Result } from "effect";
import {
  validateVocabularyJson,
  VOCABULARY_FACETS
} from "../src/resolution/facetVocabulary/vocabularyFacets";

const addedAt = "2026-04-12T04:40:05.000Z";

const findDescriptor = (facet: string) => {
  const descriptor = VOCABULARY_FACETS.find(
    (candidate) => candidate.facet === facet
  );
  if (descriptor === undefined) {
    throw new Error(`Missing vocabulary facet descriptor for ${facet}`);
  }
  return descriptor;
};

const statisticTypeDescriptor = findDescriptor("statistic-type");
const technologyOrFuelDescriptor = findDescriptor("technology-or-fuel");

const encodeRows = (rows: ReadonlyArray<Record<string, unknown>>) =>
  JSON.stringify(rows);

describe("validateVocabularyJson", () => {
  it("accepts valid statistic-type entries", () => {
    const result = validateVocabularyJson(
      statisticTypeDescriptor,
      encodeRows([
        {
          surfaceForm: "generation",
          normalizedSurfaceForm: "generation",
          canonical: "flow",
          provenance: "cold-start-corpus",
          addedAt
        }
      ])
    );

    expect(Result.isSuccess(result)).toBe(true);
    if (Result.isSuccess(result)) {
      expect(result.success.entryCount).toBe(1);
    }
  });

  it("rejects invalid closed-enum canonicals", () => {
    const result = validateVocabularyJson(
      statisticTypeDescriptor,
      encodeRows([
        {
          surfaceForm: "generation",
          normalizedSurfaceForm: "generation",
          canonical: "bogus",
          provenance: "cold-start-corpus",
          addedAt
        }
      ])
    );

    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure._tag).toBe("VocabularyLoadError");
    }
  });

  it("rejects conflicting duplicate normalized forms", () => {
    const result = validateVocabularyJson(
      statisticTypeDescriptor,
      encodeRows([
        {
          surfaceForm: "generation",
          normalizedSurfaceForm: "generation",
          canonical: "flow",
          provenance: "cold-start-corpus",
          addedAt
        },
        {
          surfaceForm: "generation",
          normalizedSurfaceForm: "generation",
          canonical: "stock",
          provenance: "hand-curated",
          addedAt
        }
      ])
    );

    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure._tag).toBe("VocabularyCollisionError");
    }
  });

  it("allows duplicate normalized forms when the canonical matches", () => {
    const result = validateVocabularyJson(
      technologyOrFuelDescriptor,
      encodeRows([
        {
          surfaceForm: "CSP",
          normalizedSurfaceForm: "csp",
          canonical: "solar thermal",
          provenance: "cold-start-corpus",
          addedAt
        },
        {
          surfaceForm: "csp",
          normalizedSurfaceForm: "csp",
          canonical: "solar thermal",
          provenance: "hand-curated",
          addedAt
        }
      ])
    );

    expect(Result.isSuccess(result)).toBe(true);
  });

  it("accepts open technology-or-fuel canonicals", () => {
    const result = validateVocabularyJson(
      technologyOrFuelDescriptor,
      encodeRows([
        {
          surfaceForm: "novel synthetic fuel",
          normalizedSurfaceForm: "novel synthetic fuel",
          canonical: "novel synthetic fuel",
          provenance: "cold-start-corpus",
          addedAt
        }
      ])
    );

    expect(Result.isSuccess(result)).toBe(true);
  });

  it("rejects agent-curated entries without notes", () => {
    const result = validateVocabularyJson(
      statisticTypeDescriptor,
      encodeRows([
        {
          surfaceForm: "generation",
          normalizedSurfaceForm: "generation",
          canonical: "flow",
          provenance: "agent-curated",
          addedAt
        }
      ])
    );

    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure._tag).toBe("VocabularyLoadError");
    }
  });

  it("rejects normalization drift from the resolver normalizer", () => {
    const result = validateVocabularyJson(
      statisticTypeDescriptor,
      encodeRows([
        {
          surfaceForm: "Wind Output",
          normalizedSurfaceForm: "wind-output",
          canonical: "flow",
          provenance: "cold-start-corpus",
          addedAt
        }
      ])
    );

    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure._tag).toBe("VocabularyLoadError");
      if (result.failure._tag === "VocabularyLoadError") {
        expect(result.failure.issues[0]).toContain("resolver expects");
      }
    }
  });
});
