import { Context, Effect } from "effect";
import type { SqlError } from "effect/unstable/sql";
import type { DbError } from "../domain/errors";
import type {
  CurationRecord,
  CurationStatus,
  CurationCandidateOutput,
  ListCurationCandidatesInput
} from "../domain/curation";
import type { KnowledgePost } from "../domain/bi";

export class CurationRepo extends Context.Tag("@skygest/CurationRepo")<
  CurationRepo,
  {
    readonly upsertFlag: (
      record: CurationRecord
    ) => Effect.Effect<boolean, SqlError | DbError>;

    readonly bulkUpsertFlags: (
      records: ReadonlyArray<CurationRecord>
    ) => Effect.Effect<number, SqlError | DbError>;

    readonly updateStatus: (
      postUri: string,
      status: CurationStatus,
      curatedBy: string | null,
      note: string | null,
      curatedAt: number
    ) => Effect.Effect<boolean, SqlError | DbError>;

    readonly getByPostUri: (
      postUri: string
    ) => Effect.Effect<CurationRecord | null, SqlError | DbError>;

    readonly listCandidates: (
      input: ListCurationCandidatesInput
    ) => Effect.Effect<ReadonlyArray<CurationCandidateOutput>, SqlError | DbError>;

    readonly postExists: (
      postUri: string
    ) => Effect.Effect<boolean, SqlError | DbError>;

    readonly getPostEmbedType: (
      postUri: string
    ) => Effect.Effect<KnowledgePost["embedType"], SqlError | DbError>;
  }
>() {}
