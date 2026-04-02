import { Schema } from "effect";
import { Did } from "./types";

export const ProviderId = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u)),
  Schema.brand("ProviderId")
);
export type ProviderId = Schema.Schema.Type<typeof ProviderId>;

export const ProviderReference = Schema.Struct({
  providerId: ProviderId,
  providerLabel: Schema.String,
  sourceFamily: Schema.NullOr(Schema.String)
});
export type ProviderReference = Schema.Schema.Type<typeof ProviderReference>;

export const ContentSourceReference = Schema.Struct({
  url: Schema.String,
  title: Schema.NullOr(Schema.String),
  domain: Schema.NullOr(Schema.String),
  publication: Schema.NullOr(Schema.String)
});
export type ContentSourceReference = Schema.Schema.Type<
  typeof ContentSourceReference
>;

export const SocialProvenance = Schema.Struct({
  did: Did,
  handle: Schema.NullOr(Schema.String)
});
export type SocialProvenance = Schema.Schema.Type<typeof SocialProvenance>;

export const ProviderRegistryEntry = Schema.Struct({
  providerId: ProviderId,
  providerLabel: Schema.String.pipe(Schema.check(Schema.isMinLength(1))),
  aliases: Schema.Array(Schema.String.pipe(Schema.check(Schema.isMinLength(1)))),
  domains: Schema.Array(Schema.String.pipe(Schema.check(Schema.isMinLength(1)))),
  sourceFamilies: Schema.Array(Schema.String.pipe(Schema.check(Schema.isMinLength(1))))
});
export type ProviderRegistryEntry = Schema.Schema.Type<
  typeof ProviderRegistryEntry
>;

export const ProviderRegistryManifest = Schema.Struct({
  domain: Schema.String.pipe(Schema.check(Schema.isMinLength(1))),
  version: Schema.String.pipe(Schema.check(Schema.isMinLength(1))),
  providers: Schema.Array(ProviderRegistryEntry)
});
export type ProviderRegistryManifest = Schema.Schema.Type<
  typeof ProviderRegistryManifest
>;

export const BrandShortenerEntry = Schema.Struct({
  shortDomain: Schema.String.pipe(Schema.check(Schema.isMinLength(1))),
  resolvedDomain: Schema.String.pipe(Schema.check(Schema.isMinLength(1)))
});
export type BrandShortenerEntry = Schema.Schema.Type<typeof BrandShortenerEntry>;

export const BrandShortenerManifest = Schema.Struct({
  version: Schema.String.pipe(Schema.check(Schema.isMinLength(1))),
  entries: Schema.Array(BrandShortenerEntry)
});
export type BrandShortenerManifest = Schema.Schema.Type<
  typeof BrandShortenerManifest
>;
