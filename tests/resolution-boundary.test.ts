import { describe, expect, it } from "@effect/vitest";
import { Schema } from "effect";
import { makeDatasetId, makeVariableId } from "../src/domain/data-layer/ids";
import {
  DataRefResolverRunParams,
  ResolvePostResponse
} from "../src/domain/resolution";
import { PostUri } from "../src/domain/types";

const asPostUri = Schema.decodeUnknownSync(PostUri)(
  "at://did:plc:test/app.bsky.feed.post/resolution-boundary"
);

const decodeDataRefResolverRunParams = Schema.decodeUnknownSync(
  DataRefResolverRunParams
);
const decodeResolvePostResponse = Schema.decodeUnknownSync(ResolvePostResponse);

describe("resolution boundary schemas", () => {
  it("decodes workflow params carrying Stage3Input[]", () => {
    const params = decodeDataRefResolverRunParams({
      postUri: asPostUri,
      stage3Inputs: [
        {
          _tag: "Stage3Input",
          postUri: asPostUri,
          originalResidual: {
            _tag: "DeferredToStage2Residual",
            source: "post-text",
            text: "EIA annual wind generation",
            reason: "needs structured decomposition"
          },
          stage2Lane: "pending",
          candidateSet: [],
          matchedSurfaceForms: [],
          unmatchedSurfaceForms: [],
          reason: "Stage 2 kernel not yet executed"
        }
      ]
    });

    expect(params.stage3Inputs).toHaveLength(1);
    expect(params.stage3Inputs[0]?.stage2Lane).toBe("pending");
  });

  it("decodes resolver responses carrying a non-empty stage2 payload", () => {
    const response = decodeResolvePostResponse({
      postUri: asPostUri,
      stage1: {
        matches: [],
        residuals: []
      },
      stage2: {
        matches: [
          {
            _tag: "VariableMatch",
            variableId: makeVariableId(
              "https://id.skygest.io/variable/var_1234567890AB"
            ),
            label: "Installed wind generation",
            bestRank: 1,
            evidence: []
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
            evidence: []
          }
        ],
        escalations: []
      },
      resolverVersion: "stage1-resolver@sky-238",
      latencyMs: {
        stage1: 1,
        total: 2
      }
    });

    expect(response.stage2?.matches).toHaveLength(1);
    expect(response.stage2?.corroborations).toHaveLength(1);
  });
});
