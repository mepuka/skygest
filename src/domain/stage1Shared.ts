import { Schema } from "effect";

export const Stage1Rank = Schema.Int.pipe(
  Schema.check(Schema.isGreaterThanOrEqualTo(1))
);
export type Stage1Rank = Schema.Schema.Type<typeof Stage1Rank>;

export const MatchTextSource = Schema.Literals([
  "post-text",
  "chart-title",
  "organization-mention",
  "logo-text",
  "source-line",
  "axis-label"
]);
export type MatchTextSource = Schema.Schema.Type<typeof MatchTextSource>;

export const UrlSource = Schema.Literals([
  "post-link",
  "link-card",
  "visible-url",
  "source-line",
  "provider-homepage"
]);
export type UrlSource = Schema.Schema.Type<typeof UrlSource>;

export const Stage1MatchGrain = Schema.Literals([
  "Distribution",
  "Dataset",
  "Agent",
  "Variable"
]);
export type Stage1MatchGrain = Schema.Schema.Type<typeof Stage1MatchGrain>;
