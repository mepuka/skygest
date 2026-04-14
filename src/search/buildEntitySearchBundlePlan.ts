import { Option, Schema } from "effect";
import type {
  Agent,
  Dataset,
  Variable
} from "../domain/data-layer";
import {
  EntitySearchBundlePlan as EntitySearchBundlePlanSchema,
  type EntitySearchBundlePlan
} from "../domain/entitySearch";
import type {
  Stage1Input,
  Stage1Result
} from "../domain/stage1Resolution";
import type { DataLayerRegistryLookup } from "../resolution/dataLayerRegistry";
import {
  collectNormalizedSearchHostnames,
  collectNormalizedSearchUrls,
  collectUniqueSearchText
} from "./searchSignals";

const decodeBundlePlan = Schema.decodeUnknownSync(
  EntitySearchBundlePlanSchema
);

const getMatchedDatasets = (
  stage1: Stage1Result | undefined,
  lookup: DataLayerRegistryLookup
): ReadonlyArray<Dataset> => {
  if (stage1 === undefined) {
    return [];
  }

  const fromDatasetMatches = stage1.matches.flatMap((match) =>
    match._tag === "DatasetMatch"
      ? [Option.getOrNull(lookup.findByCanonicalUri(match.datasetId))]
      : []
  );
  const fromDistributionMatches = stage1.matches.flatMap((match) => {
    if (match._tag !== "DistributionMatch") {
      return [];
    }

    const distribution = Option.getOrNull(
      lookup.findByCanonicalUri(match.distributionId)
    );
    if (distribution?._tag !== "Distribution") {
      return [];
    }

    return [Option.getOrNull(lookup.findByCanonicalUri(distribution.datasetId))];
  });
  const fromVariableMatches = stage1.matches.flatMap((match) => {
    if (match._tag !== "VariableMatch") {
      return [];
    }

    return [...lookup.findDatasetsByVariableId(match.variableId)];
  });

  return [
    ...fromDatasetMatches,
    ...fromDistributionMatches,
    ...fromVariableMatches
  ].filter((entity): entity is Dataset => entity?._tag === "Dataset");
};

const getMatchedVariables = (
  stage1: Stage1Result | undefined,
  lookup: DataLayerRegistryLookup
): ReadonlyArray<Variable> => {
  if (stage1 === undefined) {
    return [];
  }

  const fromVariableMatches = stage1.matches.flatMap((match) =>
    match._tag === "VariableMatch"
      ? [Option.getOrNull(lookup.findByCanonicalUri(match.variableId))]
      : []
  );
  const fromDatasetMatches = stage1.matches.flatMap((match) =>
    match._tag === "DatasetMatch"
      ? [...lookup.findVariablesByDatasetId(match.datasetId)]
      : []
  );

  return [...fromVariableMatches, ...fromDatasetMatches].filter(
    (entity): entity is Variable => entity?._tag === "Variable"
  );
};

const getMatchedAgents = (
  stage1: Stage1Result | undefined,
  lookup: DataLayerRegistryLookup
): ReadonlyArray<Agent> => {
  if (stage1 === undefined) {
    return [];
  }

  const directAgents = stage1.matches.flatMap((match) =>
    match._tag === "AgentMatch"
      ? [Option.getOrNull(lookup.findByCanonicalUri(match.agentId))]
      : []
  );
  const datasetAgents = getMatchedDatasets(stage1, lookup).flatMap((dataset) =>
    dataset.publisherAgentId === undefined
      ? []
      : [Option.getOrNull(lookup.findByCanonicalUri(dataset.publisherAgentId))]
  );

  return [...directAgents, ...datasetAgents].filter(
    (entity): entity is Agent => entity?._tag === "Agent"
  );
};

const uniqueId = <A extends string>(
  values: ReadonlyArray<A | undefined>
): A | undefined => {
  const unique = [...new Set(values.filter((value): value is A => value !== undefined))];
  return unique.length === 1 ? unique[0] : undefined;
};

const buildResidualText = (
  stage1: Stage1Result | undefined,
  source: "chart-title" | "axis-label" | "organization-mention" | "logo-text" | "source-line"
) =>
  stage1?.residuals.flatMap((residual) =>
    residual._tag === "UnmatchedTextResidual" && residual.source === source
      ? [residual.text]
      : []
  ) ?? [];

const buildResidualDatasetTitles = (stage1: Stage1Result | undefined) =>
  stage1?.residuals.flatMap((residual) =>
    residual._tag === "UnmatchedDatasetTitleResidual"
      ? [residual.datasetName]
      : []
  ) ?? [];

const buildResidualUrls = (stage1: Stage1Result | undefined) =>
  stage1?.residuals.flatMap((residual) =>
    residual._tag === "UnmatchedUrlResidual"
      ? [residual.url]
      : []
  ) ?? [];

export const buildEntitySearchBundlePlan = (
  input: Stage1Input,
  lookup: DataLayerRegistryLookup,
  stage1?: Stage1Result
): EntitySearchBundlePlan => {
  const matchedDatasets = getMatchedDatasets(stage1, lookup);
  const matchedVariables = getMatchedVariables(stage1, lookup);
  const matchedAgents = getMatchedAgents(stage1, lookup);

  const publisherAgentId = uniqueId([
    ...matchedAgents.map((agent) => agent.id),
    ...matchedDatasets.map((dataset) => dataset.publisherAgentId)
  ]);
  const datasetId = uniqueId(matchedDatasets.map((dataset) => dataset.id));
  const variableId = uniqueId(matchedVariables.map((variable) => variable.id));

  const visibleUrls =
    input.vision?.assets.flatMap((asset) => asset.analysis.visibleUrls) ?? [];
  const organizationMentions =
    input.vision?.assets.flatMap((asset) =>
      asset.analysis.organizationMentions.map((mention) => mention.name)
    ) ?? [];
  const logoText =
    input.vision?.assets.flatMap((asset) => asset.analysis.logoText) ?? [];
  const sourceLineText =
    input.vision?.assets.flatMap((asset) =>
      asset.analysis.sourceLines.map((line) => line.sourceText)
    ) ?? [];
  const datasetNames =
    input.vision?.assets.flatMap((asset) =>
      asset.analysis.sourceLines.flatMap((line) =>
        line.datasetName === null ? [] : [line.datasetName]
      )
    ) ?? [];
  const chartTitles =
    input.vision?.assets.flatMap((asset) =>
      asset.analysis.title === null ? [] : [asset.analysis.title]
    ) ?? [];
  const seriesLabels =
    input.vision?.assets.flatMap((asset) =>
      asset.analysis.series.map((series) => series.legendLabel)
    ) ?? [];
  const axisLabels =
    input.vision?.assets.flatMap((asset) => [
      asset.analysis.xAxis?.label,
      asset.analysis.xAxis?.unit,
      asset.analysis.yAxis?.label,
      asset.analysis.yAxis?.unit
    ]) ?? [];
  const keyFindings =
    input.vision?.assets.flatMap((asset) => asset.analysis.keyFindings) ?? [];
  const summaryTitles = input.vision?.summary.titles ?? [];
  const summaryFindings =
    input.vision?.summary.keyFindings.map((finding) => finding.text) ?? [];

  const exactCanonicalUrls = collectNormalizedSearchUrls(
    ...(input.postContext.links.map((link) => link.url)),
    ...(input.postContext.linkCards.map((card) => card.uri)),
    input.sourceAttribution?.contentSource?.url ?? undefined,
    ...visibleUrls,
    ...buildResidualUrls(stage1)
  );

  const exactHostnames = collectNormalizedSearchHostnames(
    ...(input.postContext.links.map((link) => link.domain ?? link.url)),
    ...(input.postContext.linkCards.map((card) => card.uri)),
    input.sourceAttribution?.contentSource?.domain ?? undefined,
    input.sourceAttribution?.contentSource?.url ?? undefined,
    ...visibleUrls,
    ...buildResidualUrls(stage1)
  );

  return decodeBundlePlan({
    exactCanonicalUrls,
    exactHostnames,
    ...(publisherAgentId === undefined ? {} : { publisherAgentId }),
    ...(datasetId === undefined ? {} : { datasetId }),
    ...(variableId === undefined ? {} : { variableId }),
    agentText: collectUniqueSearchText(
      input.sourceAttribution?.provider?.providerLabel,
      input.sourceAttribution?.provider?.sourceFamily,
      input.sourceAttribution?.contentSource?.publication,
      matchedAgents.map((agent) => [agent.name, ...(agent.alternateNames ?? [])]),
      organizationMentions,
      logoText,
      buildResidualText(stage1, "organization-mention"),
      buildResidualText(stage1, "logo-text")
    ),
    datasetText: collectUniqueSearchText(
      input.sourceAttribution?.contentSource?.title,
      input.postContext.links.flatMap((link) => [link.title, link.description]),
      input.postContext.linkCards.flatMap((card) => [card.title, card.description]),
      matchedDatasets.map((dataset) => [dataset.title, dataset.description]),
      datasetNames,
      sourceLineText,
      summaryTitles,
      chartTitles,
      buildResidualDatasetTitles(stage1),
      buildResidualText(stage1, "source-line")
    ),
    distributionText: collectUniqueSearchText(
      input.sourceAttribution?.contentSource?.title,
      input.postContext.links.flatMap((link) => [link.url, link.domain, link.title]),
      input.postContext.linkCards.flatMap((card) => [card.uri, card.title]),
      visibleUrls,
      exactHostnames
    ),
    seriesText: collectUniqueSearchText(
      chartTitles,
      summaryTitles,
      seriesLabels,
      axisLabels,
      keyFindings,
      summaryFindings
    ),
    variableText: collectUniqueSearchText(
      chartTitles,
      summaryTitles,
      input.vision?.summary.text,
      seriesLabels,
      axisLabels,
      keyFindings,
      summaryFindings,
      datasetNames,
      matchedVariables.map((variable) => [
        variable.label,
        variable.definition,
        variable.measuredProperty,
        variable.domainObject,
        variable.technologyOrFuel,
        variable.statisticType,
        variable.aggregation,
        variable.unitFamily
      ]),
      buildResidualText(stage1, "chart-title"),
      buildResidualText(stage1, "axis-label")
    )
  });
};
