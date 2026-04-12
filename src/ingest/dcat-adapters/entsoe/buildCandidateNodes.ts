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
import type { EntsoeManifestEntry } from "./manifest";
import {
  entsoeCatalogRecordSlug,
  entsoeDatasetSlug,
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

// ---------------------------------------------------------------------------
// Entity builders
// ---------------------------------------------------------------------------

const buildDatasetCandidate = (
  entry: EntsoeManifestEntry,
  datasetId: Dataset["id"],
  ctx: BuildContext,
  existing: Dataset | null,
  distributionIds: ReadonlyArray<Distribution["id"]>
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
    inSeries: existing?.inSeries,
    aliases: unionAliases(
      existing?.aliases ?? [],
      freshDatasetAliases(entry)
    ),
    createdAt: existing?.createdAt ?? ctx.nowIso,
    updatedAt: ctx.nowIso
  });

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
  const datasetNodes: Array<Extract<IngestNode, { _tag: "dataset" }>> = [];
  const distributionNodes: Array<
    Extract<IngestNode, { _tag: "distribution" }>
  > = [];
  const catalogRecordNodes: Array<
    Extract<IngestNode, { _tag: "catalog-record" }>
  > = [];

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
      [...preservedDistributionIds, apiDistribution.id]
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
