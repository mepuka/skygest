import type { Stage1Input } from "../../domain/stage1Resolution";
import type { VisionAssetEnrichment } from "../../domain/enrichment";
import type { SourceAttributionMatchResult } from "../../domain/sourceMatching";
import type {
  ResolutionEvidenceBundle,
  ResolutionPublisherHint,
  ResolutionSourceLine
} from "../../domain/resolutionKernel";
import { stripUndefined } from "../../platform/Json";

const toOptionalString = (
  value: string | null | undefined
): string | undefined => {
  if (value === null || value === undefined) {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const unique = (values: ReadonlyArray<string>): ReadonlyArray<string> =>
  [...new Set(values)];

const buildSourceLines = (
  asset: VisionAssetEnrichment
): ReadonlyArray<ResolutionSourceLine> =>
  asset.analysis.sourceLines.map((sourceLine) =>
    stripUndefined({
      sourceText: sourceLine.sourceText,
      datasetName: toOptionalString(sourceLine.datasetName)
    })
  );

const buildPublisherHints = (
  sourceAttribution: SourceAttributionMatchResult | null,
  asset: VisionAssetEnrichment | null
): ReadonlyArray<ResolutionPublisherHint> => {
  const labels = unique(
    [
      sourceAttribution?.provider?.providerLabel ?? undefined,
      ...(
        sourceAttribution?.providerCandidates.map(
          (candidate) => candidate.providerLabel
        ) ?? []
      ),
      sourceAttribution?.contentSource?.publication ?? undefined,
      sourceAttribution?.contentSource?.title ?? undefined,
      sourceAttribution?.contentSource?.domain ?? undefined,
      ...(asset?.analysis.organizationMentions.map((mention) => mention.name) ??
        []),
      ...(asset?.analysis.logoText ?? [])
    ].flatMap((value) => {
      const normalized = toOptionalString(value);
      return normalized === undefined ? [] : [normalized];
    })
  );

  return labels.map((label) => ({ label }));
};

const buildAssetBundle = (
  input: Stage1Input,
  asset: VisionAssetEnrichment
): ResolutionEvidenceBundle =>
  stripUndefined({
    postUri: input.postContext.postUri,
    assetKey: asset.assetKey,
    postText: [input.postContext.text],
    chartTitle: toOptionalString(asset.analysis.title),
    xAxis: asset.analysis.xAxis ?? undefined,
    yAxis: asset.analysis.yAxis ?? undefined,
    series: asset.analysis.series.map((series, index) =>
      stripUndefined({
        itemKey: `${asset.assetKey}:series:${index}`,
        legendLabel: series.legendLabel,
        unit: toOptionalString(series.unit)
      })
    ),
    keyFindings: asset.analysis.keyFindings,
    sourceLines: buildSourceLines(asset),
    publisherHints: buildPublisherHints(input.sourceAttribution, asset),
    temporalCoverage: asset.analysis.temporalCoverage ?? undefined
  });

const buildPostBundle = (input: Stage1Input): ResolutionEvidenceBundle =>
  stripUndefined({
    postUri: input.postContext.postUri,
    postText: [input.postContext.text],
    series: [],
    keyFindings: [],
    sourceLines: [],
    publisherHints: buildPublisherHints(input.sourceAttribution, null)
  });

export const buildResolutionEvidenceBundles = (
  input: Stage1Input
): ReadonlyArray<ResolutionEvidenceBundle> => {
  if (input.vision === null || input.vision.assets.length === 0) {
    return [buildPostBundle(input)];
  }

  return input.vision.assets.map((asset) => buildAssetBundle(input, asset));
};
