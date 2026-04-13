import { Effect, ServiceMap } from "effect";
import { SqlError } from "effect/unstable/sql/SqlError";
import type { DbError } from "../domain/errors";
import type {
  FindCandidatesByDataRefCursor,
  FindCandidatesByDataRefHit,
  FindCandidatesByDataRefInput
} from "../domain/data-layer/query";

export type DataRefCandidateReadRow = {
  readonly cursor: FindCandidatesByDataRefCursor;
  readonly hit: FindCandidatesByDataRefHit;
};

export type ListDataRefCandidateRowsRepoInput = Pick<
  FindCandidatesByDataRefInput,
  "entityId" | "observedSince" | "observedUntil" | "cursor"
> & {
  readonly limit: number;
};

export class DataRefCandidateReadRepo extends ServiceMap.Service<
  DataRefCandidateReadRepo,
  {
    readonly listByEntityId: (
      input: ListDataRefCandidateRowsRepoInput
    ) => Effect.Effect<ReadonlyArray<DataRefCandidateReadRow>, SqlError | DbError>;
  }
>()("@skygest/DataRefCandidateReadRepo") {}
