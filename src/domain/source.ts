import { Schema } from "effect";
import { Did } from "./types";

export const ProviderReference = Schema.Struct({
  providerId: Schema.String,
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
