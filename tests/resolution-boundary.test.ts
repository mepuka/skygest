import { describe, expect, it } from "@effect/vitest";
import { Schema } from "effect";
import { ResolvePostResponse } from "../src/domain/resolution";
import { PostUri } from "../src/domain/types";

const asPostUri = Schema.decodeUnknownSync(PostUri)(
  "at://did:plc:test/app.bsky.feed.post/resolution-boundary"
);

const decodeResolvePostResponse = Schema.decodeUnknownSync(ResolvePostResponse);

describe("resolution boundary schemas", () => {
  it("decodes resolver responses carrying kernel outcomes", () => {
    const response = decodeResolvePostResponse({
      postUri: asPostUri,
      stage1: {
        matches: [],
        residuals: []
      },
      kernel: [
        {
          _tag: "NoMatch",
          bundle: {
            postUri: asPostUri,
            postText: ["Installed wind generation"],
            series: [],
            keyFindings: [],
            sourceLines: [],
            publisherHints: []
          },
          reason: "no checked-in registry match"
        }
      ],
      resolverVersion: "resolution-kernel@sky-314",
      latencyMs: {
        stage1: 1,
        kernel: 1,
        total: 2
      }
    });

    expect(response.kernel).toHaveLength(1);
    expect(response.kernel[0]?._tag).toBe("NoMatch");
  });
});
