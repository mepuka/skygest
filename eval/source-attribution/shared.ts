import { Effect, Schema } from "effect";
import { ProviderId } from "../../src/domain/source";
import {
  SourceAttributionMatcherInput,
  SourceAttributionResolution,
  type SourceAttributionMatchResult
} from "../../src/domain/sourceMatching";
import {
  decodeJsonStringWith,
  stringifyUnknown
} from "../../src/platform/Json";

export class SourceAttributionEvalGoldenSetDecodeError extends Schema.TaggedErrorClass<SourceAttributionEvalGoldenSetDecodeError>()(
  "SourceAttributionEvalGoldenSetDecodeError",
  {
    lineNumber: Schema.Number,
    message: Schema.String
  }
) {}

export const SourceAttributionEvalExpectation = Schema.Struct({
  resolution: SourceAttributionResolution,
  providerId: Schema.NullOr(ProviderId),
  sourceFamily: Schema.NullOr(Schema.String),
  contentSourceDomain: Schema.NullOr(Schema.String),
  publication: Schema.NullOr(Schema.String)
});
export type SourceAttributionEvalExpectation = Schema.Schema.Type<
  typeof SourceAttributionEvalExpectation
>;

export const SourceAttributionEvalGoldenEntry = Schema.Struct({
  slug: Schema.String,
  thread: Schema.String,
  context: Schema.String,
  notes: Schema.String,
  input: SourceAttributionMatcherInput,
  expected: SourceAttributionEvalExpectation
});
export type SourceAttributionEvalGoldenEntry = Schema.Schema.Type<
  typeof SourceAttributionEvalGoldenEntry
>;

export type ProviderEvalVerdict =
  | "true-match"
  | "ambiguous-case"
  | "expected-unmatched"
  | "false-positive"
  | "miss";

export type SourceAttributionEvalActual = {
  readonly resolution: Schema.Schema.Type<typeof SourceAttributionResolution>;
  readonly providerId: string | null;
  readonly providerLabel: string | null;
  readonly sourceFamily: string | null;
  readonly candidateIds: ReadonlyArray<string>;
  readonly bestSignals: ReadonlyArray<string>;
  readonly contentSourceDomain: string | null;
  readonly publication: string | null;
};

export type SourceAttributionEvalRubric = {
  readonly providerVerdict: ProviderEvalVerdict;
  readonly contentSourceMatches: boolean;
  readonly publicationMatches: boolean;
  readonly sourceFamilyMatches: boolean;
  readonly hasFindings: boolean;
  readonly overall: "ok" | "needs-review";
};

export type SourceAttributionEvalResult = {
  readonly slug: string;
  readonly thread: string;
  readonly context: string;
  readonly notes: string;
  readonly expected: SourceAttributionEvalExpectation;
  readonly actual: SourceAttributionEvalActual | null;
  readonly rubric: SourceAttributionEvalRubric | null;
  readonly result: SourceAttributionMatchResult | null;
  readonly elapsed: number;
  readonly error: string | null;
};

const decodeGoldenEntryJson = decodeJsonStringWith(
  SourceAttributionEvalGoldenEntry
);

const providerPassVerdicts = new Set<ProviderEvalVerdict>([
  "true-match",
  "ambiguous-case",
  "expected-unmatched"
]);

const toGoldenSetLines = (raw: string) =>
  raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

const bestSignals = (
  result: SourceAttributionMatchResult
): ReadonlyArray<string> => {
  if (result.providerCandidates.length === 0) {
    return [];
  }

  const rank = Math.min(
    ...result.providerCandidates.map((candidate) => candidate.bestRank)
  );
  const signals = new Set<string>();

  for (const candidate of result.providerCandidates) {
    if (candidate.bestRank !== rank) {
      continue;
    }

    for (const evidence of candidate.evidence) {
      if (evidence.rank === rank) {
        signals.add(evidence.signal);
      }
    }
  }

  return [...signals].sort();
};

export const loadGoldenSetFromString = (raw: string) =>
  Effect.forEach(toGoldenSetLines(raw), (line, index) =>
    Effect.try({
      try: () => decodeGoldenEntryJson(line),
      catch: (error) =>
        new SourceAttributionEvalGoldenSetDecodeError({
          lineNumber: index + 1,
          message: `golden-set.jsonl line ${index + 1}: ${stringifyUnknown(error)}`
        })
    })
  );

export const classifyProviderVerdict = (
  expected: SourceAttributionEvalExpectation,
  result: SourceAttributionMatchResult
): ProviderEvalVerdict => {
  switch (expected.resolution) {
    case "matched":
      if (
        result.resolution === "matched" &&
        result.provider?.providerId === expected.providerId
      ) {
        return "true-match";
      }

      return result.resolution === "matched" ? "false-positive" : "miss";
    case "ambiguous":
      if (result.resolution === "ambiguous") {
        return "ambiguous-case";
      }

      return result.resolution === "matched" ? "false-positive" : "miss";
    case "unmatched":
      return result.resolution === "unmatched"
        ? "expected-unmatched"
        : "false-positive";
  }
};

export const summarizeMatchResult = (
  result: SourceAttributionMatchResult
): SourceAttributionEvalActual => ({
  resolution: result.resolution,
  providerId: result.provider?.providerId ?? null,
  providerLabel: result.provider?.providerLabel ?? null,
  sourceFamily: result.provider?.sourceFamily ?? null,
  candidateIds: result.providerCandidates.map((candidate) => candidate.providerId),
  bestSignals: bestSignals(result),
  contentSourceDomain: result.contentSource?.domain ?? null,
  publication: result.contentSource?.publication ?? null
});

export const assessEvalResult = (
  entry: SourceAttributionEvalGoldenEntry,
  result: SourceAttributionMatchResult,
  elapsed: number
): SourceAttributionEvalResult => {
  const actual = summarizeMatchResult(result);
  const providerVerdict = classifyProviderVerdict(entry.expected, result);
  const contentSourceMatches =
    entry.expected.contentSourceDomain === actual.contentSourceDomain;
  const publicationMatches =
    entry.expected.publication === actual.publication;
  const sourceFamilyMatches =
    entry.expected.sourceFamily === actual.sourceFamily;
  const hasFindings =
    !providerPassVerdicts.has(providerVerdict) ||
    !contentSourceMatches ||
    !publicationMatches ||
    !sourceFamilyMatches;

  return {
    slug: entry.slug,
    thread: entry.thread,
    context: entry.context,
    notes: entry.notes,
    expected: entry.expected,
    actual,
    rubric: {
      providerVerdict,
      contentSourceMatches,
      publicationMatches,
      sourceFamilyMatches,
      hasFindings,
      overall: hasFindings ? "needs-review" : "ok"
    },
    result,
    elapsed,
    error: null
  };
};

export const buildFailureResult = (
  entry: SourceAttributionEvalGoldenEntry,
  error: string,
  elapsed = 0
): SourceAttributionEvalResult => ({
  slug: entry.slug,
  thread: entry.thread,
  context: entry.context,
  notes: entry.notes,
  expected: entry.expected,
  actual: null,
  rubric: null,
  result: null,
  elapsed,
  error
});

export const formatExpectedProvider = (
  expected: SourceAttributionEvalExpectation
): string => {
  switch (expected.resolution) {
    case "matched":
      return expected.sourceFamily === null
        ? `matched:${expected.providerId ?? "none"}`
        : `matched:${expected.providerId ?? "none"} (${expected.sourceFamily})`;
    case "ambiguous":
      return "ambiguous";
    case "unmatched":
      return "unmatched";
  }
};

export const formatActualProvider = (
  actual: SourceAttributionEvalActual | null
): string => {
  if (actual === null) {
    return "error";
  }

  switch (actual.resolution) {
    case "matched":
      return actual.sourceFamily === null
        ? `matched:${actual.providerId ?? "none"}`
        : `matched:${actual.providerId ?? "none"} (${actual.sourceFamily})`;
    case "ambiguous":
      return actual.candidateIds.length > 0
        ? `ambiguous:${actual.candidateIds.join(",")}`
        : "ambiguous";
    case "unmatched":
      return "unmatched";
  }
};
