import { Effect, Layer, Schema, ServiceMap } from "effect";
import { type ResolutionOutcome } from "../domain/resolutionKernel";
import { EnrichmentSchemaDecodeError } from "../domain/errors";
import { Stage1Input } from "../domain/stage1Resolution";
import { formatSchemaParseError } from "../platform/Json";
import { DataLayerRegistry } from "../services/DataLayerRegistry";
import type { DataLayerRegistryLookup } from "./dataLayerRegistry";
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

const resolveAgentIdFromStage1Input = (
  input: typeof Stage1Input.Type,
  lookup: DataLayerRegistryLookup
) => {
  const providerHints = [
    input.sourceAttribution?.provider?.providerId,
    input.sourceAttribution?.provider?.providerLabel,
    input.sourceAttribution?.contentSource?.publication
  ];

  for (const providerHint of providerHints) {
    if (providerHint === null || providerHint === undefined) {
      continue;
    }

    const agentByLabel = lookup.findAgentByLabel(providerHint);
    if (agentByLabel._tag === "Some") {
      return agentByLabel.value.id;
    }
  }

  const homepageHints = [
    input.sourceAttribution?.contentSource?.domain,
    input.sourceAttribution?.contentSource?.url
  ];

  for (const homepageHint of homepageHints) {
    if (homepageHint === null || homepageHint === undefined) {
      continue;
    }

    const homepageAgent = lookup.findAgentByHomepageDomain(homepageHint);
    if (homepageAgent._tag === "Some") {
      return homepageAgent.value.id;
    }
  }

  return undefined;
};

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
        const agentId = resolveAgentIdFromStage1Input(decoded, registry.lookup);
        const resolutionOptions = agentId === undefined ? {} : { agentId };

        return bundles.map((bundle) =>
          resolveBundle(bundle, registry.lookup, vocabulary, resolutionOptions)
        );
      });

      return ResolutionKernel.of({ resolve });
    })
  );
}
