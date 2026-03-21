import { Context, Effect, Layer, Schema } from "effect";
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
  Schema.decodeUnknown(SourceAttributionMatcherInput)(input).pipe(
    Effect.mapError((error) =>
      EnrichmentSchemaDecodeError.make({
        message: formatSchemaParseError(error),
        operation: "SourceAttributionMatcher.match"
      })
    )
  );

export class SourceAttributionMatcher extends Context.Tag(
  "@skygest/SourceAttributionMatcher"
)<SourceAttributionMatcher, {
  readonly match: (
    input: Schema.Schema.Encoded<typeof SourceAttributionMatcherInput>
  ) => Effect.Effect<SourceAttributionMatchResult, EnrichmentSchemaDecodeError>;
}>() {
  static readonly layer = Layer.effect(
    SourceAttributionMatcher,
    Effect.gen(function* () {
      const registry = yield* ProviderRegistry;

      const match = Effect.fn("SourceAttributionMatcher.match")(function* (
        input: Schema.Schema.Encoded<typeof SourceAttributionMatcherInput>
      ) {
        const decoded = yield* decodeMatcherInput(input);
        return matchSourceAttribution(decoded, registry.lookup, publicationContext);
      });

      return SourceAttributionMatcher.of({ match });
    })
  );
}
