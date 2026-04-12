import { describe, expect, it } from "@effect/vitest";
import { Match, Schema } from "effect";
import { makeDatasetId, makeVariableId } from "../src/domain/data-layer/ids";
import type { Variable } from "../src/domain/data-layer/variable";
import { SurfaceFormEntryAny } from "../src/domain/surfaceForm";
import { VariableMatch } from "../src/domain/stage1Resolution";
import { PostUri } from "../src/domain/types";
import {
  CandidateEntry,
  PartialVariableShape,
  Stage2Evidence,
  Stage2Result,
  Stage3Input
} from "../src/domain/stage2Resolution";

const asPostUri = Schema.decodeUnknownSync(PostUri)(
  "at://did:plc:test/app.bsky.feed.post/sky-239"
);

const decodeStage2Evidence = Schema.decodeUnknownSync(Stage2Evidence);
const encodeStage2Evidence = Schema.encodeSync(Stage2Evidence);
const decodePartialVariableShape = Schema.decodeUnknownSync(PartialVariableShape);
const encodePartialVariableShape = Schema.encodeSync(PartialVariableShape);
const decodeCandidateEntry = Schema.decodeUnknownSync(CandidateEntry);
const encodeCandidateEntry = Schema.encodeSync(CandidateEntry);
const decodeStage3Input = Schema.decodeUnknownSync(Stage3Input);
const encodeStage3Input = Schema.encodeSync(Stage3Input);
const decodeStage2Result = Schema.decodeUnknownSync(Stage2Result);
const encodeStage2Result = Schema.encodeSync(Stage2Result);
const decodeVariableMatch = Schema.decodeUnknownSync(VariableMatch);
const encodeVariableMatch = Schema.encodeSync(VariableMatch);
const decodeSurfaceFormEntry = Schema.decodeUnknownSync(SurfaceFormEntryAny);

const makeSurfaceForm = (
  surfaceForm: string,
  canonical: string
) =>
  decodeSurfaceFormEntry({
    surfaceForm,
    normalizedSurfaceForm: surfaceForm.toLowerCase(),
    canonical,
    provenance: "cold-start-corpus",
    addedAt: "2026-04-11T00:00:00.000Z"
  });

describe("stage2Resolution", () => {
  it("round-trips the Stage2Evidence union and stays exhaustively matchable", () => {
    const cases = [
      {
        _tag: "FacetDecompositionEvidence" as const,
        signal: "facet-decomposition" as const,
        rank: 1 as const,
        matchedFacets: ["statisticType", "aggregation"],
        partialShape: {
          statisticType: "flow" as const,
          aggregation: "sum" as const,
          unitFamily: "energy" as const
        },
        matchedSurfaceForms: [makeSurfaceForm("generation", "flow")]
      },
      {
        _tag: "GroupedFacetDecompositionEvidence" as const,
        signal: "grouped-facet-decomposition" as const,
        rank: 1 as const,
        assetKey: "chart-1",
        residualCount: 2,
        matchedFacets: ["technologyOrFuel", "unitFamily"],
        partialShape: {
          technologyOrFuel: "offshore wind" as const,
          unitFamily: "power" as const
        },
        matchedSurfaceForms: [
          makeSurfaceForm("offshore wind", "offshore wind"),
          makeSurfaceForm("mw", "power")
        ],
        facetProvenance: [
          {
            facet: "technologyOrFuel",
            source: "chart-title" as const,
            text: "Offshore wind",
            surfaceForm: "offshore wind",
            status: "accepted" as const
          },
          {
            facet: "unitFamily",
            source: "axis-label" as const,
            text: "MW",
            surfaceForm: "mw",
            status: "accepted" as const
          }
        ],
        contributingResiduals: [
          {
            source: "chart-title" as const,
            text: "Offshore wind"
          },
          {
            source: "axis-label" as const,
            text: "MW"
          }
        ]
      },
      {
        _tag: "FuzzyDatasetTitleEvidence" as const,
        signal: "fuzzy-dataset-title" as const,
        rank: 2 as const,
        candidateTitle: "EIA Electric Power Data",
        score: 0.91,
        threshold: 0.85
      },
      {
        _tag: "FuzzyAgentLabelEvidence" as const,
        signal: "fuzzy-agent-label" as const,
        rank: 3 as const,
        candidateLabel: "Energy Information Administration",
        score: 0.88,
        threshold: 0.85
      },
      {
        _tag: "FuzzyTitleEvidence" as const,
        signal: "fuzzy-title" as const,
        rank: 4 as const,
        candidateLabel: "Installed wind capacity",
        score: 0.72,
        threshold: 0.6
      }
    ];

    for (const evidence of cases) {
      const roundTripped = decodeStage2Evidence(encodeStage2Evidence(evidence));
      expect(roundTripped).toEqual(evidence);

      const matched = Match.valueTags(roundTripped, {
        FacetDecompositionEvidence: () => "facet-decomposition",
        GroupedFacetDecompositionEvidence: () => "grouped-facet-decomposition",
        FuzzyDatasetTitleEvidence: () => "fuzzy-dataset-title",
        FuzzyAgentLabelEvidence: () => "fuzzy-agent-label",
        FuzzyTitleEvidence: () => "fuzzy-title"
      });

      expect(matched).toBe(evidence.signal);
    }
  });

  it("round-trips PartialVariableShape and CandidateEntry", () => {
    const partialShape = decodePartialVariableShape(
      encodePartialVariableShape({
        measuredProperty: "generation",
        domainObject: "electricity",
        technologyOrFuel: "wind",
        statisticType: "flow",
        aggregation: "sum",
        basis: ["gross"],
        unitFamily: "energy",
        fixedDims: {
          frequency: "annual"
        }
      })
    );

    const candidateEntry = decodeCandidateEntry(
      encodeCandidateEntry({
        entityId: makeVariableId(
          "https://id.skygest.io/variable/var_1234567890AB"
        ),
        label: "Installed wind generation",
        grain: "Variable",
        matchedFacets: ["technologyOrFuel", "unitFamily"],
        rank: 1
      })
    );

    const variableSubset: Partial<Variable> = partialShape;

    expect(partialShape.fixedDims?.frequency).toBe("annual");
    expect(variableSubset.unitFamily).toBe("energy");
    expect(candidateEntry.rank).toBe(1);
  });

  it("accepts mixed Stage 1 and Stage 2 evidence on a VariableMatch", () => {
    const variableMatch = decodeVariableMatch(
      encodeVariableMatch({
        _tag: "VariableMatch",
        variableId: makeVariableId(
          "https://id.skygest.io/variable/var_1234567890AB"
        ),
        label: "Installed wind generation",
        bestRank: 1,
        evidence: [
          {
            _tag: "VariableAliasEvidence",
            signal: "variable-alias",
            rank: 1,
            aliasScheme: "eia-series",
            aliasValue: "ELEC.WND.US-ALL.A",
            source: "post-text"
          },
          {
            _tag: "FacetDecompositionEvidence",
            signal: "facet-decomposition",
            rank: 1,
            matchedFacets: ["technologyOrFuel", "statisticType"],
            partialShape: {
              technologyOrFuel: "wind",
              statisticType: "flow",
              unitFamily: "energy"
            },
            matchedSurfaceForms: [makeSurfaceForm("wind", "wind")]
          }
        ]
      })
    );

    expect(variableMatch.evidence).toHaveLength(2);
    expect(variableMatch.evidence[0]?._tag).toBe("VariableAliasEvidence");
    expect(variableMatch.evidence[1]?._tag).toBe("FacetDecompositionEvidence");
  });

  it("round-trips Stage3Input and accepts multiple Stage1Residual variants", () => {
    const residuals = [
      {
        _tag: "DeferredToStage2Residual" as const,
        source: "post-text" as const,
        text: "EIA annual wind generation",
        reason: "needs structured decomposition"
      },
      {
        _tag: "UnmatchedTextResidual" as const,
        source: "post-text" as const,
        text: "wind output",
        normalizedText: "wind output"
      },
      {
        _tag: "UnmatchedDatasetTitleResidual" as const,
        datasetName: "Installed wind generation",
        normalizedTitle: "installed wind generation"
      },
      {
        _tag: "AmbiguousCandidatesResidual" as const,
        grain: "Dataset" as const,
        bestRank: 2,
        candidates: [
          {
            entityId: makeDatasetId(
              "https://id.skygest.io/dataset/ds_1234567890AB"
            ),
            label: "Dataset A"
          },
          {
            entityId: makeDatasetId(
              "https://id.skygest.io/dataset/ds_ABCDEFGHIJKL"
            ),
            label: "Dataset B"
          }
        ],
        evidence: []
      },
      {
        _tag: "UnmatchedUrlResidual" as const,
        source: "post-link" as const,
        url: "https://example.com/report",
        normalizedUrl: "https://example.com/report",
        hostname: "example.com"
      }
    ];

    for (const originalResidual of residuals) {
      const roundTripped = decodeStage3Input(
        encodeStage3Input({
          _tag: "Stage3Input",
          postUri: asPostUri,
          originalResidual,
          stage2Lane: "facet-decomposition",
          partialDecomposition: {
            measuredProperty: "generation",
            technologyOrFuel: "wind",
            statisticType: "flow",
            fixedDims: {
              frequency: "annual"
            }
          },
          candidateSet: [
            {
              entityId: makeVariableId(
                "https://id.skygest.io/variable/var_1234567890AB"
              ),
              label: "Wind generation",
              grain: "Variable",
              matchedFacets: ["technologyOrFuel", "statisticType"],
              rank: 1
            },
            {
              entityId: makeVariableId(
                "https://id.skygest.io/variable/var_ABCDEFGHIJKL"
              ),
              label: "Wind capacity",
              grain: "Variable",
              matchedFacets: ["technologyOrFuel"],
              rank: 2
            },
            {
              entityId: makeDatasetId(
                "https://id.skygest.io/dataset/ds_1234567890AB"
              ),
              label: "EIA wind tables",
              grain: "Dataset",
              matchedFacets: ["technologyOrFuel"],
              rank: 3
            }
          ],
          matchedSurfaceForms: [
            makeSurfaceForm("wind", "wind"),
            makeSurfaceForm("annual", "annual")
          ],
          unmatchedSurfaceForms: ["generation"],
          reason: "two variable candidates tied on matched facets"
        })
      );

      expect(roundTripped.originalResidual._tag).toBe(originalResidual._tag);
      expect(roundTripped.matchedSurfaceForms).toHaveLength(2);
      expect(roundTripped.unmatchedSurfaceForms).toEqual(["generation"]);
    }
  });

  it("round-trips grouped Stage3Input context", () => {
    const originalResidual = {
      _tag: "DeferredToStage2Residual" as const,
      source: "chart-title" as const,
      text: "Offshore wind",
      reason: "needs structured decomposition",
      assetKey: "chart-1"
    };

    const roundTripped = decodeStage3Input(
      encodeStage3Input({
        _tag: "Stage3Input",
        postUri: asPostUri,
        originalResidual,
        stage2Lane: "grouped-facet-decomposition",
        partialDecomposition: {
          technologyOrFuel: "offshore wind",
          unitFamily: "power"
        },
        candidateSet: [
          {
            entityId: makeVariableId(
              "https://id.skygest.io/variable/var_1234567890AB"
            ),
            label: "Installed offshore wind capacity",
            grain: "Variable",
            matchedFacets: ["technologyOrFuel", "unitFamily"],
            rank: 1
          }
        ],
        matchedSurfaceForms: [
          makeSurfaceForm("offshore wind", "offshore wind"),
          makeSurfaceForm("mw", "power")
        ],
        unmatchedSurfaceForms: [],
        contributingResiduals: [
          { source: "chart-title", text: "Offshore wind" },
          { source: "axis-label", text: "MW" }
        ],
        contributingResidualCount: 2,
        reason: "2 candidates tied on 2 matched facets"
      })
    );

    expect(roundTripped.stage2Lane).toBe("grouped-facet-decomposition");
    expect(roundTripped.contributingResidualCount).toBe(2);
    expect(roundTripped.contributingResiduals).toEqual([
      { source: "chart-title", text: "Offshore wind" },
      { source: "axis-label", text: "MW" }
    ]);
  });

  it("round-trips Stage2Result with new matches, corroborations, and escalations", () => {
    const roundTripped = decodeStage2Result(
      encodeStage2Result({
        matches: [
          {
            _tag: "VariableMatch",
            variableId: makeVariableId(
              "https://id.skygest.io/variable/var_1234567890AB"
            ),
            label: "Installed wind generation",
            bestRank: 1,
            evidence: [
              {
                _tag: "FacetDecompositionEvidence",
                signal: "facet-decomposition",
                rank: 1,
                matchedFacets: ["technologyOrFuel", "statisticType"],
                partialShape: {
                  technologyOrFuel: "wind",
                  statisticType: "flow",
                  unitFamily: "energy"
                },
                matchedSurfaceForms: [makeSurfaceForm("wind", "wind")]
              }
            ]
          }
        ],
        corroborations: [
          {
            matchKey: {
              grain: "Dataset",
              entityId: makeDatasetId(
                "https://id.skygest.io/dataset/ds_1234567890AB"
              )
            },
            evidence: [
              {
                _tag: "FuzzyDatasetTitleEvidence",
                signal: "fuzzy-dataset-title",
                rank: 2,
                candidateTitle: "EIA Wind Tables",
                score: 0.86,
                threshold: 0.85
              }
            ]
          }
        ],
        escalations: [
          {
            _tag: "Stage3Input",
            postUri: asPostUri,
            originalResidual: {
              _tag: "DeferredToStage2Residual",
              source: "post-text",
              text: "EIA annual wind generation",
              reason: "needs structured decomposition"
            },
            stage2Lane: "facet-decomposition",
            partialDecomposition: {
              technologyOrFuel: "wind",
              statisticType: "flow"
            },
            candidateSet: [
              {
                entityId: makeVariableId(
                  "https://id.skygest.io/variable/var_1234567890AB"
                ),
                label: "Installed wind generation",
                grain: "Variable",
                matchedFacets: ["technologyOrFuel", "statisticType"],
                rank: 1
              }
            ],
            matchedSurfaceForms: [makeSurfaceForm("wind", "wind")],
            unmatchedSurfaceForms: ["generation"],
            reason: "multiple candidates remain after decomposition"
          }
        ]
      })
    );

    expect(roundTripped.matches).toHaveLength(1);
    expect(roundTripped.corroborations).toHaveLength(1);
    expect(roundTripped.escalations).toHaveLength(1);
  });
});
