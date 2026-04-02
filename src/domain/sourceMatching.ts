import { Schema } from "effect";
import { LinkRecord } from "./bi";
import { Did } from "./types";
import {
  ContentSourceReference,
  ProviderId,
  ProviderReference,
  SocialProvenance
} from "./source";

export const SourceAttributionResolution = Schema.Literals([
  "matched",
  "ambiguous",
  "unmatched"
]);
export type SourceAttributionResolution = Schema.Schema.Type<
  typeof SourceAttributionResolution
>;

export const VisionOrganizationMentionLocation = Schema.Literals([
  "title",
  "subtitle",
  "footer",
  "watermark",
  "body"
]);
export type VisionOrganizationMentionLocation = Schema.Schema.Type<
  typeof VisionOrganizationMentionLocation
>;

export const SourceLineAliasEvidence = Schema.Struct({
  signal: Schema.Literal("source-line-alias"),
  rank: Schema.Literal(1),
  assetKey: Schema.String,
  sourceText: Schema.String,
  matchedAlias: Schema.String
});
export type SourceLineAliasEvidence = Schema.Schema.Type<
  typeof SourceLineAliasEvidence
>;

export const SourceLineDomainEvidence = Schema.Struct({
  signal: Schema.Literal("source-line-domain"),
  rank: Schema.Literal(2),
  assetKey: Schema.String,
  sourceText: Schema.String,
  domain: Schema.String
});
export type SourceLineDomainEvidence = Schema.Schema.Type<
  typeof SourceLineDomainEvidence
>;

export const ChartTitleAliasEvidence = Schema.Struct({
  signal: Schema.Literal("chart-title-alias"),
  rank: Schema.Literal(3),
  assetKey: Schema.String,
  title: Schema.String,
  matchedAlias: Schema.String
});
export type ChartTitleAliasEvidence = Schema.Schema.Type<
  typeof ChartTitleAliasEvidence
>;

export const LinkDomainEvidence = Schema.Struct({
  signal: Schema.Literal("link-domain"),
  rank: Schema.Literal(4),
  url: Schema.String,
  domain: Schema.String
});
export type LinkDomainEvidence = Schema.Schema.Type<typeof LinkDomainEvidence>;

export const EmbedLinkDomainEvidence = Schema.Struct({
  signal: Schema.Literal("embed-link-domain"),
  rank: Schema.Literal(5),
  url: Schema.String,
  domain: Schema.String
});
export type EmbedLinkDomainEvidence = Schema.Schema.Type<
  typeof EmbedLinkDomainEvidence
>;

export const VisibleUrlDomainEvidence = Schema.Struct({
  signal: Schema.Literal("visible-url-domain"),
  rank: Schema.Literal(6),
  assetKey: Schema.String,
  url: Schema.String,
  domain: Schema.String
});
export type VisibleUrlDomainEvidence = Schema.Schema.Type<
  typeof VisibleUrlDomainEvidence
>;

export const PostTextMentionEvidence = Schema.Struct({
  signal: Schema.Literal("post-text-mention"),
  rank: Schema.Literal(7),
  matchedAlias: Schema.String
});
export type PostTextMentionEvidence = Schema.Schema.Type<
  typeof PostTextMentionEvidence
>;

export const OrganizationMentionAliasEvidence = Schema.Struct({
  signal: Schema.Literal("organization-mention-alias"),
  rank: Schema.Literal(8),
  assetKey: Schema.String,
  name: Schema.String,
  location: VisionOrganizationMentionLocation,
  matchedAlias: Schema.String
});
export type OrganizationMentionAliasEvidence = Schema.Schema.Type<
  typeof OrganizationMentionAliasEvidence
>;

export const LogoTextAliasEvidence = Schema.Struct({
  signal: Schema.Literal("logo-text-alias"),
  rank: Schema.Literal(9),
  assetKey: Schema.String,
  text: Schema.String,
  matchedAlias: Schema.String
});
export type LogoTextAliasEvidence = Schema.Schema.Type<
  typeof LogoTextAliasEvidence
>;

export const SourceAttributionEvidence = Schema.Union([
  SourceLineAliasEvidence,
  SourceLineDomainEvidence,
  ChartTitleAliasEvidence,
  LinkDomainEvidence,
  EmbedLinkDomainEvidence,
  VisibleUrlDomainEvidence,
  PostTextMentionEvidence,
  OrganizationMentionAliasEvidence,
  LogoTextAliasEvidence
]);
export type SourceAttributionEvidence = Schema.Schema.Type<
  typeof SourceAttributionEvidence
>;

export const SourceAttributionProviderCandidate = Schema.Struct({
  providerId: ProviderId,
  providerLabel: Schema.String,
  sourceFamily: Schema.NullOr(Schema.String),
  bestRank: Schema.Int.pipe(Schema.check(Schema.isBetween({ minimum: 1, maximum: 9 }))),
  evidence: Schema.Array(SourceAttributionEvidence)
});
export type SourceAttributionProviderCandidate = Schema.Schema.Type<
  typeof SourceAttributionProviderCandidate
>;

export const VisionOrganizationMention = Schema.Struct({
  name: Schema.String,
  location: VisionOrganizationMentionLocation
});
export type VisionOrganizationMention = Schema.Schema.Type<
  typeof VisionOrganizationMention
>;

export const VisionSourceLineAttribution = Schema.Struct({
  sourceText: Schema.String,
  datasetName: Schema.NullOr(Schema.String)
});
export type VisionSourceLineAttribution = Schema.Schema.Type<
  typeof VisionSourceLineAttribution
>;

export const VisionSignalAssetAnalysis = Schema.Struct({
  title: Schema.NullOr(Schema.String),
  sourceLines: Schema.Array(VisionSourceLineAttribution),
  visibleUrls: Schema.Array(Schema.String),
  organizationMentions: Schema.Array(VisionOrganizationMention),
  logoText: Schema.Array(Schema.String)
});
export type VisionSignalAssetAnalysis = Schema.Schema.Type<
  typeof VisionSignalAssetAnalysis
>;

export const VisionSignalAsset = Schema.Struct({
  assetKey: Schema.String,
  analysis: VisionSignalAssetAnalysis
});
export type VisionSignalAsset = Schema.Schema.Type<typeof VisionSignalAsset>;

export const SourceAttributionVisionInput = Schema.Struct({
  assets: Schema.Array(VisionSignalAsset)
});
export type SourceAttributionVisionInput = Schema.Schema.Type<
  typeof SourceAttributionVisionInput
>;

export const SourceAttributionMatcherInput = Schema.Struct({
  post: Schema.Struct({
    did: Did,
    handle: Schema.NullOr(Schema.String),
    text: Schema.String
  }),
  links: Schema.Array(
    Schema.Struct({
      url: LinkRecord.fields.url,
      domain: LinkRecord.fields.domain,
      title: LinkRecord.fields.title,
      description: LinkRecord.fields.description,
      imageUrl: LinkRecord.fields.imageUrl,
      extractedAt: LinkRecord.fields.extractedAt
    })
  ),
  linkCards: Schema.Array(
    Schema.Struct({
      source: Schema.Literals(["embed", "media"]),
      uri: Schema.String,
      title: Schema.NullOr(Schema.String),
      description: Schema.NullOr(Schema.String),
      thumb: Schema.NullOr(Schema.String)
    })
  ),
  vision: Schema.NullOr(SourceAttributionVisionInput)
});
export type SourceAttributionMatcherInput = Schema.Schema.Type<
  typeof SourceAttributionMatcherInput
>;

export const SourceAttributionMatchResult = Schema.Struct({
  provider: Schema.NullOr(ProviderReference),
  resolution: SourceAttributionResolution,
  providerCandidates: Schema.Array(SourceAttributionProviderCandidate),
  contentSource: Schema.NullOr(ContentSourceReference),
  socialProvenance: Schema.NullOr(SocialProvenance)
});
export type SourceAttributionMatchResult = Schema.Schema.Type<
  typeof SourceAttributionMatchResult
>;
