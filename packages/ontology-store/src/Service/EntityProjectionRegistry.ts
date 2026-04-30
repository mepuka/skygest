import { Effect, Layer, Schema, ServiceMap } from "effect";

import type {
  AnyEntityDefinition,
  StorageAdapter
} from "../Domain/EntityDefinition";
import type {
  EntityMetadata,
  ProjectionContract
} from "../Domain/Projection";
import {
  entitySnapshotStorageAdapter,
  EntitySnapshotStore
} from "./EntitySnapshotStore";

export class EntityProjectionRegistryLookupError extends Schema.TaggedErrorClass<EntityProjectionRegistryLookupError>()(
  "EntityProjectionRegistryLookupError",
  {
    entityType: Schema.String
  }
) {}

export interface EntityProjectionEntry<
  Def extends AnyEntityDefinition = AnyEntityDefinition
> {
  readonly definition: Def;
  readonly storage: StorageAdapter<Def>;
  readonly projection: {
    readonly entityType: string;
    readonly toKey: (entity: any) => string;
    readonly toBody: (entity: any) => string;
    readonly toMetadata: (entity: any) => EntityMetadata;
  };
}

export interface EntityProjectionSnapshotSpec<
  Def extends AnyEntityDefinition = AnyEntityDefinition
> {
  readonly definition: Def;
  readonly projection: ProjectionContract<Def["schema"], EntityMetadata>;
}

export const defineEntityProjection = <
  Def extends AnyEntityDefinition
>(
  entry: EntityProjectionEntry<Def>
): EntityProjectionEntry<Def> => entry;

export const defineEntitySnapshotProjection = <
  Def extends AnyEntityDefinition
>(
  spec: EntityProjectionSnapshotSpec<Def>
): EntityProjectionSnapshotSpec<Def> => spec;

const makeEntityProjectionRegistry = (
  entries: ReadonlyArray<EntityProjectionEntry>
): (typeof EntityProjectionRegistry)["Service"] => {
  const byTag = new Map<string, EntityProjectionEntry>();
  for (const entry of entries) {
    byTag.set(entry.definition.tag, entry);
  }

  return EntityProjectionRegistry.of({
    entries,
    get: (entityType) =>
      Effect.gen(function* () {
        const entry = byTag.get(entityType);
        if (entry === undefined) {
          return yield* new EntityProjectionRegistryLookupError({
            entityType
          });
        }
        return entry;
      })
  });
};

export class EntityProjectionRegistry extends ServiceMap.Service<
  EntityProjectionRegistry,
  {
    readonly entries: ReadonlyArray<EntityProjectionEntry>;
    readonly get: (
      entityType: string
    ) => Effect.Effect<
      EntityProjectionEntry,
      EntityProjectionRegistryLookupError
    >;
  }
>()("@skygest/ontology-store/EntityProjectionRegistry") {
  static layer(
    entries: ReadonlyArray<EntityProjectionEntry>
  ): Layer.Layer<EntityProjectionRegistry> {
    return Layer.succeed(
      EntityProjectionRegistry,
      makeEntityProjectionRegistry(entries)
    );
  }

  static snapshotLayer(
    specs: ReadonlyArray<EntityProjectionSnapshotSpec<any>>
  ): Layer.Layer<EntityProjectionRegistry, never, EntitySnapshotStore> {
    return Layer.effect(
      EntityProjectionRegistry,
      EntitySnapshotStore.use((store) =>
        Effect.succeed(
          makeEntityProjectionRegistry(
            specs.map((spec) =>
              defineEntityProjection({
                definition: spec.definition,
                storage: entitySnapshotStorageAdapter(store, spec.definition),
                projection: spec.projection
              })
            )
          )
        )
      )
    );
  }
}
