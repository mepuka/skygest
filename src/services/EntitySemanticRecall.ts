import { Effect, Layer, ServiceMap } from "effect";
import type {
  EntitySearchSemanticRecallHit,
  EntitySearchSemanticRecallInput
} from "../domain/entitySearch";

export class EntitySemanticRecall extends ServiceMap.Service<
  EntitySemanticRecall,
  {
    readonly recall: (
      input: EntitySearchSemanticRecallInput
    ) => Effect.Effect<ReadonlyArray<EntitySearchSemanticRecallHit>>;
  }
>()("@skygest/EntitySemanticRecall") {
  static readonly noneLayer = Layer.succeed(
    EntitySemanticRecall,
    EntitySemanticRecall.of({
      recall: () => Effect.succeed([])
    })
  );
}
