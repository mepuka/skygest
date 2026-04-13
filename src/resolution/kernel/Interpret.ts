import { Option, Result } from "effect";
import {
  type PartialVariableFacetConflict,
  PartialVariableJoinConflictError
} from "../../domain/errors";
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

const REQUIRED_FACET_KEY_SET = new Set(REQUIRED_FACET_KEYS);

const asOptionalString = (value: string | null | undefined): string | undefined => {
  if (value === null || value === undefined) {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const hasRequiredConflict = (
  conflicts: ReadonlyArray<PartialVariableFacetConflict>
): boolean =>
  conflicts.some((conflict) => REQUIRED_FACET_KEY_SET.has(conflict.facet as any));

const matchSite = (
  site: EvidenceSite,
  vocabulary: FacetVocabularyShape
): SiteAssignment | null => {
  const partial = stripUndefined({
    measuredProperty: Option.getOrUndefined(
      vocabulary.matchMeasuredProperty(site.text)
    )?.canonical,
    domainObject: Option.getOrUndefined(
      vocabulary.matchDomainObject(site.text)
    )?.canonical,
    technologyOrFuel: Option.getOrUndefined(
      vocabulary.matchTechnologyOrFuel(site.text)
    )?.canonical,
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

const foldAssignments = (
  assignments: ReadonlyArray<SiteAssignment>
): Result.Result<FoldedAssignments, PartialVariableJoinConflictError> => {
  let partial: PartialVariableShape = {};
  let evidence: Array<ResolutionEvidenceReference> = [];
  let tier: ResolutionEvidenceTier = "entailment";

  for (const assignment of assignments) {
    const joined = joinPartials(partial, assignment.partial);
    if (Result.isSuccess(joined)) {
      partial = joined.success;
      evidence.push(assignment.evidence);
      continue;
    }

    if (hasRequiredConflict(joined.failure.conflicts)) {
      return Result.fail(joined.failure);
    }

    // Non-required facet conflicts keep the higher-precedence assignment and
    // downgrade the interpretation tier without failing the whole bundle.
    tier = "strong-heuristic";
  }

  return Result.succeed({
    partial,
    evidence,
    tier
  });
};

const buildSharedSites = (bundle: ResolutionEvidenceBundle): ReadonlyArray<EvidenceSite> => {
  const sites: Array<EvidenceSite> = [];

  const push = (
    source: ResolutionEvidenceSource,
    text: string | null | undefined
  ) => {
    const value = asOptionalString(text);
    if (value !== undefined) {
      sites.push({ source, text: value });
    }
  };

  push("x-axis", bundle.xAxis?.label);
  push("x-axis", bundle.xAxis?.unit);
  push("y-axis", bundle.yAxis?.label);
  push("y-axis", bundle.yAxis?.unit);
  push("chart-title", bundle.chartTitle);

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

  return sites;
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

const buildDefaultItem = (): ResolutionHypothesisItem => ({
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

const buildConflictHypothesis = (
  sharedPartial: PartialVariableShape,
  attachedContext: ReturnType<typeof buildAttachedContext>,
  evidence: ReadonlyArray<ResolutionEvidenceReference>,
  itemKey?: string
): ResolutionHypothesis => ({
  sharedPartial,
  attachedContext,
  items: [
    stripUndefined({
      itemKey,
      partial: {},
      evidence: [...evidence]
    })
  ],
  evidence: [...evidence],
  tier: "strong-heuristic"
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

  const foldedShared = foldAssignments(sharedAssignments);
  if (Result.isFailure(foldedShared)) {
    return {
      _tag: "Conflicted",
      bundle,
      conflicts: foldedShared.failure.conflicts,
      hypotheses: [
        buildConflictHypothesis({}, attachedContext, []),
        buildConflictHypothesis(
          sharedAssignments.at(-1)?.partial ?? {},
          attachedContext,
          sharedAssignments.at(-1) === undefined ? [] : [sharedAssignments.at(-1)!.evidence]
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
          buildConflictHypothesis(
            foldedShared.success.partial,
            attachedContext,
            foldedShared.success.evidence
          ),
          buildConflictHypothesis(
            assignments.at(-1)?.partial ?? {},
            attachedContext,
            assignments.at(-1) === undefined ? [] : [assignments.at(-1)!.evidence],
            itemKey
          )
        ],
        tier: "strong-heuristic"
      };
    }

    if (folded.success.tier === "strong-heuristic") {
      itemTier = "strong-heuristic";
    }

    items.push(
      stripUndefined({
        itemKey,
        partial: folded.success.partial,
        evidence: [...folded.success.evidence]
      })
    );
  }

  if (items.length === 0) {
    items.push(buildDefaultItem());
  }

  const evidence = [
    ...foldedShared.success.evidence,
    ...items.flatMap((item) => item.evidence)
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
      tier:
        foldedShared.success.tier === "strong-heuristic" ||
        itemTier === "strong-heuristic"
          ? "strong-heuristic"
          : "entailment"
    }
  };
};

export const buildEvidenceSitesInPrecedenceOrder = (
  bundle: ResolutionEvidenceBundle
): ReadonlyArray<EvidenceSite> => {
  const itemSites = buildItemSites(bundle);
  const sharedSites = buildSharedSites(bundle);

  return EVIDENCE_PRECEDENCE.flatMap((source) => [
    ...[...itemSites.values()].flatMap((sites) =>
      sites.filter((site) => site.source === source)
    ),
    ...sharedSites.filter((site) => site.source === source)
  ]);
};
