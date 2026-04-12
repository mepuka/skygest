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
  const hints = new Map<string, ResolutionPublisherHint>();

  const addHint = (
    value: string | null | undefined,
    confidence: number
  ): void => {
    const label = toOptionalString(value);
    if (label === undefined) {
      return;
    }

    const existing = hints.get(label);
    if (
      existing === undefined ||
      (existing.confidence ?? 0) < confidence
    ) {
      hints.set(label, { label, confidence });
    }
  };

  addHint(sourceAttribution?.provider?.providerLabel, 1);

  for (const candidate of sourceAttribution?.providerCandidates ?? []) {
    addHint(candidate.providerLabel, 0.8);
  }

  addHint(sourceAttribution?.contentSource?.publication, 0.7);
  addHint(sourceAttribution?.contentSource?.domain, 0.6);
  addHint(sourceAttribution?.contentSource?.title, 0.4);

  for (const mention of asset?.analysis.organizationMentions ?? []) {
    addHint(mention.name, 0.5);
  }

  for (const label of asset?.analysis.logoText ?? []) {
    addHint(label, 0.3);
  }

  return [...hints.values()];
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
