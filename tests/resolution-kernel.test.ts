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

  it.effect("keeps higher-precedence chart semantics when a publisher hint disagrees", () =>
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

      expect(outcome.tier).toBe("strong-heuristic");
      expect(outcome.items[0]?._tag).toBe("bound");
      if (outcome.items[0]?._tag !== "bound") {
        return;
      }

      expect(outcome.items[0].variableId).toBe(windVariableAId);
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
      expect(outcome.gap.candidates.length).toBeGreaterThan(0);
    }).pipe(
      Effect.provide(FacetVocabulary.layer),
      Effect.provide(localFileSystemLayer)
    ),
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

  it.effect("returns Conflicted with preserved conflict gaps when required evidence disagrees", () =>
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
