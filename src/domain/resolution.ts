import { Schema } from "effect";
import { EntitySearchBundleCandidates } from "./entitySearch";
import { Stage1Input, Stage1Result } from "./stage1Resolution";
import { ResolutionOutcome } from "./resolutionKernel";
import {
  ResolverBulkItemError,
  ResolverVersion
} from "./resolutionShared";
import { PostUri } from "./types";

const isNonEmptyResolvePostList = (
  posts: ReadonlyArray<ResolvePostRequest>
): boolean => posts.length > 0;

export const ResolveLatencyMs = Schema.Struct({
  stage1: Schema.Number.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0))),
  kernel: Schema.Number.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0))),
  total: Schema.Number.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0)))
});
export type ResolveLatencyMs = Schema.Schema.Type<typeof ResolveLatencyMs>;

export const ResolvePostRequest = Schema.Struct({
  postUri: PostUri,
  stage1Input: Schema.optionalKey(Stage1Input)
});
export type ResolvePostRequest = Schema.Schema.Type<typeof ResolvePostRequest>;

export const ResolvePostResponse = Schema.Struct({
  postUri: PostUri,
  stage1: Stage1Result,
  kernel: Schema.Array(ResolutionOutcome),
  resolverVersion: ResolverVersion,
  latencyMs: ResolveLatencyMs
});
export type ResolvePostResponse = Schema.Schema.Type<typeof ResolvePostResponse>;

export const ResolveSearchCandidatesResponse = EntitySearchBundleCandidates;
export type ResolveSearchCandidatesResponse = Schema.Schema.Type<
  typeof ResolveSearchCandidatesResponse
>;

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

export {
  ResolverBulkItemError,
  ResolverVersion
};
