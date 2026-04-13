import type { ResolutionOutcome } from "../../domain/resolutionKernel";
import { stripUndefined } from "../../platform/Json";
import type { BoundHypothesis } from "./Bind";
import type { InterpretedBundle } from "./Interpret";

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

  if (bound._tag === "Conflicted") {
    return stripUndefined({
      _tag: "Conflicted",
      bundle: interpreted.bundle,
      hypotheses: [bound.hypothesis],
      conflicts: [...bound.conflicts],
      tier: bound.hypothesis.tier
    });
  }

  const allMissingRequired =
    bound.items.length > 0 &&
    bound.items.every((item) => item.missingRequired.length > 0);
  if (allMissingRequired) {
    return stripUndefined({
      _tag: "Underspecified",
      bundle: interpreted.bundle,
      partial: bound.items[0]?.semanticPartial ?? {},
      missingRequired: [...(bound.items[0]?.missingRequired ?? [])],
      tier: bound.hypothesis.tier
    });
  }

  const allOutOfRegistry =
    bound.items.length > 0 &&
    bound.items.every(
      (item) =>
        item.missingRequired.length === 0 && item.candidates.length === 0
    );
  if (allOutOfRegistry) {
    return {
      _tag: "OutOfRegistry",
      bundle: interpreted.bundle,
      hypothesis: bound.hypothesis,
      items: bound.items.map((item) => item.item)
    };
  }

  const allResolved =
    bound.items.length > 0 &&
    bound.items.every((item) => item.candidates.length === 1);
  if (allResolved) {
    return stripUndefined({
      _tag: "Resolved",
      bundle: interpreted.bundle,
      sharedPartial: bound.hypothesis.sharedPartial,
      attachedContext: bound.hypothesis.attachedContext,
      items: bound.items.map((item) => {
        const candidate = item.candidates[0]!;
        return stripUndefined({
          ...item.item,
          variableId: candidate.variableId,
          label: candidate.label
        });
      }),
      tier: bound.hypothesis.tier
    });
  }

  return stripUndefined({
    _tag: "Ambiguous",
    bundle: interpreted.bundle,
    hypotheses: [bound.hypothesis],
    tier: bound.hypothesis.tier
  });
};
