import { Schema } from "effect";
import {
  SourceAttributionEnrichment,
  VisionAssetEnrichment
} from "./enrichment";
import { Stage1PostContext } from "./stage1Resolution";

// ---------------------------------------------------------------------------
// EnrichedBundle — one chart asset plus its upstream enrichment context,
// used as the unit of analysis by the data-reference resolution kernel.
// ---------------------------------------------------------------------------

export const EnrichedBundle = Schema.Struct({
  asset: VisionAssetEnrichment,
  sourceAttribution: Schema.NullOr(SourceAttributionEnrichment),
  postContext: Stage1PostContext
}).annotate({
  description:
    "One chart asset (VisionAssetEnrichment) plus the upstream enrichment context as the unit of analysis for data-reference resolution"
});
export type EnrichedBundle = Schema.Schema.Type<typeof EnrichedBundle>;

// ---------------------------------------------------------------------------
// Rung enumeration
// ---------------------------------------------------------------------------

/** @deprecated Superseded by SKY-343 bundle-resolution types in src/domain/bundleResolution.ts. */
export const ResolutionRung = Schema.Literals([
  "Agent",
  "Dataset",
  "Series",
  "Variable"
]).annotate({
  description: "The four rungs of the data-reference resolution kernel"
});
export type ResolutionRung = Schema.Schema.Type<typeof ResolutionRung>;
