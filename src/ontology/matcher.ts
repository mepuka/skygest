/**
 * Ontology matcher: given a prepared catalog and input signals,
 * produces match evidence for each topic.
 */
import { Schema } from "effect";
import {
  type MatchedTopic as MatchedTopicType,
  MatchedTopic
} from "../domain/bi";
import { normalizeText, normalizeWord, normalizeHashtag, normalizeDomain } from "./normalize";
import { compareEvidence, type PreparedCatalog, type PreparedTerm, type PreparedTopic } from "./catalog";

export type MatchInput = {
  readonly text: string;
  readonly metadataTexts?: ReadonlyArray<string>;
  readonly hashtags?: ReadonlyArray<string>;
  readonly domains?: ReadonlyArray<string>;
};

export type MatchEvidence = {
  readonly kind: "term" | "hashtag" | "domain";
  readonly raw: string;
  readonly normalized: string;
  readonly score: number;
};

const matchesDomain = (candidate: string, input: ReadonlyArray<string>) =>
  input.some((domain) => domain === candidate || domain.endsWith(`.${candidate}`));

const findBestEvidence = (
  topic: PreparedTopic,
  haystack: string,
  hashtags: ReadonlySet<string>,
  domains: ReadonlyArray<string>,
  ambiguityTerms: ReadonlySet<string>
): MatchEvidence | null => {
  let winner: PreparedTerm | null = null;
  let signal: MatchEvidence["kind"] | null = null;

  for (const term of topic.normalizedTerms) {
    if (!haystack.includes(` ${term.normalized} `)) {
      continue;
    }
    if (term.score === 1 && ambiguityTerms.has(term.normalized)) {
      continue;
    }
    if (compareEvidence(term, winner) < 0) {
      winner = term;
      signal = "term";
    }
  }

  for (const hashtag of topic.normalizedHashtags) {
    if (!hashtags.has(hashtag)) {
      continue;
    }
    const candidate: PreparedTerm = {
      raw: hashtag,
      normalized: hashtag,
      score: 3
    };
    if (compareEvidence(candidate, winner) < 0) {
      winner = candidate;
      signal = "hashtag";
    }
  }

  for (const domain of topic.normalizedDomains) {
    if (!matchesDomain(domain, domains)) {
      continue;
    }
    const candidate: PreparedTerm = {
      raw: domain,
      normalized: domain,
      score: 4
    };
    if (compareEvidence(candidate, winner) < 0) {
      winner = candidate;
      signal = "domain";
    }
  }

  if (winner === null || signal === null) {
    return null;
  }

  return { kind: signal, raw: winner.raw, normalized: winner.normalized, score: winner.score };
};

export const matchTopics = (
  catalog: PreparedCatalog,
  input: MatchInput
): ReadonlyArray<MatchedTopicType> => {
  const ambiguityTerms = new Set(catalog.snapshot.signalCatalog.ambiguityTerms.map(normalizeWord));
  const haystack = normalizeText([input.text, ...(input.metadataTexts ?? [])].join(" "));
  const hashtags = new Set((input.hashtags ?? []).map(normalizeHashtag).filter((value) => value.length > 0));
  const domains = (input.domains ?? [])
    .map(normalizeDomain)
    .filter((value) => value.length > 0);

  const matches = catalog.topics.flatMap((topic) => {
    const evidence = findBestEvidence(topic, haystack, hashtags, domains, ambiguityTerms);
    if (evidence === null) {
      return [];
    }

    return [Schema.decodeUnknownSync(MatchedTopic)({
      topicSlug: topic.slug,
      matchedTerm: evidence.raw,
      matchSignal: evidence.kind,
      matchValue: evidence.raw,
      matchScore: evidence.score,
      ontologyVersion: catalog.snapshot.ontologyVersion,
      matcherVersion: catalog.snapshot.snapshotVersion
    })];
  });

  return matches.sort((left: MatchedTopicType, right: MatchedTopicType) =>
    left.topicSlug.localeCompare(right.topicSlug)
  );
};
