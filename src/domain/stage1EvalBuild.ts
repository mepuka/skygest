import { Schema } from "effect";
import { PostUri } from "./types";

export const resolverGoldSetLanes = [
  "url-exact-match",
  "url-prefix-match",
  "hostname-match",
  "dataset-title",
  "dataset-alias",
  "provider-agent",
  "provider-homepage",
  "agent-label",
  "variable-alias",
  "deferred-to-stage2",
  "thread-followup"
] as const;

export const ResolverGoldSetLane = Schema.Literals(
  resolverGoldSetLanes
).annotate({
  description:
    "Human-authored lane label used to track which Stage 1 path a gold-set post exercises"
});
export type ResolverGoldSetLane = Schema.Schema.Type<typeof ResolverGoldSetLane>;

export const ResolverGoldSetEntry = Schema.Struct({
  uri: PostUri,
  handle: Schema.optionalKey(Schema.String),
  publisher: Schema.optionalKey(Schema.String),
  includesLanes: Schema.Array(ResolverGoldSetLane),
  notes: Schema.optionalKey(Schema.String)
}).annotate({
  description:
    "One curated resolver gold-set entry chosen for Stage 1 evaluation"
});
export type ResolverGoldSetEntry = Schema.Schema.Type<typeof ResolverGoldSetEntry>;

export const ResolverGoldSetManifest = Schema.Array(ResolverGoldSetEntry).annotate({
  description:
    "Curated subset of posts that have rich enrichments and hand-resolved Stage 1 ground truth"
});
export type ResolverGoldSetManifest = Schema.Schema.Type<
  typeof ResolverGoldSetManifest
>;

export const Stage1EvalSnapshotMetadata = Schema.Struct({
  handle: Schema.NullOr(Schema.String),
  publisher: Schema.optionalKey(Schema.NullOr(Schema.String)),
  includesLanes: Schema.optionalKey(Schema.Array(ResolverGoldSetLane)),
  notes: Schema.optionalKey(Schema.NullOr(Schema.String)),
  clusterKey: Schema.optionalKey(Schema.NullOr(Schema.String)),
  selectionReason: Schema.optionalKey(Schema.NullOr(Schema.String)),
  textSnippet: Schema.optionalKey(Schema.NullOr(Schema.String))
}).annotate({
  description:
    "Human-facing metadata preserved alongside one Stage 1 eval snapshot row"
});
export type Stage1EvalSnapshotMetadata = Schema.Schema.Type<
  typeof Stage1EvalSnapshotMetadata
>;

export const ManifestReadDiagnostic = Schema.TaggedStruct(
  "ManifestReadDiagnostic",
  {
    code: Schema.Literal("manifest-read-failed"),
    manifestPath: Schema.String,
    message: Schema.String
  }
).annotate({
  description: "The gold-set manifest could not be read from disk"
});
export type ManifestReadDiagnostic = Schema.Schema.Type<
  typeof ManifestReadDiagnostic
>;

export const ManifestDecodeDiagnostic = Schema.TaggedStruct(
  "ManifestDecodeDiagnostic",
  {
    code: Schema.Literal("manifest-decode-failed"),
    manifestPath: Schema.String,
    message: Schema.String
  }
).annotate({
  description:
    "The gold-set manifest existed on disk but failed Effect Schema decoding"
});
export type ManifestDecodeDiagnostic = Schema.Schema.Type<
  typeof ManifestDecodeDiagnostic
>;

export const SnapshotWriteDiagnostic = Schema.TaggedStruct(
  "SnapshotWriteDiagnostic",
  {
    code: Schema.Literal("snapshot-write-failed"),
    outputPath: Schema.String,
    message: Schema.String
  }
).annotate({
  description: "The JSONL snapshot could not be written to disk"
});
export type SnapshotWriteDiagnostic = Schema.Schema.Type<
  typeof SnapshotWriteDiagnostic
>;

export const UnsupportedPostSourceDiagnostic = Schema.TaggedStruct(
  "UnsupportedPostSourceDiagnostic",
  {
    code: Schema.Literal("unsupported-post-source"),
    slug: Schema.String,
    postUri: PostUri,
    source: Schema.Literal("twitter")
  }
).annotate({
  description:
    "Legacy diagnostic preserved so older Stage 1 build reports still decode after Twitter support was added"
});
export type UnsupportedPostSourceDiagnostic = Schema.Schema.Type<
  typeof UnsupportedPostSourceDiagnostic
>;

export const MissingStoredPostDiagnostic = Schema.TaggedStruct(
  "MissingStoredPostDiagnostic",
  {
    code: Schema.Literal("missing-stored-post"),
    slug: Schema.String,
    postUri: PostUri
  }
).annotate({
  description: "No stored post row existed for a gold-set entry"
});
export type MissingStoredPostDiagnostic = Schema.Schema.Type<
  typeof MissingStoredPostDiagnostic
>;

export const MissingPostTextDiagnostic = Schema.TaggedStruct(
  "MissingPostTextDiagnostic",
  {
    code: Schema.Literal("missing-post-text"),
    slug: Schema.String,
    postUri: PostUri
  }
).annotate({
  description: "The stored post existed but did not provide usable post text"
});
export type MissingPostTextDiagnostic = Schema.Schema.Type<
  typeof MissingPostTextDiagnostic
>;

export const MissingLinksDiagnostic = Schema.TaggedStruct(
  "MissingLinksDiagnostic",
  {
    code: Schema.Literal("missing-links"),
    slug: Schema.String,
    postUri: PostUri
  }
).annotate({
  description:
    "The gold-set post was missing stored links, but the snapshot row can still be built from the other stored signals"
});
export type MissingLinksDiagnostic = Schema.Schema.Type<
  typeof MissingLinksDiagnostic
>;

export const MissingCandidatePayloadDiagnostic = Schema.TaggedStruct(
  "MissingCandidatePayloadDiagnostic",
  {
    code: Schema.Literal("missing-candidate-payload"),
    slug: Schema.String,
    postUri: PostUri
  }
).annotate({
  description:
    "The gold-set post was missing the stored candidate payload needed to derive link cards"
});
export type MissingCandidatePayloadDiagnostic = Schema.Schema.Type<
  typeof MissingCandidatePayloadDiagnostic
>;

export const MissingLinkCardsDiagnostic = Schema.TaggedStruct(
  "MissingLinkCardsDiagnostic",
  {
    code: Schema.Literal("missing-link-cards"),
    slug: Schema.String,
    postUri: PostUri
  }
).annotate({
  description:
    "The gold-set post had a payload but it did not yield any link-card context"
});
export type MissingLinkCardsDiagnostic = Schema.Schema.Type<
  typeof MissingLinkCardsDiagnostic
>;

export const MissingVisionDiagnostic = Schema.TaggedStruct(
  "MissingVisionDiagnostic",
  {
    code: Schema.Literal("missing-vision"),
    slug: Schema.String,
    postUri: PostUri
  }
).annotate({
  description:
    "The gold-set post did not have a usable vision enrichment payload"
});
export type MissingVisionDiagnostic = Schema.Schema.Type<
  typeof MissingVisionDiagnostic
>;

export const MissingSourceAttributionDiagnostic = Schema.TaggedStruct(
  "MissingSourceAttributionDiagnostic",
  {
    code: Schema.Literal("missing-source-attribution"),
    slug: Schema.String,
    postUri: PostUri
  }
).annotate({
  description:
    "The gold-set post did not have a usable source-attribution enrichment payload"
});
export type MissingSourceAttributionDiagnostic = Schema.Schema.Type<
  typeof MissingSourceAttributionDiagnostic
>;

export const Stage1EvalSnapshotBuildDiagnostic = Schema.Union([
  ManifestReadDiagnostic,
  ManifestDecodeDiagnostic,
  SnapshotWriteDiagnostic,
  UnsupportedPostSourceDiagnostic,
  MissingStoredPostDiagnostic,
  MissingPostTextDiagnostic,
  MissingLinksDiagnostic,
  MissingCandidatePayloadDiagnostic,
  MissingLinkCardsDiagnostic,
  MissingVisionDiagnostic,
  MissingSourceAttributionDiagnostic
]).annotate({
  description:
    "Typed diagnostic emitted while loading the gold set or materializing the Stage 1 snapshot"
});
export type Stage1EvalSnapshotBuildDiagnostic = Schema.Schema.Type<
  typeof Stage1EvalSnapshotBuildDiagnostic
>;

export const Stage1EvalSnapshotBuildReport = Schema.Struct({
  manifestPath: Schema.optionalKey(Schema.String),
  outputPath: Schema.optionalKey(Schema.String),
  diagnostics: Schema.Array(Stage1EvalSnapshotBuildDiagnostic)
}).annotate({
  description:
    "Aggregate report of all typed problems found while building the Stage 1 eval snapshot"
});
export type Stage1EvalSnapshotBuildReport = Schema.Schema.Type<
  typeof Stage1EvalSnapshotBuildReport
>;
