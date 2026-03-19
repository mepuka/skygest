import { describe, expect, it } from "@effect/vitest";
import { Schema } from "effect";
import {
  MatchSignalType,
  MatchEvidence,
  ProviderMatch,
  MatchResult
} from "../src/domain/source";

describe("evidence contract types", () => {
  it("MatchSignalType accepts all 7 signal types", () => {
    const signals: Schema.Schema.Type<typeof MatchSignalType>[] = [
      "source-line-alias",
      "source-line-domain",
      "chart-title-alias",
      "link-domain",
      "embed-link-domain",
      "visible-url-domain",
      "post-text-mention"
    ];
    expect(signals).toHaveLength(7);
  });

  it("MatchResult resolution discriminates matched/ambiguous/none", () => {
    const decode = Schema.decodeUnknownSync(MatchResult);
    const result = decode({
      providerMatches: [],
      selectedProvider: null,
      resolution: "none",
      contentSource: null,
      socialProvenance: null
    });
    expect(result.resolution).toBe("none");
  });

  it("MatchResult decodes correctly with a matched provider", () => {
    const decode = Schema.decodeUnknownSync(MatchResult);
    const result = decode({
      providerMatches: [
        {
          providerId: "ercot",
          providerLabel: "ERCOT",
          sourceFamily: null,
          signals: [
            {
              signal: "link-domain",
              raw: { url: "https://ercot.com/data", domain: "ercot.com" }
            }
          ]
        }
      ],
      selectedProvider: {
        providerId: "ercot",
        providerLabel: "ERCOT",
        sourceFamily: null
      },
      resolution: "matched",
      contentSource: {
        url: "https://ercot.com/data",
        title: "ERCOT Data",
        domain: "ercot.com",
        publication: null
      },
      socialProvenance: {
        did: "did:plc:abc123",
        handle: "expert.bsky.social"
      }
    });
    expect(result.resolution).toBe("matched");
    expect(result.selectedProvider?.providerId).toBe("ercot");
    expect(result.providerMatches).toHaveLength(1);
    expect(result.providerMatches[0]?.signals[0]?.signal).toBe("link-domain");
    expect(result.contentSource?.domain).toBe("ercot.com");
    expect(result.socialProvenance?.did).toBe("did:plc:abc123");
  });
});
