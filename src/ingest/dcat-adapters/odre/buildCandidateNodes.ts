import {
  AliasSchemeValues,
  CatalogRecord,
  DataService,
  Dataset,
  Distribution,
  mintCatalogRecordId,
  mintDatasetId,
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
import type { OdreDatasetInfo } from "./api";
import type { BuildContext } from "./buildContext";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ODRE_DATASET_ALIAS_SCHEME = AliasSchemeValues.odreDatasetId;
const ODRE_SITE_BASE = "https://odre.opendatasoft.com";
const ODRE_API_BASE = "https://odre.opendatasoft.com/api/explore/v2.1";
const ODRE_HARVEST_SOURCE = `${ODRE_API_BASE}/catalog/datasets`;

// ---------------------------------------------------------------------------
// Decoders
// ---------------------------------------------------------------------------

const decodeDataset = stripUndefinedAndDecodeWith(Dataset);
const decodeDistribution = stripUndefinedAndDecodeWith(Distribution);
const decodeCatalogRecord = stripUndefinedAndDecodeWith(CatalogRecord);
const decodeDataService = stripUndefinedAndDecodeWith(DataService);

// ---------------------------------------------------------------------------
// Slug helpers
// ---------------------------------------------------------------------------

const odreDatasetSlug = (datasetId: string): string =>
  `odre-${datasetId.replace(/[_/]+/gu, "-")}`;

const odreDistributionSlug = (datasetId: string): string =>
  `${odreDatasetSlug(datasetId)}-api`;

const odreCatalogRecordSlug = (datasetId: string): string =>
  `${odreDatasetSlug(datasetId)}-cr`;

const odreDatasetLandingPage = (datasetId: string): string =>
  `${ODRE_SITE_BASE}/explore/dataset/${datasetId}/`;

const odreRecordsUrl = (datasetId: string): string =>
  `${ODRE_API_BASE}/catalog/datasets/${datasetId}/records`;

// ---------------------------------------------------------------------------
// Alias builders
// ---------------------------------------------------------------------------

const freshDatasetAliases = (
  datasetId: string
): ReadonlyArray<ExternalIdentifier> => [
  {
    scheme: ODRE_DATASET_ALIAS_SCHEME,
    value: datasetId,
    relation: "exactMatch"
  }
];

const freshDistributionAliases = (
  datasetId: string
): ReadonlyArray<ExternalIdentifier> => [
  {
    scheme: AliasSchemeValues.url,
    value: odreRecordsUrl(datasetId),
    relation: "exactMatch"
  }
];

// ---------------------------------------------------------------------------
// Entity lookup
// ---------------------------------------------------------------------------

const existingDatasetForInfo = (
  idx: CatalogIndex,
  datasetId: string
): Dataset | null => idx.datasetsByMergeKey.get(datasetId) ?? null;

// ---------------------------------------------------------------------------
// Entity builders
// ---------------------------------------------------------------------------

const buildDatasetCandidate = (
  info: OdreDatasetInfo,
  datasetId: Dataset["id"],
  ctx: BuildContext,
  existing: Dataset | null,
  distributionIds: ReadonlyArray<Distribution["id"]>
): Dataset => {
  const meta = info.metas.default;
  const dcat = info.metas.dcat;

  return decodeDataset({
    _tag: "Dataset" as const,
    id: datasetId,
    title: existing?.title ?? meta.title ?? info.dataset_id,
    description: existing?.description ?? meta.description ?? undefined,
    publisherAgentId: ctx.agent.id,
    landingPage:
      existing?.landingPage ?? odreDatasetLandingPage(info.dataset_id),
    accessRights: existing?.accessRights ?? "public",
    license: existing?.license ?? meta.license ?? undefined,
    temporal:
      existing?.temporal ??
      (dcat !== null && dcat !== undefined ? dcat.temporal ?? undefined : undefined),
    keywords: existing?.keywords ?? meta.keyword ?? undefined,
    themes: existing?.themes ?? meta.theme ?? undefined,
    distributionIds,
    dataServiceIds: [ctx.dataService.id],
    inSeries: existing?.inSeries,
    aliases: unionAliases(
      existing?.aliases ?? [],
      freshDatasetAliases(info.dataset_id)
    ),
    createdAt: existing?.createdAt ?? ctx.nowIso,
    updatedAt: ctx.nowIso
  });
};

const buildDistributionCandidate = (
  info: OdreDatasetInfo,
  datasetId: Dataset["id"],
  ctx: BuildContext,
  existing: Distribution | null
): Distribution =>
  decodeDistribution({
    _tag: "Distribution" as const,
    id: existing?.id ?? mintDistributionId(),
    datasetId,
    kind: "api-access" as const,
    title:
      existing?.title ??
      `${info.metas.default.title ?? info.dataset_id} JSON API`,
    description:
      existing?.description ?? info.metas.default.description ?? undefined,
    accessURL: existing?.accessURL ?? odreRecordsUrl(info.dataset_id),
    mediaType: existing?.mediaType ?? "application/json",
    format: existing?.format ?? "json",
    accessRights: existing?.accessRights ?? "public",
    accessServiceId: existing?.accessServiceId ?? ctx.dataService.id,
    aliases: unionAliases(
      existing?.aliases ?? [],
      freshDistributionAliases(info.dataset_id)
    ),
    createdAt: existing?.createdAt ?? ctx.nowIso,
    updatedAt: ctx.nowIso
  });

const buildCatalogRecordCandidate = (
  info: OdreDatasetInfo,
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
    sourceRecordId: existing?.sourceRecordId ?? info.dataset_id,
    harvestedFrom: existing?.harvestedFrom ?? ODRE_HARVEST_SOURCE,
    firstSeen: existing?.firstSeen ?? ctx.nowIso,
    lastSeen: ctx.nowIso,
    sourceModified:
      info.metas.default.modified ?? existing?.sourceModified ?? undefined,
    isAuthoritative: existing?.isAuthoritative ?? true,
    duplicateOf: existing?.duplicateOf
  });

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export const buildCandidateNodes = (
  datasets: ReadonlyArray<OdreDatasetInfo>,
  idx: CatalogIndex,
  ctx: BuildContext
): ReadonlyArray<IngestNode> => {
  const datasetNodes: Array<Extract<IngestNode, { _tag: "dataset" }>> = [];
  const distributionNodes: Array<
    Extract<IngestNode, { _tag: "distribution" }>
  > = [];
  const catalogRecordNodes: Array<
    Extract<IngestNode, { _tag: "catalog-record" }>
  > = [];

  for (const info of datasets) {
    const existingDataset = existingDatasetForInfo(idx, info.dataset_id);
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
      info,
      datasetId,
      ctx,
      existingApiDistribution
    );

    const dataset = buildDatasetCandidate(
      info,
      datasetId,
      ctx,
      existingDataset,
      [...preservedDistributionIds, apiDistribution.id]
    );

    const existingCatalogRecord =
      idx.catalogRecordsByCatalogAndPrimaryTopic.get(
        `${ctx.catalog.id}::${dataset.id}`
      ) ?? null;

    const catalogRecord = buildCatalogRecordCandidate(
      info,
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
        () => odreDatasetSlug(info.dataset_id)
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
        () => odreDistributionSlug(info.dataset_id)
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
        () => odreCatalogRecordSlug(info.dataset_id)
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
