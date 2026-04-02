import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { SourceAttributionMatchResult } from "../src/domain/sourceMatching";
import {
  assessEvalResult,
  buildFailureResult,
  classifyProviderVerdict,
  loadGoldenSetFromString
} from "../eval/source-attribution/shared";

const goldenSetPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../eval/source-attribution/golden-set.jsonl"
);

const makeResult = (
  overrides: Partial<SourceAttributionMatchResult>
): SourceAttributionMatchResult => ({
  provider: null,
  resolution: "unmatched",
  providerCandidates: [],
  contentSource: null,
  socialProvenance: null,
  ...overrides
});

describe("source attribution eval helpers", () => {
  it.effect("loads the source attribution golden set", () =>
    Effect.gen(function* () {
      const raw = fs.readFileSync(goldenSetPath, "utf-8");
      const entries = yield* loadGoldenSetFromString(raw);

      expect(entries).toHaveLength(10);
      expect(entries[0]?.slug).toBe("ercot-link-domain");
      expect(entries[3]?.expected.sourceFamily).toBe(
        "Monthly Outlook for Resource Adequacy (MORA)"
      );
    })
  );

  it("classifies matching providers as true matches", () => {
    const verdict = classifyProviderVerdict(
      {
        resolution: "matched",
        providerId: "ercot" as any,
        sourceFamily: null,
        contentSourceDomain: "ercot.com",
        publication: null
      },
      makeResult({
        resolution: "matched",
        provider: {
          providerId: "ercot" as any,
          providerLabel: "ERCOT",
          sourceFamily: null
        }
      })
    );

    expect(verdict).toBe("true-match");
  });

  it("classifies wrong matched providers as false positives", () => {
    const verdict = classifyProviderVerdict(
      {
        resolution: "matched",
        providerId: "ercot" as any,
        sourceFamily: null,
        contentSourceDomain: null,
        publication: null
      },
      makeResult({
        resolution: "matched",
        provider: {
          providerId: "caiso" as any,
          providerLabel: "California ISO",
          sourceFamily: null
        }
      })
    );

    expect(verdict).toBe("false-positive");
  });

  it("classifies missing expected providers as misses", () => {
    const verdict = classifyProviderVerdict(
      {
        resolution: "matched",
        providerId: "ercot" as any,
        sourceFamily: null,
        contentSourceDomain: null,
        publication: null
      },
      makeResult({
        resolution: "unmatched"
      })
    );

    expect(verdict).toBe("miss");
  });

  it("surfaces ancillary mismatches without hiding provider passes", () => {
    const assessed = assessEvalResult(
      {
        slug: "gridstatus-ercot-embed",
        thread: "ERCOT dashboard share",
        context: "Platform embed should remain content source.",
        notes: "Ancillary content-source guardrail.",
        input: {
          post: {
            did: "did:plc:test" as any,
            handle: "gridwatch.bsky.social",
            text: "ERCOT dashboard looks interesting today."
          },
          links: [],
          linkCards: [],
          vision: null
        },
        expected: {
          resolution: "matched",
          providerId: "ercot" as any,
          sourceFamily: null,
          contentSourceDomain: "gridstatus.io",
          publication: null
        }
      },
      makeResult({
        resolution: "matched",
        provider: {
          providerId: "ercot" as any,
          providerLabel: "ERCOT",
          sourceFamily: null
        },
        contentSource: {
          url: "https://ercot.com/gridinfo",
          title: null,
          domain: "ercot.com",
          publication: null
        }
      }),
      12
    );

    expect(assessed.rubric?.providerVerdict).toBe("true-match");
    expect(assessed.rubric?.contentSourceMatches).toBe(false);
    expect(assessed.rubric?.overall).toBe("needs-review");
  });

  it("builds failure records without inventing results", () => {
    const failed = buildFailureResult(
      {
        slug: "failed-case",
        thread: "Failure",
        context: "Failure context",
        notes: "Failure notes",
        input: {
          post: {
            did: "did:plc:test" as any,
            handle: null,
            text: "text"
          },
          links: [],
          linkCards: [],
          vision: null
        },
        expected: {
          resolution: "unmatched",
          providerId: null,
          sourceFamily: null,
          contentSourceDomain: null,
          publication: null
        }
      },
      "boom"
    );

    expect(failed.actual).toBeNull();
    expect(failed.rubric).toBeNull();
    expect(failed.error).toBe("boom");
  });
});
