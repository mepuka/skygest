import { describe, expect, it } from "@effect/vitest";
import { Effect, Result } from "effect";
import {
  checkedInDataLayerRegistryRoot,
  loadCheckedInDataLayerRegistry
} from "../src/bootstrap/CheckedInDataLayerRegistry";
import type { DataLayerRegistrySeed } from "../src/domain/data-layer";
import {
  makeAgentId,
  makeDatasetId,
  makeVariableId
} from "../src/domain/data-layer/ids";
import type {
  Stage1PostContext,
  Stage1Result
} from "../src/domain/stage1Resolution";
import { FacetVocabulary } from "../src/resolution/facetVocabulary";
import { runStage2 } from "../src/resolution/Stage2";
import {
  prepareDataLayerRegistry,
  toDataLayerRegistryLookup
} from "../src/resolution/dataLayerRegistry";
import { layer as localFileSystemLayer } from "./helpers/LocalFileSystem";

const iso = "2026-04-09T00:00:00.000Z" as const;

const makeSeed = (): DataLayerRegistrySeed => ({
  agents: [
    {
      _tag: "Agent",
      id: makeAgentId("https://id.skygest.io/agent/ag_1234567890AB"),
      kind: "organization",
      name: "Energy Information Administration",
      alternateNames: ["EIA"],
      aliases: [],
      createdAt: iso as any,
      updatedAt: iso as any
    }
  ],
  catalogs: [],
  catalogRecords: [],
  datasets: [
    {
      _tag: "Dataset",
      id: makeDatasetId("https://id.skygest.io/dataset/ds_1234567890AB"),
      title: "US EIA Emissions Data",
      publisherAgentId: makeAgentId("https://id.skygest.io/agent/ag_1234567890AB"),
      aliases: [],
      createdAt: iso as any,
      updatedAt: iso as any
    },
    {
      _tag: "Dataset",
      id: makeDatasetId("https://id.skygest.io/dataset/ds_ABCDEFGHIJKL"),
      title: "US EIA Capacity Data",
      publisherAgentId: makeAgentId("https://id.skygest.io/agent/ag_1234567890AB"),
      aliases: [],
      createdAt: iso as any,
      updatedAt: iso as any
    }
  ],
  distributions: [],
  dataServices: [],
  datasetSeries: [],
  variables: [
    {
      _tag: "Variable",
      id: makeVariableId("https://id.skygest.io/variable/var_1234567890AB"),
      label: "Installed offshore wind capacity",
      aliases: [],
      createdAt: iso as any,
      updatedAt: iso as any,
      technologyOrFuel: "offshore wind",
      statisticType: "stock",
      aggregation: "end_of_period",
      unitFamily: "power"
    },
    {
      _tag: "Variable",
      id: makeVariableId("https://id.skygest.io/variable/var_ABCDEFGHIJKL"),
      label: "Installed wind capacity",
      aliases: [],
      createdAt: iso as any,
      updatedAt: iso as any,
      technologyOrFuel: "wind",
      statisticType: "stock",
      aggregation: "end_of_period",
      unitFamily: "power"
    },
    {
      _tag: "Variable",
      id: makeVariableId("https://id.skygest.io/variable/var_ZYXWVUTSRQPO"),
      label: "Wind capacity benchmark",
      aliases: [],
      createdAt: iso as any,
      updatedAt: iso as any,
      technologyOrFuel: "wind",
      statisticType: "stock",
      aggregation: "end_of_period",
      unitFamily: "power"
    }
  ],
  series: []
});

const makeLookup = (seed: DataLayerRegistrySeed = makeSeed()) => {
  const prepared = prepareDataLayerRegistry(seed);
  if (Result.isFailure(prepared)) {
    throw new Error("expected prepared registry");
  }

  return toDataLayerRegistryLookup(prepared.success);
};

const makePostContext = (): Stage1PostContext => ({
  postUri: "at://did:plc:test/app.bsky.feed.post/sky-307" as any,
  text: "post text",
  links: [],
  linkCards: [],
  threadCoverage: "focus-only"
});

const makeStage1Result = (
  overrides: Partial<Stage1Result> = {}
): Stage1Result => ({
  matches: [],
  residuals: [],
  ...overrides
});

const registryLoadTimeoutMs = 30_000;

describe("runStage2", () => {
  it.effect("resolves a unique variable from facet decomposition", () =>
    Effect.gen(function* () {
      const vocabulary = yield* FacetVocabulary;
      const result = runStage2(
        makePostContext(),
        makeStage1Result({
          residuals: [
            {
              _tag: "DeferredToStage2Residual",
              source: "chart-title",
              text: "Year-end installed offshore wind energy capacity (MW)",
              reason: "needs structured decomposition"
            }
          ]
        }),
        makeLookup(),
        vocabulary
      );

      expect(result.matches).toHaveLength(1);
      expect(result.matches[0]?._tag).toBe("VariableMatch");
      expect(result.matches[0]?.evidence[0]?._tag).toBe("FacetDecompositionEvidence");
      expect(result.escalations).toHaveLength(0);
    }).pipe(Effect.provide(FacetVocabulary.layer))
  );

  it.effect("escalates tied and no-match facet decomposition cases", () =>
    Effect.gen(function* () {
      const vocabulary = yield* FacetVocabulary;
      const result = runStage2(
        makePostContext(),
        makeStage1Result({
          residuals: [
            {
              _tag: "DeferredToStage2Residual",
              source: "chart-title",
              text: "Year-end installed wind capacity (MW)",
              reason: "needs structured decomposition"
            },
            {
              _tag: "DeferredToStage2Residual",
              source: "post-text",
              text: "merit order stack",
              reason: "needs structured decomposition"
            }
          ]
        }),
        makeLookup(),
        vocabulary
      );

      expect(result.matches).toHaveLength(0);
      expect(result.escalations).toHaveLength(2);
      expect(result.escalations[0]?.candidateSet).toHaveLength(2);
      expect(result.escalations[0]?.stage2Lane).toBe("facet-decomposition");
      expect(result.escalations[1]?.candidateSet).toHaveLength(0);
      expect(result.escalations[1]?.reason).toContain("recognized no fields");
    }).pipe(Effect.provide(FacetVocabulary.layer))
  );

  it.effect("handles fuzzy, tie-breaker, no-op, and corroboration paths", () =>
    Effect.gen(function* () {
      const vocabulary = yield* FacetVocabulary;
      const result = runStage2(
        makePostContext(),
        makeStage1Result({
          matches: [
            {
              _tag: "VariableMatch",
              variableId: makeVariableId(
                "https://id.skygest.io/variable/var_1234567890AB"
              ),
              label: "Installed offshore wind capacity",
              bestRank: 1,
              evidence: []
            }
          ],
          residuals: [
            {
              _tag: "DeferredToStage2Residual",
              source: "chart-title",
              text: "Year-end installed offshore wind energy capacity (MW)",
              reason: "needs structured decomposition"
            },
            {
              _tag: "UnmatchedDatasetTitleResidual",
              datasetName: "EIA Emissions Data annual",
              normalizedTitle: "eia emissions data annual"
            },
            {
              _tag: "UnmatchedTextResidual",
              source: "post-text",
              text: "EIA Energy Information Administration",
              normalizedText: "eia energy information administration"
            },
            {
              _tag: "AmbiguousCandidatesResidual",
              grain: "Dataset",
              bestRank: 1,
              candidates: [
                {
                  entityId: makeDatasetId(
                    "https://id.skygest.io/dataset/ds_1234567890AB"
                  ),
                  label: "US EIA Emissions Data"
                },
                {
                  entityId: makeDatasetId(
                    "https://id.skygest.io/dataset/ds_ABCDEFGHIJKL"
                  ),
                  label: "US EIA Capacity Data"
                }
              ],
              evidence: []
            },
            {
              _tag: "UnmatchedUrlResidual",
              source: "post-link",
              url: "https://example.com/report",
              normalizedUrl: "example.com/report",
              hostname: "example.com"
            }
          ]
        }),
        makeLookup(),
        vocabulary
      );

      expect(result.matches.map((match) => match._tag)).toEqual([
        "DatasetMatch",
        "AgentMatch"
      ]);
      expect(result.corroborations).toHaveLength(1);
      expect(result.corroborations[0]?.matchKey.grain).toBe("Variable");
      expect(result.escalations.map((item) => item.stage2Lane)).toEqual([
        "tie-breaker",
        "no-op"
      ]);
    }).pipe(Effect.provide(FacetVocabulary.layer))
  );

  it.effect(
    "resolves a real checked-in cold-start offshore wind variable",
    () =>
      Effect.gen(function* () {
        const prepared = yield* loadCheckedInDataLayerRegistry(
          checkedInDataLayerRegistryRoot
        ).pipe(Effect.provide(localFileSystemLayer));
        const vocabulary = yield* FacetVocabulary;

        const result = runStage2(
          makePostContext(),
          makeStage1Result({
            residuals: [
              {
                _tag: "DeferredToStage2Residual",
                source: "chart-title",
                text: "Year-end installed offshore wind energy capacity (MW)",
                reason: "needs structured decomposition"
              }
            ]
          }),
          toDataLayerRegistryLookup(prepared),
          vocabulary
        );

        expect(result.matches).toHaveLength(1);
        expect(result.matches[0]?._tag).toBe("VariableMatch");
        if (result.matches[0]?._tag !== "VariableMatch") {
          throw new Error("expected VariableMatch");
        }

        expect(result.matches[0].label).toBe("Installed offshore wind capacity");
        expect(result.escalations).toHaveLength(0);
      }).pipe(Effect.provide(FacetVocabulary.layer)),
    registryLoadTimeoutMs
  );
});
