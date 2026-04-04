import { ServiceMap, Effect, Layer } from "effect";
import { SqlError } from "effect/unstable/sql/SqlError";
import type { DbError } from "../domain/errors";
import type { GetPipelineStatusInput, PipelineStatusOutput } from "../domain/pipeline";
import { PipelineStatusRepo } from "./PipelineStatusRepo";

export class PipelineStatusService extends ServiceMap.Service<
  PipelineStatusService,
  {
    readonly getStatus: (
      input: GetPipelineStatusInput
    ) => Effect.Effect<PipelineStatusOutput, SqlError | DbError>;
  }
>()("@skygest/PipelineStatusService") {
  static readonly layer = Layer.effect(
    PipelineStatusService,
    Effect.gen(function* () {
      const repo = yield* PipelineStatusRepo;

      const getStatus = Effect.fn("PipelineStatusService.getStatus")(
        function* (input: GetPipelineStatusInput) {
          const snapshot = yield* repo.getStatus();

          if (
            input.since !== undefined &&
            snapshot.lastSweep !== null &&
            snapshot.lastSweep.completedAt < input.since
          ) {
            return {
              ...snapshot,
              lastSweep: null
            };
          }

          return snapshot;
        }
      );

      return { getStatus };
    })
  );
}
