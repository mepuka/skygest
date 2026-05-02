import { Clock, Effect, Layer, Schema, ServiceMap } from "effect";
import type { SqlError } from "effect/unstable/sql/SqlError";

import type { AnyEntityDefinition } from "../Domain/EntityDefinition";
import {
  asEntityIri,
  asEntityTag,
  type EntityIri,
  type EntityTag,
  type ReindexCause
} from "../Domain/EntityGraph";
import {
  ReindexDepthExceededError,
  ReindexQueueService
} from "./ReindexQueue";
import { EntitySnapshotStore } from "./EntitySnapshotStore";

type EntityOf<Def extends AnyEntityDefinition> =
  Schema.Schema.Type<Def["schema"]>;

export interface EntityIngestionWriteOptions {
  readonly originIri?: EntityIri;
  readonly cause?: ReindexCause;
  readonly causePriority?: number;
  readonly propagationDepth?: number;
  readonly nextAttemptAt?: number;
}

export interface EntityIngestionWriteResult {
  readonly iri: EntityIri;
  readonly entityType: EntityTag;
  readonly queued: 1;
}

export class EntityIngestionWriter extends ServiceMap.Service<
  EntityIngestionWriter,
  {
    readonly write: <Def extends AnyEntityDefinition>(
      definition: Def,
      entity: EntityOf<Def>,
      options?: EntityIngestionWriteOptions
    ) => Effect.Effect<
      EntityIngestionWriteResult,
      SqlError | Schema.SchemaError | ReindexDepthExceededError
    >;
  }
>()("@skygest/ontology-store/EntityIngestionWriter") {
  static readonly layer = Layer.effect(
    EntityIngestionWriter,
    Effect.gen(function* () {
      const snapshots = yield* EntitySnapshotStore;
      const queue = yield* ReindexQueueService;

      const write = <Def extends AnyEntityDefinition>(
        definition: Def,
        entity: EntityOf<Def>,
        options?: EntityIngestionWriteOptions
      ): Effect.Effect<
        EntityIngestionWriteResult,
        SqlError | Schema.SchemaError | ReindexDepthExceededError
      > =>
        Effect.gen(function* () {
          const decoded = yield* Schema.decodeUnknownEffect(
            definition.schema
          )(entity);
          const iri = asEntityIri(definition.identity.iriOf(decoded as never));
          const entityType = asEntityTag(definition.tag);
          const now = yield* Clock.currentTimeMillis;

          yield* snapshots.save(definition, decoded as EntityOf<Def>);
          yield* queue.schedule({
            targetEntityType: entityType,
            targetIri: iri,
            originIri: options?.originIri ?? iri,
            cause: options?.cause ?? "entity-changed",
            causePriority: options?.causePriority ?? 0,
            propagationDepth: options?.propagationDepth ?? 0,
            nextAttemptAt: options?.nextAttemptAt ?? now
          });

          return { iri, entityType, queued: 1 as const };
        }) as Effect.Effect<
          EntityIngestionWriteResult,
          SqlError | Schema.SchemaError | ReindexDepthExceededError
        >;

      return EntityIngestionWriter.of({ write });
    })
  );
}
