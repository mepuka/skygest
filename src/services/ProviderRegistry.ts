import { Context, Effect, Layer } from "effect";
import {
  energyProviderRegistry,
  energyProviderRegistryManifest
} from "../bootstrap/CheckedInProviderRegistry";
import { normalizeDomain } from "../domain/normalize";
import type {
  ProviderRegistryEntry,
  ProviderRegistryManifest
} from "../domain/source";
import {
  normalizeProviderLookupKey,
  normalizeSourceFamilyKey
} from "../source/registry";

const normalizeProviderIdKey = (value: string) => value.trim().toLowerCase();

export class ProviderRegistry extends Context.Tag("@skygest/ProviderRegistry")<
  ProviderRegistry,
  {
    readonly manifest: ProviderRegistryManifest;
    readonly providers: ReadonlyArray<ProviderRegistryEntry>;
    readonly getProvider: (
      providerId: string
    ) => Effect.Effect<ProviderRegistryEntry | null>;
    readonly findByAlias: (
      alias: string
    ) => Effect.Effect<ProviderRegistryEntry | null>;
    readonly findByDomain: (
      domain: string
    ) => Effect.Effect<ProviderRegistryEntry | null>;
    readonly findBySourceFamily: (
      sourceFamily: string
    ) => Effect.Effect<ReadonlyArray<ProviderRegistryEntry>>;
  }
>() {
  static readonly layer = Layer.effect(
    ProviderRegistry,
    Effect.gen(function* () {
      const prepared = energyProviderRegistry;

      const getProvider = Effect.fn("ProviderRegistry.getProvider")(function* (
        providerId: string
      ) {
        return prepared.providerById.get(normalizeProviderIdKey(providerId)) ?? null;
      });

      const findByAlias = Effect.fn("ProviderRegistry.findByAlias")(function* (
        alias: string
      ) {
        return prepared.providerByAlias.get(normalizeProviderLookupKey(alias)) ?? null;
      });

      const findByDomain = Effect.fn("ProviderRegistry.findByDomain")(function* (
        domain: string
      ) {
        return prepared.providerByDomain.get(normalizeDomain(domain)) ?? null;
      });

      const findBySourceFamily = Effect.fn(
        "ProviderRegistry.findBySourceFamily"
      )(function* (sourceFamily: string) {
        return prepared.providersBySourceFamily.get(
          normalizeSourceFamilyKey(sourceFamily)
        ) ?? [];
      });

      return ProviderRegistry.of({
        manifest: energyProviderRegistryManifest,
        providers: prepared.providers,
        getProvider,
        findByAlias,
        findByDomain,
        findBySourceFamily
      });
    })
  );
}
