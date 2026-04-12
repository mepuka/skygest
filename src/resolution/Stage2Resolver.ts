import { Effect, Layer, ServiceMap } from "effect";
import type {
  Stage1PostContext,
  Stage1Result
} from "../domain/stage1Resolution";
import type { Stage2Result } from "../domain/stage2Resolution";
import { DataLayerRegistry } from "../services/DataLayerRegistry";
import { FacetVocabulary } from "./facetVocabulary";
import { runStage2 } from "./Stage2";

export class Stage2Resolver extends ServiceMap.Service<
  Stage2Resolver,
  {
    readonly resolve: (
      postContext: Stage1PostContext,
      stage1: Stage1Result
    ) => Effect.Effect<Stage2Result>;
  }
>()("@skygest/Stage2Resolver") {
  static readonly layer = Layer.effect(
    Stage2Resolver,
    Effect.gen(function* () {
      const registry = yield* DataLayerRegistry;
      const vocabulary = yield* FacetVocabulary;

      const resolve = Effect.fn("Stage2Resolver.resolve")(function* (
        postContext: Stage1PostContext,
        stage1: Stage1Result
      ) {
        return runStage2(postContext, stage1, registry.lookup, vocabulary);
      });

      return Stage2Resolver.of({ resolve });
    })
  );
}
