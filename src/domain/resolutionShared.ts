import { Schema } from "effect";
import { Stage2Result } from "./stage2Resolution";
import { NonNegativeInt, PostUri } from "./types";

export const Stage2Output = Stage2Result;
export type Stage2Output = Schema.Schema.Type<typeof Stage2Output>;

export const Stage3JobId = Schema.String.pipe(
  Schema.check(Schema.isMinLength(1))
);
export type Stage3JobId = Schema.Schema.Type<typeof Stage3JobId>;

export const ResolveStage3Queued = Schema.Struct({
  status: Schema.Literal("queued"),
  jobId: Stage3JobId
});
export type ResolveStage3Queued = Schema.Schema.Type<typeof ResolveStage3Queued>;

export const ResolverVersion = Schema.String.pipe(
  Schema.check(Schema.isMinLength(1))
);
export type ResolverVersion = Schema.Schema.Type<typeof ResolverVersion>;

export const ResolverBulkItemError = Schema.Struct({
  tag: Schema.String.pipe(Schema.check(Schema.isMinLength(1))),
  message: Schema.String.pipe(Schema.check(Schema.isMinLength(1))),
  retryable: Schema.optionalKey(Schema.Boolean)
});
export type ResolverBulkItemError = Schema.Schema.Type<
  typeof ResolverBulkItemError
>;

export const DataRefResolverWorkflowResult = Schema.Struct({
  postUri: PostUri,
  residualCount: NonNegativeInt,
  status: Schema.Literal("not-implemented")
});
export type DataRefResolverWorkflowResult = Schema.Schema.Type<
  typeof DataRefResolverWorkflowResult
>;
