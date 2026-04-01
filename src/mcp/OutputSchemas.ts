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
import { CurationCandidatesOutput, CuratePostOutput } from "../domain/curation.ts";
import { GetPostEnrichmentsOutput } from "../domain/enrichment.ts";

const DisplayField = Schema.Struct({ _display: Schema.String });

export const KnowledgePostsMcpOutput = Schema.extend(KnowledgePostsOutput, DisplayField);
export type KnowledgePostsMcpOutput = Schema.Schema.Type<typeof KnowledgePostsMcpOutput>;

export const KnowledgeLinksMcpOutput = Schema.extend(KnowledgeLinksOutput, DisplayField);
export type KnowledgeLinksMcpOutput = Schema.Schema.Type<typeof KnowledgeLinksMcpOutput>;

export const ExpertListMcpOutput = Schema.extend(ExpertListOutput, DisplayField);
export type ExpertListMcpOutput = Schema.Schema.Type<typeof ExpertListMcpOutput>;

export const OntologyTopicsMcpOutput = Schema.extend(OntologyTopicsOutput, DisplayField);
export type OntologyTopicsMcpOutput = Schema.Schema.Type<typeof OntologyTopicsMcpOutput>;

export const OntologyTopicMcpOutput = Schema.extend(OntologyTopicOutput, DisplayField);
export type OntologyTopicMcpOutput = Schema.Schema.Type<typeof OntologyTopicMcpOutput>;

export const ExpandedTopicsMcpOutput = Schema.extend(ExpandedTopicsOutput, DisplayField);
export type ExpandedTopicsMcpOutput = Schema.Schema.Type<typeof ExpandedTopicsMcpOutput>;

export const ExplainPostTopicsMcpOutput = Schema.extend(ExplainPostTopicsOutput, DisplayField);
export type ExplainPostTopicsMcpOutput = Schema.Schema.Type<typeof ExplainPostTopicsMcpOutput>;

export const EditorialPicksMcpOutput = Schema.extend(EditorialPicksOutput, DisplayField);
export type EditorialPicksMcpOutput = Schema.Schema.Type<typeof EditorialPicksMcpOutput>;

export const PostThreadMcpOutput = Schema.extend(PostThreadOutput, DisplayField);
export type PostThreadMcpOutput = Schema.Schema.Type<typeof PostThreadMcpOutput>;

export const ThreadDocumentMcpOutput = ThreadDocumentOutput;
export type ThreadDocumentMcpOutput = Schema.Schema.Type<typeof ThreadDocumentMcpOutput>;

export const CurationCandidatesMcpOutput = Schema.extend(CurationCandidatesOutput, DisplayField);
export type CurationCandidatesMcpOutput = Schema.Schema.Type<typeof CurationCandidatesMcpOutput>;

export const CuratePostMcpOutput = Schema.extend(CuratePostOutput, DisplayField);
export type CuratePostMcpOutput = Schema.Schema.Type<typeof CuratePostMcpOutput>;

export const SubmitEditorialPickMcpOutput = Schema.extend(SubmitEditorialPickOutput, DisplayField);
export type SubmitEditorialPickMcpOutput = Schema.Schema.Type<typeof SubmitEditorialPickMcpOutput>;

export const PostEnrichmentsMcpOutput = Schema.extend(GetPostEnrichmentsOutput, DisplayField);
export type PostEnrichmentsMcpOutput = Schema.Schema.Type<typeof PostEnrichmentsMcpOutput>;
