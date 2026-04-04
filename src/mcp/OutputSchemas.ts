/**
 * MCP-specific success wrappers.
 *
 * These extend the shared domain output schemas with a required `_display`
 * field.  Domain schemas in `bi.ts` / `editorial.ts` stay unchanged — `_display`
 * is an MCP transport concern only.
 */

import { Schema } from "effect";
import {
  KnowledgePostsOutput,
  KnowledgeLinksOutput,
  ExpertListOutput,
  OntologyTopicsOutput,
  OntologyTopicOutput,
  ExpandedTopicsOutput,
  ExplainPostTopicsOutput,
  PostThreadOutput,
  ThreadDocumentOutput
} from "../domain/bi.ts";
import { EditorialPicksOutput, SubmitEditorialPickOutput } from "../domain/editorial.ts";
import { BulkCurateOutput, CurationCandidatesOutput, CuratePostOutput } from "../domain/curation.ts";
import {
  BulkStartEnrichmentOutput,
  GetPostEnrichmentsOutput,
  EnrichmentKind,
  ListEnrichmentGapsOutput,
  ListEnrichmentIssuesOutput
} from "../domain/enrichment.ts";
import { PostUri } from "../domain/types.ts";

const displayFields = { _display: Schema.String } as const;

export const KnowledgePostsMcpOutput = KnowledgePostsOutput.pipe(Schema.fieldsAssign(displayFields));
export type KnowledgePostsMcpOutput = typeof KnowledgePostsMcpOutput.Type;

export const KnowledgeLinksMcpOutput = KnowledgeLinksOutput.pipe(Schema.fieldsAssign(displayFields));
export type KnowledgeLinksMcpOutput = typeof KnowledgeLinksMcpOutput.Type;

export const ExpertListMcpOutput = ExpertListOutput.pipe(Schema.fieldsAssign(displayFields));
export type ExpertListMcpOutput = typeof ExpertListMcpOutput.Type;

export const OntologyTopicsMcpOutput = OntologyTopicsOutput.pipe(Schema.fieldsAssign(displayFields));
export type OntologyTopicsMcpOutput = typeof OntologyTopicsMcpOutput.Type;

export const OntologyTopicMcpOutput = OntologyTopicOutput.pipe(Schema.fieldsAssign(displayFields));
export type OntologyTopicMcpOutput = typeof OntologyTopicMcpOutput.Type;

export const ExpandedTopicsMcpOutput = ExpandedTopicsOutput.pipe(Schema.fieldsAssign(displayFields));
export type ExpandedTopicsMcpOutput = typeof ExpandedTopicsMcpOutput.Type;

export const ExplainPostTopicsMcpOutput = ExplainPostTopicsOutput.pipe(Schema.fieldsAssign(displayFields));
export type ExplainPostTopicsMcpOutput = typeof ExplainPostTopicsMcpOutput.Type;

export const EditorialPicksMcpOutput = EditorialPicksOutput.pipe(Schema.fieldsAssign(displayFields));
export type EditorialPicksMcpOutput = typeof EditorialPicksMcpOutput.Type;

export const PostThreadMcpOutput = PostThreadOutput.pipe(Schema.fieldsAssign(displayFields));
export type PostThreadMcpOutput = typeof PostThreadMcpOutput.Type;

export const ThreadDocumentMcpOutput = ThreadDocumentOutput;
export type ThreadDocumentMcpOutput = typeof ThreadDocumentMcpOutput.Type;

const CurationCandidatesTransportOutput = Schema.Struct({
  ...CurationCandidatesOutput.fields,
  nextCursor: Schema.NullOr(Schema.String)
});

export const CurationCandidatesMcpOutput = CurationCandidatesTransportOutput.pipe(Schema.fieldsAssign(displayFields));
export type CurationCandidatesMcpOutput = typeof CurationCandidatesMcpOutput.Type;

export const CuratePostMcpOutput = CuratePostOutput.pipe(Schema.fieldsAssign(displayFields));
export type CuratePostMcpOutput = typeof CuratePostMcpOutput.Type;

export const BulkCurateMcpOutput = BulkCurateOutput.pipe(Schema.fieldsAssign(displayFields));
export type BulkCurateMcpOutput = typeof BulkCurateMcpOutput.Type;

export const SubmitEditorialPickMcpOutput = SubmitEditorialPickOutput.pipe(Schema.fieldsAssign(displayFields));
export type SubmitEditorialPickMcpOutput = typeof SubmitEditorialPickMcpOutput.Type;

export const PostEnrichmentsMcpOutput = GetPostEnrichmentsOutput.pipe(Schema.fieldsAssign(displayFields));
export type PostEnrichmentsMcpOutput = typeof PostEnrichmentsMcpOutput.Type;

export const EnrichmentGapsMcpOutput = ListEnrichmentGapsOutput.pipe(Schema.fieldsAssign(displayFields));
export type EnrichmentGapsMcpOutput = typeof EnrichmentGapsMcpOutput.Type;

export const EnrichmentIssuesMcpOutput = ListEnrichmentIssuesOutput.pipe(Schema.fieldsAssign(displayFields));
export type EnrichmentIssuesMcpOutput = typeof EnrichmentIssuesMcpOutput.Type;

export const StartEnrichmentMcpOutput = Schema.Struct({
  postUri: PostUri,
  enrichmentType: EnrichmentKind,
  status: Schema.Literal("queued"),
  runId: Schema.String
}).pipe(Schema.fieldsAssign(displayFields));
export type StartEnrichmentMcpOutput = typeof StartEnrichmentMcpOutput.Type;

export const BulkStartEnrichmentMcpOutput = BulkStartEnrichmentOutput.pipe(Schema.fieldsAssign(displayFields));
export type BulkStartEnrichmentMcpOutput = typeof BulkStartEnrichmentMcpOutput.Type;
