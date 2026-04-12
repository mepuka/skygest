import { describe, expect, it } from "@effect/vitest";
import {
  makeDistributionId,
  makeVariableId
} from "../src/domain/data-layer/ids";
import type { Stage1EvalSnapshotRow } from "../src/domain/stage1Eval";
import type { Stage1Result } from "../src/domain/stage1Resolution";
import type { Stage2Result } from "../src/domain/stage2Resolution";
import {
  assessStage2EvalResult,
  classifyEscalationBucket,
  classifyNewMatchBuckets,
  computeLiftDetail,
  computeResidualProgression,
  emptyExpectedRefs,
  mergeStage1And2Matches
} from "../eval/resolution-stage2/shared";

const distributionId = makeDistributionId(
  "https://id.skygest.io/distribution/dist_1234567890AB"
);
const variableId = makeVariableId(
  "https://id.skygest.io/variable/var_1234567890AB"
);
const alternateVariableId = makeVariableId(
  "https://id.skygest.io/variable/var_ABCDEFGHIJKL"
);

const makeRow = (): Stage1EvalSnapshotRow =>
  ({
    slug: "001-test",
    postUri: "at://did:plc:test/app.bsky.feed.post/abc123",
    metadata: {
      handle: "tester.bsky.social",
      publisher: "eia"
    },
    postContext: {
      postUri: "at://did:plc:test/app.bsky.feed.post/abc123",
      text: "post text",
      links: [],
      linkCards: [],
      threadCoverage: "focus-only"
    },
    vision: null,
    sourceAttribution: null
  }) as unknown as Stage1EvalSnapshotRow;

const makeStage1Result = (
  overrides: Partial<Stage1Result> = {}
): Stage1Result => ({
  matches: [],
  residuals: [],
  ...overrides
});

const makeStage2Result = (
  overrides: Partial<Stage2Result> = {}
): Stage2Result => ({
  matches: [],
  corroborations: [],
  escalations: [],
  ...overrides
});

const makeMatchedSurfaceForm = (surfaceForm = "offshore wind") =>
  ({
    surfaceForm,
    normalizedSurfaceForm: surfaceForm,
    canonical: surfaceForm,
    provenance: "cold-start-corpus",
    addedAt: "2026-04-11T00:00:00.000Z"
  }) as any;

const makeGroupedFacetEvidence = (residualCount: number) =>
  ({
    _tag: "GroupedFacetDecompositionEvidence",
    signal: "grouped-facet-decomposition",
    rank: 1,
    assetKey: "chart-1",
    residualCount,
    matchedFacets: ["technologyOrFuel", "unitFamily"],
    partialShape: {
      technologyOrFuel: "offshore wind",
      unitFamily: "power"
    },
    matchedSurfaceForms: [
      makeMatchedSurfaceForm(),
      makeMatchedSurfaceForm("mw")
    ],
    facetProvenance: [
      {
        facet: "technologyOrFuel",
        source: "chart-title",
        text: "Offshore wind",
        surfaceForm: "offshore wind",
        status: "accepted"
      },
      {
        facet: "unitFamily",
        source: "axis-label",
        text: "MW",
        surfaceForm: "mw",
        status: "accepted"
      }
    ],
    contributingResiduals: [
      {
        source: "chart-title",
        text: "Offshore wind"
      },
      {
        source: "axis-label",
        text: "MW"
      }
    ]
  }) as const;

describe("stage2 eval helpers", () => {
  it("mergeStage1And2Matches combines and deduplicates ids", () => {
    const merged = mergeStage1And2Matches(
      makeStage1Result({
        matches: [
          {
            _tag: "DistributionMatch",
            distributionId,
            title: "Distribution",
            bestRank: 1,
            evidence: []
          }
        ]
      }),
      makeStage2Result({
        matches: [
          {
            _tag: "DistributionMatch",
            distributionId,
            title: "Distribution",
            bestRank: 1,
            evidence: []
          },
          {
            _tag: "VariableMatch",
            variableId,
            label: "Installed offshore wind capacity",
            bestRank: 1,
            evidence: []
          }
        ]
      })
    );

    expect(merged.distributionIds).toEqual([distributionId]);
    expect(merged.variableIds).toEqual([variableId]);
  });

  it("classifies no-facet-match escalations", () => {
    expect(
      classifyEscalationBucket({
        _tag: "Stage3Input",
        postUri: makeRow().postUri,
        originalResidual: {
          _tag: "DeferredToStage2Residual",
          source: "chart-title",
          text: "merit order stack",
          reason: "needs structured decomposition"
        },
        stage2Lane: "facet-decomposition",
        candidateSet: [],
        matchedSurfaceForms: [],
        unmatchedSurfaceForms: ["merit", "order", "stack"],
        reason: "facet vocabulary recognized no fields in text"
      })
    ).toBe("no-facet-match");
  });

  it("classifies facet-match-no-variable escalations", () => {
    expect(
      classifyEscalationBucket({
        _tag: "Stage3Input",
        postUri: makeRow().postUri,
        originalResidual: {
          _tag: "DeferredToStage2Residual",
          source: "chart-title",
          text: "installed offshore wind capacity",
          reason: "needs structured decomposition"
        },
        stage2Lane: "facet-decomposition",
        candidateSet: [],
        matchedSurfaceForms: [makeMatchedSurfaceForm()],
        unmatchedSurfaceForms: ["capacity"],
        reason: "no variable candidates matched the decoded facets"
      })
    ).toBe("facet-match-no-variable");
  });

  it("classifies grouped facet-decomposition escalations", () => {
    expect(
      classifyEscalationBucket({
        _tag: "Stage3Input",
        postUri: makeRow().postUri,
        originalResidual: {
          _tag: "DeferredToStage2Residual",
          source: "chart-title",
          text: "installed offshore wind capacity",
          reason: "needs structured decomposition",
          assetKey: "chart-1"
        },
        stage2Lane: "grouped-facet-decomposition",
        partialDecomposition: {
          technologyOrFuel: "offshore wind",
          unitFamily: "power"
        },
        candidateSet: [],
        matchedSurfaceForms: [makeMatchedSurfaceForm(), makeMatchedSurfaceForm("mw")],
        unmatchedSurfaceForms: ["capacity"],
        contributingResiduals: [
          { source: "chart-title", text: "installed offshore wind" },
          { source: "axis-label", text: "mw" }
        ],
        contributingResidualCount: 2,
        reason: "no variable candidates matched the decoded facets"
      })
    ).toBe("facet-match-no-variable");
  });

  it("classifies fuzzy threshold and no-candidate escalations", () => {
    expect(
      classifyEscalationBucket({
        _tag: "Stage3Input",
        postUri: makeRow().postUri,
        originalResidual: {
          _tag: "UnmatchedTextResidual",
          source: "post-text",
          text: "ercot",
          normalizedText: "ercot"
        },
        stage2Lane: "fuzzy-agent-label",
        candidateSet: [],
        matchedSurfaceForms: [],
        unmatchedSurfaceForms: ["ercot"],
        reason: "best fuzzy score 0.20 below 0.60 threshold"
      })
    ).toBe("fuzzy-below-threshold");

    expect(
      classifyEscalationBucket({
        _tag: "Stage3Input",
        postUri: makeRow().postUri,
        originalResidual: {
          _tag: "UnmatchedDatasetTitleResidual",
          datasetName: "Some Dataset",
          normalizedTitle: "some dataset"
        },
        stage2Lane: "fuzzy-dataset-title",
        candidateSet: [],
        matchedSurfaceForms: [],
        unmatchedSurfaceForms: ["some", "dataset"],
        reason: "no dataset candidates available for fuzzy matching"
      })
    ).toBe("fuzzy-no-candidate");
  });

  it("classifies ambiguous and handoff escalations", () => {
    expect(
      classifyEscalationBucket({
        _tag: "Stage3Input",
        postUri: makeRow().postUri,
        originalResidual: {
          _tag: "AmbiguousCandidatesResidual",
          grain: "Variable",
          bestRank: 1,
          candidates: [
            { entityId: variableId, label: "A" },
            { entityId: alternateVariableId, label: "B" }
          ],
          evidence: []
        },
        stage2Lane: "tie-breaker",
        candidateSet: [],
        matchedSurfaceForms: [],
        unmatchedSurfaceForms: [],
        reason: "2 candidates tied at rank 1"
      })
    ).toBe("ambiguous");

    expect(
      classifyEscalationBucket({
        _tag: "Stage3Input",
        postUri: makeRow().postUri,
        originalResidual: {
          _tag: "UnmatchedUrlResidual",
          source: "post-link",
          url: "https://example.com/report"
        },
        stage2Lane: "no-op",
        candidateSet: [],
        matchedSurfaceForms: [],
        unmatchedSurfaceForms: [],
        reason: "stage 2 has no action for unmatched URLs"
      })
    ).toBe("handoff");
  });

  it("classifies wrong new matches and skips correct ones", () => {
    const stage2 = makeStage2Result({
      matches: [
        {
          _tag: "VariableMatch",
          variableId,
          label: "Installed offshore wind capacity",
          bestRank: 1,
          evidence: []
        }
      ]
    });

    expect(
      classifyNewMatchBuckets(stage2, {
        ...emptyExpectedRefs(),
        variableIds: [alternateVariableId]
      })
    ).toEqual(["wrong-new-match"]);

    expect(
      classifyNewMatchBuckets(stage2, {
        ...emptyExpectedRefs(),
        variableIds: [variableId]
      })
    ).toEqual([]);
  });

  it("computes lift detail without collapsing missing and unexpected deltas", () => {
    expect(
      computeLiftDetail(
        {
          missing: {
            distributionIds: [],
            datasetIds: [],
            agentIds: [],
            variableIds: [variableId, alternateVariableId]
          },
          unexpected: {
            distributionIds: [],
            datasetIds: [],
            agentIds: [],
            variableIds: []
          }
        },
        {
          missing: {
            distributionIds: [],
            datasetIds: [],
            agentIds: [],
            variableIds: [variableId]
          },
          unexpected: {
            distributionIds: [],
            datasetIds: [],
            agentIds: [],
            variableIds: [alternateVariableId]
          }
        }
      )
    ).toEqual({
      missingDelta: -1,
      unexpectedDelta: 1
    });
  });

  it("counts residual progression from evidence entries instead of match rows", () => {
    const progression = computeResidualProgression(
      makeStage1Result({
        residuals: [
          {
            _tag: "DeferredToStage2Residual",
            source: "chart-title",
            text: "offshore wind capacity",
            reason: "needs structured decomposition"
          },
          {
            _tag: "UnmatchedTextResidual",
            source: "post-text",
            text: "ercot",
            normalizedText: "ercot"
          }
        ]
      }),
      makeStage2Result({
        matches: [
          {
            _tag: "VariableMatch",
            variableId,
            label: "Installed offshore wind capacity",
            bestRank: 1,
            evidence: [
              {
                _tag: "FacetDecompositionEvidence",
                signal: "facet-decomposition",
                rank: 1,
                matchedFacets: ["technologyOrFuel"],
                partialShape: { technologyOrFuel: "offshore wind" },
                matchedSurfaceForms: [makeMatchedSurfaceForm()]
              },
              {
                _tag: "FuzzyAgentLabelEvidence",
                signal: "fuzzy-agent-label",
                rank: 1,
                candidateLabel: "ERCOT",
                score: 1,
                threshold: 0.85
              }
            ]
          }
        ]
      })
    );

    expect(progression.byKind.DeferredToStage2Residual.resolved).toBe(1);
    expect(progression.byKind.UnmatchedTextResidual.resolved).toBe(1);
    expect(progression.totals.resolved).toBe(2);
  });

  it("expands grouped resolved, corroborated, and escalated counts", () => {
    const progression = computeResidualProgression(
      makeStage1Result({
        matches: [
          {
            _tag: "VariableMatch",
            variableId,
            label: "Installed offshore wind capacity",
            bestRank: 1,
            evidence: []
          }
        ],
        residuals: [
          {
            _tag: "DeferredToStage2Residual",
            source: "chart-title",
            text: "Offshore wind",
            reason: "needs structured decomposition",
            assetKey: "chart-1"
          },
          {
            _tag: "DeferredToStage2Residual",
            source: "axis-label",
            text: "MW",
            reason: "needs structured decomposition",
            assetKey: "chart-1"
          },
          {
            _tag: "DeferredToStage2Residual",
            source: "chart-title",
            text: "Solar",
            reason: "needs structured decomposition",
            assetKey: "chart-2"
          },
          {
            _tag: "DeferredToStage2Residual",
            source: "axis-label",
            text: "MW",
            reason: "needs structured decomposition",
            assetKey: "chart-2"
          },
          {
            _tag: "DeferredToStage2Residual",
            source: "chart-title",
            text: "Hydrogen",
            reason: "needs structured decomposition",
            assetKey: "chart-3"
          },
          {
            _tag: "DeferredToStage2Residual",
            source: "axis-label",
            text: "kg",
            reason: "needs structured decomposition",
            assetKey: "chart-3"
          }
        ]
      }),
      makeStage2Result({
        matches: [
          {
            _tag: "VariableMatch",
            variableId: alternateVariableId,
            label: "Installed solar capacity",
            bestRank: 1,
            evidence: [makeGroupedFacetEvidence(2)]
          }
        ],
        corroborations: [
          {
            matchKey: {
              grain: "Variable",
              entityId: variableId
            },
            evidence: [makeGroupedFacetEvidence(2)]
          }
        ],
        escalations: [
          {
            _tag: "Stage3Input",
            postUri: makeRow().postUri,
            originalResidual: {
              _tag: "DeferredToStage2Residual",
              source: "chart-title",
              text: "Hydrogen",
              reason: "needs structured decomposition",
              assetKey: "chart-3"
            },
            stage2Lane: "grouped-facet-decomposition",
            partialDecomposition: {
              technologyOrFuel: "hydrogen",
              unitFamily: "energy"
            },
            candidateSet: [],
            matchedSurfaceForms: [makeMatchedSurfaceForm("hydrogen")],
            unmatchedSurfaceForms: ["kg"],
            contributingResiduals: [
              { source: "chart-title", text: "Hydrogen" },
              { source: "axis-label", text: "kg" }
            ],
            contributingResidualCount: 2,
            reason: "no variable candidates matched the decoded facets"
          }
        ]
      })
    );

    expect(progression.byKind.DeferredToStage2Residual.total).toBe(6);
    expect(progression.byKind.DeferredToStage2Residual.resolved).toBe(2);
    expect(progression.byKind.DeferredToStage2Residual.corroborated).toBe(2);
    expect(progression.byKind.DeferredToStage2Residual.escalated).toBe(2);
    expect(progression.totals.total).toBe(6);
    expect(progression.totals.resolved).toBe(2);
    expect(progression.totals.corroborated).toBe(2);
    expect(progression.totals.escalated).toBe(2);
  });

  it("breaks residual progression down by residual kind", () => {
    const progression = computeResidualProgression(
      makeStage1Result({
        residuals: [
          {
            _tag: "DeferredToStage2Residual",
            source: "chart-title",
            text: "offshore wind capacity",
            reason: "needs structured decomposition"
          },
          {
            _tag: "DeferredToStage2Residual",
            source: "chart-title",
            text: "wind capacity",
            reason: "needs structured decomposition"
          },
          {
            _tag: "UnmatchedTextResidual",
            source: "post-text",
            text: "ercot",
            normalizedText: "ercot"
          },
          {
            _tag: "AmbiguousCandidatesResidual",
            grain: "Variable",
            bestRank: 1,
            candidates: [
              { entityId: variableId, label: "A" },
              { entityId: alternateVariableId, label: "B" }
            ],
            evidence: []
          },
          {
            _tag: "UnmatchedUrlResidual",
            source: "post-link",
            url: "https://example.com/report"
          }
        ]
      }),
      makeStage2Result({
        matches: [
          {
            _tag: "VariableMatch",
            variableId,
            label: "Installed offshore wind capacity",
            bestRank: 1,
            evidence: [
              {
                _tag: "FacetDecompositionEvidence",
                signal: "facet-decomposition",
                rank: 1,
                matchedFacets: ["technologyOrFuel"],
                partialShape: { technologyOrFuel: "offshore wind" },
                matchedSurfaceForms: [makeMatchedSurfaceForm()]
              }
            ]
          }
        ],
        corroborations: [
          {
            matchKey: {
              grain: "Variable",
              entityId: variableId
            },
            evidence: [
              {
                _tag: "FacetDecompositionEvidence",
                signal: "facet-decomposition",
                rank: 1,
                matchedFacets: ["technologyOrFuel"],
                partialShape: { technologyOrFuel: "wind" },
                matchedSurfaceForms: [makeMatchedSurfaceForm("wind")]
              }
            ]
          }
        ],
        escalations: [
          {
            _tag: "Stage3Input",
            postUri: makeRow().postUri,
            originalResidual: {
              _tag: "UnmatchedTextResidual",
              source: "post-text",
              text: "ercot",
              normalizedText: "ercot"
            },
            stage2Lane: "fuzzy-agent-label",
            candidateSet: [],
            matchedSurfaceForms: [],
            unmatchedSurfaceForms: ["ercot"],
            reason: "no agent candidates available for fuzzy matching"
          },
          {
            _tag: "Stage3Input",
            postUri: makeRow().postUri,
            originalResidual: {
              _tag: "AmbiguousCandidatesResidual",
              grain: "Variable",
              bestRank: 1,
              candidates: [
                { entityId: variableId, label: "A" },
                { entityId: alternateVariableId, label: "B" }
              ],
              evidence: []
            },
            stage2Lane: "tie-breaker",
            candidateSet: [],
            matchedSurfaceForms: [],
            unmatchedSurfaceForms: [],
            reason: "2 candidates tied at rank 1"
          },
          {
            _tag: "Stage3Input",
            postUri: makeRow().postUri,
            originalResidual: {
              _tag: "UnmatchedUrlResidual",
              source: "post-link",
              url: "https://example.com/report"
            },
            stage2Lane: "no-op",
            candidateSet: [],
            matchedSurfaceForms: [],
            unmatchedSurfaceForms: [],
            reason: "stage 2 has no action for unmatched URLs"
          }
        ]
      })
    );

    expect(progression.byKind.DeferredToStage2Residual.total).toBe(2);
    expect(progression.byKind.DeferredToStage2Residual.resolved).toBe(1);
    expect(progression.byKind.DeferredToStage2Residual.corroborated).toBe(1);
    expect(progression.byKind.UnmatchedTextResidual.escalated).toBe(1);
    expect(progression.byKind.AmbiguousCandidatesResidual.escalated).toBe(1);
    expect(progression.byKind.UnmatchedUrlResidual.escalated).toBe(1);
    expect(progression.totals.total).toBe(5);
  });

  it("assesses a full Stage 1 + Stage 2 result", () => {
    const row = makeRow();
    const stage1Result = makeStage1Result({
      residuals: [
        {
          _tag: "DeferredToStage2Residual",
          source: "chart-title",
          text: "offshore wind capacity",
          reason: "needs structured decomposition"
        }
      ]
    });
    const stage2Result = makeStage2Result({
      matches: [
        {
          _tag: "VariableMatch",
          variableId,
          label: "Installed offshore wind capacity",
          bestRank: 1,
          evidence: [
            {
              _tag: "FacetDecompositionEvidence",
              signal: "facet-decomposition",
              rank: 1,
              matchedFacets: ["technologyOrFuel"],
              partialShape: { technologyOrFuel: "offshore wind" },
              matchedSurfaceForms: [makeMatchedSurfaceForm()]
            }
          ]
        }
      ]
    });

    const assessed = assessStage2EvalResult(
      row,
      {
        ...emptyExpectedRefs(),
        variableIds: [variableId]
      },
      stage1Result,
      stage2Result,
      12
    );

    expect(assessed.stage1HasFindings).toBe(true);
    expect(assessed.stage1MissBucket).toBe("deferred-to-stage2");
    expect(assessed.hasFindings).toBe(false);
    expect(assessed.combinedActual?.variableIds).toEqual([variableId]);
    expect(assessed.stage2ObservationBuckets).toEqual([]);
    expect(assessed.liftDetail).toEqual({
      missingDelta: -1,
      unexpectedDelta: 0
    });
    expect(assessed.residualProgression?.byKind.DeferredToStage2Residual.resolved).toBe(
      1
    );
  });
});
