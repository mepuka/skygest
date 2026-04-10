import { Layer } from "effect";
import { KeyValueStore, Persistence } from "effect/unstable/persistence";

export const localPersistenceLayer = (directory: string) =>
  Persistence.layerKvs.pipe(
    Layer.provide(KeyValueStore.layerFileSystem(directory))
  );
