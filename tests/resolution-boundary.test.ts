import { describe, expect, it } from "@effect/vitest";
import { Schema } from "effect";
import {
  ResolveBulkRequest,
  ResolveBulkResponse,
  ResolvePostRequest,
  ResolvePostResponse
} from "../src/domain/resolution";
import { PostUri } from "../src/domain/types";

const asPostUri = Schema.decodeUnknownSync(PostUri);
const decodeResolvePostRequest = Schema.decodeUnknownSync(ResolvePostRequest);
const decodeResolveBulkRequest = Schema.decodeUnknownSync(ResolveBulkRequest);
const decodeResolvePostResponse = Schema.decodeUnknownSync(ResolvePostResponse);
const decodeResolveBulkResponse = Schema.decodeUnknownSync(ResolveBulkResponse);
const encodeResolvePostResponse = Schema.encodeSync(ResolvePostResponse);
const encodeResolveBulkResponse = Schema.encodeSync(ResolveBulkResponse);

const postUri = asPostUri(
  "at://did:plc:test/app.bsky.feed.post/resolution-boundary"
);
const secondPostUri = asPostUri(
  "at://did:plc:test/app.bsky.feed.post/resolution-boundary-2"
);

const windVariableId =
  "https://id.skygest.io/variable/var_1234567890AB" as const;
const solarVariableId =
  "https://id.skygest.io/variable/var_ABCDEFGHIJKL" as const;

const ambiguousKernelOutcome = {
  _tag: "Ambiguous" as const,
  bundle: {
    postUri,
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
        itemKey: "hydro",
        legendLabel: "Hydro",
        unit: "TWh"
      }
    ],
    keyFindings: [],
    sourceLines: [],
    publisherHints: []
  },
  hypotheses: [
    {
      sharedPartial: {
        measuredProperty: "generation",
        domainObject: "electricity",
        statisticType: "flow"
      },
      attachedContext: {},
      items: [
        {
          itemKey: "wind",
          partial: {
            technologyOrFuel: "wind"
          },
          evidence: [
            {
              source: "series-label" as const,
              text: "Wind",
              itemKey: "wind"
            }
          ]
        },
        {
          itemKey: "hydro",
          partial: {
            technologyOrFuel: "hydro"
          },
          evidence: [
            {
              source: "series-label" as const,
              text: "Hydro",
              itemKey: "hydro"
            }
          ]
        }
      ],
      evidence: [
        {
          source: "chart-title" as const,
          text: "Electricity generation"
        }
      ],
      tier: "strong-heuristic" as const
    }
  ],
  items: [
    {
      _tag: "bound" as const,
      itemKey: "wind",
      semanticPartial: {
        measuredProperty: "generation",
        domainObject: "electricity",
        technologyOrFuel: "wind",
        statisticType: "flow"
      },
      attachedContext: {},
      evidence: [
        {
          source: "series-label" as const,
          text: "Wind",
          itemKey: "wind"
        }
      ],
      variableId: windVariableId,
      label: "Wind electricity generation"
    },
    {
      _tag: "gap" as const,
      itemKey: "hydro",
      semanticPartial: {
        measuredProperty: "generation",
        domainObject: "electricity",
        technologyOrFuel: "hydro",
        statisticType: "flow"
      },
      attachedContext: {},
      evidence: [
        {
          source: "series-label" as const,
          text: "Hydro",
          itemKey: "hydro"
        }
      ],
      candidates: [
        {
          variableId: solarVariableId,
          label: "Solar electricity generation",
          matchedFacets: [
            "measuredProperty",
            "domainObject",
            "statisticType"
          ],
          mismatchedFacets: [],
          subsumptionRatio: 0.75,
          partialSpecificity: 4,
          semanticPartial: {
            measuredProperty: "generation",
            domainObject: "electricity",
            technologyOrFuel: "solar PV",
            statisticType: "flow"
          }
        }
      ],
      reason: "ambiguous-candidates" as const
    }
  ],
  gaps: [
    {
      partial: {
        measuredProperty: "generation",
        domainObject: "electricity",
        technologyOrFuel: "hydro",
        statisticType: "flow"
      },
      candidates: [
        {
          variableId: solarVariableId,
          label: "Solar electricity generation",
          matchedFacets: [
            "measuredProperty",
            "domainObject",
            "statisticType"
          ],
          mismatchedFacets: [],
          subsumptionRatio: 0.75,
          partialSpecificity: 4,
          semanticPartial: {
            measuredProperty: "generation",
            domainObject: "electricity",
            technologyOrFuel: "solar PV",
            statisticType: "flow"
          }
        }
      ],
      reason: "ambiguous-candidates" as const
    }
  ],
  tier: "strong-heuristic" as const
};

describe("resolution boundary schemas", () => {
  it("decodes single-post requests", () => {
    const request = decodeResolvePostRequest({
      postUri
    });

    expect(request.postUri).toBe(postUri);
  });

  it("rejects empty bulk requests", () => {
    expect(() =>
      decodeResolveBulkRequest({
        posts: []
      })
    ).toThrow();
  });

  it("encodes and decodes resolver responses carrying tagged kernel outcomes", () => {
    const response = decodeResolvePostResponse({
      postUri,
      stage1: {
        matches: [],
        residuals: []
      },
      kernel: [ambiguousKernelOutcome],
      resolverVersion: "resolution-kernel@sky-314",
      latencyMs: {
        stage1: 1,
        kernel: 1,
        total: 2
      }
    });

    const encoded = encodeResolvePostResponse(response);
    const roundTripped = decodeResolvePostResponse(encoded);

    expect(roundTripped.kernel).toHaveLength(1);
    expect(roundTripped.kernel[0]?._tag).toBe("Ambiguous");
    if (roundTripped.kernel[0]?._tag !== "Ambiguous") {
      return;
    }

    expect(roundTripped.kernel[0].items.map((item) => item._tag)).toEqual([
      "bound",
      "gap"
    ]);
    expect(roundTripped.kernel[0].gaps[0]?.reason).toBe("ambiguous-candidates");
  });

  it("encodes and decodes bulk resolver responses with keyed errors", () => {
    const response = decodeResolveBulkResponse({
      results: {
        [postUri]: {
          postUri,
          stage1: {
            matches: [],
            residuals: []
          },
          kernel: [ambiguousKernelOutcome],
          resolverVersion: "resolution-kernel@sky-314",
          latencyMs: {
            stage1: 1,
            kernel: 1,
            total: 2
          }
        }
      },
      errors: {
        [secondPostUri]: {
          tag: "ResolverSourceAttributionMissingError",
          message: "missing source attribution",
          retryable: false
        }
      }
    });

    const encoded = encodeResolveBulkResponse(response);
    const roundTripped = decodeResolveBulkResponse(encoded);

    expect(roundTripped.results[postUri]?.kernel[0]?._tag).toBe("Ambiguous");
    expect(roundTripped.errors[secondPostUri]?.tag).toBe(
      "ResolverSourceAttributionMissingError"
    );
  });
});
