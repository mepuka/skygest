import { Effect } from "effect";
import type { MatchedTopic } from "../domain/bi";
import { OntologyCatalog } from "../services/OntologyCatalog";

/**
 * Reusable topic matching: accepts post-like input and returns matched topics
 * via the OntologyCatalog service. Used by both the Bluesky FilterWorker and
 * the Twitter import endpoint.
 */
export const matchTopics = (input: {
  readonly text: string;
  readonly links: ReadonlyArray<{ readonly domain?: string | null }>;
  readonly hashtags?: ReadonlyArray<string>;
  readonly metadataTexts?: ReadonlyArray<string>;
}): Effect.Effect<ReadonlyArray<MatchedTopic>, never, OntologyCatalog> =>
  Effect.gen(function* () {
    const ontology = yield* OntologyCatalog;

    const domains = input.links
      .map((link) => link.domain)
      .filter((domain): domain is string => domain !== null && domain !== undefined && domain.length > 0);

    return yield* ontology.match({
      text: input.text,
      metadataTexts: input.metadataTexts ?? [],
      hashtags: input.hashtags ?? [],
      domains
    });
  });
