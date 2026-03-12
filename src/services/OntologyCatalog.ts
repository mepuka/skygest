import { Context, Effect, Layer, Option, Schema } from "effect";
import snapshotJson from "../../config/ontology/energy-snapshot.json";
import {
  type ExpandedTopicsOutput as ExpandedTopicsOutputType,
  type MatchedTopic as MatchedTopicType,
  type OntologyConcept as OntologyConceptType,
  type OntologyExpandMode,
  type OntologyListTopic as OntologyListTopicType,
  type OntologySnapshot as OntologySnapshotType,
  type OntologyTopic as OntologyTopicType,
  type OntologyTopicView,
  type TopicSlug,
  ExpandedTopicsOutput,
  MatchedTopic,
  OntologyConcept,
  OntologyListTopic,
  OntologySnapshot,
  OntologyTopic
} from "../domain/bi";
import { CloudflareEnv, type EnvBindings } from "../platform/Env";

const ACTIVE_POINTER_KEY = "ontology:energy:active";
const SNAPSHOT_PREFIX = "ontology:energy:snapshots:";
const ACTIVE_POINTER_CACHE_TTL_MS = 30_000;

const normalizeText = (value: string) =>
  ` ${value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()} `;

const normalizeWord = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const normalizeHashtag = (value: string) =>
  value.trim().toLowerCase().replace(/^#+/u, "");

const normalizeDomain = (value: string) =>
  value.trim().toLowerCase().replace(/^www\./u, "");

type MatchInput = {
  readonly text: string;
  readonly metadataTexts?: ReadonlyArray<string>;
  readonly hashtags?: ReadonlyArray<string>;
  readonly domains?: ReadonlyArray<string>;
};

type PreparedTerm = {
  readonly raw: string;
  readonly normalized: string;
  readonly score: number;
};

type PreparedTopic = OntologyTopicType & {
  readonly normalizedTerms: ReadonlyArray<PreparedTerm>;
  readonly normalizedHashtags: ReadonlySet<string>;
  readonly normalizedDomains: ReadonlySet<string>;
};

type PreparedCatalog = {
  readonly snapshot: OntologySnapshotType;
  readonly topics: ReadonlyArray<PreparedTopic>;
  readonly concepts: ReadonlyArray<OntologyConceptType>;
  readonly topicBySlug: ReadonlyMap<string, PreparedTopic>;
  readonly conceptBySlug: ReadonlyMap<string, OntologyConceptType>;
  readonly nodeBySlug: ReadonlyMap<string, OntologyListTopicType>;
  readonly conceptDescendants: ReadonlyMap<string, ReadonlySet<string>>;
  readonly conceptAncestors: ReadonlyMap<string, ReadonlySet<string>>;
};

type SnapshotPointer = {
  readonly snapshotVersion: string;
};

const SnapshotPointerSchema = Schema.Struct({
  snapshotVersion: Schema.String
});

const LocalSnapshot = Schema.decodeUnknownSync(OntologySnapshot)(snapshotJson);

let cachedPointer: { readonly snapshotVersion: string; readonly expiresAt: number } | null = null;
const preparedCatalogByVersion = new Map<string, PreparedCatalog>();

const compareEvidence = (left: PreparedTerm | null, right: PreparedTerm | null) => {
  if (left === null) {
    return 1;
  }
  if (right === null) {
    return -1;
  }
  if (left.score !== right.score) {
    return right.score - left.score;
  }
  if (left.raw.length !== right.raw.length) {
    return right.raw.length - left.raw.length;
  }
  return left.raw.localeCompare(right.raw);
};

const sortTopicSlugs = (values: Iterable<string>) =>
  Schema.decodeUnknownSync(Schema.Array(Schema.String))(
    Array.from(new Set(values)).sort((a, b) => a.localeCompare(b))
  ) as ReadonlyArray<TopicSlug>;

const makeTopicNode = (topic: OntologyTopicType): OntologyListTopicType => ({
  slug: topic.slug,
  kind: "canonical-topic",
  label: topic.label,
  description: topic.description,
  canonicalTopicSlug: topic.slug,
  topConcept: false,
  conceptSlugs: topic.conceptSlugs,
  parentSlugs: [],
  childSlugs: topic.conceptSlugs,
  terms: topic.terms,
  hashtags: topic.hashtags,
  domains: topic.domains
});

const makeConceptNode = (concept: OntologyConceptType): OntologyListTopicType => ({
  slug: concept.slug,
  kind: "concept",
  label: concept.label,
  description: concept.description,
  canonicalTopicSlug: concept.canonicalTopicSlug,
  topConcept: concept.topConcept,
  conceptSlugs: [concept.slug],
  parentSlugs: concept.broaderSlugs,
  childSlugs: concept.narrowerSlugs,
  terms: concept.matcherTerms,
  hashtags: [],
  domains: []
});

const buildAncestors = (
  conceptBySlug: ReadonlyMap<string, OntologyConceptType>,
  slug: string,
  seen = new Set<string>()
): ReadonlySet<string> => {
  const concept = conceptBySlug.get(slug);
  if (concept === undefined) {
    return seen;
  }

  for (const parent of concept.broaderSlugs) {
    if (!seen.has(parent)) {
      seen.add(parent);
      buildAncestors(conceptBySlug, parent, seen);
    }
  }

  return seen;
};

const buildDescendants = (
  conceptBySlug: ReadonlyMap<string, OntologyConceptType>,
  slug: string,
  seen = new Set<string>()
): ReadonlySet<string> => {
  const concept = conceptBySlug.get(slug);
  if (concept === undefined) {
    return seen;
  }

  for (const child of concept.narrowerSlugs) {
    if (!seen.has(child)) {
      seen.add(child);
      buildDescendants(conceptBySlug, child, seen);
    }
  }

  return seen;
};

const prepareCatalog = (snapshot: OntologySnapshotType): PreparedCatalog => {
  const topics = snapshot.canonicalTopics.map((topic) => ({
    ...topic,
    normalizedTerms: topic.terms
      .map((raw) => {
        const normalized = normalizeWord(raw);
        return {
          raw,
          normalized,
          score: normalized.includes(" ") ? 2 : 1
        } satisfies PreparedTerm;
      })
      .filter((term, index, array) =>
        term.normalized.length > 0 &&
        array.findIndex((candidate) => candidate.normalized === term.normalized) === index
      )
      .sort(compareEvidence),
    normalizedHashtags: new Set(topic.hashtags.map(normalizeHashtag).filter((value) => value.length > 0)),
    normalizedDomains: new Set(topic.domains.map(normalizeDomain).filter((value) => value.length > 0))
  }));
  const topicBySlug = new Map(topics.map((topic) => [topic.slug, topic] as const));
  const conceptBySlug = new Map(snapshot.concepts.map((concept) => [concept.slug, concept] as const));
  const conceptDescendants = new Map(
    snapshot.concepts.map((concept) => [concept.slug, buildDescendants(conceptBySlug, concept.slug)] as const)
  );
  const conceptAncestors = new Map(
    snapshot.concepts.map((concept) => [concept.slug, buildAncestors(conceptBySlug, concept.slug)] as const)
  );
  const nodeBySlug = new Map<string, OntologyListTopicType>([
    ...snapshot.canonicalTopics.map((topic) => [topic.slug, makeTopicNode(topic)] as const),
    ...snapshot.concepts.map((concept) => [concept.slug, makeConceptNode(concept)] as const)
  ]);

  return {
    snapshot,
    topics,
    concepts: snapshot.concepts,
    topicBySlug,
    conceptBySlug,
    nodeBySlug,
    conceptDescendants,
    conceptAncestors
  };
};

const getPreparedCatalog = (snapshot: OntologySnapshotType): PreparedCatalog => {
  const cached = preparedCatalogByVersion.get(snapshot.snapshotVersion);
  if (cached !== undefined) {
    return cached;
  }

  const prepared = prepareCatalog(snapshot);
  preparedCatalogByVersion.set(snapshot.snapshotVersion, prepared);
  return prepared;
};

const loadSnapshotFromKv = (env: EnvBindings): Effect.Effect<OntologySnapshotType> =>
  Effect.tryPromise({
    try: async () => {
      const now = Date.now();
      if (cachedPointer !== null && cachedPointer.expiresAt > now) {
        const cached = preparedCatalogByVersion.get(cachedPointer.snapshotVersion);
        if (cached !== undefined) {
          return cached.snapshot;
        }
      }

      const kv = env.ONTOLOGY_KV;
      if (kv == null) {
        return LocalSnapshot;
      }

      const pointerJson = await kv.get(ACTIVE_POINTER_KEY, "json");
      if (pointerJson === null) {
        return LocalSnapshot;
      }

      const pointer = Schema.decodeUnknownSync(SnapshotPointerSchema)(pointerJson) as SnapshotPointer;
      cachedPointer = {
        snapshotVersion: pointer.snapshotVersion,
        expiresAt: now + ACTIVE_POINTER_CACHE_TTL_MS
      };

      const cached = preparedCatalogByVersion.get(pointer.snapshotVersion);
      if (cached !== undefined) {
        return cached.snapshot;
      }

      const snapshotJson = await kv.get(`${SNAPSHOT_PREFIX}${pointer.snapshotVersion}`, "json");
      if (snapshotJson === null) {
        return LocalSnapshot;
      }

      return Schema.decodeUnknownSync(OntologySnapshot)(snapshotJson);
    },
    catch: () => LocalSnapshot
  }).pipe(Effect.catchAll(() => Effect.succeed(LocalSnapshot)));

const loadPreparedCatalog = Effect.fn("OntologyCatalog.loadPreparedCatalog")(function* () {
  const env = yield* Effect.serviceOption(CloudflareEnv);
  const snapshot = Option.isSome(env) && env.value.ONTOLOGY_KV != null
    ? yield* loadSnapshotFromKv(env.value)
    : LocalSnapshot;

  return getPreparedCatalog(snapshot);
});

const matchesDomain = (candidate: string, input: ReadonlyArray<string>) =>
  input.some((domain) => domain === candidate || domain.endsWith(`.${candidate}`));

const resolveExpansion = (
  catalog: PreparedCatalog,
  slugs: ReadonlyArray<string>,
  mode: OntologyExpandMode
): ExpandedTopicsOutputType => {
  const resolved = new Set<string>();
  const canonicalTopicSlugs = new Set<TopicSlug>();

  for (const slug of slugs) {
    const topic = catalog.topicBySlug.get(slug);
    if (topic !== undefined) {
      resolved.add(topic.slug);
      canonicalTopicSlugs.add(topic.slug);

      if (mode === "descendants") {
        for (const conceptSlug of topic.conceptSlugs) {
          resolved.add(conceptSlug);
          const concept = catalog.conceptBySlug.get(conceptSlug);
          if (concept?.canonicalTopicSlug != null) {
            canonicalTopicSlugs.add(concept.canonicalTopicSlug);
          }
        }
      }

      continue;
    }

    const concept = catalog.conceptBySlug.get(slug);
    if (concept === undefined) {
      continue;
    }

    resolved.add(concept.slug);
    if (concept.canonicalTopicSlug != null) {
      canonicalTopicSlugs.add(concept.canonicalTopicSlug);
    }

    const related = mode === "descendants"
      ? catalog.conceptDescendants.get(concept.slug)
      : mode === "ancestors"
        ? catalog.conceptAncestors.get(concept.slug)
        : undefined;

    for (const relatedSlug of related ?? []) {
      resolved.add(relatedSlug);
      const relatedConcept = catalog.conceptBySlug.get(relatedSlug);
      if (relatedConcept?.canonicalTopicSlug != null) {
        canonicalTopicSlugs.add(relatedConcept.canonicalTopicSlug);
      }
    }
  }

  const resolvedSlugs = Array.from(resolved).sort((left, right) => left.localeCompare(right));
  const items = resolvedSlugs
    .map((slug) => catalog.nodeBySlug.get(slug))
    .filter((item): item is OntologyListTopicType => item !== undefined);

  return Schema.decodeUnknownSync(ExpandedTopicsOutput)({
    mode,
    inputSlugs: slugs,
    resolvedSlugs,
    canonicalTopicSlugs: sortTopicSlugs(canonicalTopicSlugs),
    items
  });
};

export class OntologyCatalog extends Context.Tag("@skygest/OntologyCatalog")<
  OntologyCatalog,
  {
    readonly snapshot: OntologySnapshotType;
    readonly topics: ReadonlyArray<OntologyTopicType>;
    readonly concepts: ReadonlyArray<OntologyConceptType>;
    readonly match: (
      input: MatchInput
    ) => Effect.Effect<ReadonlyArray<MatchedTopicType>>;
    readonly listTopics: (
      view: OntologyTopicView
    ) => Effect.Effect<ReadonlyArray<OntologyListTopicType>>;
    readonly getTopic: (
      slug: string
    ) => Effect.Effect<OntologyListTopicType | null>;
    readonly expandTopics: (
      slugs: ReadonlyArray<string>,
      mode: OntologyExpandMode
    ) => Effect.Effect<ExpandedTopicsOutputType>;
  }
>() {
  static readonly layer = Layer.effect(
    OntologyCatalog,
    Effect.gen(function* () {
      const catalog = yield* loadPreparedCatalog();
      const ambiguityTerms = new Set(catalog.snapshot.signalCatalog.ambiguityTerms.map(normalizeWord));

      const match = Effect.fn("OntologyCatalog.match")(function* (input: MatchInput) {
        const haystack = normalizeText([input.text, ...(input.metadataTexts ?? [])].join(" "));
        const hashtags = new Set((input.hashtags ?? []).map(normalizeHashtag).filter((value) => value.length > 0));
        const domains = (input.domains ?? [])
          .map(normalizeDomain)
          .filter((value) => value.length > 0);

        const matches = catalog.topics.flatMap((topic: PreparedTopic) => {
          let winner: PreparedTerm | null = null;
          let signal: MatchedTopicType["matchSignal"] | null = null;

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
            return [];
          }

          return [Schema.decodeUnknownSync(MatchedTopic)({
            topicSlug: topic.slug,
            matchedTerm: winner.raw,
            matchSignal: signal,
            matchValue: winner.raw,
            matchScore: winner.score,
            ontologyVersion: catalog.snapshot.ontologyVersion,
            matcherVersion: catalog.snapshot.snapshotVersion
          })];
        });

        return matches.sort((left: MatchedTopicType, right: MatchedTopicType) =>
          left.topicSlug.localeCompare(right.topicSlug)
        );
      });

      const listTopics = Effect.fn("OntologyCatalog.listTopics")(function* (view: OntologyTopicView) {
        return view === "concepts"
          ? catalog.concepts
            .map(makeConceptNode)
            .sort((left: OntologyListTopicType, right: OntologyListTopicType) =>
              left.label.localeCompare(right.label)
            )
          : catalog.snapshot.canonicalTopics
            .map(makeTopicNode)
            .sort((left: OntologyListTopicType, right: OntologyListTopicType) =>
              left.label.localeCompare(right.label)
            );
      });

      const getTopic = Effect.fn("OntologyCatalog.getTopic")(function* (slug: string) {
        return catalog.nodeBySlug.get(slug) ?? null;
      });

      const expandTopics = Effect.fn("OntologyCatalog.expandTopics")(function* (
        slugs: ReadonlyArray<string>,
        mode: OntologyExpandMode
      ) {
        return resolveExpansion(catalog, slugs, mode);
      });

      return OntologyCatalog.of({
        snapshot: catalog.snapshot,
        topics: catalog.snapshot.canonicalTopics,
        concepts: catalog.snapshot.concepts,
        match,
        listTopics,
        getTopic,
        expandTopics
      });
    })
  );
}
