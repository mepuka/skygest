import {
  AliasSchemeValues,
  CatalogRecord,
  DataService,
  Dataset,
  Distribution,
  type Agent,
  type AgentId,
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
import type { GridStatusDatasetInfo } from "./api";
import type { BuildContext } from "./buildContext";
import {
  GRIDSTATUS_DATASET_ALIAS_SCHEME,
  gridstatusApiDistributionSlug,
  gridstatusCatalogRecordSlug,
  gridstatusCsvDistributionSlug,
  gridstatusDatasetLandingPage,
  gridstatusDatasetQueryUrl,
  gridstatusDatasetSlug
} from "./endpointCatalog";

const decodeDataset = stripUndefinedAndDecodeWith(Dataset);
const decodeDistribution = stripUndefinedAndDecodeWith(Distribution);
const decodeCatalogRecord = stripUndefinedAndDecodeWith(CatalogRecord);
const decodeDataService = stripUndefinedAndDecodeWith(DataService);

const normalize = (value: string): string => value.trim().toLowerCase();

const SOURCE_AGENT_MATCHERS: Record<string, ReadonlyArray<string>> = {
  aeso: ["alberta electric system operator", "aeso"],
  caiso: ["california independent system operator", "caiso"],
  eia: [
    "u.s. energy information administration",
    "us energy information administration",
    "energy information administration",
    "eia"
  ],
  ercot: ["electric reliability council of texas", "ercot"],
  ieso: ["independent electricity system operator", "ieso"],
  isone: ["iso new england", "iso-ne", "isone"],
  miso: ["midcontinent independent system operator", "miso"],
  nyiso: ["new york independent system operator", "nyiso"],
  pjm: ["pjm interconnection", "pjm interconnection, l.l.c.", "pjm"],
  spp: ["southwest power pool", "spp"],
  gridstatus: ["gridstatus"]
};

const resolveSourceAgentId = (
  idx: CatalogIndex,
  source: string | null | undefined,
  gridStatusAgentId: Agent["id"]
): AgentId | undefined => {
  if (source === null || source === undefined) {
    return undefined;
  }

  const normalizedSource = normalize(source);
  if (normalizedSource === "gridstatus") {
    return gridStatusAgentId;
  }

  const matchers = SOURCE_AGENT_MATCHERS[normalizedSource];
  if (matchers === undefined) {
    return undefined;
  }

  const existingAgent = idx.allAgents.find((agent) => {
    const candidates = [
      agent.name,
      ...(agent.alternateNames ?? []),
      ...agent.aliases.map((alias) => alias.value)
    ].map(normalize);
    return matchers.some((matcher) => candidates.includes(matcher));
  });

  return existingAgent?.id;
};

const temporalRange = (
  dataset: GridStatusDatasetInfo
): string | undefined => {
  const start = dataset.earliest_available_time_utc;
  const end = dataset.latest_available_time_utc;
  if (start === null || start === undefined || end === null || end === undefined) {
    return undefined;
  }

  return `${start}/${end}`;
};

const freshDatasetAliases = (
  dataset: GridStatusDatasetInfo
): ReadonlyArray<ExternalIdentifier> => [
  {
    scheme: GRIDSTATUS_DATASET_ALIAS_SCHEME,
    value: dataset.id,
    relation: "exactMatch"
  },
  ...(dataset.source_url === null || dataset.source_url === undefined
    ? []
    : [
        {
          scheme: AliasSchemeValues.url,
          value: dataset.source_url,
          relation: "closeMatch" as const
        }
      ])
];

const buildApiDistributionAliases = (
  baseUrl: string,
  datasetId: string
): ReadonlyArray<ExternalIdentifier> => [
  {
    scheme: AliasSchemeValues.url,
    value: `${gridstatusDatasetQueryUrl(baseUrl, datasetId)}?return_format=json`,
    relation: "exactMatch"
  }
];

const buildCsvDistributionAliases = (
  baseUrl: string,
  datasetId: string
): ReadonlyArray<ExternalIdentifier> => [
  {
    scheme: AliasSchemeValues.url,
    value: `${gridstatusDatasetQueryUrl(baseUrl, datasetId)}?return_format=csv&download=true`,
    relation: "exactMatch"
  }
];

const existingDatasetForInfo = (
  idx: CatalogIndex,
  dataset: GridStatusDatasetInfo
): Dataset | null => idx.datasetsByMergeKey.get(dataset.id) ?? null;

const existingGridStatusServedDatasetIds = (
  idx: CatalogIndex,
  dataService: DataService
): ReadonlyArray<Dataset["id"]> => {
  const validIds = new Set(
    idx.allDatasets
      .filter((dataset) =>
        dataset.aliases.some(
          (alias) => alias.scheme === GRIDSTATUS_DATASET_ALIAS_SCHEME
        )
      )
      .map((dataset) => dataset.id)
  );

  return dataService.servesDatasetIds.filter((datasetId) => validIds.has(datasetId));
};

const buildDatasetCandidate = (
  datasetInfo: GridStatusDatasetInfo,
  datasetId: Dataset["id"],
  ctx: BuildContext,
  idx: CatalogIndex,
  existing: Dataset | null,
  distributionIds: ReadonlyArray<Distribution["id"]>
): Dataset => {
  const source = datasetInfo.source ?? undefined;
  const description = datasetInfo.description ?? undefined;

  return decodeDataset({
    _tag: "Dataset" as const,
    id: datasetId,
    title: datasetInfo.name,
    description: existing?.description ?? description,
    creatorAgentId:
      existing?.creatorAgentId ??
      resolveSourceAgentId(idx, source, ctx.agent.id),
    publisherAgentId: ctx.agent.id,
    landingPage:
      existing?.landingPage ?? gridstatusDatasetLandingPage(datasetInfo.id),
    accessRights: existing?.accessRights ?? "public",
    temporal: existing?.temporal ?? temporalRange(datasetInfo),
    keywords:
      existing?.keywords ??
      [
        datasetInfo.id,
        ...(source === undefined ? [] : [source]),
        ...(datasetInfo.table_type === undefined ||
        datasetInfo.table_type === null
          ? []
          : [datasetInfo.table_type]),
        ...(datasetInfo.data_frequency === undefined ||
        datasetInfo.data_frequency === null
          ? []
          : [datasetInfo.data_frequency])
      ],
    themes: existing?.themes ?? ["grid operations"],
    distributionIds,
    dataServiceIds: [ctx.dataService.id],
    inSeries: existing?.inSeries,
    aliases: unionAliases(
      existing?.aliases ?? [],
      freshDatasetAliases(datasetInfo)
    ),
    createdAt: existing?.createdAt ?? ctx.nowIso,
    updatedAt: ctx.nowIso
  });
};

const buildApiDistributionCandidate = (
  datasetInfo: GridStatusDatasetInfo,
  datasetId: Dataset["id"],
  ctx: BuildContext,
  existing: Distribution | null,
  baseUrl: string
): Distribution => {
  const description = datasetInfo.description ?? undefined;

  return decodeDistribution({
    _tag: "Distribution" as const,
    id: existing?.id ?? mintDistributionId(),
    datasetId,
    kind: "api-access" as const,
    title: existing?.title ?? `${datasetInfo.name} JSON API`,
    description: existing?.description ?? description,
    accessURL:
      existing?.accessURL ??
      `${gridstatusDatasetQueryUrl(baseUrl, datasetInfo.id)}?return_format=json`,
    mediaType: existing?.mediaType ?? "application/json",
    format: existing?.format ?? "json",
    accessRights: existing?.accessRights ?? "public",
    accessServiceId: existing?.accessServiceId ?? ctx.dataService.id,
    aliases: unionAliases(
      existing?.aliases ?? [],
      buildApiDistributionAliases(baseUrl, datasetInfo.id)
    ),
    createdAt: existing?.createdAt ?? ctx.nowIso,
    updatedAt: ctx.nowIso
  });
};

const buildCsvDistributionCandidate = (
  datasetInfo: GridStatusDatasetInfo,
  datasetId: Dataset["id"],
  ctx: BuildContext,
  existing: Distribution | null,
  baseUrl: string
): Distribution => {
  const description = datasetInfo.description ?? undefined;

  return decodeDistribution({
    _tag: "Distribution" as const,
    id: existing?.id ?? mintDistributionId(),
    datasetId,
    kind: "download" as const,
    title: existing?.title ?? `${datasetInfo.name} CSV download`,
    description: existing?.description ?? description,
    downloadURL:
      existing?.downloadURL ??
      `${gridstatusDatasetQueryUrl(baseUrl, datasetInfo.id)}?return_format=csv&download=true`,
    mediaType: existing?.mediaType ?? "text/csv",
    format: existing?.format ?? "csv",
    accessRights: existing?.accessRights ?? "public",
    accessServiceId: existing?.accessServiceId ?? ctx.dataService.id,
    aliases: unionAliases(
      existing?.aliases ?? [],
      buildCsvDistributionAliases(baseUrl, datasetInfo.id)
    ),
    createdAt: existing?.createdAt ?? ctx.nowIso,
    updatedAt: ctx.nowIso
  });
};

const buildCatalogRecord = (
  datasetInfo: GridStatusDatasetInfo,
  datasetId: Dataset["id"],
  ctx: BuildContext,
  existing: CatalogRecord | null,
  baseUrl: string
): CatalogRecord =>
  decodeCatalogRecord({
    _tag: "CatalogRecord" as const,
    id: existing?.id ?? mintCatalogRecordId(),
    catalogId: ctx.catalog.id,
    primaryTopicType: "dataset" as const,
    primaryTopicId: datasetId,
    sourceRecordId: existing?.sourceRecordId ?? datasetInfo.id,
    harvestedFrom:
      existing?.harvestedFrom ?? `${baseUrl.replace(/\/+$/u, "")}/datasets`,
    firstSeen:
      existing?.firstSeen ??
      datasetInfo.created_at_utc ??
      ctx.nowIso,
    lastSeen:
      existing?.lastSeen ??
      datasetInfo.last_checked_time_utc ??
      ctx.nowIso,
    sourceModified:
      existing?.sourceModified ??
      datasetInfo.latest_available_time_utc ??
      undefined,
    isAuthoritative: existing?.isAuthoritative ?? true,
    duplicateOf: existing?.duplicateOf
  });

export const buildCandidateNodes = (
  datasets: ReadonlyArray<GridStatusDatasetInfo>,
  idx: CatalogIndex,
  ctx: BuildContext,
  baseUrl: string
): ReadonlyArray<IngestNode> => {
  const datasetNodes: Array<Extract<IngestNode, { _tag: "dataset" }>> = [];
  const distributionNodes: Array<Extract<IngestNode, { _tag: "distribution" }>> =
    [];
  const catalogRecordNodes: Array<
    Extract<IngestNode, { _tag: "catalog-record" }>
  > = [];

  for (const datasetInfo of datasets) {
    const existingDataset = existingDatasetForInfo(idx, datasetInfo);
    const datasetId = existingDataset?.id ?? mintDatasetId();
    const existingApiDistribution =
      idx.distributionsByDatasetIdKind.get(`${datasetId}::api-access`) ?? null;
    const existingCsvDistribution =
      idx.distributionsByDatasetIdKind.get(`${datasetId}::download`) ?? null;
    const preservedDistributionIds = idx.allDistributions
      .filter(
        (distribution) =>
          distribution.datasetId === datasetId &&
          distribution.kind !== "api-access" &&
          distribution.kind !== "download"
      )
      .map((distribution) => distribution.id);
    const apiDistribution = buildApiDistributionCandidate(
      datasetInfo,
      datasetId,
      ctx,
      existingApiDistribution,
      baseUrl
    );
    const csvDistribution = buildCsvDistributionCandidate(
      datasetInfo,
      datasetId,
      ctx,
      existingCsvDistribution,
      baseUrl
    );
    const dataset = buildDatasetCandidate(
      datasetInfo,
      datasetId,
      ctx,
      idx,
      existingDataset,
      [...preservedDistributionIds, apiDistribution.id, csvDistribution.id]
    );
    const existingCatalogRecord =
      idx.catalogRecordsByCatalogAndPrimaryTopic.get(
        `${ctx.catalog.id}::${dataset.id}`
      ) ?? null;
    const catalogRecord = buildCatalogRecord(
      datasetInfo,
      dataset.id,
      ctx,
      existingCatalogRecord,
      baseUrl
    );

    datasetNodes.push({
      _tag: "dataset",
      slug: stableSlug(
        existingDataset === null
          ? undefined
          : idx.datasetFileSlugById.get(existingDataset.id),
        () => gridstatusDatasetSlug(datasetInfo.id)
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
        () => gridstatusApiDistributionSlug(datasetInfo.id)
      ),
      data: apiDistribution,
      merged: existingApiDistribution !== null
    });
    distributionNodes.push({
      _tag: "distribution",
      slug: stableSlug(
        existingCsvDistribution === null
          ? undefined
          : idx.distributionFileSlugById.get(existingCsvDistribution.id),
        () => gridstatusCsvDistributionSlug(datasetInfo.id)
      ),
      data: csvDistribution,
      merged: existingCsvDistribution !== null
    });
    catalogRecordNodes.push({
      _tag: "catalog-record",
      slug: stableSlug(
        existingCatalogRecord === null
          ? undefined
          : idx.catalogRecordFileSlugById.get(existingCatalogRecord.id),
        () => gridstatusCatalogRecordSlug(datasetInfo.id)
      ),
      data: catalogRecord,
      merged: existingCatalogRecord !== null
    });
  }

  const servedDatasetIds = Array.from(
    new Set([
      ...existingGridStatusServedDatasetIds(idx, ctx.dataService),
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
