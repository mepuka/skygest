import { Schema } from "effect";
import { stage1InputFields } from "./stage1Resolution";
import { PostUri } from "./types";
import { Stage1EvalSnapshotMetadata } from "./stage1EvalBuild";

export * from "./stage1EvalBuild";

export const Stage1EvalSnapshotInput = Schema.Struct(
  stage1InputFields
).annotate({
  description:
    "The exact deterministic resolver inputs persisted into one snapshot row"
});
export type Stage1EvalSnapshotInput = Schema.Schema.Type<
  typeof Stage1EvalSnapshotInput
>;

export const Stage1EvalSnapshotRow = Schema.Struct({
  slug: Schema.String,
  postUri: PostUri,
  metadata: Stage1EvalSnapshotMetadata,
  ...stage1InputFields
}).annotate({
  description:
    "One materialized Stage 1 eval row containing the exact deterministic inputs consumed by the resolver"
});
export type Stage1EvalSnapshotRow = Schema.Schema.Type<
  typeof Stage1EvalSnapshotRow
>;
