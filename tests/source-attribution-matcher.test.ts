import { describe, expect, it } from "@effect/vitest";
import { Schema } from "effect";
import {
  MatchSignalType,
  MatchEvidence,
  ProviderMatch,
  MatchResolution,
  MatchResult
} from "../src/domain/source";
import {
  stripSourcePrefix,
  isWholeWordMatch,
  extractDomainFromText
} from "../src/source/normalize";

describe("evidence contract types", () => {
  it("MatchSignalType decodes all 7 signal types and rejects invalid", () => {
    const decode = Schema.decodeUnknownSync(MatchSignalType);
    const signals = [
      "source-line-alias",
      "source-line-domain",
      "chart-title-alias",
      "link-domain",
      "embed-link-domain",
      "visible-url-domain",
      "post-text-mention"
    ];
    for (const s of signals) {
      expect(decode(s)).toBe(s);
    }
    expect(() => decode("invalid-signal")).toThrow();
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

describe("normalization utilities", () => {
  describe("stripSourcePrefix", () => {
    it("removes common prefixes", () => {
      expect(stripSourcePrefix("Source: EIA")).toBe("EIA");
      expect(stripSourcePrefix("Data: AESO")).toBe("AESO");
      expect(stripSourcePrefix("Source data: BC Hydro")).toBe("BC Hydro");
      expect(stripSourcePrefix("via ERCOT")).toBe("ERCOT");
    });

    it("is case-insensitive", () => {
      expect(stripSourcePrefix("SOURCE: EIA")).toBe("EIA");
      expect(stripSourcePrefix("source: EIA")).toBe("EIA");
      expect(stripSourcePrefix("Via ERCOT")).toBe("ERCOT");
      expect(stripSourcePrefix("VIA ERCOT")).toBe("ERCOT");
      expect(stripSourcePrefix("DATA: AESO")).toBe("AESO");
      expect(stripSourcePrefix("Source Data: NEB")).toBe("NEB");
    });

    it("returns original text when no prefix matches", () => {
      expect(stripSourcePrefix("EIA")).toBe("EIA");
      expect(stripSourcePrefix("ERCOT load data")).toBe("ERCOT load data");
    });

    it("trims whitespace", () => {
      expect(stripSourcePrefix("  Source: EIA  ")).toBe("EIA");
      expect(stripSourcePrefix("  EIA  ")).toBe("EIA");
    });

    it("handles prefix with extra whitespace", () => {
      expect(stripSourcePrefix("Source:  EIA")).toBe("EIA");
      expect(stripSourcePrefix("Source :  EIA")).toBe("EIA");
    });
  });

  describe("isWholeWordMatch", () => {
    it("matches on word boundaries", () => {
      expect(isWholeWordMatch("ERCOT demand is near peak", "ERCOT")).toBe(true);
      expect(isWholeWordMatch("the ercot grid", "ERCOT")).toBe(true);
      expect(isWholeWordMatch("forecast data", "ERCOT")).toBe(false);
    });

    it("is case-insensitive", () => {
      expect(isWholeWordMatch("ercot data", "ERCOT")).toBe(true);
      expect(isWholeWordMatch("ERCOT data", "ercot")).toBe(true);
    });

    it("handles hyphenated aliases like ISO-NE", () => {
      expect(isWholeWordMatch("ISO-NE prices", "ISO-NE")).toBe(true);
      expect(isWholeWordMatch("the ISO-NE market", "ISO-NE")).toBe(true);
    });

    it("handles ENTSO-E", () => {
      expect(isWholeWordMatch("ENTSO-E transparency platform", "ENTSO-E")).toBe(
        true
      );
    });

    it("skips aliases shorter than 3 chars", () => {
      expect(isWholeWordMatch("BC Hydro report", "BC")).toBe(false);
      expect(isWholeWordMatch("AB power", "AB")).toBe(false);
    });

    it("does not match partial words", () => {
      expect(isWholeWordMatch("ERCOTX data", "ERCOT")).toBe(false);
      expect(isWholeWordMatch("XERCOT data", "ERCOT")).toBe(false);
    });

    it("matches aliases with special regex characters", () => {
      expect(isWholeWordMatch("reporting by S&P Global", "S&P Global")).toBe(
        true
      );
    });

    it("matches 3-char aliases", () => {
      expect(isWholeWordMatch("EIA data is out", "EIA")).toBe(true);
      expect(isWholeWordMatch("NEB report", "NEB")).toBe(true);
    });
  });

  describe("extractDomainFromText", () => {
    it("extracts domain from full URLs", () => {
      expect(extractDomainFromText("https://ercot.com/data")).toBe(
        "ercot.com"
      );
      expect(extractDomainFromText("http://www.eia.gov/petroleum")).toBe(
        "eia.gov"
      );
    });

    it("extracts bare domains", () => {
      expect(extractDomainFromText("Source: eia.gov")).toBe("eia.gov");
      expect(extractDomainFromText("from ercot.com")).toBe("ercot.com");
    });

    it("strips www prefix", () => {
      expect(extractDomainFromText("www.eia.gov")).toBe("eia.gov");
      expect(extractDomainFromText("https://www.ercot.com/data")).toBe(
        "ercot.com"
      );
    });

    it("returns null when no domain found", () => {
      expect(extractDomainFromText("Source: EIA")).toBeNull();
      expect(extractDomainFromText("ERCOT demand is near peak")).toBeNull();
      expect(extractDomainFromText("")).toBeNull();
    });

    it("lowercases the extracted domain", () => {
      expect(extractDomainFromText("ERCOT.COM/data")).toBe("ercot.com");
      expect(extractDomainFromText("https://EIA.GOV")).toBe("eia.gov");
    });

    it("handles domains with subdomains", () => {
      expect(extractDomainFromText("https://api.gridstatus.io/live")).toBe(
        "api.gridstatus.io"
      );
    });

    it("handles domains embedded in text", () => {
      expect(
        extractDomainFromText("Check out gridstatus.io for live data")
      ).toBe("gridstatus.io");
    });

    it("rejects common abbreviations (U.S., a.m., i.e., e.g.)", () => {
      expect(extractDomainFromText("at 10 a.m. ET")).toBeNull();
      expect(extractDomainFromText("U.S. Energy Information Administration")).toBeNull();
      expect(extractDomainFromText("i.e. this is a test")).toBeNull();
      expect(extractDomainFromText("e.g. solar panels")).toBeNull();
    });
  });
});
