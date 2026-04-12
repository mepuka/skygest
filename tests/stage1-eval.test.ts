import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { makeDistributionId } from "../src/domain/data-layer/ids";
import type { Stage1Result } from "../src/domain/stage1Resolution";
import {
  assessEvalResult,
  buildFailureResult,
  classifyMissBucket,
  diffDirectRefs,
  emptyExpectedRefs,
  loadSnapshotFromString,
  projectExpectedRefsByPost,
  summarizeActualRefs
} from "../eval/resolution-stage1/shared";

describe("stage1 eval helpers", () => {
  it.effect("loads snapshot rows from jsonl", () =>
    Effect.gen(function* () {
      const rows = yield* loadSnapshotFromString(`
{"slug":"001-test","postUri":"at://did:plc:test/app.bsky.feed.post/abc123","metadata":{"handle":"tester.bsky.social","publisher":"eia"},"postContext":{"postUri":"at://did:plc:test/app.bsky.feed.post/abc123","text":"hello","links":[],"linkCards":[],"threadCoverage":"focus-only"},"vision":null,"sourceAttribution":null}
      `);

      expect(rows).toHaveLength(1);
      expect(rows[0]?.slug).toBe("001-test");
      expect(rows[0]?.metadata.publisher).toBe("eia");
    })
  );

  it("projects candidate truth by post and diffs direct refs", () => {
    const expectedByPost = projectExpectedRefsByPost([
      {
        _tag: "Candidate",
        id: "https://id.skygest.io/candidate/cand_1234567890AB" as any,
        sourceRef: {
          contentId: "at://did:plc:test/app.bsky.feed.post/abc123" as any
        },
        referencedDistributionId:
          "https://id.skygest.io/distribution/dist_1234567890AB" as any,
        referencedDatasetId:
          "https://id.skygest.io/dataset/ds_1234567890AB" as any,
        referencedAgentId: "https://id.skygest.io/agent/ag_1234567890AB" as any,
        referencedVariableId:
          "https://id.skygest.io/variable/var_1234567890AB" as any,
        referencedSeriesId: "https://id.skygest.io/series/ser_1234567890AB" as any,
        resolutionState: "resolved",
        createdAt: "2026-04-09T00:00:00.000Z" as any
      }
    ]);

    const expected = expectedByPost.get(
      "at://did:plc:test/app.bsky.feed.post/abc123"
    );
    expect(expected).toEqual({
      distributionIds: ["https://id.skygest.io/distribution/dist_1234567890AB"],
      datasetIds: ["https://id.skygest.io/dataset/ds_1234567890AB"],
      agentIds: ["https://id.skygest.io/agent/ag_1234567890AB"],
      variableIds: ["https://id.skygest.io/variable/var_1234567890AB"],
      seriesIds: ["https://id.skygest.io/series/ser_1234567890AB"]
    });

    const diff = diffDirectRefs(expected!, {
      distributionIds: ["https://id.skygest.io/distribution/dist_1234567890AB"],
      datasetIds: [],
      agentIds: [],
      variableIds: []
    });

    expect(diff.missing.datasetIds).toEqual([
      "https://id.skygest.io/dataset/ds_1234567890AB"
    ]);
    expect(diff.unexpected.distributionIds).toEqual([]);
  });

  it("classifies ambiguity and builds failure rows", () => {
    const row = {
      slug: "001-test",
      postUri: "at://did:plc:test/app.bsky.feed.post/abc123" as any,
      metadata: {
        handle: "tester.bsky.social",
        publisher: "eia"
      },
      postContext: {
        postUri: "at://did:plc:test/app.bsky.feed.post/abc123" as any,
        text: "text",
        links: [],
        linkCards: [],
        threadCoverage: "focus-only" as const
      },
      vision: null,
      sourceAttribution: null
    };
    const expected = {
      ...emptyExpectedRefs(),
      distributionIds: ["https://id.skygest.io/distribution/dist_1234567890AB" as any]
    };
    const result: Stage1Result = {
      matches: [],
      residuals: [
        {
          _tag: "AmbiguousCandidatesResidual" as const,
          grain: "Distribution" as const,
          bestRank: 3,
          candidates: [
            {
              entityId: makeDistributionId(
                "https://id.skygest.io/distribution/dist_1234567890AB"
              ),
              label: "A"
            },
            {
              entityId: makeDistributionId(
                "https://id.skygest.io/distribution/dist_ZYXWVUTSRQPO"
              ),
              label: "B"
            }
          ],
          evidence: []
        }
      ]
    };

    expect(classifyMissBucket(expected, summarizeActualRefs(result), result)).toBe(
      "stage1-ambiguity"
    );

    const assessed = assessEvalResult(row, expected, result, 4);
    expect(assessed.hasFindings).toBe(true);
    expect(assessed.missBucket).toBe("stage1-ambiguity");

    const failure = buildFailureResult(row, expected, "boom");
    expect(failure.error).toBe("boom");
    expect(failure.actual).toBeNull();
  });
});
