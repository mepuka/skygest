import { Schema } from "effect";
import { ThreadEmbedType } from "./bi";
import { EmbedPayload } from "./embed";
import { PostUri } from "./types";

export const CandidatePayloadStage = Schema.Literals(["candidate", "picked"]);
export type CandidatePayloadStage = Schema.Schema.Type<typeof CandidatePayloadStage>;

export const CandidateEnrichmentType = Schema.String.pipe(Schema.check(Schema.isMinLength(1)));
export type CandidateEnrichmentType = Schema.Schema.Type<typeof CandidateEnrichmentType>;

export const CandidatePayloadEnrichmentRecord = Schema.Struct({
  enrichmentType: CandidateEnrichmentType,
  enrichmentPayload: Schema.Unknown,
  updatedAt: Schema.Number,
  enrichedAt: Schema.Number
});
export type CandidatePayloadEnrichmentRecord = Schema.Schema.Type<
  typeof CandidatePayloadEnrichmentRecord
>;

export const CandidatePayloadRecord = Schema.Struct({
  postUri: PostUri,
  captureStage: CandidatePayloadStage,
  embedType: Schema.NullOr(ThreadEmbedType),
  embedPayload: Schema.NullOr(EmbedPayload),
  enrichments: Schema.Array(CandidatePayloadEnrichmentRecord),
  capturedAt: Schema.Number,
  updatedAt: Schema.Number,
  enrichedAt: Schema.NullOr(Schema.Number)
});
export type CandidatePayloadRecord = Schema.Schema.Type<typeof CandidatePayloadRecord>;

export const SaveCandidatePayloadInput = Schema.Struct({
  postUri: PostUri,
  captureStage: CandidatePayloadStage,
  embedType: Schema.NullOr(ThreadEmbedType),
  embedPayload: Schema.NullOr(EmbedPayload)
});
export type SaveCandidatePayloadInput = Schema.Schema.Type<typeof SaveCandidatePayloadInput>;

export const SaveCandidateEnrichmentInput = Schema.Struct({
  postUri: PostUri,
  enrichmentType: CandidateEnrichmentType,
  enrichmentPayload: Schema.Unknown
});
export type SaveCandidateEnrichmentInput = Schema.Schema.Type<typeof SaveCandidateEnrichmentInput>;

export class CandidatePayloadNotPickedError extends Schema.TaggedErrorClass<CandidatePayloadNotPickedError>()(
  "CandidatePayloadNotPickedError",
  {
    postUri: PostUri,
    captureStage: CandidatePayloadStage
  }
) {}
