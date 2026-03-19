import { Schema } from "effect";
import { Did } from "./types";

export const ProviderId = Schema.String.pipe(
  Schema.pattern(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u),
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
  providerLabel: Schema.String.pipe(Schema.minLength(1)),
  aliases: Schema.Array(Schema.String.pipe(Schema.minLength(1))),
  domains: Schema.Array(Schema.String.pipe(Schema.minLength(1))),
  sourceFamilies: Schema.Array(Schema.String.pipe(Schema.minLength(1)))
});
export type ProviderRegistryEntry = Schema.Schema.Type<
  typeof ProviderRegistryEntry
>;

export const ProviderRegistryManifest = Schema.Struct({
  domain: Schema.String.pipe(Schema.minLength(1)),
  version: Schema.String.pipe(Schema.minLength(1)),
  providers: Schema.Array(ProviderRegistryEntry)
});
export type ProviderRegistryManifest = Schema.Schema.Type<
  typeof ProviderRegistryManifest
>;

// ---------------------------------------------------------------------------
// Match evidence contract (SKY-45)
// ---------------------------------------------------------------------------

export const MatchSignalType = Schema.Literal(
  "source-line-alias",
  "source-line-domain",
  "chart-title-alias",
  "link-domain",
  "embed-link-domain",
  "visible-url-domain",
  "post-text-mention"
);
export type MatchSignalType = Schema.Schema.Type<typeof MatchSignalType>;

export const MatchEvidence = Schema.Struct({
  signal: MatchSignalType,
  raw: Schema.Record({ key: Schema.String, value: Schema.String })
});
export type MatchEvidence = Schema.Schema.Type<typeof MatchEvidence>;

export const ProviderMatch = Schema.Struct({
  providerId: ProviderId,
  providerLabel: Schema.String,
  sourceFamily: Schema.NullOr(Schema.String),
  signals: Schema.Array(MatchEvidence)
});
export type ProviderMatch = Schema.Schema.Type<typeof ProviderMatch>;

export const MatchResolution = Schema.Literal("matched", "ambiguous", "none");
export type MatchResolution = Schema.Schema.Type<typeof MatchResolution>;

export const MatchResult = Schema.Struct({
  providerMatches: Schema.Array(ProviderMatch),
  selectedProvider: Schema.NullOr(ProviderReference),
  resolution: MatchResolution,
  contentSource: Schema.NullOr(ContentSourceReference),
  socialProvenance: Schema.NullOr(SocialProvenance)
});
export type MatchResult = Schema.Schema.Type<typeof MatchResult>;
