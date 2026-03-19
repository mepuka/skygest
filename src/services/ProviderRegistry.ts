import { Context, Effect, Layer } from "effect";
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

export class ProviderRegistry extends Context.Tag("@skygest/ProviderRegistry")<
  ProviderRegistry,
  {
    readonly manifest: ProviderRegistryManifest;
    readonly lookup: ProviderLookup;
  }
>() {
  static readonly layer = Layer.effect(
    ProviderRegistry,
    Effect.gen(function* () {
      return ProviderRegistry.of({
        manifest: energyProviderRegistryManifest,
        lookup: toProviderLookup(energyProviderRegistry)
      });
    })
  );
}
