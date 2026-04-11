import type { SourceAttributionEnrichment } from "../domain/enrichment";
import type { EnrichmentExecutionPlan } from "../domain/enrichmentPlan";
import type { Stage1Input } from "../domain/stage1Resolution";

export const buildStage1Input = (
  plan: EnrichmentExecutionPlan,
  sourceAttribution: SourceAttributionEnrichment
): Stage1Input => ({
  postContext: {
    postUri: plan.post.postUri,
    text: plan.post.text,
    links: plan.links,
    linkCards: plan.linkCards,
    threadCoverage: plan.post.threadCoverage
  },
  vision: plan.vision,
  sourceAttribution
});
