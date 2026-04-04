import { ServiceMap, Effect } from "effect";
import { SqlError } from "effect/unstable/sql/SqlError";
import type { DbError } from "../domain/errors";
import type { PipelineStatusOutput } from "../domain/pipeline";

export class PipelineStatusRepo extends ServiceMap.Service<
  PipelineStatusRepo,
  {
    readonly getStatus: () => Effect.Effect<PipelineStatusOutput, SqlError | DbError>;
  }
>()("@skygest/PipelineStatusRepo") {}
