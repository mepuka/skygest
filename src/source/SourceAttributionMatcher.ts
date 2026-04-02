import { ServiceMap, Effect, Layer, Schema } from "effect";
import { EnrichmentSchemaDecodeError } from "../domain/errors";
import {
  SourceAttributionMatcherInput,
  type SourceAttributionMatchResult
} from "../domain/sourceMatching";
import { formatSchemaParseError } from "../platform/Json";
import { ProviderRegistry } from "../services/ProviderRegistry";
import { matchSourceAttribution } from "./SourceAttributionRules";
import { publicationsSeedManifest } from "../bootstrap/CheckedInPublications";
import { brandShortenerMap } from "./brandShorteners";
import { buildPublicationIndex } from "./publicationResolver";
import type { PublicationContext } from "./contentSource";

const publicationContext: PublicationContext = {
  publicationIndex: buildPublicationIndex(publicationsSeedManifest.publications),
  brandShortenerMap
};

const decodeMatcherInput = (input: unknown) =>
  Schema.decodeUnknownEffect(SourceAttributionMatcherInput)(input).pipe(
    Effect.mapError((error) =>
      new EnrichmentSchemaDecodeError({
        message: formatSchemaParseError(error),
        operation: "SourceAttributionMatcher.match"
      })
    )
  );

export class SourceAttributionMatcher extends ServiceMap.Service<SourceAttributionMatcher, {
  readonly match: (
    input: Schema.Codec.Encoded<typeof SourceAttributionMatcherInput>
  ) => Effect.Effect<SourceAttributionMatchResult, EnrichmentSchemaDecodeError>;
}>()("@skygest/SourceAttributionMatcher") {
  static readonly layer = Layer.effect(
    SourceAttributionMatcher,
    Effect.gen(function* () {
      const registry = yield* ProviderRegistry;

      const match = Effect.fn("SourceAttributionMatcher.match")(function* (
        input: Schema.Codec.Encoded<typeof SourceAttributionMatcherInput>
      ) {
        const decoded = yield* decodeMatcherInput(input);
        return matchSourceAttribution(decoded, registry.lookup, publicationContext);
      });

      return { match };
    })
  );
}
