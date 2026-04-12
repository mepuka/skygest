import { describe, expect, it } from "@effect/vitest";
import { Result, Schema } from "effect";
import {
  StatisticType
} from "../src/domain/data-layer/variable";
import { buildVocabularyIndex, makeSurfaceFormEntry } from "../src/resolution/facetVocabulary/SurfaceFormEntry";

const StatisticTypeSurfaceFormEntry = makeSurfaceFormEntry(StatisticType);
const decodeStatisticTypeSurfaceFormEntry = Schema.decodeUnknownSync(
  StatisticTypeSurfaceFormEntry
);

describe("SurfaceFormEntry", () => {
  it("decodes cold-start entries without notes", () => {
    const entry = decodeStatisticTypeSurfaceFormEntry({
      surfaceForm: "generation",
      normalizedSurfaceForm: "generation",
      canonical: "flow",
      provenance: "cold-start-corpus",
      addedAt: "2026-04-11T00:00:00.000Z"
    });

    expect(entry.canonical).toBe("flow");
    expect(entry.notes).toBeUndefined();
  });

  it("decodes agent-curated entries when notes are present", () => {
    const entry = decodeStatisticTypeSurfaceFormEntry({
      surfaceForm: "output",
      normalizedSurfaceForm: "output",
      canonical: "flow",
      provenance: "agent-curated",
      notes: "reviewed against staged examples",
      addedAt: "2026-04-11T00:00:00.000Z",
      source: "operator"
    });

    expect(entry.notes).toBe("reviewed against staged examples");
  });

  it("rejects agent-curated entries without notes", () => {
    expect(() =>
      decodeStatisticTypeSurfaceFormEntry({
        surfaceForm: "generation",
        normalizedSurfaceForm: "generation",
        canonical: "flow",
        provenance: "agent-curated",
        addedAt: "2026-04-11T00:00:00.000Z"
      })
    ).toThrow();
  });

  it("rejects eval-feedback entries without notes", () => {
    expect(() =>
      decodeStatisticTypeSurfaceFormEntry({
        surfaceForm: "generation",
        normalizedSurfaceForm: "generation",
        canonical: "flow",
        provenance: "eval-feedback",
        addedAt: "2026-04-11T00:00:00.000Z"
      })
    ).toThrow();
  });

  it("returns a typed collision when duplicate normalized forms disagree", () => {
    const collision = buildVocabularyIndex("statisticType", [
      decodeStatisticTypeSurfaceFormEntry({
        surfaceForm: "generation",
        normalizedSurfaceForm: "generation",
        canonical: "flow",
        provenance: "cold-start-corpus",
        addedAt: "2026-04-11T00:00:00.000Z"
      }),
      decodeStatisticTypeSurfaceFormEntry({
        surfaceForm: "generation",
        normalizedSurfaceForm: "generation",
        canonical: "stock",
        provenance: "hand-curated",
        addedAt: "2026-04-11T00:00:00.000Z"
      })
    ]);

    expect(Result.isFailure(collision)).toBe(true);
    if (Result.isFailure(collision)) {
      expect(collision.failure._tag).toBe("VocabularyCollisionError");
      expect(collision.failure.normalizedSurfaceForm).toBe("generation");
    }
  });
});
