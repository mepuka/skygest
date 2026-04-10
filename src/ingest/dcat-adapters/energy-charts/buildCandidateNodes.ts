import { ulid } from "ulid";
import {
  AliasSchemeValues,
  CatalogRecord,
  Dataset,
  Distribution,
  makeCatalogRecordId,
  makeDatasetId,
  makeDistributionId,
  type ExternalIdentifier
} from "../../../domain/data-layer";
import { stripUndefined } from "../../../platform/Json";
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
  type EndpointFamily
} from "./endpointCatalog";
import type { BuildContext } from "./buildContext";

const mintEntityId = (entityKind: string, prefix: string): string =>
  `https://id.skygest.io/${entityKind}/${prefix}_${ulid()}`;

const datasetIdFromUlid = () => makeDatasetId(mintEntityId("dataset", "ds"));
const distributionIdFromUlid = () =>
  makeDistributionId(mintEntityId("distribution", "dist"));
const catalogRecordIdFromUlid = () =>
  makeCatalogRecordId(mintEntityId("catalog-record", "cr"));

const freshDatasetAliases = (
  family: EndpointFamily
): ReadonlyArray<ExternalIdentifier> => [
  {
    scheme: ENERGY_CHARTS_DATASET_ALIAS_SCHEME,
    value: family.endpointKey,
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

const buildDatasetCandidate = (
  family: EndpointFamily,
  datasetId: Dataset["id"],
  ctx: BuildContext,
  existing: Dataset | null,
  distributionIds: ReadonlyArray<Distribution["id"]>
): Dataset =>
  stripUndefined({
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
    inSeries: existing?.inSeries,
    aliases: unionAliases(existing?.aliases ?? [], freshDatasetAliases(family)),
    createdAt: existing?.createdAt ?? ctx.nowIso,
    updatedAt: ctx.nowIso
  }) as unknown as Dataset;

export const buildDistributionCandidate = (
  family: EndpointFamily,
  datasetId: Dataset["id"],
  ctx: BuildContext,
  existing: Distribution | null
): Distribution =>
  stripUndefined({
    _tag: "Distribution" as const,
    id: existing?.id ?? distributionIdFromUlid(),
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
  }) as unknown as Distribution;

export const buildCatalogRecord = (
  family: EndpointFamily,
  datasetId: Dataset["id"],
  ctx: BuildContext,
  existing: CatalogRecord | null
): CatalogRecord =>
  stripUndefined({
    _tag: "CatalogRecord" as const,
    id: existing?.id ?? catalogRecordIdFromUlid(),
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
  }) as unknown as CatalogRecord;

export const buildCandidateNodes = (
  families: ReadonlyArray<EndpointFamily>,
  idx: CatalogIndex,
  ctx: BuildContext
): ReadonlyArray<IngestNode> => {
  const datasetNodes: Array<Extract<IngestNode, { _tag: "dataset" }>> = [];
  const distributionNodes: Array<Extract<IngestNode, { _tag: "distribution" }>> =
    [];
  const catalogRecordNodes: Array<
    Extract<IngestNode, { _tag: "catalog-record" }>
  > = [];

  for (const family of families) {
    const existingDataset = existingDatasetForFamily(idx, family);
    const datasetId = existingDataset?.id ?? datasetIdFromUlid();
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
      [...preservedDistributionIds, apiDistribution.id]
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
      data: apiDistribution
    });
    catalogRecordNodes.push({
      _tag: "catalog-record",
      slug: stableSlug(
        existingCatalogRecord === null
          ? undefined
          : idx.catalogRecordFileSlugById.get(existingCatalogRecord.id),
        () => family.catalogRecordSlug
      ),
      data: catalogRecord
    });
  }

  const servedDatasetIds = Array.from(
    new Set([
      ...ctx.dataService.servesDatasetIds,
      ...datasetNodes.map((node) => node.data.id)
    ])
  ).sort();
  const dataService = stripUndefined({
    ...ctx.dataService,
    servesDatasetIds: servedDatasetIds,
    updatedAt: ctx.nowIso
  }) as unknown as BuildContext["dataService"];

  return [
    {
      _tag: "agent",
      slug: ctx.agentSlug,
      data: ctx.agent
    },
    {
      _tag: "catalog",
      slug: ctx.catalogSlug,
      data: ctx.catalog
    },
    ...datasetNodes,
    ...distributionNodes,
    ...catalogRecordNodes,
    {
      _tag: "data-service",
      slug: ctx.dataServiceSlug,
      data: dataService
    }
  ];
};
