import { Chunk, Option } from "effect";
import type {
  ProviderRegistryEntry,
  ProviderRegistryManifest
} from "../domain/source";
import { normalizeDomain } from "../domain/normalize";

const normalizeProviderIdKey = (value: string) => value.trim().toLowerCase();

export const normalizeProviderLookupKey = (value: string) =>
  value.trim().toLowerCase().replace(/\s+/gu, " ");

export const normalizeSourceFamilyKey = (value: string) =>
  normalizeProviderLookupKey(value);

export type PreparedProviderRegistry = {
  readonly manifest: ProviderRegistryManifest;
  readonly providers: ReadonlyArray<ProviderRegistryEntry>;
  readonly providerById: ReadonlyMap<string, ProviderRegistryEntry>;
  readonly providerByAlias: ReadonlyMap<string, ProviderRegistryEntry>;
  readonly providerByDomain: ReadonlyMap<string, ProviderRegistryEntry>;
  readonly providersBySourceFamily: ReadonlyMap<
    string,
    ReadonlyArray<ProviderRegistryEntry>
  >;
  readonly aliasEntries: ReadonlyArray<{
    readonly aliasKey: string;
    readonly aliasText: string;
    readonly provider: ProviderRegistryEntry;
  }>;
};

export type ProviderLookup = {
  readonly manifest: ProviderRegistryManifest;
  readonly providers: Chunk.Chunk<ProviderRegistryEntry>;
  readonly aliasEntries: Chunk.Chunk<{
    readonly aliasKey: string;
    readonly aliasText: string;
    readonly provider: ProviderRegistryEntry;
  }>;
  readonly findById: (providerId: string) => Option.Option<ProviderRegistryEntry>;
  readonly findByAlias: (alias: string) => Option.Option<ProviderRegistryEntry>;
  readonly findByDomain: (domain: string) => Option.Option<ProviderRegistryEntry>;
  readonly findBySourceFamily: (
    sourceFamily: string
  ) => Chunk.Chunk<ProviderRegistryEntry>;
};

export const assertValidProviderRegistryManifest = (
  manifest: ProviderRegistryManifest
): ProviderRegistryManifest => {
  const issues: string[] = [];
  const seenProviderIds = new Map<string, string>();
  const seenAliases = new Map<string, string>();
  const seenDomains = new Map<string, string>();

  for (const provider of manifest.providers) {
    const providerKey = normalizeProviderIdKey(provider.providerId);
    const aliasKeys = new Set<string>();
    const domainKeys = new Set<string>();
    const sourceFamilyKeys = new Set<string>();

    if (seenProviderIds.has(providerKey)) {
      issues.push(`duplicate provider id "${providerKey}"`);
    } else {
      seenProviderIds.set(providerKey, provider.providerId);
    }

    for (const alias of [provider.providerLabel, ...provider.aliases]) {
      const aliasKey = normalizeProviderLookupKey(alias);

      if (aliasKey.length === 0) {
        issues.push(`provider "${provider.providerId}" has an empty alias`);
        continue;
      }

      if (aliasKeys.has(aliasKey)) {
        issues.push(
          `provider "${provider.providerId}" repeats alias "${aliasKey}"`
        );
      } else {
        aliasKeys.add(aliasKey);
      }

      const existingProviderId = seenAliases.get(aliasKey);
      if (
        existingProviderId !== undefined &&
        existingProviderId !== provider.providerId
      ) {
        issues.push(
          `duplicate alias "${aliasKey}" used by "${existingProviderId}" and "${provider.providerId}"`
        );
      } else {
        seenAliases.set(aliasKey, provider.providerId);
      }
    }

    for (const domain of provider.domains) {
      const domainKey = normalizeDomain(domain);

      if (domainKey.length === 0) {
        issues.push(`provider "${provider.providerId}" has an empty domain`);
        continue;
      }

      if (domainKeys.has(domainKey)) {
        issues.push(
          `provider "${provider.providerId}" repeats domain "${domainKey}"`
        );
      } else {
        domainKeys.add(domainKey);
      }

      const existingProviderId = seenDomains.get(domainKey);
      if (
        existingProviderId !== undefined &&
        existingProviderId !== provider.providerId
      ) {
        issues.push(
          `duplicate domain "${domainKey}" used by "${existingProviderId}" and "${provider.providerId}"`
        );
      } else {
        seenDomains.set(domainKey, provider.providerId);
      }
    }

    for (const sourceFamily of provider.sourceFamilies) {
      const sourceFamilyKey = normalizeSourceFamilyKey(sourceFamily);

      if (sourceFamilyKey.length === 0) {
        issues.push(
          `provider "${provider.providerId}" has an empty source family`
        );
        continue;
      }

      if (sourceFamilyKeys.has(sourceFamilyKey)) {
        issues.push(
          `provider "${provider.providerId}" repeats source family "${sourceFamilyKey}"`
        );
      } else {
        sourceFamilyKeys.add(sourceFamilyKey);
      }
    }
  }

  if (issues.length > 0) {
    throw new Error(`invalid provider registry manifest: ${issues.join(", ")}`);
  }

  return manifest;
};

export const prepareProviderRegistry = (
  manifest: ProviderRegistryManifest
): PreparedProviderRegistry => {
  const validManifest = assertValidProviderRegistryManifest(manifest);
  const providerById = new Map<string, ProviderRegistryEntry>();
  const providerByAlias = new Map<string, ProviderRegistryEntry>();
  const providerByDomain = new Map<string, ProviderRegistryEntry>();
  const providersBySourceFamily = new Map<
    string,
    ReadonlyArray<ProviderRegistryEntry>
  >();
  const aliasEntries: Array<{
    readonly aliasKey: string;
    readonly aliasText: string;
    readonly provider: ProviderRegistryEntry;
  }> = [];

  for (const provider of validManifest.providers) {
    providerById.set(normalizeProviderIdKey(provider.providerId), provider);

    for (const alias of [provider.providerLabel, ...provider.aliases]) {
      const aliasKey = normalizeProviderLookupKey(alias);
      providerByAlias.set(aliasKey, provider);
      aliasEntries.push({
        aliasKey,
        aliasText: alias,
        provider
      });
    }

    for (const domain of provider.domains) {
      providerByDomain.set(normalizeDomain(domain), provider);
    }

    for (const sourceFamily of provider.sourceFamilies) {
      const sourceFamilyKey = normalizeSourceFamilyKey(sourceFamily);
      const existing = providersBySourceFamily.get(sourceFamilyKey) ?? [];
      providersBySourceFamily.set(sourceFamilyKey, [...existing, provider]);
    }
  }

  return {
    manifest: validManifest,
    providers: validManifest.providers,
    providerById,
    providerByAlias,
    providerByDomain,
    providersBySourceFamily,
    aliasEntries: aliasEntries.sort((left, right) => {
      const byLength = right.aliasKey.length - left.aliasKey.length;
      if (byLength !== 0) {
        return byLength;
      }

      return left.provider.providerId.localeCompare(right.provider.providerId);
    })
  };
};

export const toProviderLookup = (
  prepared: PreparedProviderRegistry
): ProviderLookup => ({
  manifest: prepared.manifest,
  providers: Chunk.fromIterable(prepared.providers),
  aliasEntries: Chunk.fromIterable(prepared.aliasEntries),
  findById: (providerId: string) =>
    Option.fromNullable(
      prepared.providerById.get(normalizeProviderIdKey(providerId))
    ),
  findByAlias: (alias: string) =>
    Option.fromNullable(
      prepared.providerByAlias.get(normalizeProviderLookupKey(alias))
    ),
  findByDomain: (domain: string) =>
    Option.fromNullable(prepared.providerByDomain.get(normalizeDomain(domain))),
  findBySourceFamily: (sourceFamily: string) =>
    Chunk.fromIterable(
      prepared.providersBySourceFamily.get(
        normalizeSourceFamilyKey(sourceFamily)
      ) ?? []
    )
});
