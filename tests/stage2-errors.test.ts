import { describe, expect, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import {
  FacetDecompositionError,
  OntologyDecodeError,
  VocabularyCollisionError,
  VocabularyLoadError
} from "../src/domain/errors";
import { PostUri } from "../src/domain/types";

const asPostUri = Schema.decodeUnknownSync(PostUri)(
  "at://did:plc:test/app.bsky.feed.post/stage2"
);

describe("Stage 2 errors", () => {
  it.effect("yields and catches OntologyDecodeError", () =>
    Effect.gen(function* () {
      const error = yield* Effect.gen(function* () {
        return yield* new OntologyDecodeError({
          source: "oeo",
          path: "references/external/oeo/oeo.ttl",
          message: "bad triple"
        });
      }).pipe(Effect.flip);

      expect(error._tag).toBe("OntologyDecodeError");

      const caught = yield* Effect.gen(function* () {
        return yield* new OntologyDecodeError({
          source: "oeo",
          path: "references/external/oeo/oeo.ttl",
          message: "bad triple"
        });
      }).pipe(
        Effect.catchTag("OntologyDecodeError", (caughtError) =>
          Effect.succeed(caughtError.path)
        )
      );

      expect(caught).toBe("references/external/oeo/oeo.ttl");
    })
  );

  it.effect("yields and catches VocabularyLoadError", () =>
    Effect.gen(function* () {
      const error = yield* Effect.gen(function* () {
        return yield* new VocabularyLoadError({
          facet: "aggregation",
          path: "references/vocabulary/aggregation.json",
          issues: ["missing canonical field"]
        });
      }).pipe(Effect.flip);

      expect(error._tag).toBe("VocabularyLoadError");

      const caught = yield* Effect.gen(function* () {
        return yield* new VocabularyLoadError({
          facet: "aggregation",
          path: "references/vocabulary/aggregation.json",
          issues: ["missing canonical field"]
        });
      }).pipe(
        Effect.catchTag("VocabularyLoadError", (caughtError) =>
          Effect.succeed(caughtError.issues)
        )
      );

      expect(caught).toEqual(["missing canonical field"]);
    })
  );

  it.effect("yields and catches VocabularyCollisionError", () =>
    Effect.gen(function* () {
      const error = yield* Effect.gen(function* () {
        return yield* new VocabularyCollisionError({
          facet: "unitFamily",
          normalizedSurfaceForm: "mw",
          canonicalA: "power",
          canonicalB: "energy"
        });
      }).pipe(Effect.flip);

      expect(error._tag).toBe("VocabularyCollisionError");

      const caught = yield* Effect.gen(function* () {
        return yield* new VocabularyCollisionError({
          facet: "unitFamily",
          normalizedSurfaceForm: "mw",
          canonicalA: "power",
          canonicalB: "energy"
        });
      }).pipe(
        Effect.catchTag("VocabularyCollisionError", (caughtError) =>
          Effect.succeed(caughtError.normalizedSurfaceForm)
        )
      );

      expect(caught).toBe("mw");
    })
  );

  it.effect("yields and catches FacetDecompositionError", () =>
    Effect.gen(function* () {
      const error = yield* Effect.gen(function* () {
        return yield* new FacetDecompositionError({
          postUri: asPostUri,
          reason: "lane dispatch failed"
        });
      }).pipe(Effect.flip);

      expect(error._tag).toBe("FacetDecompositionError");

      const caught = yield* Effect.gen(function* () {
        return yield* new FacetDecompositionError({
          postUri: asPostUri,
          reason: "lane dispatch failed"
        });
      }).pipe(
        Effect.catchTag("FacetDecompositionError", (caughtError) =>
          Effect.succeed(caughtError.reason)
        )
      );

      expect(caught).toBe("lane dispatch failed");
    })
  );
});
