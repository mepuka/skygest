import { describe, expect, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import {
  checkedInDataLayerRegistryRoot,
  loadCheckedInDataLayerRegistry
} from "../src/bootstrap/CheckedInDataLayerRegistry";
import { ResolutionEvidenceBundle, ResolutionOutcome } from "../src/domain/resolutionKernel";
import { makeVariableId } from "../src/domain/data-layer/ids";
import { FacetVocabulary } from "../src/resolution/facetVocabulary";
import { resolveBundle } from "../src/resolution/kernel/ResolutionKernel";
import { toDataLayerRegistryLookup } from "../src/resolution/dataLayerRegistry";
import { layer as localFileSystemLayer } from "./helpers/LocalFileSystem";

const decodeBundle = Schema.decodeUnknownSync(ResolutionEvidenceBundle);
const decodeOutcome = Schema.decodeUnknownSync(ResolutionOutcome);

const expectOutcome = (input: unknown) => decodeOutcome(input);

describe("resolveBundle", () => {
  it.effect("resolves a real checked-in offshore wind variable from one bundle", () =>
    Effect.gen(function* () {
      const vocabulary = yield* FacetVocabulary;
      const prepared = yield* loadCheckedInDataLayerRegistry(
        checkedInDataLayerRegistryRoot
      );
      const lookup = toDataLayerRegistryLookup(prepared);

      const outcome = expectOutcome(
        resolveBundle(
          decodeBundle({
            postText: ["Europe added more offshore wind last year"],
            chartTitle: "Year-end installed offshore wind capacity",
            yAxis: {
              label: "Capacity",
              unit: "MW"
            },
            series: [
              {
                itemKey: "offshore-wind",
                legendLabel: "Offshore wind",
                unit: "MW"
              }
            ],
            keyFindings: [],
            sourceLines: [],
            publisherHints: []
          }),
          lookup,
          vocabulary
        )
      );

      expect(outcome._tag).toBe("Resolved");
      if (outcome._tag !== "Resolved") {
        return;
      }

      expect(outcome.tier).toBe("entailment");
      expect(outcome.items).toHaveLength(1);
      expect(outcome.items[0]?.variableId).toBe(
        makeVariableId("https://id.skygest.io/variable/var_01KNQEZ5WM6DKQ71AGT8CVF53B")
      );
      expect(outcome.items[0]?.label).toBe("Installed offshore wind capacity");
    }).pipe(
      Effect.provide(FacetVocabulary.layer),
      Effect.provide(localFileSystemLayer)
    ),
    15_000
  );

  it.effect("returns Underspecified when the bundle has technology and units but no semantic measure", () =>
    Effect.gen(function* () {
      const vocabulary = yield* FacetVocabulary;
      const prepared = yield* loadCheckedInDataLayerRegistry(
        checkedInDataLayerRegistryRoot
      );
      const lookup = toDataLayerRegistryLookup(prepared);

      const outcome = expectOutcome(
        resolveBundle(
          decodeBundle({
            postText: [],
            chartTitle: "Offshore wind by region",
            yAxis: {
              label: "MW",
              unit: "MW"
            },
            series: [
              {
                itemKey: "offshore-wind",
                legendLabel: "Offshore wind",
                unit: "MW"
              }
            ],
            keyFindings: [],
            sourceLines: [],
            publisherHints: []
          }),
          lookup,
          vocabulary
        )
      );

      expect(outcome._tag).toBe("Underspecified");
      if (outcome._tag !== "Underspecified") {
        return;
      }

      expect(outcome.partial.technologyOrFuel).toBe("offshore wind");
      expect(outcome.missingRequired).toContain("measuredProperty");
      expect(outcome.missingRequired).toContain("statisticType");
    }).pipe(
      Effect.provide(FacetVocabulary.layer),
      Effect.provide(localFileSystemLayer)
    ),
    15_000
  );

  it.effect("returns OutOfRegistry for a resolvable bundle with no matching cold-start variable", () =>
    Effect.gen(function* () {
      const vocabulary = yield* FacetVocabulary;
      const prepared = yield* loadCheckedInDataLayerRegistry(
        checkedInDataLayerRegistryRoot
      );
      const lookup = toDataLayerRegistryLookup(prepared);

      const outcome = expectOutcome(
        resolveBundle(
          decodeBundle({
            postText: [],
            chartTitle: "Year-end installed tidal capacity",
            yAxis: {
              label: "Capacity",
              unit: "MW"
            },
            series: [
              {
                itemKey: "tidal",
                legendLabel: "Tidal",
                unit: "MW"
              }
            ],
            keyFindings: [],
            sourceLines: [],
            publisherHints: []
          }),
          lookup,
          vocabulary
        )
      );

      expect(outcome._tag).toBe("OutOfRegistry");
      if (outcome._tag !== "OutOfRegistry") {
        return;
      }

      expect(outcome.items).toHaveLength(1);
      expect(outcome.items[0]?.semanticPartial.technologyOrFuel).toBe("marine");
      expect(outcome.items[0]?.variableId).toBeUndefined();
    }).pipe(
      Effect.provide(FacetVocabulary.layer),
      Effect.provide(localFileSystemLayer)
    ),
    15_000
  );

  it.effect("resolves a multi-series chart into one bound item per series", () =>
    Effect.gen(function* () {
      const vocabulary = yield* FacetVocabulary;
      const prepared = yield* loadCheckedInDataLayerRegistry(
        checkedInDataLayerRegistryRoot
      );
      const lookup = toDataLayerRegistryLookup(prepared);

      const outcome = expectOutcome(
        resolveBundle(
          decodeBundle({
            postText: [],
            chartTitle: "EU electricity generation",
            yAxis: {
              label: "Generation",
              unit: "TWh"
            },
            series: [
              {
                itemKey: "solar",
                legendLabel: "Solar",
                unit: "TWh"
              },
              {
                itemKey: "wind",
                legendLabel: "Wind",
                unit: "TWh"
              }
            ],
            keyFindings: [],
            sourceLines: [],
            publisherHints: []
          }),
          lookup,
          vocabulary
        )
      );

      expect(outcome._tag).toBe("Resolved");
      if (outcome._tag !== "Resolved") {
        return;
      }

      expect(outcome.items).toHaveLength(2);
      expect(outcome.items.map((item) => item.itemKey)).toEqual([
        "solar",
        "wind"
      ]);
      expect(outcome.items.map((item) => item.label)).toEqual([
        "Solar electricity generation",
        "Wind electricity generation"
      ]);
    }).pipe(
      Effect.provide(FacetVocabulary.layer),
      Effect.provide(localFileSystemLayer)
    ),
    15_000
  );

  it.effect("returns Ambiguous when the bundle conveys a coherent but non-unique variable", () =>
    Effect.gen(function* () {
      const vocabulary = yield* FacetVocabulary;
      const prepared = yield* loadCheckedInDataLayerRegistry(
        checkedInDataLayerRegistryRoot
      );
      const lookup = toDataLayerRegistryLookup(prepared);

      const outcome = expectOutcome(
        resolveBundle(
          decodeBundle({
            postText: [],
            chartTitle: "Electricity generation",
            yAxis: {
              label: "Generation",
              unit: "TWh"
            },
            series: [],
            keyFindings: [],
            sourceLines: [],
            publisherHints: []
          }),
          lookup,
          vocabulary
        )
      );

      expect(outcome._tag).toBe("Ambiguous");
      if (outcome._tag !== "Ambiguous") {
        return;
      }

      expect(outcome.hypotheses).toHaveLength(1);
      expect(outcome.hypotheses[0]?.sharedPartial.measuredProperty).toBe(
        "generation"
      );
      expect(outcome.hypotheses[0]?.sharedPartial.domainObject).toBe(
        "electricity"
      );
    }).pipe(
      Effect.provide(FacetVocabulary.layer),
      Effect.provide(localFileSystemLayer)
    ),
    15_000
  );

  it.effect("returns Conflicted when required evidence disagrees across the bundle", () =>
    Effect.gen(function* () {
      const vocabulary = yield* FacetVocabulary;
      const prepared = yield* loadCheckedInDataLayerRegistry(
        checkedInDataLayerRegistryRoot
      );
      const lookup = toDataLayerRegistryLookup(prepared);

      const outcome = expectOutcome(
        resolveBundle(
          decodeBundle({
            postText: [],
            chartTitle: "Electricity generation",
            yAxis: {
              label: "Capacity",
              unit: "MW"
            },
            series: [],
            keyFindings: [],
            sourceLines: [],
            publisherHints: []
          }),
          lookup,
          vocabulary
        )
      );

      expect(outcome._tag).toBe("Conflicted");
      if (outcome._tag !== "Conflicted") {
        return;
      }

      expect(outcome.conflicts).toEqual([
        {
          facet: "measuredProperty",
          values: ["capacity", "generation"]
        }
      ]);
    }).pipe(
      Effect.provide(FacetVocabulary.layer),
      Effect.provide(localFileSystemLayer)
    ),
    15_000
  );
});
