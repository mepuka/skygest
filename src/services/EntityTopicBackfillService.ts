import { Clock, Effect, Exit, Layer, Schema, ServiceMap } from "effect";
import type { SqlError } from "effect/unstable/sql/SqlError";
import {
  EnergyTopic,
  EnergyTopicEntity,
  EntitySnapshotStore,
  ReindexQueueService,
  asEntityIri,
  asEntityTag
} from "@skygest/ontology-store";
import { OntologyCatalog } from "./OntologyCatalog";

export interface EntityTopicBackfillInput {
  readonly limit?: number;
  readonly offset?: number;
}

export interface EntityTopicBackfillResult {
  readonly total: number;
  readonly scanned: number;
  readonly migrated: number;
  readonly queued: number;
  readonly failed: number;
  readonly failedIris: ReadonlyArray<string>;
}

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;
const TOPIC_ENTITY_TAG = asEntityTag("EnergyTopic");

const normalizeLimit = (limit: number | undefined): number =>
  limit === undefined || !Number.isFinite(limit)
    ? DEFAULT_LIMIT
    : Math.min(MAX_LIMIT, Math.max(1, Math.floor(limit)));

const normalizeOffset = (offset: number | undefined): number =>
  offset === undefined || !Number.isFinite(offset)
    ? 0
    : Math.max(0, Math.floor(offset));

const decodeEnergyTopic = Schema.decodeUnknownEffect(EnergyTopic);

const sortConcepts = (
  concepts: (typeof OntologyCatalog)["Service"]["concepts"]
) =>
  Array.from(concepts).sort((left, right) =>
    left.slug.localeCompare(right.slug)
  );

export class EntityTopicBackfillService extends ServiceMap.Service<
  EntityTopicBackfillService,
  {
    readonly backfill: (
      input?: EntityTopicBackfillInput
    ) => Effect.Effect<EntityTopicBackfillResult, SqlError | Schema.SchemaError>;
  }
>()("@skygest/EntityTopicBackfillService") {
  static readonly layer = Layer.effect(
    EntityTopicBackfillService,
    Effect.gen(function* () {
      const ontology = yield* OntologyCatalog;
      const snapshots = yield* EntitySnapshotStore;
      const queue = yield* ReindexQueueService;

      const saveAndQueue = Effect.fn(
        "EntityTopicBackfillService.saveAndQueue"
      )(function* (concept: (typeof ontology.concepts)[number]) {
        const topic = yield* decodeEnergyTopic({
          iri: concept.iri,
          slug: concept.slug,
          label: concept.label,
          altLabels: concept.altLabels,
          ...(concept.description === null
            ? {}
            : { description: concept.description }),
          ...(concept.canonicalTopicSlug === null
            ? {}
            : { canonicalTopicSlug: concept.canonicalTopicSlug }),
          topConcept: concept.topConcept,
          broaderSlugs: concept.broaderSlugs,
          narrowerSlugs: concept.narrowerSlugs
        });
        const iri = asEntityIri(topic.iri);
        const now = yield* Clock.currentTimeMillis;

        yield* snapshots.save(EnergyTopicEntity, topic);
        yield* queue.schedule({
          targetEntityType: TOPIC_ENTITY_TAG,
          targetIri: iri,
          originIri: iri,
          cause: "entity-changed",
          causePriority: 0,
          propagationDepth: 0,
          nextAttemptAt: now
        });
      });

      const backfill = Effect.fn("EntityTopicBackfillService.backfill")(
        function* (input?: EntityTopicBackfillInput) {
          const limit = normalizeLimit(input?.limit);
          const offset = normalizeOffset(input?.offset);
          const concepts = sortConcepts(ontology.concepts);
          const page = concepts.slice(offset, offset + limit);

          const outcomes = yield* Effect.forEach(
            page,
            (concept) => Effect.exit(saveAndQueue(concept)),
            { concurrency: 8 }
          );
          const migrated = outcomes.filter((outcome) => Exit.isSuccess(outcome))
            .length;
          const failedIris = outcomes.flatMap((outcome, index) =>
            Exit.isSuccess(outcome) ? [] : [page[index]?.iri ?? "unknown"]
          );

          return {
            total: concepts.length,
            scanned: page.length,
            migrated,
            queued: migrated,
            failed: page.length - migrated,
            failedIris
          };
        }
      );

      return EntityTopicBackfillService.of({ backfill });
    })
  );
}
