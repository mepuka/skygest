import { Effect, Layer, Schema, ServiceMap } from "effect";
import { EnrichmentSchemaDecodeError } from "../domain/errors";
import { Stage1Input, type Stage1Result } from "../domain/stage1Resolution";
import { formatSchemaParseError } from "../platform/Json";
import { DataLayerRegistry } from "../services/DataLayerRegistry";
import { runStage1 } from "./Stage1";

const decodeStage1Input = (input: unknown) =>
  Schema.decodeUnknownEffect(Stage1Input)(input).pipe(
    Effect.mapError((error) =>
      new EnrichmentSchemaDecodeError({
        message: formatSchemaParseError(error),
        operation: "Stage1Resolver.resolve"
      })
    )
  );

export class Stage1Resolver extends ServiceMap.Service<
  Stage1Resolver,
  {
    readonly resolve: (
      input: Schema.Codec.Encoded<typeof Stage1Input>
    ) => Effect.Effect<Stage1Result, EnrichmentSchemaDecodeError>;
  }
>()("@skygest/Stage1Resolver") {
  static readonly layer = Layer.effect(
    Stage1Resolver,
    Effect.gen(function* () {
      const registry = yield* DataLayerRegistry;

      const resolve = Effect.fn("Stage1Resolver.resolve")(function* (
        input: Schema.Codec.Encoded<typeof Stage1Input>
      ) {
        const decoded = yield* decodeStage1Input(input);
        return runStage1(decoded, registry.lookup);
      });

      return { resolve };
    })
  );
}
