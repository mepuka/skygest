import { Schema } from "effect";
import { ThreadEmbedType } from "./bi";
import { AtUri } from "./types";

export const CandidatePayloadStage = Schema.Literal("candidate", "picked");
export type CandidatePayloadStage = Schema.Schema.Type<typeof CandidatePayloadStage>;

export const CandidatePayloadRecord = Schema.Struct({
  postUri: AtUri,
  captureStage: CandidatePayloadStage,
  embedType: Schema.NullOr(ThreadEmbedType),
  embedPayload: Schema.NullOr(Schema.Unknown),
  enrichmentPayload: Schema.NullOr(Schema.Unknown),
  capturedAt: Schema.Number,
  updatedAt: Schema.Number,
  enrichedAt: Schema.NullOr(Schema.Number)
});
export type CandidatePayloadRecord = Schema.Schema.Type<typeof CandidatePayloadRecord>;

export const SaveCandidatePayloadInput = Schema.Struct({
  postUri: AtUri,
  captureStage: CandidatePayloadStage,
  embedType: Schema.NullOr(ThreadEmbedType),
  embedPayload: Schema.NullOr(Schema.Unknown)
});
export type SaveCandidatePayloadInput = Schema.Schema.Type<typeof SaveCandidatePayloadInput>;

export const SaveCandidateEnrichmentInput = Schema.Struct({
  postUri: AtUri,
  enrichmentPayload: Schema.Unknown
});
export type SaveCandidateEnrichmentInput = Schema.Schema.Type<typeof SaveCandidateEnrichmentInput>;
