import { Layer, ServiceMap } from "effect";
import {
  toDataLayerRegistryLookup,
  type PreparedDataLayerRegistry
} from "../resolution/dataLayerRegistry";

export class DataLayerRegistry extends ServiceMap.Service<
  DataLayerRegistry,
  {
    readonly prepared: PreparedDataLayerRegistry;
    readonly lookup: ReturnType<typeof toDataLayerRegistryLookup>;
  }
>()("@skygest/DataLayerRegistry") {
  static readonly layerFromPrepared = (prepared: PreparedDataLayerRegistry) =>
    Layer.succeed(
      DataLayerRegistry,
      DataLayerRegistry.of({
        prepared,
        lookup: toDataLayerRegistryLookup(prepared)
      })
    );
}
