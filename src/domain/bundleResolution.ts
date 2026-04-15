import { Schema } from "effect";
import { AgentId, DatasetId, SeriesId, VariableId } from "./data-layer/ids";
import {
  EntitySearchEntityId,
  EntitySearchMatchKind
} from "./entitySearch";
import { ResolutionRung } from "./enrichedBundle";

export const BundleResolutionSignalKind = Schema.Literals([
  "source-attribution-provider-label",
  "source-attribution-content-domain",
  "source-attribution-content-url",
  "visible-url-domain",
  "visible-url",
  "logo-text",
  "organization-mention",
  "source-line-text",
  "source-line-dataset-name",
  "chart-title",
  "link-card-domain",
  "link-card-url",
  "post-link-domain",
  "post-link-url",
  "series-legend-label",
  "axis-label",
  "axis-unit",
  "not-implemented"
]);
export type BundleResolutionSignalKind = Schema.Schema.Type<
  typeof BundleResolutionSignalKind
>;

export const BundleResolutionSignal = Schema.Struct({
  kind: BundleResolutionSignalKind,
  field: Schema.String,
  value: Schema.String
}).annotate({
  description:
    "One bundle signal preserved as provenance for query generation and downstream resolution hits"
});
export type BundleResolutionSignal = Schema.Schema.Type<
  typeof BundleResolutionSignal
>;

export const BundleResolutionLane = Schema.Literals([
  "search",
  "exact-url",
  "exact-hostname",
  "not-implemented"
]);
export type BundleResolutionLane = Schema.Schema.Type<
  typeof BundleResolutionLane
>;

export const BundleResolutionTrailHit = Schema.Struct({
  entityId: EntitySearchEntityId,
  score: Schema.NullOr(Schema.Number),
  matchKind: Schema.NullOr(EntitySearchMatchKind)
}).annotate({
  description:
    "One ranked or exact entity produced by a single bundle-resolution query"
});
export type BundleResolutionTrailHit = Schema.Schema.Type<
  typeof BundleResolutionTrailHit
>;

export const BundleResolutionTrailEntry = Schema.Struct({
  rung: ResolutionRung,
  signal: BundleResolutionSignal,
  lane: BundleResolutionLane,
  query: Schema.NullOr(Schema.String),
  scoped: Schema.Boolean,
  scopeAgentIds: Schema.Array(AgentId),
  hits: Schema.Array(BundleResolutionTrailHit),
  note: Schema.NullOr(Schema.String)
}).annotate({
  description:
    "One bundle-resolution query plus the entity hits it produced, kept for debugging and diagnostics"
});
export type BundleResolutionTrailEntry = Schema.Schema.Type<
  typeof BundleResolutionTrailEntry
>;

const resolvedBundleHitFields = {
  signal: BundleResolutionSignal,
  score: Schema.NullOr(Schema.Number),
  scoped: Schema.Boolean,
  matchKind: Schema.NullOr(EntitySearchMatchKind)
} as const;

export const ResolvedAgent = Schema.Struct({
  entityId: AgentId,
  ...resolvedBundleHitFields
}).annotate({
  description:
    "One resolved Agent retained in the bundle envelope with its winning signal provenance"
});
export type ResolvedAgent = Schema.Schema.Type<typeof ResolvedAgent>;

export const ResolvedDataset = Schema.Struct({
  entityId: DatasetId,
  ...resolvedBundleHitFields
}).annotate({
  description:
    "One resolved Dataset retained in the bundle envelope with its winning signal provenance"
});
export type ResolvedDataset = Schema.Schema.Type<typeof ResolvedDataset>;

export const ResolvedSeries = Schema.Struct({
  entityId: SeriesId,
  ...resolvedBundleHitFields
}).annotate({
  description:
    "One resolved Series retained in the bundle envelope with its winning signal provenance"
});
export type ResolvedSeries = Schema.Schema.Type<typeof ResolvedSeries>;

export const ResolvedVariable = Schema.Struct({
  entityId: VariableId,
  ...resolvedBundleHitFields
}).annotate({
  description:
    "One resolved Variable retained in the bundle envelope with its winning signal provenance"
});
export type ResolvedVariable = Schema.Schema.Type<typeof ResolvedVariable>;

export const BundleResolution = Schema.Struct({
  agents: Schema.Array(ResolvedAgent),
  datasets: Schema.Array(ResolvedDataset),
  series: Schema.Array(ResolvedSeries),
  variables: Schema.Array(ResolvedVariable),
  trail: Schema.Array(BundleResolutionTrailEntry)
}).annotate({
  description:
    "Typed bundle-resolution envelope produced from one EnrichedBundle over exact URL/domain lookups and EntitySearch queries"
});
export type BundleResolution = Schema.Schema.Type<typeof BundleResolution>;
