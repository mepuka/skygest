import { Clock, Context, Effect, Layer } from "effect";
import type { SqlError } from "@effect/sql/SqlError";
import type { DbError } from "../domain/errors";
import type {
  CandidatePayloadNotPickedError,
  CandidatePayloadRecord,
  SaveCandidateEnrichmentInput,
  SaveCandidatePayloadInput
} from "../domain/candidatePayload";
import type { AtUri } from "../domain/types";
import { CandidatePayloadRepo } from "./CandidatePayloadRepo";

export class CandidatePayloadService extends Context.Tag("@skygest/CandidatePayloadService")<
  CandidatePayloadService,
  {
    readonly capturePayload: (
      input: SaveCandidatePayloadInput
    ) => Effect.Effect<boolean, SqlError | DbError>;

    readonly markPicked: (
      postUri: AtUri
    ) => Effect.Effect<boolean, SqlError | DbError>;

    readonly saveEnrichment: (
      input: SaveCandidateEnrichmentInput
    ) => Effect.Effect<boolean, SqlError | DbError | CandidatePayloadNotPickedError>;

    readonly getPayload: (
      postUri: AtUri
    ) => Effect.Effect<CandidatePayloadRecord | null, SqlError | DbError>;
  }
>() {
  static readonly layer = Layer.effect(CandidatePayloadService, Effect.gen(function* () {
    const repo = yield* CandidatePayloadRepo;

    const capturePayload = Effect.fn("CandidatePayloadService.capturePayload")(function* (
      input: SaveCandidatePayloadInput
    ) {
      const now = yield* Clock.currentTimeMillis;
      return yield* repo.upsertCapture({
        postUri: input.postUri,
        captureStage: input.captureStage,
        embedType: input.embedType,
        embedPayload: input.embedPayload,
        enrichments: [],
        capturedAt: now,
        updatedAt: now,
        enrichedAt: null
      });
    });

    const markPicked = Effect.fn("CandidatePayloadService.markPicked")(function* (postUri: AtUri) {
      const now = yield* Clock.currentTimeMillis;
      return yield* repo.markPicked(postUri, now);
    });

    const saveEnrichment = Effect.fn("CandidatePayloadService.saveEnrichment")(function* (
      input: SaveCandidateEnrichmentInput
    ) {
      const now = yield* Clock.currentTimeMillis;
      return yield* repo.saveEnrichment(input, now, now);
    });

    const getPayload = Effect.fn("CandidatePayloadService.getPayload")(function* (postUri: AtUri) {
      return yield* repo.getByPostUri(postUri);
    });

    return CandidatePayloadService.of({
      capturePayload,
      markPicked,
      saveEnrichment,
      getPayload
    });
  }));
}
