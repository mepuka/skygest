import { describe, expect, it } from "@effect/vitest";
import { Effect, Result, Schema } from "effect";
import {
  checkedInDataLayerRegistryRoot,
  loadCheckedInDataLayerRegistry
} from "../src/bootstrap/CheckedInDataLayerRegistry";
import type { DataLayerRegistrySeed } from "../src/domain/data-layer/registry";
import {
  makeAgentId,
  makeDatasetId,
  makeVariableId
} from "../src/domain/data-layer/ids";
import {
  ResolutionEvidenceBundle,
  ResolutionOutcome
} from "../src/domain/resolutionKernel";
import { prepareDataLayerRegistry, toDataLayerRegistryLookup } from "../src/resolution/dataLayerRegistry";
import { FacetVocabulary } from "../src/resolution/facetVocabulary";
import { bindHypothesis } from "../src/resolution/kernel/Bind";
import { interpretBundle } from "../src/resolution/kernel/Interpret";
import { resolveBundle } from "../src/resolution/kernel/ResolutionKernel";
import { layer as localFileSystemLayer } from "./helpers/LocalFileSystem";

const decodeBundle = Schema.decodeUnknownSync(ResolutionEvidenceBundle);
const decodeOutcome = Schema.decodeUnknownSync(ResolutionOutcome);

const ISO = "2026-04-09T00:00:00.000Z" as const;

const agentAId = makeAgentId("https://id.skygest.io/agent/ag_1234567890AB");
const agentBId = makeAgentId("https://id.skygest.io/agent/ag_ABCDEFGHIJKL");
const agentCId = makeAgentId("https://id.skygest.io/agent/ag_MNOPQRSTUVWX");
const datasetAId = makeDatasetId("https://id.skygest.io/dataset/ds_1234567890AB");
const datasetBId = makeDatasetId("https://id.skygest.io/dataset/ds_ABCDEFGHIJKL");
const datasetCId = makeDatasetId("https://id.skygest.io/dataset/ds_MNOPQRSTUVWX");
const windVariableAId = makeVariableId("https://id.skygest.io/variable/var_1234567890AB");
const windVariableBId = makeVariableId("https://id.skygest.io/variable/var_ABCDEFGHIJKL");
const solarVariableId = makeVariableId("https://id.skygest.io/variable/var_MNOPQRSTUVWX");
const datasetDId = makeDatasetId("https://id.skygest.io/dataset/ds_QRSTUVWXYZ12");
const datasetEId = makeDatasetId("https://id.skygest.io/dataset/ds_ZYXWVUTSRQ98");
const specificWindVariableId = makeVariableId("https://id.skygest.io/variable/var_QRSTUVWXYZ12");
const genericWindVariableId = makeVariableId("https://id.skygest.io/variable/var_ZYXWVUTSRQ98");

const makeCustomLookup = (seed: DataLayerRegistrySeed) => {
  const prepared = prepareDataLayerRegistry(seed);
  if (Result.isFailure(prepared)) {
    throw new Error("expected custom registry seed to prepare successfully");
  }

  return toDataLayerRegistryLookup(prepared.success);
};

const customRegistryLookup = makeCustomLookup({
  agents: [
    {
      _tag: "Agent",
      id: agentAId,
      kind: "organization",
      name: "Energy Information Administration",
      alternateNames: ["EIA"],
      homepage: "https://www.eia.gov/" as any,
      aliases: [],
      createdAt: ISO as any,
      updatedAt: ISO as any
    },
    {
      _tag: "Agent",
      id: agentBId,
      kind: "organization",
      name: "International Energy Agency",
      alternateNames: ["IEA"],
      homepage: "https://www.iea.org/" as any,
      aliases: [],
      createdAt: ISO as any,
      updatedAt: ISO as any
    },
    {
      _tag: "Agent",
      id: agentCId,
      kind: "organization",
      name: "California ISO",
      alternateNames: ["CAISO"],
      homepage: "https://www.caiso.com/" as any,
      aliases: [],
      createdAt: ISO as any,
      updatedAt: ISO as any
    }
  ],
  catalogs: [],
  catalogRecords: [],
  datasets: [
    {
      _tag: "Dataset",
      id: datasetAId,
      title: "EIA wind generation",
      publisherAgentId: agentAId,
      aliases: [],
      distributionIds: [],
      variableIds: [windVariableAId],
      createdAt: ISO as any,
      updatedAt: ISO as any
    },
    {
      _tag: "Dataset",
      id: datasetBId,
      title: "IEA wind generation",
      publisherAgentId: agentBId,
      aliases: [],
      distributionIds: [],
      variableIds: [windVariableBId],
      createdAt: ISO as any,
      updatedAt: ISO as any
    },
    {
      _tag: "Dataset",
      id: datasetCId,
      title: "Solar generation",
      publisherAgentId: agentAId,
      aliases: [],
      distributionIds: [],
      variableIds: [solarVariableId],
      createdAt: ISO as any,
      updatedAt: ISO as any
    }
  ],
  distributions: [],
  dataServices: [],
  datasetSeries: [],
  variables: [
    {
      _tag: "Variable",
      id: windVariableAId,
      label: "EIA wind electricity generation",
      aliases: [],
      measuredProperty: "generation",
      domainObject: "electricity",
      technologyOrFuel: "wind",
      statisticType: "flow",
      unitFamily: "energy",
      createdAt: ISO as any,
      updatedAt: ISO as any
    },
    {
      _tag: "Variable",
      id: windVariableBId,
      label: "IEA wind electricity generation",
      aliases: [],
      measuredProperty: "generation",
      domainObject: "electricity",
      technologyOrFuel: "wind",
      statisticType: "flow",
      unitFamily: "energy",
      createdAt: ISO as any,
      updatedAt: ISO as any
    },
    {
      _tag: "Variable",
      id: solarVariableId,
      label: "Solar electricity generation",
      aliases: [],
      measuredProperty: "generation",
      domainObject: "electricity",
      technologyOrFuel: "solar PV",
      statisticType: "flow",
      unitFamily: "energy",
      createdAt: ISO as any,
      updatedAt: ISO as any
    }
  ],
  series: []
});

const mixedRegistryLookup = makeCustomLookup({
  agents: [
    {
      _tag: "Agent",
      id: agentAId,
      kind: "organization",
      name: "Energy Information Administration",
      alternateNames: ["EIA"],
      homepage: "https://www.eia.gov/" as any,
      aliases: [],
      createdAt: ISO as any,
      updatedAt: ISO as any
    }
  ],
  catalogs: [],
  catalogRecords: [],
  datasets: [
    {
      _tag: "Dataset",
      id: datasetAId,
      title: "Wind generation",
      publisherAgentId: agentAId,
      aliases: [],
      distributionIds: [],
      variableIds: [windVariableAId],
      createdAt: ISO as any,
      updatedAt: ISO as any
    },
    {
      _tag: "Dataset",
      id: datasetCId,
      title: "Solar generation",
      publisherAgentId: agentAId,
      aliases: [],
      distributionIds: [],
      variableIds: [solarVariableId],
      createdAt: ISO as any,
      updatedAt: ISO as any
    }
  ],
  distributions: [],
  dataServices: [],
  datasetSeries: [],
  variables: [
    {
      _tag: "Variable",
      id: windVariableAId,
      label: "Wind electricity generation",
      aliases: [],
      measuredProperty: "generation",
      domainObject: "electricity",
      technologyOrFuel: "wind",
      statisticType: "flow",
      unitFamily: "energy",
      createdAt: ISO as any,
      updatedAt: ISO as any
    },
    {
      _tag: "Variable",
      id: solarVariableId,
      label: "Solar electricity generation",
      aliases: [],
      measuredProperty: "generation",
      domainObject: "electricity",
      technologyOrFuel: "solar PV",
      statisticType: "flow",
      unitFamily: "energy",
      createdAt: ISO as any,
      updatedAt: ISO as any
    }
  ],
  series: []
});

const rankingRegistryLookup = makeCustomLookup({
  agents: [
    {
      _tag: "Agent",
      id: agentAId,
      kind: "organization",
      name: "Energy Information Administration",
      alternateNames: ["EIA"],
      homepage: "https://www.eia.gov/" as any,
      aliases: [],
      createdAt: ISO as any,
      updatedAt: ISO as any
    }
  ],
  catalogs: [],
  catalogRecords: [],
  datasets: [
    {
      _tag: "Dataset",
      id: datasetDId,
      title: "Specific wind generation",
      publisherAgentId: agentAId,
      aliases: [],
      distributionIds: [],
      variableIds: [specificWindVariableId],
      createdAt: ISO as any,
      updatedAt: ISO as any
    },
    {
      _tag: "Dataset",
      id: datasetEId,
      title: "Generic wind flow",
      publisherAgentId: agentAId,
      aliases: [],
      distributionIds: [],
      variableIds: [genericWindVariableId],
      createdAt: ISO as any,
      updatedAt: ISO as any
    }
  ],
  distributions: [],
  dataServices: [],
  datasetSeries: [],
  variables: [
    {
      _tag: "Variable",
      id: specificWindVariableId,
      label: "A specific wind electricity generation variable",
      aliases: [],
      measuredProperty: "generation",
      domainObject: "electricity",
      technologyOrFuel: "wind",
      statisticType: "flow",
      unitFamily: "energy",
      createdAt: ISO as any,
      updatedAt: ISO as any
    },
    {
      _tag: "Variable",
      id: genericWindVariableId,
      label: "Z generic wind flow variable",
      aliases: [],
      measuredProperty: "generation",
      technologyOrFuel: "wind",
      statisticType: "flow",
      createdAt: ISO as any,
      updatedAt: ISO as any
    }
  ],
  series: []
});

const customAmbiguousBundle = decodeBundle({
  postText: [],
  chartTitle: "Wind electricity generation",
  yAxis: {
    label: "Generation",
    unit: "TWh"
  },
  series: [],
  keyFindings: [],
  sourceLines: [],
  publisherHints: []
});

describe("resolveBundle", () => {
  it.effect("refuses to bind the heat-pump post when only narrative evidence is present", () =>
    Effect.gen(function* () {
      const vocabulary = yield* FacetVocabulary;
      const prepared = yield* loadCheckedInDataLayerRegistry(
        checkedInDataLayerRegistryRoot
      );
      const lookup = toDataLayerRegistryLookup(prepared);

      // Post-text is narrative, not an identity witness for any chart. Under
      // the identity/narrative split the kernel must decline to project the
      // narrative tokens onto the shared partial, so the outcome is NoMatch
      // (the strongest possible form of "does not falsely bind").
      const outcome = decodeOutcome(
        resolveBundle(
          decodeBundle({
            postText: ["Heat pumps overtake gas in Germany's heating market"],
            series: [],
            keyFindings: [],
            sourceLines: [],
            publisherHints: []
          }),
          lookup,
          vocabulary
        )
      );

      expect(outcome._tag).toBe("NoMatch");
    }).pipe(
      Effect.provide(FacetVocabulary.layer),
      Effect.provide(localFileSystemLayer)
    ),
    15_000
  );

  it.effect("resolves a trace-style offshore wind bundle from the checked-in registry", () =>
    Effect.gen(function* () {
      const vocabulary = yield* FacetVocabulary;
      const prepared = yield* loadCheckedInDataLayerRegistry(
        checkedInDataLayerRegistryRoot
      );
      const lookup = toDataLayerRegistryLookup(prepared);

      const outcome = decodeOutcome(
        resolveBundle(
          decodeBundle({
            postUri:
              "at://did:plc:3zhdeyok4trlrd3cijz7p4e6/app.bsky.feed.post/3m7rx7sb6q22l",
            postText: [
              "25 years after Blyth, the UK keeps adding offshore wind capacity."
            ],
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
            sourceLines: [
              {
                sourceText: "Ember",
                datasetName: "Ember data"
              }
            ],
            publisherHints: [
              {
                label: "Ember"
              }
            ]
          }),
          lookup,
          vocabulary
        )
      );

      expect(outcome._tag).toBe("Resolved");
      if (outcome._tag !== "Resolved") {
        return;
      }

      expect(outcome.items).toHaveLength(1);
      expect(outcome.items[0]?._tag).toBe("bound");
      if (outcome.items[0]?._tag !== "bound") {
        return;
      }

      expect(outcome.items[0].variableId).toBe(
        makeVariableId("https://id.skygest.io/variable/var_01KNQEZ5WM6DKQ71AGT8CVF53B")
      );
      expect(outcome.items[0].label).toBe("Installed offshore wind capacity");
    }).pipe(
      Effect.provide(FacetVocabulary.layer),
      Effect.provide(localFileSystemLayer)
    ),
    15_000
  );

  it.effect("retracts shared-level facets when an item specifies them", () =>
    Effect.gen(function* () {
      const vocabulary = yield* FacetVocabulary;
      const prepared = yield* loadCheckedInDataLayerRegistry(
        checkedInDataLayerRegistryRoot
      );
      const lookup = toDataLayerRegistryLookup(prepared);

      // Shared partial (from chart title "Wind generation") carries
      // technologyOrFuel=wind. The series label "Offshore wind" resolves to
      // technologyOrFuel=offshore_wind, which conflicts with the shared value.
      // Under the retraction join, the item is strictly more specific, so the
      // shared value is retracted before the join and no conflict is produced.
      const outcome = decodeOutcome(
        resolveBundle(
          decodeBundle({
            postText: [],
            chartTitle: "Wind generation",
            series: [
              {
                itemKey: "offshore",
                legendLabel: "Offshore wind",
                unit: "GW"
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

      // Retraction must prevent the shared↔item join from failing, so the
      // outcome cannot be Conflicted on this input, and no item gap can
      // report required-facet-conflict.
      expect(outcome._tag).not.toBe("Conflicted");

      const items =
        outcome._tag === "Resolved"
          ? outcome.items
          : outcome._tag === "Ambiguous"
            ? outcome.items
            : outcome._tag === "OutOfRegistry"
              ? outcome.items
              : [];
      expect(items.length).toBeGreaterThan(0);
      for (const item of items) {
        if (item._tag === "gap") {
          expect(item.reason).not.toBe("required-facet-conflict");
        }
      }
      // The retracted shared partial (generation, flow) joined with the
      // item partial (offshore wind, power) must yield a semantic partial
      // carrying the more-specific technologyOrFuel value.
      expect(items[0]?.semanticPartial.technologyOrFuel).toBe("offshore wind");
    }).pipe(
      Effect.provide(FacetVocabulary.layer),
      Effect.provide(localFileSystemLayer)
    ),
    15_000
  );

  it.effect("ignores a disagreeing publisher hint because narrative sources do not project onto identity", () =>
    Effect.gen(function* () {
      const vocabulary = yield* FacetVocabulary;

      const outcome = decodeOutcome(
        resolveBundle(
          decodeBundle({
            postText: [],
            chartTitle: "Wind electricity generation",
            yAxis: {
              label: "Generation",
              unit: "TWh"
            },
            series: [],
            keyFindings: [],
            sourceLines: [],
            publisherHints: [
              {
                label: "Solar"
              }
            ]
          }),
          mixedRegistryLookup,
          vocabulary
        )
      );

      expect(outcome._tag).toBe("Resolved");
      if (outcome._tag !== "Resolved") {
        return;
      }

      // Publisher hints are narrative and never touch the shared partial, so
      // the fold never sees a conflict and the interpretation remains an
      // entailment of the chart-title identity.
      expect(outcome.tier).toBe("entailment");
      expect(outcome.items[0]?._tag).toBe("bound");
      if (outcome.items[0]?._tag !== "bound") {
        return;
      }

      expect(outcome.items[0].variableId).toBe(windVariableAId);
    }).pipe(Effect.provide(FacetVocabulary.layer)),
    15_000
  );

  it.effect("does not leak technologyOrFuel from key-findings into the shared partial", () =>
    Effect.gen(function* () {
      const vocabulary = yield* FacetVocabulary;

      // Mirrors the 005-klstone evidence bundle: chart title is generic
      // electricity generation, but a key-finding mentions wind as the
      // leading source. Under the identity/narrative split, `wind` is
      // narrative and must not end up in the shared partial.
      //
      // We assert directly on the interpret step's hypothesis rather than
      // going through resolveBundle so the invariant is tested unconditionally
      // — otherwise a regression to Underspecified/Ambiguous/OutOfRegistry
      // would silently skip the assertion in the previous Resolved-only guard.
      const bundle = decodeBundle({
        postText: [],
        chartTitle: "Public net electricity generation in Germany",
        series: [],
        keyFindings: [
          "Wind power was the leading source of generation, with Wind Onshore contributing 33.6%"
        ],
        sourceLines: [],
        publisherHints: []
      });

      const interpreted = interpretBundle(bundle, vocabulary);

      expect(interpreted._tag).toBe("Hypothesis");
      if (interpreted._tag !== "Hypothesis") {
        return;
      }

      expect(interpreted.hypothesis.sharedPartial.technologyOrFuel).toBeUndefined();
      for (const item of interpreted.hypothesis.items) {
        expect(item.partial.technologyOrFuel).toBeUndefined();
      }
    }).pipe(Effect.provide(FacetVocabulary.layer)),
    15_000
  );

  it.effect("returns Underspecified with a preserved gap when required facets are missing", () =>
    Effect.gen(function* () {
      const vocabulary = yield* FacetVocabulary;
      const prepared = yield* loadCheckedInDataLayerRegistry(
        checkedInDataLayerRegistryRoot
      );
      const lookup = toDataLayerRegistryLookup(prepared);

      const outcome = decodeOutcome(
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
      expect(outcome.gap.reason).toBe("missing-required");
      expect(outcome.gaps).toHaveLength(1);
      expect(outcome.gap.candidates.length).toBeGreaterThan(0);
    }).pipe(
      Effect.provide(FacetVocabulary.layer),
      Effect.provide(localFileSystemLayer)
    ),
    15_000
  );

  it.effect("preserves every underspecified item gap instead of collapsing to the first series", () =>
    Effect.gen(function* () {
      const vocabulary = yield* FacetVocabulary;

      const outcome = decodeOutcome(
        resolveBundle(
          decodeBundle({
            postText: [],
            chartTitle: "Electricity",
            series: [
              {
                itemKey: "solar",
                legendLabel: "Solar"
              },
              {
                itemKey: "wind",
                legendLabel: "Wind"
              }
            ],
            keyFindings: [],
            sourceLines: [],
            publisherHints: []
          }),
          mixedRegistryLookup,
          vocabulary
        )
      );

      expect(outcome._tag).toBe("Underspecified");
      if (outcome._tag !== "Underspecified") {
        return;
      }

      expect(outcome.partial).toEqual({
        domainObject: "electricity"
      });
      expect(outcome.missingRequired).toEqual([
        "measuredProperty",
        "statisticType"
      ]);
      expect(outcome.gaps).toHaveLength(2);
      expect(
        outcome.gaps.map((gap) => gap.partial.technologyOrFuel).sort()
      ).toEqual(["solar PV", "wind"]);
    }).pipe(Effect.provide(FacetVocabulary.layer)),
    15_000
  );

  it.effect("returns OutOfRegistry with nearest misses for a resolvable bundle that has no matching variable", () =>
    Effect.gen(function* () {
      const vocabulary = yield* FacetVocabulary;
      const prepared = yield* loadCheckedInDataLayerRegistry(
        checkedInDataLayerRegistryRoot
      );
      const lookup = toDataLayerRegistryLookup(prepared);

      const outcome = decodeOutcome(
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
      expect(outcome.items[0]?._tag).toBe("gap");
      expect(outcome.gap.reason).toBe("no-candidates");
      expect(outcome.gap.candidates.length).toBeGreaterThan(0);
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

      const outcome = decodeOutcome(
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
      expect(outcome.items.every((item) => item._tag === "bound")).toBe(true);
      expect(outcome.items.map((item) => item.itemKey)).toEqual([
        "solar",
        "wind"
      ]);
    }).pipe(
      Effect.provide(FacetVocabulary.layer),
      Effect.provide(localFileSystemLayer)
    ),
    15_000
  );

  it.effect("preserves mixed multi-topic results as Ambiguous with bound and gap items", () =>
    Effect.gen(function* () {
      const vocabulary = yield* FacetVocabulary;

      const outcome = decodeOutcome(
        resolveBundle(
          decodeBundle({
            postText: [],
            chartTitle: "Electricity generation",
            yAxis: {
              label: "Generation",
              unit: "TWh"
            },
            series: [
              {
                itemKey: "wind",
                legendLabel: "Wind",
                unit: "TWh"
              },
              {
                itemKey: "solar",
                legendLabel: "Solar",
                unit: "TWh"
              },
              {
                itemKey: "hydro",
                legendLabel: "Hydro",
                unit: "TWh"
              }
            ],
            keyFindings: [],
            sourceLines: [],
            publisherHints: []
          }),
          mixedRegistryLookup,
          vocabulary
        )
      );

      expect(outcome._tag).toBe("Ambiguous");
      if (outcome._tag !== "Ambiguous") {
        return;
      }

      expect(outcome.items.map((item) => item._tag)).toEqual([
        "bound",
        "bound",
        "gap"
      ]);
      expect(outcome.gaps).toHaveLength(1);
      expect(outcome.gaps[0]?.reason).toBe("ambiguous-candidates");
    }).pipe(Effect.provide(FacetVocabulary.layer)),
    15_000
  );

  it.effect("returns Ambiguous with ranked candidates when multiple variables remain in scope", () =>
    Effect.gen(function* () {
      const vocabulary = yield* FacetVocabulary;

      const outcome = decodeOutcome(
        resolveBundle(customAmbiguousBundle, customRegistryLookup, vocabulary)
      );

      expect(outcome._tag).toBe("Ambiguous");
      if (outcome._tag !== "Ambiguous") {
        return;
      }

      expect(outcome.items).toHaveLength(1);
      expect(outcome.items[0]?._tag).toBe("gap");
      if (outcome.items[0]?._tag !== "gap") {
        return;
      }

      expect(outcome.items[0].reason).toBe("ambiguous-candidates");
      expect(outcome.items[0].candidates.map((candidate) => candidate.label)).toEqual([
        "EIA wind electricity generation",
        "IEA wind electricity generation"
      ]);
    }).pipe(Effect.provide(FacetVocabulary.layer)),
    15_000
  );

  it("prefers the better subsumption ratio before falling back to label order", () => {
    const bound = bindHypothesis(
      {
        sharedPartial: {
          measuredProperty: "generation",
          technologyOrFuel: "wind",
          statisticType: "flow"
        },
        attachedContext: {},
        items: [
          {
            itemKey: "wind",
            partial: {},
            evidence: []
          }
        ],
        evidence: []
      },
      rankingRegistryLookup
    );

    expect(bound.items[0]?._tag).toBe("gap");
    if (bound.items[0]?._tag !== "gap") {
      return;
    }

    expect(bound.items[0].reason).toBe("ambiguous-candidates");
    expect(bound.items[0].candidates.map((candidate) => candidate.label)).toEqual([
      "Z generic wind flow variable",
      "A specific wind electricity generation variable"
    ]);
  });

  it.effect("uses agent narrowing to resolve an otherwise ambiguous candidate set", () =>
    Effect.gen(function* () {
      const vocabulary = yield* FacetVocabulary;

      const outcome = decodeOutcome(
        resolveBundle(customAmbiguousBundle, customRegistryLookup, vocabulary, {
          agentId: agentAId
        })
      );

      expect(outcome._tag).toBe("Resolved");
      if (outcome._tag !== "Resolved") {
        return;
      }

      expect(outcome.items[0]?._tag).toBe("bound");
      if (outcome.items[0]?._tag !== "bound") {
        return;
      }

      expect(outcome.items[0].variableId).toBe(windVariableAId);
    }).pipe(Effect.provide(FacetVocabulary.layer)),
    15_000
  );

  it.effect("applies agent narrowing even when only one compatible candidate remains", () =>
    Effect.gen(function* () {
      const vocabulary = yield* FacetVocabulary;

      const outcome = decodeOutcome(
        resolveBundle(
          decodeBundle({
            postText: [],
            chartTitle: "Solar electricity generation",
            yAxis: {
              label: "Generation",
              unit: "TWh"
            },
            series: [],
            keyFindings: [],
            sourceLines: [],
            publisherHints: []
          }),
          customRegistryLookup,
          vocabulary,
          {
            agentId: agentBId
          }
        )
      );

      expect(outcome._tag).toBe("OutOfRegistry");
      if (outcome._tag !== "OutOfRegistry") {
        return;
      }

      expect(outcome.gap.reason).toBe("agent-scope-empty");
      expect(outcome.gap.candidates.map((candidate) => candidate.label)).toEqual([
        "Solar electricity generation"
      ]);
    }).pipe(Effect.provide(FacetVocabulary.layer)),
    15_000
  );

  it.effect("returns OutOfRegistry with an agent-scope-empty gap when narrowing removes every candidate", () =>
    Effect.gen(function* () {
      const vocabulary = yield* FacetVocabulary;

      const outcome = decodeOutcome(
        resolveBundle(customAmbiguousBundle, customRegistryLookup, vocabulary, {
          agentId: agentCId
        })
      );

      expect(outcome._tag).toBe("OutOfRegistry");
      if (outcome._tag !== "OutOfRegistry") {
        return;
      }

      expect(outcome.gap.reason).toBe("agent-scope-empty");
      expect(outcome.gap.candidates.map((candidate) => candidate.label)).toEqual([
        "EIA wind electricity generation",
        "IEA wind electricity generation"
      ]);
    }).pipe(Effect.provide(FacetVocabulary.layer)),
    15_000
  );

  it.effect("keeps the strongest series-label technology match explicit until cartesian fanout lands", () =>
    Effect.gen(function* () {
      const vocabulary = yield* FacetVocabulary;

      const outcome = decodeOutcome(
        resolveBundle(
          decodeBundle({
            postText: [],
            chartTitle: "Electricity generation",
            yAxis: {
              label: "Generation",
              unit: "TWh"
            },
            series: [
              {
                itemKey: "hybrid",
                legendLabel: "Wind and solar",
                unit: "TWh"
              }
            ],
            keyFindings: [],
            sourceLines: [],
            publisherHints: []
          }),
          mixedRegistryLookup,
          vocabulary
        )
      );

      expect(outcome._tag).toBe("Resolved");
      if (outcome._tag !== "Resolved") {
        return;
      }

      expect(outcome.items[0]?._tag).toBe("bound");
      if (outcome.items[0]?._tag !== "bound") {
        return;
      }

      expect(outcome.items[0].variableId).toBe(solarVariableId);
    }).pipe(Effect.provide(FacetVocabulary.layer)),
    15_000
  );

  it.effect("lets stronger-precedence evidence dominate a weaker-precedence required-facet conflict", () =>
    Effect.gen(function* () {
      const vocabulary = yield* FacetVocabulary;
      const prepared = yield* loadCheckedInDataLayerRegistry(
        checkedInDataLayerRegistryRoot
      );
      const lookup = toDataLayerRegistryLookup(prepared);

      // y-axis (precedence 2) fires first with measuredProperty=capacity, while
      // chart-title (precedence 3) would emit measuredProperty=generation. Under
      // the evidence-precedence rule the weaker chart-title assignment is
      // dropped with a tier downgrade rather than hard-conflicting — the eval
      // gold set relies on this because real posts routinely mention a
      // secondary measuredProperty in lower-precedence evidence.
      const outcome = decodeOutcome(
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

      expect(outcome._tag).not.toBe("Conflicted");
      if (outcome._tag === "Conflicted") {
        return;
      }

      // The fold keeps y-axis's capacity and drops chart-title's generation.
      // The expected outcome depends on whether the registry has a variable
      // compatible with {measuredProperty=capacity, unitFamily=power}, but
      // regardless the fold must NOT fork into hypotheses.
      if (outcome._tag === "Resolved") {
        for (const item of outcome.items) {
          if (item._tag !== "bound") {
            continue;
          }
          expect(item.semanticPartial.measuredProperty).toBe("capacity");
        }
      }

      if (outcome._tag === "Underspecified" || outcome._tag === "Ambiguous") {
        expect(outcome.tier).toBe("weak-heuristic");
      }
    }).pipe(
      Effect.provide(FacetVocabulary.layer),
      Effect.provide(localFileSystemLayer)
    ),
    15_000
  );

  it.effect("returns Conflicted when same-precedence identity evidence disagrees on a required facet", () =>
    Effect.gen(function* () {
      const vocabulary = yield* FacetVocabulary;
      const prepared = yield* loadCheckedInDataLayerRegistry(
        checkedInDataLayerRegistryRoot
      );
      const lookup = toDataLayerRegistryLookup(prepared);

      // Both sites come from `x-axis` (one from the label, one from the
      // unit string), so they share a precedence index. Neither can
      // dominate the other, and the fold must surface the real conflict.
      const outcome = decodeOutcome(
        resolveBundle(
          decodeBundle({
            postText: [],
            xAxis: {
              label: "Electricity generation",
              unit: "Capacity in MW"
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
      expect(outcome.gaps).toHaveLength(2);
      expect(outcome.gaps.every((gap) => gap.reason === "required-facet-conflict")).toBe(true);
    }).pipe(
      Effect.provide(FacetVocabulary.layer),
      Effect.provide(localFileSystemLayer)
    ),
    15_000
  );

  it.effect("emits a live NoMatch outcome for an empty evidence bundle", () =>
    Effect.gen(function* () {
      const vocabulary = yield* FacetVocabulary;

      const outcome = decodeOutcome(
        resolveBundle(
          decodeBundle({
            postText: [],
            series: [],
            keyFindings: [],
            sourceLines: [],
            publisherHints: []
          }),
          customRegistryLookup,
          vocabulary
        )
      );

      expect(outcome).toEqual({
        _tag: "NoMatch",
        bundle: {
          keyFindings: [],
          postText: [],
          publisherHints: [],
          series: [],
          sourceLines: []
        },
        reason: "No usable semantic evidence"
      });
    }).pipe(Effect.provide(FacetVocabulary.layer)),
    15_000
  );
});
