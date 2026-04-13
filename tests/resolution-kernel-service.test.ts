import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { checkedInDataLayerRegistryLayer } from "../src/bootstrap/CheckedInDataLayerRegistry";
import { ResolutionKernel } from "../src/resolution/ResolutionKernel";
import { FacetVocabulary } from "../src/resolution/facetVocabulary";
import { layer as localFileSystemLayer } from "./helpers/LocalFileSystem";

const kernelLayer = ResolutionKernel.layer.pipe(
  Layer.provideMerge(
    Layer.mergeAll(checkedInDataLayerRegistryLayer(), FacetVocabulary.layer)
  )
);

describe("ResolutionKernel service", () => {
  it.effect(
    "builds bundles from Stage1Input and returns one outcome per bundle",
    () =>
      Effect.gen(function* () {
        const kernel = yield* ResolutionKernel;

        const outcomes = yield* kernel.resolve({
          postContext: {
            postUri: "at://did:plc:test/app.bsky.feed.post/kernel-service",
            text: "Year-end installed offshore wind capacity (MW)",
            links: [],
            linkCards: [],
            threadCoverage: "focus-only"
          },
          vision: null,
          sourceAttribution: null
        });

        expect(outcomes).toHaveLength(1);
        expect(outcomes[0]?._tag).toBe("Resolved");
        if (outcomes[0]?._tag !== "Resolved") {
          return;
        }

        expect(outcomes[0].items[0]?.label).toBe(
          "Installed offshore wind capacity"
        );
      }).pipe(
        Effect.provide(kernelLayer),
        Effect.provide(localFileSystemLayer)
      ),
    15_000
  );
});
