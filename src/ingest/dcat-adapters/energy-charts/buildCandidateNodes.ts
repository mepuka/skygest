import {
  AliasSchemeValues,
  CatalogRecord,
  DataService,
  Dataset,
  DatasetSeries,
  Distribution,
  mintCatalogRecordId,
  mintDatasetId,
  mintDatasetSeriesId,
  mintDistributionId,
  type ExternalIdentifier
} from "../../../domain/data-layer";
import { stripUndefinedAndDecodeWith } from "../../../platform/Json";
import {
  stableSlug,
  type CatalogIndex,
  type IngestNode,
  unionAliases
} from "../../dcat-harness";
import {
  ENERGY_CHARTS_API_BASE_URL,
  ENERGY_CHARTS_DATASET_ALIAS_SCHEME,
  ENERGY_CHARTS_LICENSE_URL,
  ENERGY_CHARTS_OPENAPI_URL,
  energyChartsDatasetSeriesSlug,
  energyChartsFamilyTitle,
  type EndpointFamily
} from "./endpointCatalog";
import type { BuildContext } from "./buildContext";

const decodeDataset = stripUndefinedAndDecodeWith(Dataset);
const decodeDatasetSeries = stripUndefinedAndDecodeWith(DatasetSeries);
const decodeDistribution = stripUndefinedAndDecodeWith(Distribution);
const decodeCatalogRecord = stripUndefinedAndDecodeWith(CatalogRecord);
const decodeDataService = stripUndefinedAndDecodeWith(DataService);

const freshDatasetAliases = (
  family: EndpointFamily
): ReadonlyArray<ExternalIdentifier> => [
  {
    scheme: ENERGY_CHARTS_DATASET_ALIAS_SCHEME,
    value: family.endpointKey,
    relation: "exactMatch"
  }
];

const freshDatasetSeriesAliases = (
  endpointKey: string
): ReadonlyArray<ExternalIdentifier> => [
  {
    scheme: ENERGY_CHARTS_DATASET_ALIAS_SCHEME,
    value: `series:${endpointKey}`,
    relation: "exactMatch"
  }
];

const freshDistributionAliases = (
  family: EndpointFamily
): ReadonlyArray<ExternalIdentifier> => [
  {
    scheme: AliasSchemeValues.url,
    value: `${ENERGY_CHARTS_API_BASE_URL}${family.endpointKey}`,
    relation: "exactMatch"
  }
];

const existingDatasetForFamily = (
  idx: CatalogIndex,
  family: EndpointFamily
): Dataset | null => idx.datasetsByMergeKey.get(family.endpointKey) ?? null;

const datasetSeriesKeyForFamily = (family: EndpointFamily): string =>
  family.endpointKey
    .replace(/_forecast$/u, "")
    .replace(/_daily_avg$/u, "");

const existingDatasetSeriesForKey = (
  idx: CatalogIndex,
  ctx: BuildContext,
  endpointKey: string
): DatasetSeries | null =>
  idx.allDatasetSeries.find(
    (series) =>
      series.aliases.some(
        (alias) =>
          alias.scheme === ENERGY_CHARTS_DATASET_ALIAS_SCHEME &&
          alias.value === `series:${endpointKey}`
      ) ||
      (series.title === energyChartsFamilyTitle(endpointKey) &&
        (series.publisherAgentId ?? ctx.agent.id) === ctx.agent.id)
  ) ?? null;

const buildDatasetSeriesDescription = (endpointKey: string): string =>
  `Collection of Energy Charts ${endpointKey.replace(/_/gu, " ")} endpoints published as separate but related feeds.`;

const buildDatasetCandidate = (
  family: EndpointFamily,
  datasetId: Dataset["id"],
  ctx: BuildContext,
  existing: Dataset | null,
  distributionIds: ReadonlyArray<Distribution["id"]>,
  datasetSeriesId: DatasetSeries["id"] | undefined
): Dataset =>
  decodeDataset({
    _tag: "Dataset" as const,
    id: datasetId,
    title: family.title,
    description: existing?.description ?? family.description ?? family.summary,
    publisherAgentId: ctx.agent.id,
    landingPage: existing?.landingPage,
    accessRights: existing?.accessRights ?? "public",
    license: existing?.license ?? ENERGY_CHARTS_LICENSE_URL,
    temporal: existing?.temporal,
    keywords: existing?.keywords ?? [family.endpointKey],
    themes: existing?.themes,
    distributionIds,
    dataServiceIds: [ctx.dataService.id],
    inSeries: existing?.inSeries ?? datasetSeriesId,
    aliases: unionAliases(existing?.aliases ?? [], freshDatasetAliases(family)),
    createdAt: existing?.createdAt ?? ctx.nowIso,
    updatedAt: ctx.nowIso
  });

const buildDatasetSeriesCandidate = (
  endpointKey: string,
  ctx: BuildContext,
  existing: DatasetSeries | null
): DatasetSeries =>
  decodeDatasetSeries({
    _tag: "DatasetSeries" as const,
    id: existing?.id ?? mintDatasetSeriesId(),
    title: existing?.title ?? energyChartsFamilyTitle(endpointKey),
    description:
      existing?.description ?? buildDatasetSeriesDescription(endpointKey),
    publisherAgentId: existing?.publisherAgentId ?? ctx.agent.id,
    cadence: existing?.cadence ?? "irregular",
    aliases: unionAliases(
      existing?.aliases ?? [],
      freshDatasetSeriesAliases(endpointKey)
    ),
    createdAt: existing?.createdAt ?? ctx.nowIso,
    updatedAt: ctx.nowIso
  });

export const buildDistributionCandidate = (
  family: EndpointFamily,
  datasetId: Dataset["id"],
  ctx: BuildContext,
  existing: Distribution | null
): Distribution =>
  decodeDistribution({
    _tag: "Distribution" as const,
    id: existing?.id ?? mintDistributionId(),
    datasetId,
    kind: "api-access" as const,
    title: existing?.title ?? `${family.title} API`,
    description: existing?.description ?? family.description ?? family.summary,
    accessURL:
      existing?.accessURL ?? `${ENERGY_CHARTS_API_BASE_URL}${family.endpointKey}`,
    mediaType: existing?.mediaType ?? "application/json",
    format: existing?.format ?? "json",
    accessRights: existing?.accessRights ?? "public",
    license: existing?.license ?? ENERGY_CHARTS_LICENSE_URL,
    accessServiceId: existing?.accessServiceId ?? ctx.dataService.id,
    aliases: unionAliases(
      existing?.aliases ?? [],
      freshDistributionAliases(family)
    ),
    createdAt: existing?.createdAt ?? ctx.nowIso,
    updatedAt: ctx.nowIso
  });

export const buildCatalogRecord = (
  family: EndpointFamily,
  datasetId: Dataset["id"],
  ctx: BuildContext,
  existing: CatalogRecord | null
): CatalogRecord =>
  decodeCatalogRecord({
    _tag: "CatalogRecord" as const,
    id: existing?.id ?? mintCatalogRecordId(),
    catalogId: ctx.catalog.id,
    primaryTopicType: "dataset" as const,
    primaryTopicId: datasetId,
    sourceRecordId: existing?.sourceRecordId,
    harvestedFrom: existing?.harvestedFrom ?? ENERGY_CHARTS_OPENAPI_URL,
    firstSeen: existing?.firstSeen ?? ctx.nowIso,
    lastSeen: ctx.nowIso,
    sourceModified: existing?.sourceModified,
    isAuthoritative: existing?.isAuthoritative ?? true,
    duplicateOf: existing?.duplicateOf
  });

export const buildCandidateNodes = (
  families: ReadonlyArray<EndpointFamily>,
  idx: CatalogIndex,
  ctx: BuildContext
): ReadonlyArray<IngestNode> => {
  const datasetSeriesNodes: Array<
    Extract<IngestNode, { _tag: "dataset-series" }>
  > = [];
  const datasetNodes: Array<Extract<IngestNode, { _tag: "dataset" }>> = [];
  const distributionNodes: Array<Extract<IngestNode, { _tag: "distribution" }>> =
    [];
  const catalogRecordNodes: Array<
    Extract<IngestNode, { _tag: "catalog-record" }>
  > = [];

  const familiesBySeriesKey = new Map<string, Array<EndpointFamily>>();
  for (const family of families) {
    const key = datasetSeriesKeyForFamily(family);
    const bucket = familiesBySeriesKey.get(key);
    if (bucket === undefined) {
      familiesBySeriesKey.set(key, [family]);
    } else {
      bucket.push(family);
    }
  }

  const datasetSeriesIdByKey = new Map<string, DatasetSeries["id"]>();
  for (const [endpointKey, members] of familiesBySeriesKey) {
    if (members.length < 2) {
      continue;
    }

    const existingDatasetSeries = existingDatasetSeriesForKey(
      idx,
      ctx,
      endpointKey
    );
    const datasetSeries = buildDatasetSeriesCandidate(
      endpointKey,
      ctx,
      existingDatasetSeries
    );

    datasetSeriesIdByKey.set(endpointKey, datasetSeries.id);
    datasetSeriesNodes.push({
      _tag: "dataset-series",
      slug: stableSlug(
        existingDatasetSeries === null
          ? undefined
          : idx.datasetSeriesFileSlugById.get(existingDatasetSeries.id),
        () => energyChartsDatasetSeriesSlug(endpointKey)
      ),
      data: datasetSeries,
      merged: existingDatasetSeries !== null
    });
  }

  for (const family of families) {
    const existingDataset = existingDatasetForFamily(idx, family);
    const datasetId = existingDataset?.id ?? mintDatasetId();
    const existingApiDistribution =
      idx.distributionsByDatasetIdKind.get(`${datasetId}::api-access`) ?? null;
    const preservedDistributionIds = idx.allDistributions
      .filter(
        (distribution) =>
          distribution.datasetId === datasetId && distribution.kind !== "api-access"
      )
      .map((distribution) => distribution.id);
    const apiDistribution = buildDistributionCandidate(
      family,
      datasetId,
      ctx,
      existingApiDistribution
    );
    const dataset = buildDatasetCandidate(
      family,
      datasetId,
      ctx,
      existingDataset,
      [...preservedDistributionIds, apiDistribution.id],
      datasetSeriesIdByKey.get(datasetSeriesKeyForFamily(family))
    );
    const existingCatalogRecord =
      idx.catalogRecordsByCatalogAndPrimaryTopic.get(
        `${ctx.catalog.id}::${dataset.id}`
      ) ?? null;
    const catalogRecord = buildCatalogRecord(
      family,
      dataset.id,
      ctx,
      existingCatalogRecord
    );

    datasetNodes.push({
      _tag: "dataset",
      slug: stableSlug(
        existingDataset === null
          ? undefined
          : idx.datasetFileSlugById.get(existingDataset.id),
        () => family.datasetSlug
      ),
      data: dataset,
      merged: existingDataset !== null
    });
    distributionNodes.push({
      _tag: "distribution",
      slug: stableSlug(
        existingApiDistribution === null
          ? undefined
          : idx.distributionFileSlugById.get(existingApiDistribution.id),
        () => family.distributionSlug
      ),
      data: apiDistribution,
      merged: existingApiDistribution !== null
    });
    catalogRecordNodes.push({
      _tag: "catalog-record",
      slug: stableSlug(
        existingCatalogRecord === null
          ? undefined
          : idx.catalogRecordFileSlugById.get(existingCatalogRecord.id),
        () => family.catalogRecordSlug
      ),
      data: catalogRecord,
      merged: existingCatalogRecord !== null
    });
  }

  const servedDatasetIds = Array.from(
    new Set([
      ...ctx.dataService.servesDatasetIds,
      ...datasetNodes.map((node) => node.data.id)
    ])
  ).sort();
  const dataService = decodeDataService({
    ...ctx.dataService,
    servesDatasetIds: servedDatasetIds,
    updatedAt: ctx.nowIso
  });

  return [
    {
      _tag: "agent",
      slug: ctx.agentSlug,
      data: ctx.agent,
      merged: ctx.agentMerged
    },
    {
      _tag: "catalog",
      slug: ctx.catalogSlug,
      data: ctx.catalog,
      merged: ctx.catalogMerged
    },
    ...datasetSeriesNodes,
    ...datasetNodes,
    ...distributionNodes,
    ...catalogRecordNodes,
    {
      _tag: "data-service",
      slug: ctx.dataServiceSlug,
      data: dataService,
      merged: ctx.dataServiceMerged
    }
  ];
};
