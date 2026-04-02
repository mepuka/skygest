import { ServiceMap, Effect, Layer } from "effect";
import {
  energyProviderRegistry,
  energyProviderRegistryManifest
} from "../bootstrap/CheckedInProviderRegistry";
import type {
  ProviderRegistryManifest
} from "../domain/source";
import {
  toProviderLookup,
  type ProviderLookup
} from "../source/registry";

export class ProviderRegistry extends ServiceMap.Service<
  ProviderRegistry,
  {
    readonly manifest: ProviderRegistryManifest;
    readonly lookup: ProviderLookup;
  }
>()("@skygest/ProviderRegistry") {
  static readonly layer = Layer.effect(
    ProviderRegistry,
    Effect.gen(function* () {
      return {
        manifest: energyProviderRegistryManifest,
        lookup: toProviderLookup(energyProviderRegistry)
      };
    })
  );
}
