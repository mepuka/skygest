import { Context, Effect, Layer, Schema } from "effect";
import ontologyTopicsJson from "../../config/ontology/energy-topics.json";
import {
  MatchedTopic,
  OntologyTopic,
  type MatchedTopic as MatchedTopicType,
  type OntologyTopic as OntologyTopicType
} from "../domain/bi";

const TopicsSchema = Schema.Array(OntologyTopic);

const normalize = (value: string) =>
  ` ${value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()} `;

type PreparedTopic = OntologyTopicType & {
  readonly normalizedTerms: ReadonlyArray<{ readonly raw: string; readonly normalized: string }>;
};

export class OntologyCatalog extends Context.Tag("@skygest/OntologyCatalog")<
  OntologyCatalog,
  {
    readonly topics: ReadonlyArray<OntologyTopicType>;
    readonly match: (
      text: string,
      metadataTexts?: ReadonlyArray<string>
    ) => Effect.Effect<ReadonlyArray<MatchedTopicType>>;
  }
>() {
  static readonly layer = Layer.sync(
    OntologyCatalog,
    () => {
      const topics = Schema.decodeUnknownSync(TopicsSchema)(ontologyTopicsJson);
      const prepared: ReadonlyArray<PreparedTopic> = topics.map((topic) => ({
        ...topic,
        normalizedTerms: topic.terms.map((term) => ({
          raw: term,
          normalized: normalize(term)
        }))
      }));

      const match = Effect.fn("OntologyCatalog.match")(function* (
        text: string,
        metadataTexts: ReadonlyArray<string> = []
      ) {
        const haystack = normalize([text, ...metadataTexts].join(" "));
        const matched = prepared.flatMap((topic) => {
          const term = topic.normalizedTerms.find((candidate) =>
            haystack.includes(candidate.normalized)
          );
          return term
            ? [{
                topicSlug: topic.slug,
                matchedTerm: term.raw
              }]
            : [];
        });

        return matched;
      });

      return OntologyCatalog.of({
        topics,
        match
      });
    }
  );
}
