import { Effect, Layer, Schema, ServiceMap } from "effect";

import type {
  AnyEntityDefinition,
  StorageAdapter
} from "../Domain/EntityDefinition";

export class EntityRegistryLookupError extends Schema.TaggedErrorClass<EntityRegistryLookupError>()(
  "EntityRegistryLookupError",
  {
    entityType: Schema.String
  }
) {}

export interface RegisteredEntity<Def extends AnyEntityDefinition> {
  readonly definition: Def;
  readonly storage?: StorageAdapter<Def>;
}

export class EntityRegistry extends ServiceMap.Service<
  EntityRegistry,
  {
    readonly definitions: ReadonlyArray<AnyEntityDefinition>;
    readonly getDefinition: (
      entityType: string
    ) => Effect.Effect<AnyEntityDefinition, EntityRegistryLookupError>;
    readonly getStorageAdapter: (
      entityType: string
    ) => Effect.Effect<StorageAdapter<AnyEntityDefinition>, EntityRegistryLookupError>;
  }
>()("@skygest/ontology-store/EntityRegistry") {
  static layer(
    entries: ReadonlyArray<RegisteredEntity<AnyEntityDefinition>>
  ): Layer.Layer<EntityRegistry> {
    return Layer.succeed(EntityRegistry, makeEntityRegistry(entries));
  }
}

export const makeEntityRegistry = (
  entries: ReadonlyArray<RegisteredEntity<AnyEntityDefinition>>
): (typeof EntityRegistry)["Service"] => {
  const byTag = new Map<string, RegisteredEntity<AnyEntityDefinition>>();
  for (const entry of entries) {
    byTag.set(entry.definition.tag, entry);
  }

  return EntityRegistry.of({
    definitions: entries.map((entry) => entry.definition),
    getDefinition: (entityType) =>
      Effect.gen(function* () {
        const definition = byTag.get(entityType)?.definition;
        if (definition === undefined) {
          return yield* new EntityRegistryLookupError({ entityType });
        }
        return definition;
      }),
    getStorageAdapter: (entityType) =>
      Effect.gen(function* () {
        const storage = byTag.get(entityType)?.storage;
        if (storage === undefined) {
          return yield* new EntityRegistryLookupError({ entityType });
        }
        return storage;
      })
  });
};
