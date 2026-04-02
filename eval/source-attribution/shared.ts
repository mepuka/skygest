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
  providerId: Schema.optionalKey(Schema.NullOr(ProviderId)),
  candidateIds: Schema.optionalKey(Schema.Array(ProviderId)),
  sourceFamily: Schema.optionalKey(Schema.NullOr(Schema.String)),
  contentSourceDomain: Schema.optionalKey(Schema.NullOr(Schema.String)),
  publication: Schema.optionalKey(Schema.NullOr(Schema.String))
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
  readonly contentSourceAsserted: boolean;
  readonly contentSourceMatches: boolean;
  readonly publicationAsserted: boolean;
  readonly publicationMatches: boolean;
  readonly sourceFamilyAsserted: boolean;
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

const normalizeIds = (ids: ReadonlyArray<string>) =>
  [...new Set(ids)].sort((left, right) => left.localeCompare(right));

const candidateIdsMatch = (
  expected: ReadonlyArray<string> | undefined,
  actual: ReadonlyArray<string>
) => {
  if (expected === undefined) {
    return true;
  }

  const expectedIds = normalizeIds(expected);
  const actualIds = normalizeIds(actual);

  return (
    expectedIds.length === actualIds.length &&
    expectedIds.every((value, index) => value === actualIds[index])
  );
};

const compareOptionalAssertion = (
  expected: string | null | undefined,
  actual: string | null
) => ({
  asserted: expected !== undefined,
  matches: expected === undefined ? true : expected === actual
});

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
      if (
        result.resolution === "ambiguous" &&
        candidateIdsMatch(
          expected.candidateIds,
          result.providerCandidates.map((candidate) => candidate.providerId)
        )
      ) {
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
  const contentSourceCheck = compareOptionalAssertion(
    entry.expected.contentSourceDomain,
    actual.contentSourceDomain
  );
  const publicationCheck = compareOptionalAssertion(
    entry.expected.publication,
    actual.publication
  );
  const sourceFamilyCheck = compareOptionalAssertion(
    entry.expected.sourceFamily,
    actual.sourceFamily
  );
  const hasFindings =
    !providerPassVerdicts.has(providerVerdict) ||
    !contentSourceCheck.matches ||
    !publicationCheck.matches ||
    !sourceFamilyCheck.matches;

  return {
    slug: entry.slug,
    thread: entry.thread,
    context: entry.context,
    notes: entry.notes,
    expected: entry.expected,
    actual,
    rubric: {
      providerVerdict,
      contentSourceAsserted: contentSourceCheck.asserted,
      contentSourceMatches: contentSourceCheck.matches,
      publicationAsserted: publicationCheck.asserted,
      publicationMatches: publicationCheck.matches,
      sourceFamilyAsserted: sourceFamilyCheck.asserted,
      sourceFamilyMatches: sourceFamilyCheck.matches,
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
      return expected.candidateIds === undefined
        ? "ambiguous"
        : `ambiguous:${normalizeIds(expected.candidateIds).join(",")}`;
    case "unmatched":
      return "unmatched";
  }
};

type AssertionSummary = {
  readonly matched: number;
  readonly asserted: number;
};

const summarizeAssertion = (
  results: ReadonlyArray<SourceAttributionEvalResult>,
  assertedSelector: (result: SourceAttributionEvalResult) => boolean,
  matchedSelector: (result: SourceAttributionEvalResult) => boolean
): AssertionSummary => {
  const asserted = results.filter(assertedSelector);
  return {
    matched: asserted.filter(matchedSelector).length,
    asserted: asserted.length
  };
};

export const summarizeAncillaryAssertions = (
  results: ReadonlyArray<SourceAttributionEvalResult>
) => ({
  contentSource: summarizeAssertion(
    results,
    (result) => result.rubric?.contentSourceAsserted === true,
    (result) => result.rubric?.contentSourceMatches === true
  ),
  publication: summarizeAssertion(
    results,
    (result) => result.rubric?.publicationAsserted === true,
    (result) => result.rubric?.publicationMatches === true
  ),
  sourceFamily: summarizeAssertion(
    results,
    (result) => result.rubric?.sourceFamilyAsserted === true,
    (result) => result.rubric?.sourceFamilyMatches === true
  )
});

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
