import { Predicate } from "effect";
import type {
  CandidatePayloadRecord,
  CandidatePayloadStage
} from "./candidatePayload";

export const isPickedCandidatePayloadStage: Predicate.Predicate<
  CandidatePayloadStage
> = (stage) => stage === "picked";

export const isPickedCandidatePayloadRecord: Predicate.Predicate<
  CandidatePayloadRecord
> = Predicate.mapInput(
  isPickedCandidatePayloadStage,
  (payload) => payload.captureStage
);
