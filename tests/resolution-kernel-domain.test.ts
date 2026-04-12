import { describe, expect, it } from "@effect/vitest";
import { Match, Schema } from "effect";
import { makeVariableId } from "../src/domain/data-layer/ids";
import {
  AttachedContext,
  BoundResolutionItem,
  ResolutionEvidenceBundle,
  ResolutionEvidenceReference,
  ResolutionHypothesis,
  ResolutionOutcome
} from "../src/domain/resolutionKernel";

const decodeBundle = Schema.decodeUnknownSync(ResolutionEvidenceBundle);
const encodeBundle = Schema.encodeSync(ResolutionEvidenceBundle);
const decodeContext = Schema.decodeUnknownSync(AttachedContext);
const decodeEvidence = Schema.decodeUnknownSync(ResolutionEvidenceReference);
const decodeHypothesis = Schema.decodeUnknownSync(ResolutionHypothesis);
const decodeItem = Schema.decodeUnknownSync(BoundResolutionItem);
const decodeOutcome = Schema.decodeUnknownSync(ResolutionOutcome);
const encodeOutcome = Schema.encodeSync(ResolutionOutcome);

describe("resolutionKernel domain contract", () => {
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
      confidence: 0.9
    });
    const item = decodeItem({
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
    const outOfRegistryItem = decodeItem({
      itemKey: "solar",
      semanticPartial: {
        measuredProperty: "generation",
        technologyOrFuel: "solar",
        statisticType: "flow",
        unitFamily: "energy"
      },
      attachedContext: context,
      evidence: [evidence],
      label: "Solar generation"
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
        items: [item]
      }),
      decodeOutcome({
        _tag: "Ambiguous" as const,
        bundle,
        hypotheses: [hypothesis]
      }),
      decodeOutcome({
        _tag: "Underspecified" as const,
        bundle,
        partial: {
          measuredProperty: "generation"
        },
        hypotheses: [hypothesis]
      }),
      decodeOutcome({
        _tag: "Conflicted" as const,
        bundle,
        hypotheses: [hypothesis],
        conflicts: [
          {
            facet: "measuredProperty",
            values: ["capacity", "generation"]
          }
        ]
      }),
      decodeOutcome({
        _tag: "OutOfRegistry" as const,
        bundle,
        hypothesis,
        items: [outOfRegistryItem]
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
});
