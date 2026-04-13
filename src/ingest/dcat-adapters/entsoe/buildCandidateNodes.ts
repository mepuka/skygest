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
import type { EntsoeManifestEntry } from "./manifest";
import {
  entsoeCatalogRecordSlug,
  entsoeDatasetSlug,
  entsoeDatasetSeriesSlug,
  entsoeDatasetSeriesSpecFor,
  entsoeDistributionSlug,
  manifestMergeKey
} from "./manifest";
import type { BuildContext } from "./buildContext";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ENTSOE_DATASET_ALIAS_SCHEME = AliasSchemeValues.entsoeDocumentType;
const ENTSOE_LANDING_PAGE = "https://transparency.entsoe.eu/";
const ENTSOE_API_BASE = "https://web-api.tp.entsoe.eu/api";

// ---------------------------------------------------------------------------
// Decoders
// ---------------------------------------------------------------------------

const decodeDataset = stripUndefinedAndDecodeWith(Dataset);
const decodeDatasetSeries = stripUndefinedAndDecodeWith(DatasetSeries);
const decodeDistribution = stripUndefinedAndDecodeWith(Distribution);
const decodeCatalogRecord = stripUndefinedAndDecodeWith(CatalogRecord);
const decodeDataService = stripUndefinedAndDecodeWith(DataService);

// ---------------------------------------------------------------------------
// Alias builders
// ---------------------------------------------------------------------------

const freshDatasetAliases = (
  entry: EntsoeManifestEntry
): ReadonlyArray<ExternalIdentifier> => [
  {
    scheme: ENTSOE_DATASET_ALIAS_SCHEME,
    value: manifestMergeKey(entry),
    relation: "exactMatch"
  }
];

const freshDatasetSeriesAliases = (
  documentType: string
): ReadonlyArray<ExternalIdentifier> => [
  {
    scheme: ENTSOE_DATASET_ALIAS_SCHEME,
    value: `series:${documentType}`,
    relation: "exactMatch"
  }
];

const freshDistributionAliases = (
  entry: EntsoeManifestEntry
): ReadonlyArray<ExternalIdentifier> => [
  {
    scheme: AliasSchemeValues.url,
    value: distributionAccessUrl(entry),
    relation: "exactMatch"
  }
];

// ---------------------------------------------------------------------------
// URL helpers
// ---------------------------------------------------------------------------

const distributionAccessUrl = (entry: EntsoeManifestEntry): string => {
  const params = new URLSearchParams({ documentType: entry.documentType });
  if (entry.processType !== undefined) {
    params.set("processType", entry.processType);
  }
  return `${ENTSOE_API_BASE}?${params.toString()}`;
};

// ---------------------------------------------------------------------------
// Entity lookup
// ---------------------------------------------------------------------------

const existingDatasetForEntry = (
  idx: CatalogIndex,
  entry: EntsoeManifestEntry
): Dataset | null => idx.datasetsByMergeKey.get(manifestMergeKey(entry)) ?? null;

const existingDatasetSeriesForDocumentType = (
  idx: CatalogIndex,
  ctx: BuildContext,
  documentType: string
): DatasetSeries | null => {
  const spec = entsoeDatasetSeriesSpecFor(documentType);
  if (spec === undefined) {
    return null;
  }

  return idx.allDatasetSeries.find(
    (series) =>
      series.aliases.some(
        (alias) =>
          alias.scheme === ENTSOE_DATASET_ALIAS_SCHEME &&
          alias.value === `series:${documentType}`
      ) ||
      (series.title === spec.title &&
        (series.publisherAgentId ?? ctx.agent.id) === ctx.agent.id)
  ) ?? null;
};

// ---------------------------------------------------------------------------
// Entity builders
// ---------------------------------------------------------------------------

const buildDatasetCandidate = (
  entry: EntsoeManifestEntry,
  datasetId: Dataset["id"],
  ctx: BuildContext,
  existing: Dataset | null,
  distributionIds: ReadonlyArray<Distribution["id"]>,
  datasetSeriesId: DatasetSeries["id"] | undefined
): Dataset =>
  decodeDataset({
    _tag: "Dataset" as const,
    id: datasetId,
    title: existing?.title ?? entry.title,
    description: existing?.description ?? entry.description,
    publisherAgentId: ctx.agent.id,
    landingPage: existing?.landingPage ?? ENTSOE_LANDING_PAGE,
    accessRights: existing?.accessRights ?? "public",
    keywords: existing?.keywords ?? [entry.category, entry.regulationArticle],
    themes: existing?.themes ?? [entry.category],
    distributionIds,
    dataServiceIds: [ctx.dataService.id],
    inSeries: existing?.inSeries ?? datasetSeriesId,
    aliases: unionAliases(
      existing?.aliases ?? [],
      freshDatasetAliases(entry)
    ),
    createdAt: existing?.createdAt ?? ctx.nowIso,
    updatedAt: ctx.nowIso
  });

const buildDatasetSeriesCandidate = (
  documentType: string,
  ctx: BuildContext,
  existing: DatasetSeries | null
): DatasetSeries => {
  const spec = entsoeDatasetSeriesSpecFor(documentType);
  if (spec === undefined) {
    throw new Error(`Missing ENTSO-E dataset-series spec for ${documentType}`);
  }

  return decodeDatasetSeries({
    _tag: "DatasetSeries" as const,
    id: existing?.id ?? mintDatasetSeriesId(),
    title: existing?.title ?? spec.title,
    description: existing?.description ?? spec.description,
    publisherAgentId: existing?.publisherAgentId ?? ctx.agent.id,
    cadence: existing?.cadence ?? "irregular",
    aliases: unionAliases(
      existing?.aliases ?? [],
      freshDatasetSeriesAliases(documentType)
    ),
    createdAt: existing?.createdAt ?? ctx.nowIso,
    updatedAt: ctx.nowIso
  });
};

const buildDistributionCandidate = (
  entry: EntsoeManifestEntry,
  datasetId: Dataset["id"],
  ctx: BuildContext,
  existing: Distribution | null
): Distribution =>
  decodeDistribution({
    _tag: "Distribution" as const,
    id: existing?.id ?? mintDistributionId(),
    datasetId,
    kind: "api-access" as const,
    title: existing?.title ?? `${entry.title} XML API`,
    description: existing?.description ?? entry.description,
    accessURL: existing?.accessURL ?? distributionAccessUrl(entry),
    mediaType: existing?.mediaType ?? "application/xml",
    format: existing?.format ?? "xml",
    accessRights: existing?.accessRights ?? "public",
    accessServiceId: existing?.accessServiceId ?? ctx.dataService.id,
    aliases: unionAliases(
      existing?.aliases ?? [],
      freshDistributionAliases(entry)
    ),
    createdAt: existing?.createdAt ?? ctx.nowIso,
    updatedAt: ctx.nowIso
  });

const buildCatalogRecordCandidate = (
  entry: EntsoeManifestEntry,
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
    sourceRecordId: existing?.sourceRecordId ?? manifestMergeKey(entry),
    harvestedFrom: existing?.harvestedFrom ?? "static-manifest",
    firstSeen: existing?.firstSeen ?? ctx.nowIso,
    lastSeen: ctx.nowIso,
    sourceModified: existing?.sourceModified,
    isAuthoritative: existing?.isAuthoritative ?? true,
    duplicateOf: existing?.duplicateOf
  });

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export const buildCandidateNodes = (
  entries: ReadonlyArray<EntsoeManifestEntry>,
  idx: CatalogIndex,
  ctx: BuildContext
): ReadonlyArray<IngestNode> => {
  const datasetSeriesNodes: Array<
    Extract<IngestNode, { _tag: "dataset-series" }>
  > = [];
  const datasetNodes: Array<Extract<IngestNode, { _tag: "dataset" }>> = [];
  const distributionNodes: Array<
    Extract<IngestNode, { _tag: "distribution" }>
  > = [];
  const catalogRecordNodes: Array<
    Extract<IngestNode, { _tag: "catalog-record" }>
  > = [];

  const entriesByDocumentType = new Map<string, Array<EntsoeManifestEntry>>();
  for (const entry of entries) {
    const bucket = entriesByDocumentType.get(entry.documentType);
    if (bucket === undefined) {
      entriesByDocumentType.set(entry.documentType, [entry]);
    } else {
      bucket.push(entry);
    }
  }

  const datasetSeriesIdByDocumentType = new Map<string, DatasetSeries["id"]>();
  for (const [documentType, members] of entriesByDocumentType) {
    if (members.length < 2 || entsoeDatasetSeriesSpecFor(documentType) === undefined) {
      continue;
    }

    const existingDatasetSeries = existingDatasetSeriesForDocumentType(
      idx,
      ctx,
      documentType
    );
    const datasetSeries = buildDatasetSeriesCandidate(
      documentType,
      ctx,
      existingDatasetSeries
    );

    datasetSeriesIdByDocumentType.set(documentType, datasetSeries.id);
    datasetSeriesNodes.push({
      _tag: "dataset-series",
      slug: stableSlug(
        existingDatasetSeries === null
          ? undefined
          : idx.datasetSeriesFileSlugById.get(existingDatasetSeries.id),
        () => entsoeDatasetSeriesSlug(documentType)
      ),
      data: datasetSeries,
      merged: existingDatasetSeries !== null
    });
  }

  for (const entry of entries) {
    const existingDataset = existingDatasetForEntry(idx, entry);
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
      entry,
      datasetId,
      ctx,
      existingApiDistribution
    );

    const dataset = buildDatasetCandidate(
      entry,
      datasetId,
      ctx,
      existingDataset,
      [...preservedDistributionIds, apiDistribution.id],
      datasetSeriesIdByDocumentType.get(entry.documentType)
    );

    const existingCatalogRecord =
      idx.catalogRecordsByCatalogAndPrimaryTopic.get(
        `${ctx.catalog.id}::${dataset.id}`
      ) ?? null;

    const catalogRecord = buildCatalogRecordCandidate(
      entry,
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
        () => entsoeDatasetSlug(entry)
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
        () => entsoeDistributionSlug(entry)
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
        () => entsoeCatalogRecordSlug(entry)
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
