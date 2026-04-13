import { Effect, Schema } from "effect";
import { AgentId, VariableId } from "../../src/domain/data-layer/ids";
import {
  ResolutionEvidenceBundle,
  ResolutionEvidenceTier,
  ResolutionGapReason,
  ResolutionOutcome,
  ResolutionOutcomeStatus
} from "../../src/domain/resolutionKernel";
import type { PartialVariableFacetConflict } from "../../src/domain/errors";
import type { DataLayerRegistryLookup } from "../../src/resolution/dataLayerRegistry";
import type { FacetVocabularyShape } from "../../src/resolution/facetVocabulary";
import { assembleOutcome } from "../../src/resolution/kernel/AssembleOutcome";
import {
  bindHypothesis,
  type BoundHypothesis
} from "../../src/resolution/kernel/Bind";
import { buildResolutionEvidenceBundles } from "../../src/resolution/kernel/BundleAdapter";
import {
  interpretBundle,
  type InterpretedBundle
} from "../../src/resolution/kernel/Interpret";
import { resolveAgentIdFromStage1Input } from "../../src/resolution/ResolutionKernel";
import type { Stage1Input } from "../../src/domain/stage1Resolution";
import { PostUri } from "../../src/domain/types";
import {
  decodeJsonStringWith,
  stringifyUnknown
} from "../../src/platform/Json";

/**
 * Kernel eval shared types and helpers.
 *
 * The kernel emits one `ResolutionOutcome` per evidence bundle. Ground-truth
 * entries live in `expected-outcomes.jsonl` keyed by `(postUri, assetKey?)`.
 * When `assetKey` is omitted the entry applies to the whole post — we assert
 * that at least one bundle satisfied the expectation.
 */

export class KernelEvalExpectedDecodeError extends Schema.TaggedErrorClass<KernelEvalExpectedDecodeError>()(
  "KernelEvalExpectedDecodeError",
  {
    lineNumber: Schema.Number,
    message: Schema.String
  }
) {}

export const ExpectedKernelOutcome = Schema.Struct({
  postUri: PostUri,
  assetKey: Schema.optionalKey(Schema.String),
  outcomeTag: ResolutionOutcomeStatus,
  expectedVariableIds: Schema.optionalKey(Schema.Array(VariableId)),
  expectedGapReason: Schema.optionalKey(ResolutionGapReason),
  expectedAgentId: Schema.optionalKey(AgentId),
  notes: Schema.optionalKey(Schema.String)
}).annotate({
  description:
    "One hand-authored assertion about what the kernel should emit for a given post/bundle"
});
export type ExpectedKernelOutcome = Schema.Schema.Type<
  typeof ExpectedKernelOutcome
>;

const decodeExpectedJson = decodeJsonStringWith(ExpectedKernelOutcome);

export const loadExpectedOutcomesFromString = (raw: string) =>
  Effect.forEach(
    raw
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith("//")),
    (line, index) =>
      Effect.try({
        try: () => decodeExpectedJson(line),
        catch: (error) =>
          new KernelEvalExpectedDecodeError({
            lineNumber: index + 1,
            message: `expected-outcomes.jsonl line ${index + 1}: ${stringifyUnknown(error)}`
          })
      })
  );

export type ExpectedOutcomesIndex = {
  readonly byBundle: ReadonlyMap<string, ExpectedKernelOutcome>;
  readonly byPost: ReadonlyMap<string, ReadonlyArray<ExpectedKernelOutcome>>;
};

const bundleKey = (postUri: string, assetKey: string) =>
  `${postUri}#${assetKey}`;

export const indexExpectedOutcomes = (
  entries: ReadonlyArray<ExpectedKernelOutcome>
): ExpectedOutcomesIndex => {
  const byBundle = new Map<string, ExpectedKernelOutcome>();
  const byPost = new Map<string, Array<ExpectedKernelOutcome>>();

  for (const entry of entries) {
    if (entry.assetKey !== undefined) {
      byBundle.set(bundleKey(entry.postUri, entry.assetKey), entry);
    }
    const bucket = byPost.get(entry.postUri) ?? [];
    bucket.push(entry);
    byPost.set(entry.postUri, bucket);
  }

  return {
    byBundle,
    byPost: new Map(
      [...byPost.entries()].map(([postUri, list]) => [
        postUri,
        list as ReadonlyArray<ExpectedKernelOutcome>
      ])
    )
  };
};

export type ActualOutcomeSummary = {
  readonly outcomeTag: ResolutionOutcomeStatus;
  readonly boundVariableIds: ReadonlyArray<string>;
  readonly candidateVariableIds: ReadonlyArray<string>;
  readonly gapReason: ResolutionGapReason | null;
  readonly matchedFacetCounts: ReadonlyArray<number>;
  readonly agentId: string | null;
  readonly confidence: number | null;
  readonly tier: ResolutionEvidenceTier | null;
};

const unique = <A>(values: Iterable<A>): ReadonlyArray<A> => [
  ...new Set(values)
];

export const summarizeOutcome = (
  outcome: ResolutionOutcome
): ActualOutcomeSummary => {
  switch (outcome._tag) {
    case "Resolved": {
      const boundVariableIds = unique(
        outcome.items.flatMap((item) =>
          item._tag === "bound" ? [item.variableId] : []
        )
      );
      const matchedFacetCounts = outcome.items.flatMap((item) =>
        item._tag === "bound" ? [Object.keys(item.semanticPartial).length] : []
      );
      return {
        outcomeTag: "Resolved",
        boundVariableIds,
        candidateVariableIds: boundVariableIds,
        gapReason: null,
        matchedFacetCounts,
        agentId: outcome.agentId ?? null,
        confidence: outcome.confidence ?? null,
        tier: outcome.tier ?? null
      };
    }
    case "Ambiguous": {
      const boundVariableIds = unique(
        outcome.items.flatMap((item) =>
          item._tag === "bound" ? [item.variableId] : []
        )
      );
      const candidateVariableIds = unique([
        ...boundVariableIds,
        ...outcome.gaps.flatMap((gap) =>
          gap.candidates.map((candidate) => candidate.variableId)
        )
      ]);
      const gapReason = outcome.gaps[0]?.reason ?? null;
      const matchedFacetCounts = outcome.gaps.flatMap((gap) =>
        gap.candidates.map((candidate) => candidate.matchedFacets.length)
      );
      return {
        outcomeTag: "Ambiguous",
        boundVariableIds,
        candidateVariableIds,
        gapReason,
        matchedFacetCounts,
        agentId: outcome.gaps[0]?.context?.agentId ?? null,
        confidence: outcome.confidence ?? null,
        tier: outcome.tier ?? null
      };
    }
    case "Underspecified": {
      return {
        outcomeTag: "Underspecified",
        boundVariableIds: [],
        candidateVariableIds: unique(
          outcome.gap.candidates.map((candidate) => candidate.variableId)
        ),
        gapReason: outcome.gap.reason,
        matchedFacetCounts: outcome.gap.candidates.map(
          (candidate) => candidate.matchedFacets.length
        ),
        agentId: outcome.gap.context?.agentId ?? null,
        confidence: outcome.confidence ?? null,
        tier: outcome.tier ?? null
      };
    }
    case "Conflicted": {
      const firstGap = outcome.gaps[0];
      return {
        outcomeTag: "Conflicted",
        boundVariableIds: [],
        candidateVariableIds: [],
        gapReason: firstGap?.reason ?? null,
        matchedFacetCounts: [],
        agentId: firstGap?.context?.agentId ?? null,
        confidence: outcome.confidence ?? null,
        tier: outcome.tier ?? null
      };
    }
    case "OutOfRegistry": {
      const boundVariableIds = unique(
        outcome.items.flatMap((item) =>
          item._tag === "bound" ? [item.variableId] : []
        )
      );
      return {
        outcomeTag: "OutOfRegistry",
        boundVariableIds,
        candidateVariableIds: boundVariableIds,
        gapReason: outcome.gap.reason,
        matchedFacetCounts: [],
        agentId: outcome.gap.context?.agentId ?? null,
        confidence: null,
        tier: null
      };
    }
    case "NoMatch": {
      return {
        outcomeTag: "NoMatch",
        boundVariableIds: [],
        candidateVariableIds: [],
        gapReason: null,
        matchedFacetCounts: [],
        agentId: null,
        confidence: null,
        tier: null
      };
    }
  }
};

/**
 * Full trace record for one bundle through the kernel pipeline.
 *
 * `interpreted`, `bound`, and `outcome` are the raw kernel intermediates
 * captured as we walk interpret → bind → assemble. The runner surfaces these
 * in the per-entry JSON so operators can debug conflict/ambiguous cases
 * without re-running the pipeline.
 */
export type BundleTrace = {
  readonly bundle: ResolutionEvidenceBundle;
  readonly assetKey: string | null;
  readonly agentId: string | null;
  readonly interpreted: InterpretedBundle;
  readonly bound: BoundHypothesis | null;
  readonly outcome: ResolutionOutcome;
};

export type BundleSummary = {
  readonly assetKey: string | null;
  readonly actual: ActualOutcomeSummary;
  readonly trace: BundleTrace;
};

/**
 * Run the kernel pipeline manually so we can capture intermediates. Uses the
 * same `buildResolutionEvidenceBundles` + `interpretBundle` + `bindHypothesis`
 * + `assembleOutcome` sequence as `ResolutionKernel.resolve`, with the same
 * agent-id derivation from `Stage1Input`.
 */
export const tracePost = (
  stage1Input: Stage1Input,
  lookup: DataLayerRegistryLookup,
  vocabulary: FacetVocabularyShape
): ReadonlyArray<BundleTrace> => {
  const bundles = buildResolutionEvidenceBundles(stage1Input);
  const agentId = resolveAgentIdFromStage1Input(stage1Input, lookup);
  const resolutionOptions = agentId === undefined ? {} : { agentId };

  return bundles.map((bundle) => {
    const interpreted = interpretBundle(bundle, vocabulary);
    const bound =
      interpreted._tag === "Hypothesis"
        ? bindHypothesis(interpreted.hypothesis, lookup, resolutionOptions)
        : null;
    const outcome = assembleOutcome(interpreted, bound);
    return {
      bundle,
      assetKey: bundle.assetKey ?? null,
      agentId: agentId ?? null,
      interpreted,
      bound,
      outcome
    };
  });
};

export const traceToBundleSummary = (trace: BundleTrace): BundleSummary => ({
  assetKey: trace.assetKey,
  actual: summarizeOutcome(trace.outcome),
  trace
});

export const summarizeBundles = (
  traces: ReadonlyArray<BundleTrace>
): ReadonlyArray<BundleSummary> => traces.map(traceToBundleSummary);

export type KernelAssessmentCheck =
  | {
      readonly kind: "outcome-tag";
      readonly pass: boolean;
      readonly expected: ResolutionOutcomeStatus;
      readonly actual: ResolutionOutcomeStatus;
    }
  | {
      readonly kind: "variable-ids";
      readonly pass: boolean;
      readonly expected: ReadonlyArray<string>;
      readonly missing: ReadonlyArray<string>;
      readonly unexpected: ReadonlyArray<string>;
    }
  | {
      readonly kind: "gap-reason";
      readonly pass: boolean;
      readonly expected: ResolutionGapReason;
      readonly actual: ResolutionGapReason | null;
    }
  | {
      readonly kind: "agent-scope";
      readonly pass: boolean;
      readonly expected: string;
      readonly actual: string | null;
    };

export type KernelEvalEntry =
  | {
      readonly kind: "annotated";
      readonly slug: string;
      readonly postUri: string;
      readonly expected: ExpectedKernelOutcome;
      readonly selectedBundle: BundleSummary | null;
      readonly checks: ReadonlyArray<KernelAssessmentCheck>;
      readonly hasFindings: boolean;
      readonly error: string | null;
    }
  | {
      readonly kind: "unannotated";
      readonly slug: string;
      readonly postUri: string;
      readonly bundles: ReadonlyArray<BundleSummary>;
      readonly error: string | null;
    };

const diffIds = (
  expected: ReadonlyArray<string>,
  actual: ReadonlyArray<string>
) => ({
  missing: expected.filter((id) => !actual.includes(id)),
  unexpected: actual.filter((id) => !expected.includes(id))
});

/**
 * Score one bundle against an expected entry. `strictUnexpected` is true only
 * when the expected entry pinned a specific `assetKey` — loose post-level
 * ground truth does not flag unexpected variables because other bundles may
 * legitimately emit them.
 */
const runChecks = (
  expected: ExpectedKernelOutcome,
  summary: BundleSummary,
  strictUnexpected: boolean
): ReadonlyArray<KernelAssessmentCheck> => {
  const checks: Array<KernelAssessmentCheck> = [];

  checks.push({
    kind: "outcome-tag",
    pass: summary.actual.outcomeTag === expected.outcomeTag,
    expected: expected.outcomeTag,
    actual: summary.actual.outcomeTag
  });

  if (expected.expectedVariableIds !== undefined) {
    const { missing, unexpected } = diffIds(
      expected.expectedVariableIds,
      summary.actual.boundVariableIds
    );
    const pass =
      missing.length === 0 && (!strictUnexpected || unexpected.length === 0);
    checks.push({
      kind: "variable-ids",
      pass,
      expected: expected.expectedVariableIds,
      missing,
      unexpected
    });
  }

  if (expected.expectedGapReason !== undefined) {
    checks.push({
      kind: "gap-reason",
      pass: summary.actual.gapReason === expected.expectedGapReason,
      expected: expected.expectedGapReason,
      actual: summary.actual.gapReason
    });
  }

  if (expected.expectedAgentId !== undefined) {
    checks.push({
      kind: "agent-scope",
      pass: summary.actual.agentId === expected.expectedAgentId,
      expected: expected.expectedAgentId,
      actual: summary.actual.agentId
    });
  }

  return checks;
};

const countFailingChecks = (
  checks: ReadonlyArray<KernelAssessmentCheck>
): number => checks.filter((check) => !check.pass).length;

/**
 * Evaluate one row's resolved outcomes against all expected entries for that
 * post. Produces one `KernelEvalEntry` per expected entry, plus one entry per
 * unannotated bundle so the runner can surface "needs annotation" rows in the
 * summary.
 */
export const evaluateRow = (
  slug: string,
  postUri: string,
  bundles: ReadonlyArray<BundleSummary>,
  index: ExpectedOutcomesIndex
): ReadonlyArray<KernelEvalEntry> => {
  const expectedForPost = index.byPost.get(postUri) ?? [];
  const consumedAssetKeys = new Set<string>();
  const entries: Array<KernelEvalEntry> = [];

  for (const expected of expectedForPost) {
    if (expected.assetKey !== undefined) {
      const selected =
        bundles.find((bundle) => bundle.assetKey === expected.assetKey) ?? null;
      consumedAssetKeys.add(expected.assetKey);
      const checks =
        selected === null
          ? [
              {
                kind: "outcome-tag" as const,
                pass: false,
                expected: expected.outcomeTag,
                actual: "NoMatch" as const
              }
            ]
          : runChecks(expected, selected, true);
      entries.push({
        kind: "annotated",
        slug,
        postUri,
        expected,
        selectedBundle: selected,
        checks,
        hasFindings: countFailingChecks(checks) > 0,
        error: null
      });
      continue;
    }

    // Post-level expectation: pick the bundle with the fewest failures.
    let best: { bundle: BundleSummary; checks: ReadonlyArray<KernelAssessmentCheck> } | null =
      null;
    for (const bundle of bundles) {
      const checks = runChecks(expected, bundle, false);
      if (
        best === null ||
        countFailingChecks(checks) < countFailingChecks(best.checks)
      ) {
        best = { bundle, checks };
      }
    }
    if (best === null) {
      entries.push({
        kind: "annotated",
        slug,
        postUri,
        expected,
        selectedBundle: null,
        checks: [
          {
            kind: "outcome-tag",
            pass: false,
            expected: expected.outcomeTag,
            actual: "NoMatch"
          }
        ],
        hasFindings: true,
        error: null
      });
      continue;
    }
    if (best.bundle.assetKey !== null) {
      consumedAssetKeys.add(best.bundle.assetKey);
    }
    entries.push({
      kind: "annotated",
      slug,
      postUri,
      expected,
      selectedBundle: best.bundle,
      checks: best.checks,
      hasFindings: countFailingChecks(best.checks) > 0,
      error: null
    });
  }

  const unannotated = bundles.filter(
    (bundle) => bundle.assetKey === null || !consumedAssetKeys.has(bundle.assetKey)
  );
  if (expectedForPost.length === 0 || unannotated.length > 0) {
    entries.push({
      kind: "unannotated",
      slug,
      postUri,
      bundles: unannotated.length > 0 ? unannotated : bundles,
      error: null
    });
  }

  return entries;
};

// ---------------------------------------------------------------------------
// Diagnostic rendering — compact, human-readable trace blocks for summary.md
// ---------------------------------------------------------------------------

const facetKeys = (partial: Record<string, unknown>): ReadonlyArray<string> =>
  Object.entries(partial)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([key, value]) => `${key}=${String(value)}`);

const formatConflicts = (
  conflicts: ReadonlyArray<PartialVariableFacetConflict>
): string =>
  conflicts
    .map(
      (conflict) =>
        `${conflict.facet}(${conflict.values[0]}≠${conflict.values[1]})`
    )
    .join(", ") || "—";

export const formatTraceDiagnostic = (
  trace: BundleTrace,
  candidateLimit = 3
): ReadonlyArray<string> => {
  const lines: Array<string> = [];
  const assetLabel = trace.assetKey ?? "post-text";
  lines.push(
    `asset=${assetLabel} agentId=${trace.agentId ?? "—"} interpret=${trace.interpreted._tag} outcome=${trace.outcome._tag}`
  );

  if (trace.interpreted._tag === "Conflicted") {
    lines.push(
      `  conflicts: ${formatConflicts(trace.interpreted.conflicts)}`
    );
    trace.interpreted.hypotheses.forEach((hypothesis, index) => {
      const shared = facetKeys(hypothesis.sharedPartial);
      lines.push(
        `  hypothesis[${index}] sharedPartial: ${shared.length > 0 ? shared.join(", ") : "—"}`
      );
      lines.push(
        `  hypothesis[${index}] items=${hypothesis.items.length} evidence=${hypothesis.evidence.length}`
      );
    });
    return lines;
  }

  if (trace.interpreted._tag === "NoMatch") {
    lines.push(`  reason: ${trace.interpreted.reason}`);
    return lines;
  }

  const hypothesis = trace.interpreted.hypothesis;
  const shared = facetKeys(hypothesis.sharedPartial);
  lines.push(
    `  sharedPartial: ${shared.length > 0 ? shared.join(", ") : "—"}`
  );
  lines.push(
    `  hypothesisItems=${hypothesis.items.length} evidence=${hypothesis.evidence.length}`
  );

  if (trace.bound !== null) {
    trace.bound.items.forEach((item, itemIndex) => {
      if (item._tag === "bound") {
        lines.push(
          `  item[${itemIndex}] BOUND variable=${item.variableId} label=${item.label ?? "—"}`
        );
        return;
      }
      lines.push(
        `  item[${itemIndex}] GAP reason=${item.reason} missing=[${(item.missingRequired ?? []).join(", ")}]`
      );
      const topCandidates = item.candidates.slice(0, candidateLimit);
      topCandidates.forEach((candidate, candidateIndex) => {
        lines.push(
          `    candidate[${candidateIndex}] var=${candidate.variableId.split("/").pop()} label="${candidate.label}" matched=[${candidate.matchedFacets.join(", ")}] mismatched=${candidate.mismatchedFacets.length}`
        );
      });
      if (item.candidates.length > topCandidates.length) {
        lines.push(
          `    … +${item.candidates.length - topCandidates.length} more candidates`
        );
      }
    });
  }
  return lines;
};

export const buildFailureEntry = (
  slug: string,
  postUri: string,
  expectedForPost: ReadonlyArray<ExpectedKernelOutcome>,
  reason: string
): ReadonlyArray<KernelEvalEntry> => {
  if (expectedForPost.length === 0) {
    return [
      {
        kind: "unannotated",
        slug,
        postUri,
        bundles: [],
        error: reason
      }
    ];
  }
  return expectedForPost.map((expected) => ({
    kind: "annotated" as const,
    slug,
    postUri,
    expected,
    selectedBundle: null,
    checks: [],
    hasFindings: true,
    error: reason
  }));
};
