import { describe, expect, it } from "@effect/vitest";
import { Match, Schema } from "effect";
import { makeAgentId, makeVariableId } from "../src/domain/data-layer/ids";
import {
  AttachedContext,
  BoundResolutionItem,
  EVIDENCE_PRECEDENCE,
  ResolutionEvidenceBundle,
  ResolutionEvidenceReference,
  ResolutionGap,
  ResolutionHypothesis,
  ResolutionOutcome,
  VariableCandidateScore
} from "../src/domain/resolutionKernel";

const decodeBundle = Schema.decodeUnknownSync(ResolutionEvidenceBundle);
const encodeBundle = Schema.encodeSync(ResolutionEvidenceBundle);
const decodeContext = Schema.decodeUnknownSync(AttachedContext);
const decodeEvidence = Schema.decodeUnknownSync(ResolutionEvidenceReference);
const decodeHypothesis = Schema.decodeUnknownSync(ResolutionHypothesis);
const decodeGap = Schema.decodeUnknownSync(ResolutionGap);
const decodeCandidate = Schema.decodeUnknownSync(VariableCandidateScore);
const decodeItem = Schema.decodeUnknownSync(BoundResolutionItem);
const decodeOutcome = Schema.decodeUnknownSync(ResolutionOutcome);
const encodeOutcome = Schema.encodeSync(ResolutionOutcome);

describe("resolutionKernel domain contract", () => {
  it("exports the locked evidence precedence order", () => {
    expect(EVIDENCE_PRECEDENCE).toEqual([
      "series-label",
      "x-axis",
      "y-axis",
      "chart-title",
      "key-finding",
      "post-text",
      "source-line",
      "publisher-hint"
    ]);
  });

  it("round-trips the structured evidence bundle", () => {
    const bundle = decodeBundle(
      encodeBundle({
        postText: ["Wind generation rose year over year"],
        chartTitle: "US Wind Generation",
        xAxis: {
          label: "Year",
          unit: null
        },
        yAxis: {
          label: "Generation",
          unit: "TWh"
        },
        series: [
          {
            itemKey: "wind",
            legendLabel: "Wind",
            unit: "TWh"
          }
        ],
        keyFindings: ["Wind output surpassed coal in April"],
        sourceLines: [
          {
            sourceText: "Source: EIA",
            datasetName: "Electric Power Monthly"
          }
        ],
        publisherHints: [
          {
            label: "EIA",
            confidence: 0.95
          }
        ]
      })
    );

    expect(bundle.chartTitle).toBe("US Wind Generation");
    expect(bundle.series[0]?.legendLabel).toBe("Wind");
    expect(bundle.publisherHints[0]?.label).toBe("EIA");
  });

  it("keeps reporting context separate from semantic identity", () => {
    const context = decodeContext({
      place: "Germany",
      frequency: "monthly",
      time: {
        start: "2024-01",
        end: "2024-12"
      },
      extra: {
        scenario: "baseline"
      }
    });

    expect(context.place).toBe("Germany");
    expect(context.time?.start).toBe("2024-01");
    expect(context.extra?.scenario).toBe("baseline");
  });

  it("round-trips bound and gap items with exhaustive tag matching", () => {
    const context = decodeContext({
      place: "Europe"
    });
    const evidence = decodeEvidence({
      source: "series-label",
      text: "Solar",
      itemKey: "solar"
    });
    const candidate = decodeCandidate({
      variableId: makeVariableId("https://id.skygest.io/variable/var_1234567890AB"),
      label: "Solar generation",
      matchedFacets: [
        "measuredProperty",
        "technologyOrFuel",
        "statisticType",
        "unitFamily"
      ],
      mismatchedFacets: [],
      subsumptionRatio: 1,
      partialSpecificity: 4,
      semanticPartial: {
        measuredProperty: "generation",
        technologyOrFuel: "solar",
        statisticType: "flow",
        unitFamily: "energy"
      }
    });
    const boundItem = decodeItem({
      _tag: "bound",
      itemKey: "solar",
      semanticPartial: {
        measuredProperty: "generation",
        technologyOrFuel: "solar",
        statisticType: "flow",
        unitFamily: "energy"
      },
      attachedContext: context,
      evidence: [evidence],
      variableId: makeVariableId("https://id.skygest.io/variable/var_1234567890AB"),
      label: "Solar generation"
    });
    const gapItem = decodeItem({
      _tag: "gap",
      itemKey: "hydro",
      semanticPartial: {
        measuredProperty: "generation",
        technologyOrFuel: "hydro",
        statisticType: "flow",
        unitFamily: "energy"
      },
      attachedContext: context,
      evidence: [
        decodeEvidence({
          source: "series-label",
          text: "Hydro",
          itemKey: "hydro"
        })
      ],
      candidates: [candidate],
      reason: "no-candidates"
    });

    expect(
      Match.valueTags(boundItem, {
        bound: (item) => item.variableId,
        gap: () => null
      })
    ).toBe(makeVariableId("https://id.skygest.io/variable/var_1234567890AB"));
    expect(
      Match.valueTags(gapItem, {
        bound: () => null,
        gap: (item) => item.reason
      })
    ).toBe("no-candidates");
  });

  it("round-trips all outcome variants and stays exhaustively matchable", () => {
    const bundle = decodeBundle({
      postText: ["Solar and wind generation rose"],
      chartTitle: "EU Generation Mix",
      series: [
        { itemKey: "solar", legendLabel: "Solar", unit: "TWh" },
        { itemKey: "wind", legendLabel: "Wind", unit: "TWh" }
      ],
      keyFindings: [],
      sourceLines: [],
      publisherHints: []
    });
    const context = decodeContext({
      place: "Europe"
    });
    const evidence = decodeEvidence({
      source: "series-label",
      text: "Solar",
      itemKey: "solar"
    });
    const hypothesis = decodeHypothesis({
      sharedPartial: {
        measuredProperty: "generation",
        statisticType: "flow",
        unitFamily: "energy"
      },
      attachedContext: context,
      items: [
        {
          itemKey: "solar",
          partial: {
            technologyOrFuel: "solar"
          },
          evidence: [evidence]
        }
      ],
      evidence: [evidence],
      confidence: 0.9,
      tier: "strong-heuristic"
    });
    const candidate = decodeCandidate({
      variableId: makeVariableId("https://id.skygest.io/variable/var_1234567890AB"),
      label: "Solar generation",
      matchedFacets: [
        "measuredProperty",
        "technologyOrFuel",
        "statisticType",
        "unitFamily"
      ],
      mismatchedFacets: [],
      subsumptionRatio: 1,
      partialSpecificity: 4,
      semanticPartial: {
        measuredProperty: "generation",
        technologyOrFuel: "solar",
        statisticType: "flow",
        unitFamily: "energy"
      }
    });
    const gap = decodeGap({
      partial: {
        measuredProperty: "generation",
        statisticType: "flow",
        unitFamily: "energy"
      },
      candidates: [candidate],
      reason: "ambiguous-candidates",
      context: {
        agentId: makeAgentId("https://id.skygest.io/agent/ag_1234567890AB"),
        attachedContext: context
      }
    });
    const boundItem = decodeItem({
      _tag: "bound",
      itemKey: "solar",
      semanticPartial: {
        measuredProperty: "generation",
        technologyOrFuel: "solar",
        statisticType: "flow",
        unitFamily: "energy"
      },
      attachedContext: context,
      evidence: [evidence],
      variableId: makeVariableId("https://id.skygest.io/variable/var_1234567890AB"),
      label: "Solar generation"
    });
    const gapItem = decodeItem({
      _tag: "gap",
      itemKey: "solar",
      semanticPartial: {
        measuredProperty: "generation",
        technologyOrFuel: "solar",
        statisticType: "flow",
        unitFamily: "energy"
      },
      attachedContext: context,
      evidence: [evidence],
      candidates: [candidate],
      reason: "ambiguous-candidates"
    });

    const cases = [
      decodeOutcome({
        _tag: "Resolved" as const,
        bundle,
        sharedPartial: {
          measuredProperty: "generation",
          statisticType: "flow",
          unitFamily: "energy"
        },
        attachedContext: context,
        items: [boundItem],
        confidence: 0.95,
        tier: "entailment"
      }),
      decodeOutcome({
        _tag: "Ambiguous" as const,
        bundle,
        hypotheses: [hypothesis],
        items: [gapItem],
        gaps: [gap],
        confidence: 0.7,
        tier: "weak-heuristic"
      }),
      decodeOutcome({
        _tag: "Underspecified" as const,
        bundle,
        partial: {
          measuredProperty: "generation"
        },
        missingRequired: ["statisticType"],
        gap: decodeGap({
          partial: {
            measuredProperty: "generation"
          },
          missingRequired: ["statisticType"],
          candidates: [candidate],
          reason: "missing-required"
        }),
        confidence: 0.6,
        tier: "weak-heuristic"
      }),
      decodeOutcome({
        _tag: "Conflicted" as const,
        bundle,
        hypotheses: [hypothesis],
        confidence: 0.5,
        tier: "strong-heuristic",
        conflicts: [
          {
            facet: "measuredProperty",
            values: ["capacity", "generation"]
          }
        ],
        gaps: [
          decodeGap({
            partial: {
              measuredProperty: "generation"
            },
            candidates: [],
            reason: "required-facet-conflict"
          })
        ]
      }),
      decodeOutcome({
        _tag: "OutOfRegistry" as const,
        bundle,
        hypothesis,
        items: [gapItem],
        gap: decodeGap({
          partial: {
            measuredProperty: "generation",
            technologyOrFuel: "hydro",
            statisticType: "flow",
            unitFamily: "energy"
          },
          candidates: [],
          reason: "no-candidates"
        })
      }),
      decodeOutcome({
        _tag: "NoMatch" as const,
        bundle,
        reason: "No usable semantic evidence"
      })
    ];

    for (const outcome of cases) {
      const roundTripped = decodeOutcome(encodeOutcome(outcome));
      expect(roundTripped).toEqual(outcome);

      const matchedTag = Match.valueTags(roundTripped, {
        Resolved: () => "Resolved",
        Ambiguous: () => "Ambiguous",
        Underspecified: () => "Underspecified",
        Conflicted: () => "Conflicted",
        OutOfRegistry: () => "OutOfRegistry",
        NoMatch: () => "NoMatch"
      });

      expect(matchedTag).toBe(outcome._tag);
    }
  });

  it("keeps the encoded outcome wire format stable", () => {
    const bundle = decodeBundle({
      postText: ["Retail power prices rose"],
      series: [],
      keyFindings: [],
      sourceLines: [],
      publisherHints: []
    });

    expect(
      [
        encodeOutcome(
          decodeOutcome({
            _tag: "Resolved" as const,
            bundle,
            sharedPartial: {
              measuredProperty: "price",
              statisticType: "price"
            },
            attachedContext: {},
            items: [],
            confidence: 1,
            tier: "entailment"
          })
        ),
        encodeOutcome(
          decodeOutcome({
            _tag: "Ambiguous" as const,
            bundle,
            hypotheses: [],
            items: [],
            gaps: [],
            confidence: 0.5,
            tier: "weak-heuristic"
          })
        ),
        encodeOutcome(
          decodeOutcome({
            _tag: "Underspecified" as const,
            bundle,
            partial: {
              measuredProperty: "price"
            },
            missingRequired: ["statisticType"],
            gap: {
              partial: {
                measuredProperty: "price"
              },
              missingRequired: ["statisticType"],
              candidates: [],
              reason: "missing-required"
            },
            confidence: 0.4,
            tier: "weak-heuristic"
          })
        ),
        encodeOutcome(
          decodeOutcome({
            _tag: "Conflicted" as const,
            bundle,
            hypotheses: [],
            conflicts: [
              {
                facet: "measuredProperty",
                values: ["capacity", "price"]
              }
            ],
            gaps: [
              {
                partial: {
                  measuredProperty: "price"
                },
                candidates: [],
                reason: "required-facet-conflict"
              }
            ],
            confidence: 0.3,
            tier: "strong-heuristic"
          })
        ),
        encodeOutcome(
          decodeOutcome({
            _tag: "OutOfRegistry" as const,
            bundle,
            hypothesis: {
              sharedPartial: {
                measuredProperty: "price",
                statisticType: "price"
              },
              attachedContext: {},
              items: [],
              evidence: [],
              confidence: 0.8,
              tier: "strong-heuristic"
            },
            items: [],
            gap: {
              partial: {
                measuredProperty: "price",
                statisticType: "price"
              },
              candidates: [],
              reason: "no-candidates"
            }
          })
        ),
        encodeOutcome(
          decodeOutcome({
            _tag: "NoMatch" as const,
            bundle,
            reason: "no signal"
          })
        )
      ]
    ).toMatchInlineSnapshot(`
      [
        {
          "_tag": "Resolved",
          "attachedContext": {},
          "bundle": {
            "keyFindings": [],
            "postText": [
              "Retail power prices rose",
            ],
            "publisherHints": [],
            "series": [],
            "sourceLines": [],
          },
          "confidence": 1,
          "items": [],
          "sharedPartial": {
            "measuredProperty": "price",
            "statisticType": "price",
          },
          "tier": "entailment",
        },
        {
          "_tag": "Ambiguous",
          "bundle": {
            "keyFindings": [],
            "postText": [
              "Retail power prices rose",
            ],
            "publisherHints": [],
            "series": [],
            "sourceLines": [],
          },
          "confidence": 0.5,
          "gaps": [],
          "hypotheses": [],
          "items": [],
          "tier": "weak-heuristic",
        },
        {
          "_tag": "Underspecified",
          "bundle": {
            "keyFindings": [],
            "postText": [
              "Retail power prices rose",
            ],
            "publisherHints": [],
            "series": [],
            "sourceLines": [],
          },
          "confidence": 0.4,
          "gap": {
            "candidates": [],
            "missingRequired": [
              "statisticType",
            ],
            "partial": {
              "measuredProperty": "price",
            },
            "reason": "missing-required",
          },
          "missingRequired": [
            "statisticType",
          ],
          "partial": {
            "measuredProperty": "price",
          },
          "tier": "weak-heuristic",
        },
        {
          "_tag": "Conflicted",
          "bundle": {
            "keyFindings": [],
            "postText": [
              "Retail power prices rose",
            ],
            "publisherHints": [],
            "series": [],
            "sourceLines": [],
          },
          "confidence": 0.3,
          "conflicts": [
            {
              "facet": "measuredProperty",
              "values": [
                "capacity",
                "price",
              ],
            },
          ],
          "gaps": [
            {
              "candidates": [],
              "partial": {
                "measuredProperty": "price",
              },
              "reason": "required-facet-conflict",
            },
          ],
          "hypotheses": [],
          "tier": "strong-heuristic",
        },
        {
          "_tag": "OutOfRegistry",
          "bundle": {
            "keyFindings": [],
            "postText": [
              "Retail power prices rose",
            ],
            "publisherHints": [],
            "series": [],
            "sourceLines": [],
          },
          "gap": {
            "candidates": [],
            "partial": {
              "measuredProperty": "price",
              "statisticType": "price",
            },
            "reason": "no-candidates",
          },
          "hypothesis": {
            "attachedContext": {},
            "confidence": 0.8,
            "evidence": [],
            "items": [],
            "sharedPartial": {
              "measuredProperty": "price",
              "statisticType": "price",
            },
            "tier": "strong-heuristic",
          },
          "items": [],
        },
        {
          "_tag": "NoMatch",
          "bundle": {
            "keyFindings": [],
            "postText": [
              "Retail power prices rose",
            ],
            "publisherHints": [],
            "series": [],
            "sourceLines": [],
          },
          "reason": "no signal",
        },
      ]
    `);
  });
});
