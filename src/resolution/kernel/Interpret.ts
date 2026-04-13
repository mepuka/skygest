import { Option, Result } from "effect";
import type { PartialVariableFacetConflict } from "../../domain/errors";
import {
  EVIDENCE_PRECEDENCE,
  type ResolutionEvidenceBundle,
  type ResolutionEvidenceReference,
  type ResolutionEvidenceSource,
  type ResolutionEvidenceTier,
  type ResolutionHypothesis,
  type ResolutionHypothesisItem
} from "../../domain/resolutionKernel";
import {
  REQUIRED_FACET_KEYS,
  type PartialVariableShape,
  joinPartials
} from "../../domain/partialVariableAlgebra";
import { stripUndefined } from "../../platform/Json";
import type { FacetVocabularyShape } from "../facetVocabulary";

const DEFAULT_BUNDLE_ITEM_KEY = "bundle";
const SEGMENT_DELIMITER = /(?:\s+\band\b\s+)|(?:\s+\bor\b\s+)|[;\n]+/giu;

// Identity sources witness the variable's identity directly: chart/axis/series
// text names what the chart is measuring. These feed the shared partial via
// `foldAssignments`.
const IDENTITY_SOURCES: ReadonlySet<ResolutionEvidenceSource> = new Set([
  "series-label",
  "x-axis",
  "y-axis",
  "chart-title"
]);

// Narrative sources are commentary about the observation, not witnesses for
// its identity. They must never project onto the shared partial because the
// algebra's join operator is only valid over co-referential projections of
// the same variable. Narrative matches are still surfaced in the hypothesis
// `evidence[]` for downstream trace output.
const NARRATIVE_SOURCES: ReadonlySet<ResolutionEvidenceSource> = new Set([
  "key-finding",
  "post-text",
  "source-line",
  "publisher-hint"
]);

type EvidenceSite = {
  readonly source: ResolutionEvidenceSource;
  readonly text: string;
  readonly itemKey?: string;
};

type SiteAssignment = {
  readonly partial: PartialVariableShape;
  readonly evidence: ResolutionEvidenceReference;
};

type FoldedAssignments = {
  readonly partial: PartialVariableShape;
  readonly evidence: ReadonlyArray<ResolutionEvidenceReference>;
  readonly tier: ResolutionEvidenceTier;
};

type FoldConflict = {
  readonly left: FoldedAssignments;
  readonly right: SiteAssignment;
  readonly conflicts: ReadonlyArray<PartialVariableFacetConflict>;
};

export type InterpretedBundle =
  | {
      readonly _tag: "NoMatch";
      readonly bundle: ResolutionEvidenceBundle;
      readonly reason: string;
    }
  | {
      readonly _tag: "Hypothesis";
      readonly bundle: ResolutionEvidenceBundle;
      readonly hypothesis: ResolutionHypothesis;
    }
  | {
      readonly _tag: "Conflicted";
      readonly bundle: ResolutionEvidenceBundle;
      readonly hypotheses: ReadonlyArray<ResolutionHypothesis>;
      readonly conflicts: ReadonlyArray<PartialVariableFacetConflict>;
      readonly tier: ResolutionEvidenceTier;
    };

const REQUIRED_FACET_KEY_SET: ReadonlySet<string> = new Set(REQUIRED_FACET_KEYS);

const asOptionalString = (value: string | null | undefined): string | undefined => {
  if (value === null || value === undefined) {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const segmentText = (
  source: ResolutionEvidenceSource,
  text: string
): ReadonlyArray<string> => {
  if (source !== "post-text" && source !== "key-finding") {
    return [text];
  }

  const segments = text
    .split(SEGMENT_DELIMITER)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);

  return segments.length > 0 ? segments : [text];
};

const hasRequiredConflict = (
  conflicts: ReadonlyArray<PartialVariableFacetConflict>
): boolean => conflicts.some((conflict) => REQUIRED_FACET_KEY_SET.has(conflict.facet));

const matchSite = (
  site: EvidenceSite,
  vocabulary: FacetVocabularyShape
): SiteAssignment | null => {
  // Full cartesian fanout for multi-match series labels has not landed yet.
  // Keep the strongest technology/fuel match explicit until that deeper
  // interpret-stage expansion exists.
  const technologyOrFuel =
    site.source === "series-label"
      ? vocabulary.matchAllTechnologyOrFuel(site.text)[0]?.canonical
      : Option.getOrUndefined(vocabulary.matchTechnologyOrFuel(site.text))?.canonical;

  const partial = stripUndefined({
    measuredProperty: Option.getOrUndefined(
      vocabulary.matchMeasuredProperty(site.text)
    )?.canonical,
    domainObject: Option.getOrUndefined(
      vocabulary.matchDomainObject(site.text)
    )?.canonical,
    technologyOrFuel,
    statisticType: Option.getOrUndefined(
      vocabulary.matchStatisticType(site.text)
    )?.canonical,
    aggregation: Option.getOrUndefined(
      vocabulary.matchAggregation(site.text)
    )?.canonical,
    unitFamily: Option.getOrUndefined(
      vocabulary.matchUnitFamily(site.text)
    )?.canonical,
    policyInstrument: Option.getOrUndefined(
      vocabulary.matchPolicyInstrument(site.text)
    )?.canonical
  }) satisfies PartialVariableShape;

  if (Object.keys(partial).length === 0) {
    return null;
  }

  return {
    partial,
    evidence: stripUndefined({
      source: site.source,
      text: site.text,
      itemKey: site.itemKey
    })
  };
};

const sourcePrecedenceIndex = (source: ResolutionEvidenceSource): number =>
  EVIDENCE_PRECEDENCE.indexOf(source);

const downgradeTier = (
  current: ResolutionEvidenceTier,
  next: ResolutionEvidenceTier
): ResolutionEvidenceTier => {
  if (current === "weak-heuristic" || next === "weak-heuristic") {
    return "weak-heuristic";
  }
  if (current === "strong-heuristic" || next === "strong-heuristic") {
    return "strong-heuristic";
  }
  return "entailment";
};

const foldAssignments = (
  assignments: ReadonlyArray<SiteAssignment>
): Result.Result<FoldedAssignments, FoldConflict> => {
  let partial: PartialVariableShape = {};
  let evidence: Array<ResolutionEvidenceReference> = [];
  let tier: ResolutionEvidenceTier = "entailment";
  // Track the strongest (lowest-index) source folded so far. Assignments are
  // iterated in precedence order, so a later assignment whose source index is
  // strictly greater than `strongestSourceIndex` is from a weaker band and
  // should yield to the already-accumulated partial on required-facet conflict.
  let strongestSourceIndex: number | null = null;

  for (const assignment of assignments) {
    const assignmentSourceIndex = sourcePrecedenceIndex(
      assignment.evidence.source
    );
    const joined = joinPartials(partial, assignment.partial);
    if (Result.isSuccess(joined)) {
      partial = joined.success;
      evidence.push(assignment.evidence);
      strongestSourceIndex =
        strongestSourceIndex === null
          ? assignmentSourceIndex
          : Math.min(strongestSourceIndex, assignmentSourceIndex);
      continue;
    }

    const isRequiredConflict = hasRequiredConflict(joined.failure.conflicts);

    // Weaker-precedence assignments never win a required-facet conflict: the
    // earlier, stronger-precedence partial stays put and the fold downgrades
    // to `weak-heuristic`. This is the common case on real posts where
    // chart-title / post-text mention secondary measurements (e.g. "share",
    // "curtailment") alongside the chart's actual measuredProperty.
    if (
      isRequiredConflict &&
      strongestSourceIndex !== null &&
      assignmentSourceIndex > strongestSourceIndex
    ) {
      tier = downgradeTier(tier, "weak-heuristic");
      continue;
    }

    if (isRequiredConflict) {
      return Result.fail({
        left: {
          partial,
          evidence,
          tier
        },
        right: assignment,
        conflicts: joined.failure.conflicts
      });
    }

    // Non-required facet conflicts keep the earlier higher-precedence value and
    // downgrade the interpretation tier without losing the accumulated fold.
    tier = downgradeTier(tier, "strong-heuristic");
  }

  return Result.succeed({
    partial,
    evidence,
    tier
  });
};

const buildSharedSites = (bundle: ResolutionEvidenceBundle): ReadonlyArray<EvidenceSite> => {
  // Push order is intentionally precedence-ordered (x-axis -> y-axis ->
  // chart-title). Series-label is an item-level signal handled in
  // buildItemSites, not a shared-partial signal, so it is not collected here.
  const sites: Array<EvidenceSite> = [];

  const push = (
    source: ResolutionEvidenceSource,
    text: string | null | undefined
  ) => {
    if (!IDENTITY_SOURCES.has(source)) {
      return;
    }

    const value = asOptionalString(text);
    if (value === undefined) {
      return;
    }

    for (const segment of segmentText(source, value)) {
      sites.push({ source, text: segment });
    }
  };

  push("x-axis", bundle.xAxis?.label);
  push("x-axis", bundle.xAxis?.unit);
  push("y-axis", bundle.yAxis?.label);
  push("y-axis", bundle.yAxis?.unit);
  push("chart-title", bundle.chartTitle);

  return sites;
};

// Collects narrative evidence matches purely for trace output. These never
// participate in the shared-partial fold — they exist so downstream consumers
// can see what narrative signals were observed alongside the identity
// partial.
const buildNarrativeTraceEvidence = (
  bundle: ResolutionEvidenceBundle,
  vocabulary: FacetVocabularyShape
): ReadonlyArray<ResolutionEvidenceReference> => {
  const sites: Array<EvidenceSite> = [];

  const push = (
    source: ResolutionEvidenceSource,
    text: string | null | undefined
  ) => {
    if (!NARRATIVE_SOURCES.has(source)) {
      return;
    }

    const value = asOptionalString(text);
    if (value === undefined) {
      return;
    }

    for (const segment of segmentText(source, value)) {
      sites.push({ source, text: segment });
    }
  };

  for (const finding of bundle.keyFindings) {
    push("key-finding", finding);
  }
  for (const text of bundle.postText) {
    push("post-text", text);
  }
  for (const sourceLine of bundle.sourceLines) {
    push("source-line", sourceLine.sourceText);
    push("source-line", sourceLine.datasetName);
  }
  for (const hint of bundle.publisherHints) {
    push("publisher-hint", hint.label);
  }

  const references: Array<ResolutionEvidenceReference> = [];
  for (const site of sites) {
    const assignment = matchSite(site, vocabulary);
    if (assignment !== null) {
      references.push(assignment.evidence);
    }
  }
  return references;
};

const buildItemSites = (
  bundle: ResolutionEvidenceBundle
): ReadonlyMap<string, ReadonlyArray<EvidenceSite>> => {
  const groups = new Map<string, Array<EvidenceSite>>();

  for (const series of bundle.series) {
    const sites: Array<EvidenceSite> = [];
    const label = asOptionalString(series.legendLabel);
    if (label !== undefined) {
      sites.push({
        source: "series-label",
        text: label,
        itemKey: series.itemKey
      });
    }

    const unit = asOptionalString(series.unit);
    if (unit !== undefined) {
      sites.push({
        source: "series-label",
        text: unit,
        itemKey: series.itemKey
      });
    }

    groups.set(series.itemKey, sites);
  }

  return groups;
};

const buildDefaultItem = (
  bundle: ResolutionEvidenceBundle
): ResolutionHypothesisItem => ({
  itemKey: bundle.assetKey ?? DEFAULT_BUNDLE_ITEM_KEY,
  partial: {},
  evidence: []
});

const buildAttachedContext = (bundle: ResolutionEvidenceBundle) =>
  stripUndefined({
    time:
      bundle.temporalCoverage?.startDate == null
        ? undefined
        : stripUndefined({
            start: bundle.temporalCoverage.startDate,
            end:
              bundle.temporalCoverage.endDate == null
                ? undefined
                : bundle.temporalCoverage.endDate
          })
  });

const buildSharedConflictHypothesis = (
  partial: PartialVariableShape,
  attachedContext: ReturnType<typeof buildAttachedContext>,
  evidence: ReadonlyArray<ResolutionEvidenceReference>,
  tier: ResolutionEvidenceTier
): ResolutionHypothesis => ({
  sharedPartial: partial,
  attachedContext,
  items: [
    {
      itemKey: DEFAULT_BUNDLE_ITEM_KEY,
      partial: {},
      evidence: []
    }
  ],
  evidence: [...evidence],
  tier
});

const buildItemConflictHypothesis = (
  partial: PartialVariableShape,
  attachedContext: ReturnType<typeof buildAttachedContext>,
  evidence: ReadonlyArray<ResolutionEvidenceReference>,
  itemKey: string,
  tier: ResolutionEvidenceTier
): ResolutionHypothesis => ({
  sharedPartial: {},
  attachedContext,
  items: [
    {
      itemKey,
      partial,
      evidence: [...evidence]
    }
  ],
  evidence: [...evidence],
  tier
});

export const interpretBundle = (
  bundle: ResolutionEvidenceBundle,
  vocabulary: FacetVocabularyShape
): InterpretedBundle => {
  const attachedContext = buildAttachedContext(bundle);
  const sharedAssignments = buildSharedSites(bundle)
    .map((site) => matchSite(site, vocabulary))
    .filter((assignment): assignment is SiteAssignment => assignment !== null);
  const itemAssignments = buildItemSites(bundle);
  const narrativeTraceEvidence = buildNarrativeTraceEvidence(bundle, vocabulary);

  const foldedShared = foldAssignments(sharedAssignments);
  if (Result.isFailure(foldedShared)) {
    return {
      _tag: "Conflicted",
      bundle,
      conflicts: foldedShared.failure.conflicts,
      hypotheses: [
        buildSharedConflictHypothesis(
          foldedShared.failure.left.partial,
          attachedContext,
          foldedShared.failure.left.evidence,
          foldedShared.failure.left.tier
        ),
        buildSharedConflictHypothesis(
          foldedShared.failure.right.partial,
          attachedContext,
          [foldedShared.failure.right.evidence],
          "strong-heuristic"
        )
      ],
      tier: "strong-heuristic"
    };
  }

  const items: Array<ResolutionHypothesisItem> = [];
  let itemTier: ResolutionEvidenceTier = foldedShared.success.tier;

  for (const [itemKey, sites] of itemAssignments.entries()) {
    const assignments = sites
      .map((site) => matchSite(site, vocabulary))
      .filter((assignment): assignment is SiteAssignment => assignment !== null);
    const folded = foldAssignments(assignments);

    if (Result.isFailure(folded)) {
      return {
        _tag: "Conflicted",
        bundle,
        conflicts: folded.failure.conflicts,
        hypotheses: [
          buildSharedConflictHypothesis(
            foldedShared.success.partial,
            attachedContext,
            foldedShared.success.evidence,
            foldedShared.success.tier
          ),
          buildItemConflictHypothesis(
            folded.failure.right.partial,
            attachedContext,
            [folded.failure.right.evidence],
            itemKey,
            "strong-heuristic"
          )
        ],
        tier: "strong-heuristic"
      };
    }

    itemTier = downgradeTier(itemTier, folded.success.tier);

    items.push(
      stripUndefined({
        itemKey,
        partial: folded.success.partial,
        evidence: [...folded.success.evidence]
      })
    );
  }

  if (items.length === 0) {
    items.push(buildDefaultItem(bundle));
  }

  const evidence = [
    ...foldedShared.success.evidence,
    ...items.flatMap((item) => item.evidence),
    ...narrativeTraceEvidence
  ];

  if (
    Object.keys(foldedShared.success.partial).length === 0 &&
    items.every((item) => Object.keys(item.partial).length === 0)
  ) {
    return {
      _tag: "NoMatch",
      bundle,
      reason: "No usable semantic evidence"
    };
  }

  return {
    _tag: "Hypothesis",
    bundle,
    hypothesis: {
      sharedPartial: foldedShared.success.partial,
      attachedContext,
      items,
      evidence,
      tier: downgradeTier(foldedShared.success.tier, itemTier)
    }
  };
};
