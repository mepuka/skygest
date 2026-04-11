import { Schema } from "effect";
import { Stage1Input, Stage1Residual, Stage1Result } from "./stage1Resolution";
import {
  DataRefResolverWorkflowResult,
  ResolverBulkItemError,
  ResolverVersion,
  ResolveStage3Queued,
  Stage2Output
} from "./resolutionShared";
import { PostUri } from "./types";

const isNonEmptyResolvePostList = (
  posts: ReadonlyArray<ResolvePostRequest>
): boolean => posts.length > 0;

export const ResolveStage3Result = ResolveStage3Queued;
export type ResolveStage3Result = Schema.Schema.Type<typeof ResolveStage3Result>;

export const ResolveLatencyMs = Schema.Struct({
  stage1: Schema.Number.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0))),
  stage2: Schema.optionalKey(
    Schema.Number.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0)))
  ),
  total: Schema.Number.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0)))
});
export type ResolveLatencyMs = Schema.Schema.Type<typeof ResolveLatencyMs>;

export const ResolvePostRequest = Schema.Struct({
  postUri: PostUri,
  stage1Input: Schema.optionalKey(Stage1Input),
  dispatchStage3: Schema.optionalKey(Schema.Boolean)
});
export type ResolvePostRequest = Schema.Schema.Type<typeof ResolvePostRequest>;

export const ResolvePostResponse = Schema.Struct({
  postUri: PostUri,
  stage1: Stage1Result,
  stage2: Schema.optionalKey(Stage2Output),
  stage3: Schema.optionalKey(ResolveStage3Result),
  resolverVersion: ResolverVersion,
  latencyMs: ResolveLatencyMs
});
export type ResolvePostResponse = Schema.Schema.Type<typeof ResolvePostResponse>;

export const ResolveBulkRequest = Schema.Struct({
  posts: Schema.Array(ResolvePostRequest).pipe(
    Schema.check(Schema.makeFilter(isNonEmptyResolvePostList))
  )
});
export type ResolveBulkRequest = Schema.Schema.Type<typeof ResolveBulkRequest>;

export const ResolveBulkResponse = Schema.Struct({
  results: Schema.Record(PostUri, ResolvePostResponse),
  errors: Schema.Record(PostUri, ResolverBulkItemError)
});
export type ResolveBulkResponse = Schema.Schema.Type<typeof ResolveBulkResponse>;

export const DataRefResolverRunParams = Schema.Struct({
  postUri: PostUri,
  residuals: Schema.Array(Stage1Residual)
});
export type DataRefResolverRunParams = Schema.Schema.Type<
  typeof DataRefResolverRunParams
>;

export {
  DataRefResolverWorkflowResult,
  ResolverBulkItemError,
  ResolverVersion,
  Stage2Output
};
