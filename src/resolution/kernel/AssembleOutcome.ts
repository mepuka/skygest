import { Result } from "effect";
import {
  type BoundResolutionGapItem,
  type ResolutionGap,
  type ResolutionHypothesis,
  type ResolutionOutcome
} from "../../domain/resolutionKernel";
import {
  joinPartials,
  missingRequired,
  type PartialVariableShape,
  type RequiredFacetKey
} from "../../domain/partialVariableAlgebra";
import { stripUndefined } from "../../platform/Json";
import type { BoundHypothesis } from "./Bind";
import type { InterpretedBundle } from "./Interpret";

const asGap = (
  item: BoundResolutionGapItem,
  agentId?: BoundHypothesis["agentId"]
): ResolutionGap =>
  stripUndefined({
    partial: item.semanticPartial,
    missingRequired: item.missingRequired,
    candidates: [...item.candidates],
    reason: item.reason,
    context: stripUndefined({
      agentId,
      attachedContext: item.attachedContext
    })
  });

const hypothesisPartial = (hypothesis: ResolutionHypothesis): PartialVariableShape => {
  const joined = joinPartials(
    hypothesis.sharedPartial,
    hypothesis.items[0]?.partial ?? {}
  );

  return Result.isSuccess(joined) ? joined.success : hypothesis.sharedPartial;
};

const gapFromConflictHypothesis = (
  hypothesis: ResolutionHypothesis
): ResolutionGap => {
  const partial = hypothesisPartial(hypothesis);

  return stripUndefined({
    partial,
    missingRequired: missingRequired(partial),
    candidates: [],
    reason: "required-facet-conflict" as const,
    context: {
      attachedContext: hypothesis.attachedContext
    }
  });
};

const collectMissingRequired = (
  items: ReadonlyArray<BoundResolutionGapItem>
): ReadonlyArray<RequiredFacetKey> =>
  [...new Set(items.flatMap((item) => item.missingRequired ?? []))];

export const assembleOutcome = (
  interpreted: InterpretedBundle,
  bound: BoundHypothesis | null
): ResolutionOutcome => {
  switch (interpreted._tag) {
    case "NoMatch":
      return {
        _tag: "NoMatch",
        bundle: interpreted.bundle,
        reason: interpreted.reason
      };
    case "Conflicted":
      return stripUndefined({
        _tag: "Conflicted",
        bundle: interpreted.bundle,
        hypotheses: [...interpreted.hypotheses],
        conflicts: [...interpreted.conflicts],
        gaps: interpreted.hypotheses.map(gapFromConflictHypothesis),
        tier: interpreted.tier
      });
    case "Hypothesis":
      break;
  }

  if (bound === null) {
    return {
      _tag: "NoMatch",
      bundle: interpreted.bundle,
      reason: "Kernel bind did not execute"
    };
  }

  const boundItems = bound.items.filter((item) => item._tag === "bound");
  const gapItems = bound.items.filter((item) => item._tag === "gap");
  const gaps = gapItems.map((item) => asGap(item, bound.agentId));

  if (boundItems.length === bound.items.length && boundItems.length > 0) {
    return stripUndefined({
      _tag: "Resolved",
      bundle: interpreted.bundle,
      sharedPartial: bound.hypothesis.sharedPartial,
      attachedContext: bound.hypothesis.attachedContext,
      items: [...bound.items],
      confidence: bound.hypothesis.confidence,
      tier: bound.hypothesis.tier
    });
  }

  const allMissingRequired =
    gapItems.length === bound.items.length &&
    gapItems.every((item) => item.reason === "missing-required");
  if (allMissingRequired) {
    const firstGap = gapItems[0]!;
    const missing = collectMissingRequired(gapItems);
    const partial =
      gapItems.length === 1
        ? firstGap.semanticPartial
        : bound.hypothesis.sharedPartial;

    if (gapItems.every((item) => item.candidates.length === 0)) {
      return {
        _tag: "NoMatch",
        bundle: interpreted.bundle,
        reason: "Kernel could not bind an underspecified partial"
      };
    }

    return stripUndefined({
      _tag: "Underspecified",
      bundle: interpreted.bundle,
      partial,
      missingRequired: [...missing],
      gap: asGap(firstGap, bound.agentId),
      gaps,
      confidence: bound.hypothesis.confidence,
      tier: bound.hypothesis.tier
    });
  }

  const allOutOfRegistry =
    gapItems.length === bound.items.length &&
    gapItems.every(
      (item) =>
        item.reason === "no-candidates" || item.reason === "agent-scope-empty"
    );
  if (allOutOfRegistry) {
    const firstGap = gapItems[0]!;
    return {
      _tag: "OutOfRegistry",
      bundle: interpreted.bundle,
      hypothesis: bound.hypothesis,
      items: [...bound.items],
      gap: asGap(firstGap, bound.agentId)
    };
  }

  return stripUndefined({
    _tag: "Ambiguous",
    bundle: interpreted.bundle,
    hypotheses: [bound.hypothesis],
    items: [...bound.items],
    gaps,
    confidence: bound.hypothesis.confidence,
    tier: bound.hypothesis.tier
  });
};
