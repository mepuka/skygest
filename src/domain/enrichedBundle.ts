import { Schema } from "effect";
import { AgentId, DatasetId } from "./data-layer/ids";
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

// ---------------------------------------------------------------------------
// AgentSignal — provenance of a rung-1 agent hit.
//
// Each variant records which vision/source-attribution/post-context field
// produced the hit, plus the literal query value fed to the lookup.
//
// SUPERSEDED-BY: SKY-343 / src/domain/bundleResolution.ts
// These exact-match resolver types remain in tree only to support the
// reference implementation at src/resolution/bundle/resolveDataReference.ts.
// ---------------------------------------------------------------------------

/** @deprecated Superseded by SKY-343 bundle-resolution types in src/domain/bundleResolution.ts. */
export const AgentSignal = Schema.Union([
  Schema.TaggedStruct("SourceAttributionProvider", {
    providerLabel: Schema.String
  }),
  Schema.TaggedStruct("SourceAttributionContentDomain", {
    domain: Schema.String
  }),
  Schema.TaggedStruct("VisibleUrlDomain", {
    url: Schema.String,
    domain: Schema.String
  }),
  Schema.TaggedStruct("LogoText", {
    logoText: Schema.String
  }),
  Schema.TaggedStruct("OrganizationMention", {
    name: Schema.String
  }),
  Schema.TaggedStruct("SourceLineText", {
    sourceText: Schema.String
  }),
  Schema.TaggedStruct("LinkCardDomain", {
    uri: Schema.String,
    domain: Schema.String
  }),
  Schema.TaggedStruct("PostLinkDomain", {
    url: Schema.String,
    domain: Schema.String
  })
]).annotate({
  description:
    "Provenance tag for a rung-1 agent hit — records which field/value produced the hit"
});
export type AgentSignal = Schema.Schema.Type<typeof AgentSignal>;

// ---------------------------------------------------------------------------
// DatasetSignal — provenance of a rung-2 dataset hit.
//
// URL-lane variants short-circuit through Distribution.datasetId.
// Name-lane variants invoke findDatasetMatchesForName().
// ---------------------------------------------------------------------------

/** @deprecated Superseded by SKY-343 bundle-resolution types in src/domain/bundleResolution.ts. */
export const DatasetSignal = Schema.Union([
  Schema.TaggedStruct("VisibleUrlDistribution", {
    url: Schema.String
  }),
  Schema.TaggedStruct("LinkCardDistribution", {
    uri: Schema.String
  }),
  Schema.TaggedStruct("PostLinkDistribution", {
    url: Schema.String
  }),
  Schema.TaggedStruct("VisibleUrlDatasetLandingPage", {
    url: Schema.String
  }),
  Schema.TaggedStruct("LinkCardDatasetLandingPage", {
    uri: Schema.String
  }),
  Schema.TaggedStruct("PostLinkDatasetLandingPage", {
    url: Schema.String
  }),
  Schema.TaggedStruct("SourceLineDatasetName", {
    datasetName: Schema.String
  }),
  Schema.TaggedStruct("ChartTitle", {
    title: Schema.String
  }),
  Schema.TaggedStruct("SourceLineText", {
    sourceText: Schema.String
  })
]).annotate({
  description:
    "Provenance tag for a rung-2 dataset hit — records which signal and query value produced the hit"
});
export type DatasetSignal = Schema.Schema.Type<typeof DatasetSignal>;

// ---------------------------------------------------------------------------
// Resolved hit shapes (one entry per distinct rung result).
// ---------------------------------------------------------------------------

/** @deprecated Superseded by SKY-343 bundle-resolution types in src/domain/bundleResolution.ts. */
export const ResolvedAgent = Schema.Struct({
  agentId: AgentId,
  via: AgentSignal
}).annotate({
  description: "One agent hit from rung 1, tagged with the signal that produced it"
});
export type ResolvedAgent = Schema.Schema.Type<typeof ResolvedAgent>;

/** @deprecated Superseded by SKY-343 bundle-resolution types in src/domain/bundleResolution.ts. */
export const ResolvedDataset = Schema.Struct({
  datasetId: DatasetId,
  via: DatasetSignal,
  agentScoped: Schema.Boolean
}).annotate({
  description:
    "One dataset hit from rung 2, tagged with the signal that produced it and whether it was scoped by rung-1 agents"
});
export type ResolvedDataset = Schema.Schema.Type<typeof ResolvedDataset>;

// ---------------------------------------------------------------------------
// Trail — a linear log of every probe the kernel attempted.
//
// Each entry captures: rung, signal tag, query string, number of hits,
// and an optional status note (e.g. stub rungs 3/4).
// ---------------------------------------------------------------------------

/** @deprecated Superseded by SKY-343 bundle-resolution types in src/domain/bundleResolution.ts. */
export const TrailStatus = Schema.Literals([
  "hit",
  "miss",
  "skipped-empty",
  "not-implemented-stub",
  "not-implemented-needs-lookup-api"
]);
export type TrailStatus = Schema.Schema.Type<typeof TrailStatus>;

/** @deprecated Superseded by SKY-343 bundle-resolution types in src/domain/bundleResolution.ts. */
export const TrailEntry = Schema.Struct({
  rung: ResolutionRung,
  signal: Schema.String,
  query: Schema.NullOr(Schema.String),
  status: TrailStatus,
  hits: Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0))),
  note: Schema.NullOr(Schema.String)
}).annotate({
  description:
    "One entry in the per-bundle resolution trail — what signal was probed, what query was used, what came back"
});
export type TrailEntry = Schema.Schema.Type<typeof TrailEntry>;

// ---------------------------------------------------------------------------
// DataReferenceResolution — the kernel's output for one bundle.
//
// SUPERSEDED-BY: SKY-343 / src/domain/bundleResolution.ts
// ---------------------------------------------------------------------------

/** @deprecated Superseded by SKY-343 bundle-resolution types in src/domain/bundleResolution.ts. */
export const DataReferenceResolution = Schema.Struct({
  agents: Schema.Array(ResolvedAgent),
  datasets: Schema.Array(ResolvedDataset),
  series: Schema.Array(Schema.Never),
  variables: Schema.Array(Schema.Never),
  trail: Schema.Array(TrailEntry)
}).annotate({
  description:
    "Total resolution result for one EnrichedBundle. Rungs 1 and 2 are populated; rungs 3 and 4 are stubbed and always empty."
});
export type DataReferenceResolution = Schema.Schema.Type<
  typeof DataReferenceResolution
>;
