import { describe, expect, it } from "@effect/vitest";
import type {
  EnrichmentPlannedQuoteContext
} from "../src/domain/enrichmentPlan";
import {
  canExecuteEnrichmentPlan,
  defaultStopReasonForEnrichmentType,
  evaluateEnrichmentPlanningDecision,
  hasDurableQuoteContext,
  hasGroundingSignals,
  hasSourceSignals,
  hasVisualAssets,
  isSkippedEnrichmentPlan,
  type EnrichmentPlanningContext
} from "../src/enrichment/EnrichmentPredicates";

const makeContext = (
  overrides: Partial<EnrichmentPlanningContext> = {}
): EnrichmentPlanningContext => ({
  enrichmentType: "vision",
  assets: [],
  links: [],
  quote: null,
  linkCards: [],
  existingEnrichments: [],
  ...overrides
});

const makeQuote = (
  overrides: Partial<EnrichmentPlannedQuoteContext> = {}
): EnrichmentPlannedQuoteContext => ({
  source: "embed",
  uri: null,
  text: null,
  author: null,
  ...overrides
});

describe("EnrichmentPredicates", () => {
  it("requires visual assets for vision planning", () => {
    expect(hasVisualAssets(makeContext())).toBe(false);
    expect(
      hasVisualAssets(
        makeContext({
          assets: [
            {
              assetKey: "embed:0:image",
              assetType: "image",
              source: "embed",
              index: 0,
              thumb: "thumb.jpg",
              fullsize: "full.jpg",
              alt: null
            }
          ]
        })
      )
    ).toBe(true);
  });

  it("treats any quote field as durable quote context", () => {
    expect(hasDurableQuoteContext(makeContext())).toBe(false);
    expect(
      hasDurableQuoteContext(
        makeContext({
          quote: makeQuote({
            text: "Quoted source context"
          })
        })
      )
    ).toBe(true);
  });

  it("separates source and grounding signals", () => {
    const imageOnly = makeContext({
      enrichmentType: "source-attribution",
      assets: [
        {
          assetKey: "embed:0:image",
          assetType: "image",
          source: "embed",
          index: 0,
          thumb: "thumb.jpg",
          fullsize: "full.jpg",
          alt: null
        }
      ]
    });

    expect(hasSourceSignals(imageOnly)).toBe(true);
    expect(hasGroundingSignals(imageOnly)).toBe(false);
  });

  it("evaluates planning decisions from the shared predicate set", () => {
    expect(
      evaluateEnrichmentPlanningDecision(
        makeContext({
          enrichmentType: "vision"
        })
      )
    ).toEqual({
      decision: "skip",
      stopReason: "no-visual-assets"
    });

    expect(
      evaluateEnrichmentPlanningDecision(
        makeContext({
          enrichmentType: "source-attribution",
          quote: makeQuote({
            uri: "at://did:plc:test/app.bsky.feed.post/quoted"
          })
        })
      )
    ).toEqual({
      decision: "execute"
    });

    expect(
      evaluateEnrichmentPlanningDecision(
        makeContext({
          enrichmentType: "grounding",
          linkCards: [
            {
              source: "embed",
              uri: "https://example.com/report",
              title: "Report",
              description: null,
              thumb: null
            }
          ]
        })
      )
    ).toEqual({
      decision: "execute"
    });
  });

  it("shares default stop reasons with workflow review handling", () => {
    expect(defaultStopReasonForEnrichmentType("vision")).toBe("no-visual-assets");
    expect(defaultStopReasonForEnrichmentType("source-attribution")).toBe(
      "no-source-signals"
    );
    expect(defaultStopReasonForEnrichmentType("grounding")).toBe(
      "no-grounding-signals"
    );
  });

  it("exposes reusable plan-level predicates", () => {
    expect(canExecuteEnrichmentPlan(makeContext())).toBe(false);
    expect(
      canExecuteEnrichmentPlan(
        makeContext({
          enrichmentType: "grounding",
          existingEnrichments: [
            {
              output: {
                kind: "source-attribution",
                provider: null,
                contentSource: null,
                socialProvenance: null,
                processedAt: 1
              },
              updatedAt: 1,
              enrichedAt: 1
            }
          ]
        })
      )
    ).toBe(true);

    const skippedPlan = {
      decision: "skip"
    } as const;
    const executePlan = {
      decision: "execute"
    } as const;

    expect(isSkippedEnrichmentPlan(skippedPlan)).toBe(true);
    expect(isSkippedEnrichmentPlan(executePlan)).toBe(false);
  });
});
