import type { AgentId } from "../../domain/data-layer/ids";
import type { ResolutionEvidenceBundle } from "../../domain/resolutionKernel";
import type { DataLayerRegistryLookup } from "../dataLayerRegistry";
import type { FacetVocabularyShape } from "../facetVocabulary";
import { assembleOutcome } from "./AssembleOutcome";
import { bindHypothesis } from "./Bind";
import { interpretBundle } from "./Interpret";

export const resolveBundle = (
  bundle: ResolutionEvidenceBundle,
  lookup: DataLayerRegistryLookup,
  vocabulary: FacetVocabularyShape,
  options: {
    readonly agentId?: AgentId;
  } = {}
) => {
  const interpreted = interpretBundle(bundle, vocabulary);
  if (interpreted._tag !== "Hypothesis") {
    return assembleOutcome(interpreted, null);
  }

  return assembleOutcome(
    interpreted,
    bindHypothesis(interpreted.hypothesis, lookup, options)
  );
};
