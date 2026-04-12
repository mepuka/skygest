import { describe, expect, it } from "@effect/vitest";
import { Match, Schema } from "effect";
import type { Variable } from "../src/domain/data-layer/variable";
import { PostUri } from "../src/domain/types";
import {
  CandidateEntry,
  PartialVariableShape,
  Stage2Evidence,
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
        matchedSurfaceForms: [{ surfaceForm: "generation" }]
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
        entityId: "https://id.skygest.io/variable/var_1234567890AB",
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

  it("round-trips Stage3Input and accepts multiple Stage1Residual variants", () => {
    const residuals = [
      {
        _tag: "DeferredToStage2Residual" as const,
        source: "post-text" as const,
        text: "EIA annual wind generation",
        reason: "needs structured decomposition"
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
              entityId: "https://id.skygest.io/variable/var_01",
              label: "Wind generation",
              grain: "Variable",
              matchedFacets: ["technologyOrFuel", "statisticType"],
              rank: 1
            },
            {
              entityId: "https://id.skygest.io/variable/var_02",
              label: "Wind capacity",
              grain: "Variable",
              matchedFacets: ["technologyOrFuel"],
              rank: 2
            },
            {
              entityId: "https://id.skygest.io/dataset/ds_01",
              label: "EIA wind tables",
              grain: "Dataset",
              matchedFacets: ["technologyOrFuel"],
              rank: 3
            }
          ],
          matchedSurfaceForms: [
            { surfaceForm: "wind" },
            { surfaceForm: "annual" }
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
});
