import { Effect, Layer, Schema, ServiceMap } from "effect";
import { type ResolutionOutcome } from "../domain/resolutionKernel";
import { EnrichmentSchemaDecodeError } from "../domain/errors";
import { Stage1Input } from "../domain/stage1Resolution";
import { formatSchemaParseError } from "../platform/Json";
import { DataLayerRegistry } from "../services/DataLayerRegistry";
import { FacetVocabulary } from "./facetVocabulary";
import { buildResolutionEvidenceBundles } from "./kernel/BundleAdapter";
import { resolveBundle } from "./kernel/ResolutionKernel";

const decodeStage1Input = (input: unknown) =>
  Schema.decodeUnknownEffect(Stage1Input)(input).pipe(
    Effect.mapError((error) =>
      new EnrichmentSchemaDecodeError({
        message: formatSchemaParseError(error),
        operation: "ResolutionKernel.resolve"
      })
    )
  );

export class ResolutionKernel extends ServiceMap.Service<
  ResolutionKernel,
  {
    readonly resolve: (
      input: Schema.Codec.Encoded<typeof Stage1Input>
    ) => Effect.Effect<
      ReadonlyArray<ResolutionOutcome>,
      EnrichmentSchemaDecodeError
    >;
  }
>()("@skygest/ResolutionKernel") {
  static readonly layer = Layer.effect(
    ResolutionKernel,
    Effect.gen(function* () {
      const registry = yield* DataLayerRegistry;
      const vocabulary = yield* FacetVocabulary;

      const resolve = Effect.fn("ResolutionKernel.resolve")(function* (
        input: Schema.Codec.Encoded<typeof Stage1Input>
      ) {
        const decoded = yield* decodeStage1Input(input);
        const bundles = buildResolutionEvidenceBundles(decoded);

        return bundles.map((bundle) =>
          resolveBundle(bundle, registry.lookup, vocabulary)
        );
      });

      return ResolutionKernel.of({ resolve });
    })
  );
}
