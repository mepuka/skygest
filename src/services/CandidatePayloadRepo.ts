import { ServiceMap, Effect } from "effect";
import type { SqlError } from "effect/unstable/sql";
import type { DbError } from "../domain/errors";
import type {
  CandidatePayloadRecord,
  CandidatePayloadNotPickedError,
  SaveCandidateEnrichmentInput
} from "../domain/candidatePayload";

export class CandidatePayloadRepo extends ServiceMap.Service<
  CandidatePayloadRepo,
  {
    /** Upsert a durable candidate/picked payload snapshot. Returns true if new, false if updated. */
    readonly upsertCapture: (
      record: CandidatePayloadRecord
    ) => Effect.Effect<boolean, SqlError | DbError>;

    /** Read the stored payload snapshot for a post, if one exists. */
    readonly getByPostUri: (
      postUri: string
    ) => Effect.Effect<CandidatePayloadRecord | null, SqlError | DbError>;

    /** Promote an existing stored payload from candidate to picked. */
    readonly markPicked: (
      postUri: string,
      updatedAt: number
    ) => Effect.Effect<boolean, SqlError | DbError>;

    /** Attach enrichment JSON to an existing stored payload. */
    readonly saveEnrichment: (
      input: SaveCandidateEnrichmentInput,
      updatedAt: number,
      enrichedAt: number
    ) => Effect.Effect<boolean, SqlError | DbError | CandidatePayloadNotPickedError>;
  }
>()("@skygest/CandidatePayloadRepo") {}
