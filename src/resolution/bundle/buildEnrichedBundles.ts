import type { EnrichedBundle } from "../../domain/enrichedBundle";
import type { Stage1Input } from "../../domain/stage1Resolution";

export const buildEnrichedBundles = (
  input: Stage1Input
): ReadonlyArray<EnrichedBundle> => {
  if (input.vision === null || input.vision.assets.length === 0) {
    return [];
  }

  return input.vision.assets.map((asset) => ({
    asset,
    sourceAttribution: input.sourceAttribution,
    postContext: input.postContext
  }));
};
