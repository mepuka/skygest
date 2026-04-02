import { ServiceMap, Duration, Effect, Layer, Option, Schema } from "effect";
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
  OntologySnapshot
} from "../domain/bi";
import { prepareCatalog, type PreparedCatalog } from "../ontology/catalog";
import { matchTopics, type MatchInput } from "../ontology/matcher";
import { CloudflareEnv, type EnvBindings } from "../platform/Env";

const ACTIVE_POINTER_KEY = "ontology:energy:active";
const SNAPSHOT_PREFIX = "ontology:energy:snapshots:";
const CATALOG_CACHE_TTL = Duration.seconds(30);
const CATALOG_CACHE_TTL_MS = Duration.toMillis(CATALOG_CACHE_TTL);

class OntologyKvReadError extends Schema.TaggedErrorClass<OntologyKvReadError>()(
  "OntologyKvReadError",
  {
    operation: Schema.String,
    key: Schema.String,
    error: Schema.Defect
  }
) {}

class OntologyKvDecodeError extends Schema.TaggedErrorClass<OntologyKvDecodeError>()(
  "OntologyKvDecodeError",
  {
    operation: Schema.String,
    key: Schema.String,
    error: Schema.Defect
  }
) {}

export type OntologyKvError = OntologyKvReadError | OntologyKvDecodeError;

type CatalogLoadResult = {
  readonly catalog: PreparedCatalog;
  readonly cacheable: boolean;
};

const SnapshotPointerSchema = Schema.Struct({
  snapshotVersion: Schema.String
});

const LocalSnapshot = Schema.decodeUnknownSync(OntologySnapshot)(snapshotJson);
const LocalPreparedCatalog = prepareCatalog(LocalSnapshot);
const preparedCatalogByVersion = new Map<string, PreparedCatalog>([
  [LocalSnapshot.snapshotVersion, LocalPreparedCatalog]
]);

const sortTopicSlugs = (values: Iterable<string>) =>
  Array.from(new Set(values)).sort((a, b) => a.localeCompare(b)) as unknown as ReadonlyArray<TopicSlug>;

const localCatalogResult = (cacheable: boolean): CatalogLoadResult => ({
  catalog: LocalPreparedCatalog,
  cacheable
});

const getPreparedCatalog = (snapshot: OntologySnapshotType): PreparedCatalog => {
  const cached = preparedCatalogByVersion.get(snapshot.snapshotVersion);
  if (cached !== undefined) {
    return cached;
  }

  const prepared = prepareCatalog(snapshot);
  preparedCatalogByVersion.set(snapshot.snapshotVersion, prepared);
  return prepared;
};

const loadCatalogFromKv = (env: EnvBindings): Effect.Effect<CatalogLoadResult> =>
  Effect.gen(function* () {
    const kv = env.ONTOLOGY_KV;
    if (kv == null) {
      return localCatalogResult(true);
    }

    const pointerJson = yield* Effect.tryPromise({
      try: () => kv.get(ACTIVE_POINTER_KEY, "json"),
      catch: (error) => OntologyKvReadError.make({
        operation: "getPointer",
        key: ACTIVE_POINTER_KEY,
        error
      })
    });

    if (pointerJson === null) {
      return localCatalogResult(false);
    }

    const pointer = yield* Schema.decodeUnknown(SnapshotPointerSchema)(pointerJson).pipe(
      Effect.mapError((error) => OntologyKvDecodeError.make({
        operation: "decodePointer",
        key: ACTIVE_POINTER_KEY,
        error
      }))
    );

    const snapshotKey = `${SNAPSHOT_PREFIX}${pointer.snapshotVersion}`;

    const rawSnapshot = yield* Effect.tryPromise({
      try: () => kv.get(snapshotKey, "json"),
      catch: (error) => OntologyKvReadError.make({
        operation: "getSnapshot",
        key: snapshotKey,
        error
      })
    });

    if (rawSnapshot === null) {
      return localCatalogResult(false);
    }

    const snapshot = yield* Schema.decodeUnknown(OntologySnapshot)(rawSnapshot).pipe(
      Effect.mapError((error) => OntologyKvDecodeError.make({
        operation: "decodeSnapshot",
        key: snapshotKey,
        error
      }))
    );

    return {
      catalog: getPreparedCatalog(snapshot),
      cacheable: true
    } satisfies CatalogLoadResult;
  }).pipe(
    Effect.catchAll((error) =>
      Effect.logWarning("Ontology KV load failed, falling back to local snapshot").pipe(
        Effect.annotateLogs({
          failureTag: error._tag,
          operation: error.operation,
          key: error.key
        }),
        Effect.as(localCatalogResult(false))
      )
    )
  );

const loadCatalog = Effect.gen(function* () {
  const env = yield* Effect.serviceOption(CloudflareEnv);
  return Option.isSome(env) && env.value.ONTOLOGY_KV != null
    ? yield* loadCatalogFromKv(env.value)
    : localCatalogResult(true);
});

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

export class OntologyCatalog extends ServiceMap.Service<
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
    readonly resolveCanonicalTopicSlugs: (
      topic: string | undefined
    ) => Effect.Effect<ReadonlyArray<TopicSlug> | undefined>;
  }
>()("@skygest/OntologyCatalog") {
  static readonly layer = Layer.effect(
    OntologyCatalog,
    Effect.gen(function* () {
      let cachedCatalog: { readonly catalog: PreparedCatalog; readonly expiresAt: number } | null = null;

      const getCatalog = Effect.fn("OntologyCatalog.getCatalog")(function* () {
        const now = Date.now();
        if (cachedCatalog !== null && cachedCatalog.expiresAt > now) {
          return cachedCatalog.catalog;
        }

        const loaded = yield* loadCatalog;
        if (loaded.cacheable) {
          cachedCatalog = {
            catalog: loaded.catalog,
            expiresAt: now + CATALOG_CACHE_TTL_MS
          };
        } else {
          cachedCatalog = null;
        }

        return loaded.catalog;
      });

      let currentCatalog = yield* getCatalog();

      const match = (input: MatchInput) =>
        Effect.map(getCatalog(), (catalog) => {
          currentCatalog = catalog;
          return matchTopics(catalog, input);
        }).pipe(
          Effect.withSpan("OntologyCatalog.match")
        );

      const listTopics = (view: OntologyTopicView) =>
        Effect.map(getCatalog(), (catalog) => {
          currentCatalog = catalog;
          return view === "concepts" ? catalog.sortedConceptNodes : catalog.sortedFacetNodes;
        }
        ).pipe(Effect.withSpan("OntologyCatalog.listTopics"));

      const getTopic = (slug: string) =>
        Effect.map(getCatalog(), (catalog) => {
          currentCatalog = catalog;
          return catalog.nodeBySlug.get(slug) ?? null;
        }
        ).pipe(Effect.withSpan("OntologyCatalog.getTopic"));

      const expandTopics = (slugs: ReadonlyArray<string>, mode: OntologyExpandMode) =>
        Effect.map(getCatalog(), (catalog) => {
          currentCatalog = catalog;
          return resolveExpansion(catalog, slugs, mode);
        }
        ).pipe(Effect.withSpan("OntologyCatalog.expandTopics"));

      return {
        get snapshot() {
          return currentCatalog.snapshot;
        },
        get topics() {
          return currentCatalog.snapshot.canonicalTopics;
        },
        get concepts() {
          return currentCatalog.snapshot.concepts;
        },
        match,
        listTopics,
        getTopic,
        expandTopics,
        resolveCanonicalTopicSlugs: (topic) => {
          if (topic === undefined) return Effect.void as unknown as Effect.Effect<ReadonlyArray<TopicSlug> | undefined>;
          return expandTopics([topic], "descendants").pipe(
            Effect.map((r) => r.canonicalTopicSlugs)
          );
        }
      };
    })
  );
}
