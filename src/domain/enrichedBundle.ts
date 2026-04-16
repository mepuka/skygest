import { Schema } from "effect";
import {
  SourceAttributionEnrichment,
  VisionAssetEnrichment
} from "./enrichment";
import { Stage1PostContext } from "./stage1Resolution";

// ---------------------------------------------------------------------------
// EnrichedBundle — one chart asset plus its upstream enrichment context,
// used as the unit of analysis by provenance-first data-reference resolution.
// ---------------------------------------------------------------------------

export const EnrichedBundle = Schema.Struct({
  asset: VisionAssetEnrichment,
  sourceAttribution: Schema.NullOr(SourceAttributionEnrichment),
  postContext: Stage1PostContext
}).annotate({
  description:
    "One chart asset plus the upstream enrichment context as the unit of analysis for provenance resolution"
});
export type EnrichedBundle = Schema.Schema.Type<typeof EnrichedBundle>;
