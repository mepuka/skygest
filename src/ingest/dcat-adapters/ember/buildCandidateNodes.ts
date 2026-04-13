import {
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
  EMBER_API_BASE_URL,
  EMBER_DATASET_ALIAS_SCHEME,
  EMBER_LICENSE,
  EMBER_OPENAPI_URL,
  emberFamilyTitle,
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
    scheme: EMBER_DATASET_ALIAS_SCHEME,
    value: family.route,
    relation: "exactMatch"
  }
];

const freshDatasetSeriesAliases = (
  family: EndpointFamily
): ReadonlyArray<ExternalIdentifier> => [
  {
    scheme: EMBER_DATASET_ALIAS_SCHEME,
    value: family.family,
    relation: "exactMatch"
  }
];

const freshDistributionAliases = (
  family: EndpointFamily
): ReadonlyArray<ExternalIdentifier> => [
  {
    scheme: "url",
    value: `${EMBER_API_BASE_URL}${family.route}`,
    relation: "exactMatch"
  }
];

const existingDatasetForFamily = (
  idx: CatalogIndex,
  family: EndpointFamily
): Dataset | null => idx.datasetsByMergeKey.get(family.route) ?? null;

const existingDatasetSeriesForFamily = (
  idx: CatalogIndex,
  ctx: BuildContext,
  family: EndpointFamily
): DatasetSeries | null =>
  idx.allDatasetSeries.find(
    (series) =>
      series.aliases.some(
        (alias) =>
          alias.scheme === EMBER_DATASET_ALIAS_SCHEME &&
          alias.value === family.family
      ) ||
      (series.title === buildDatasetSeriesTitle(family) &&
        (series.publisherAgentId ?? ctx.agent.id) === ctx.agent.id)
  ) ?? null;

const cadenceForFamilies = (
  families: ReadonlyArray<EndpointFamily>
): DatasetSeries["cadence"] =>
  families.every((family) => family.resolution === "monthly")
    ? "monthly"
    : families.every((family) => family.resolution === "yearly")
      ? "annual"
      : "irregular";

const buildDatasetSeriesTitle = (family: EndpointFamily): string =>
  `Ember ${emberFamilyTitle(family.family)}`;

const buildDatasetSeriesDescription = (
  families: ReadonlyArray<EndpointFamily>
): string =>
  families.length === 1
    ? `Collection of Ember ${families[0]!.family.replace(/-/gu, " ")} datasets.`
    : `Collection of Ember ${families[0]!.family.replace(/-/gu, " ")} datasets grouped by reporting resolution.`;

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
    license: existing?.license ?? EMBER_LICENSE,
    keywords:
      existing?.keywords ?? [family.family, family.resolution, "ember-api"],
    themes: existing?.themes,
    temporal: existing?.temporal,
    distributionIds,
    dataServiceIds: [ctx.dataService.id],
    inSeries: existing?.inSeries ?? datasetSeriesId,
    aliases: unionAliases(existing?.aliases ?? [], freshDatasetAliases(family)),
    createdAt: existing?.createdAt ?? ctx.nowIso,
    updatedAt: ctx.nowIso
  });

const buildDatasetSeriesCandidate = (
  family: EndpointFamily,
  familyMembers: ReadonlyArray<EndpointFamily>,
  ctx: BuildContext,
  existing: DatasetSeries | null
): DatasetSeries =>
  decodeDatasetSeries({
    _tag: "DatasetSeries" as const,
    id: existing?.id ?? mintDatasetSeriesId(),
    title: existing?.title ?? buildDatasetSeriesTitle(family),
    description:
      existing?.description ?? buildDatasetSeriesDescription(familyMembers),
    publisherAgentId: existing?.publisherAgentId ?? ctx.agent.id,
    cadence: existing?.cadence ?? cadenceForFamilies(familyMembers),
    aliases: unionAliases(
      existing?.aliases ?? [],
      freshDatasetSeriesAliases(family)
    ),
    createdAt: existing?.createdAt ?? ctx.nowIso,
    updatedAt: ctx.nowIso
  });

const buildDistributionCandidate = (
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
    accessURL: existing?.accessURL ?? `${EMBER_API_BASE_URL}${family.route}`,
    mediaType: existing?.mediaType ?? "application/json",
    format: existing?.format ?? "json",
    accessRights: existing?.accessRights ?? "public",
    license: existing?.license ?? EMBER_LICENSE,
    accessServiceId: existing?.accessServiceId ?? ctx.dataService.id,
    aliases: unionAliases(
      existing?.aliases ?? [],
      freshDistributionAliases(family)
    ),
    createdAt: existing?.createdAt ?? ctx.nowIso,
    updatedAt: ctx.nowIso
  });

const buildCatalogRecord = (
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
    harvestedFrom: existing?.harvestedFrom ?? EMBER_OPENAPI_URL,
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

  const familiesByName = new Map<string, Array<EndpointFamily>>();
  for (const family of families) {
    const bucket = familiesByName.get(family.family);
    if (bucket === undefined) {
      familiesByName.set(family.family, [family]);
    } else {
      bucket.push(family);
    }
  }

  const datasetSeriesIdByFamily = new Map<string, DatasetSeries["id"]>();

  for (const [familyName, familyMembers] of familiesByName) {
    if (familyMembers.length < 2) {
      continue;
    }

    const representative = familyMembers[0]!;
    const existingDatasetSeries = existingDatasetSeriesForFamily(
      idx,
      ctx,
      representative
    );
    const datasetSeries = buildDatasetSeriesCandidate(
      representative,
      familyMembers,
      ctx,
      existingDatasetSeries
    );

    datasetSeriesIdByFamily.set(familyName, datasetSeries.id);
    datasetSeriesNodes.push({
      _tag: "dataset-series",
      slug: stableSlug(
        existingDatasetSeries === null
          ? undefined
          : idx.datasetSeriesFileSlugById.get(existingDatasetSeries.id),
        () => representative.datasetSeriesSlug
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
          distribution.datasetId === datasetId &&
          distribution.kind !== "api-access"
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
      datasetSeriesIdByFamily.get(family.family)
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
