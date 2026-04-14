import {
  AliasSchemeValues,
  CatalogRecord,
  Dataset,
  DatasetSeries,
  Distribution,
  mintCatalogRecordId,
  mintDatasetId,
  mintDatasetSeriesId,
  mintDistributionId,
  type DistributionKind,
  type ExternalIdentifier
} from "../../../domain/data-layer";
import { stripUndefinedAndDecodeWith } from "../../../platform/Json";
import {
  findDistributionInIndex,
  stableSlug,
  type CatalogIndex,
  type IngestNode,
  unionAliases
} from "../../dcat-harness";
import type { BuildContext } from "./buildContext";
import {
  energyInstituteCatalogRecordSlug,
  energyInstituteDistributionKinds,
  type EnergyInstituteDatasetManifestEntry,
  type EnergyInstituteDistributionSpec,
  type EnergyInstituteSeriesSpec
} from "./manifest";

const decodeDataset = stripUndefinedAndDecodeWith(Dataset);
const decodeDatasetSeries = stripUndefinedAndDecodeWith(DatasetSeries);
const decodeDistribution = stripUndefinedAndDecodeWith(Distribution);
const decodeCatalogRecord = stripUndefinedAndDecodeWith(CatalogRecord);

const freshDatasetAliases = (
  entry: EnergyInstituteDatasetManifestEntry
): ReadonlyArray<ExternalIdentifier> => [
  {
    scheme: AliasSchemeValues.url,
    value: entry.mergeKey,
    relation: "exactMatch"
  }
];

const freshSeriesAliases = (
  spec: EnergyInstituteSeriesSpec
): ReadonlyArray<ExternalIdentifier> => [
  {
    scheme: AliasSchemeValues.url,
    value: spec.seriesUrl,
    relation: "exactMatch"
  }
];

const freshDistributionAliases = (
  spec: EnergyInstituteDistributionSpec
): ReadonlyArray<ExternalIdentifier> => [
  {
    scheme: AliasSchemeValues.url,
    value: spec.accessURL,
    relation: "exactMatch"
  }
];

const existingDatasetForEntry = (
  idx: CatalogIndex,
  ctx: BuildContext,
  entry: EnergyInstituteDatasetManifestEntry
): Dataset | null =>
  idx.datasetsByMergeKey.get(entry.mergeKey) ??
  idx.allDatasets.find(
    (dataset) =>
      dataset.publisherAgentId === ctx.agent.id &&
      (dataset.landingPage === entry.landingPage || dataset.title === entry.title)
  ) ??
  null;

const existingDatasetSeriesForSpec = (
  idx: CatalogIndex,
  ctx: BuildContext,
  spec: EnergyInstituteSeriesSpec
): DatasetSeries | null =>
  idx.allDatasetSeries.find(
    (series) =>
      series.publisherAgentId === ctx.agent.id &&
      (series.title === spec.title ||
        series.aliases.some(
          (alias) =>
            alias.scheme === AliasSchemeValues.url && alias.value === spec.seriesUrl
        ))
  ) ?? null;

const existingDistributionForKind = (
  idx: CatalogIndex,
  datasetId: Dataset["id"],
  spec: EnergyInstituteDistributionSpec
): Distribution | null =>
  findDistributionInIndex(idx, {
    datasetId,
    kind: spec.kind,
    accessURL: spec.accessURL,
    format: spec.format ?? undefined
  });

const buildDatasetCandidate = (
  entry: EnergyInstituteDatasetManifestEntry,
  datasetId: Dataset["id"],
  ctx: BuildContext,
  existing: Dataset | null,
  distributionIds: ReadonlyArray<Distribution["id"]>,
  datasetSeriesId: DatasetSeries["id"]
): Dataset =>
  decodeDataset({
    _tag: "Dataset" as const,
    id: datasetId,
    title: existing?.title ?? entry.title,
    description: existing?.description ?? entry.description,
    publisherAgentId: ctx.agent.id,
    landingPage: existing?.landingPage ?? entry.landingPage,
    accessRights: existing?.accessRights ?? "public",
    keywords: existing?.keywords ?? [...entry.keywords],
    themes: existing?.themes ?? [...entry.themes],
    distributionIds,
    inSeries: existing?.inSeries ?? datasetSeriesId,
    aliases: unionAliases(existing?.aliases ?? [], freshDatasetAliases(entry)),
    createdAt: existing?.createdAt ?? ctx.nowIso,
    updatedAt: ctx.nowIso
  });

const buildDatasetSeriesCandidate = (
  spec: EnergyInstituteSeriesSpec,
  ctx: BuildContext,
  existing: DatasetSeries | null
): DatasetSeries =>
  decodeDatasetSeries({
    _tag: "DatasetSeries" as const,
    id: existing?.id ?? mintDatasetSeriesId(),
    title: existing?.title ?? spec.title,
    description: existing?.description ?? spec.description,
    publisherAgentId: existing?.publisherAgentId ?? ctx.agent.id,
    cadence: existing?.cadence ?? spec.cadence,
    aliases: unionAliases(existing?.aliases ?? [], freshSeriesAliases(spec)),
    createdAt: existing?.createdAt ?? ctx.nowIso,
    updatedAt: ctx.nowIso
  });

const buildDistributionCandidate = (
  spec: EnergyInstituteDistributionSpec,
  datasetId: Dataset["id"],
  ctx: BuildContext,
  existing: Distribution | null
): Distribution =>
  decodeDistribution({
    _tag: "Distribution" as const,
    id: existing?.id ?? mintDistributionId(),
    datasetId,
    kind: spec.kind,
    title: spec.title,
    description: existing?.description ?? spec.description,
    accessURL: spec.accessURL,
    mediaType: spec.mediaType ?? existing?.mediaType,
    format: spec.format ?? existing?.format,
    downloadURL: existing?.downloadURL,
    byteSize: existing?.byteSize,
    checksum: existing?.checksum,
    accessRights: existing?.accessRights ?? "public",
    license: existing?.license,
    accessServiceId: existing?.accessServiceId,
    aliases: unionAliases(
      existing?.aliases ?? [],
      freshDistributionAliases(spec)
    ),
    createdAt: existing?.createdAt ?? ctx.nowIso,
    updatedAt: ctx.nowIso
  });

const buildCatalogRecordCandidate = (
  entry: EnergyInstituteDatasetManifestEntry,
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
    sourceRecordId: existing?.sourceRecordId ?? entry.key,
    harvestedFrom: existing?.harvestedFrom ?? entry.landingPage,
    firstSeen: existing?.firstSeen ?? ctx.nowIso,
    lastSeen: ctx.nowIso,
    sourceModified: existing?.sourceModified,
    isAuthoritative: existing?.isAuthoritative ?? true,
    duplicateOf: existing?.duplicateOf
  });

const preservedDistributionNode = (
  distribution: Distribution,
  idx: CatalogIndex
): Extract<IngestNode, { _tag: "distribution" }> => ({
  _tag: "distribution",
  slug: stableSlug(
    idx.distributionFileSlugById.get(distribution.id),
    () => distribution.id
  ),
  data: distribution,
  merged: true
});

const managedDistributionKinds = (
  entry: EnergyInstituteDatasetManifestEntry
): ReadonlySet<DistributionKind> => energyInstituteDistributionKinds(entry);

export const buildCandidateNodes = (
  entries: ReadonlyArray<EnergyInstituteDatasetManifestEntry>,
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

  const datasetSeriesIdByKey = new Map<string, DatasetSeries["id"]>();
  const seenDistributionIds = new Set<Distribution["id"]>();

  for (const entry of entries) {
    let datasetSeriesId = datasetSeriesIdByKey.get(entry.series.key);
    if (datasetSeriesId === undefined) {
      const existingSeries = existingDatasetSeriesForSpec(idx, ctx, entry.series);
      const datasetSeries = buildDatasetSeriesCandidate(
        entry.series,
        ctx,
        existingSeries
      );
      datasetSeriesId = datasetSeries.id;
      datasetSeriesIdByKey.set(entry.series.key, datasetSeriesId);
      datasetSeriesNodes.push({
        _tag: "dataset-series",
        slug: stableSlug(
          existingSeries === null
            ? undefined
            : idx.datasetSeriesFileSlugById.get(existingSeries.id),
          () => entry.series.slug
        ),
        data: datasetSeries,
        merged: existingSeries !== null
      });
    }

    const existingDataset = existingDatasetForEntry(idx, ctx, entry);
    const datasetId = existingDataset?.id ?? mintDatasetId();

    const managedDistributionIds: Array<Distribution["id"]> = [];
    for (const spec of entry.distributions) {
      const existingDistribution = existingDistributionForKind(
        idx,
        datasetId,
        spec
      );
      const distribution = buildDistributionCandidate(
        spec,
        datasetId,
        ctx,
        existingDistribution
      );
      managedDistributionIds.push(distribution.id);
      if (seenDistributionIds.has(distribution.id)) {
        continue;
      }

      seenDistributionIds.add(distribution.id);
      distributionNodes.push({
        _tag: "distribution",
        slug: stableSlug(
          existingDistribution === null
            ? undefined
            : idx.distributionFileSlugById.get(existingDistribution.id),
          () => spec.slug
        ),
        data: distribution,
        merged: existingDistribution !== null
      });
    }

    const preservedDistributionIds: Array<Distribution["id"]> = [];
    const managedKinds = managedDistributionKinds(entry);
    for (const distribution of idx.allDistributions) {
      if (
        distribution.datasetId !== datasetId ||
        managedKinds.has(distribution.kind)
      ) {
        continue;
      }

      preservedDistributionIds.push(distribution.id);
      if (seenDistributionIds.has(distribution.id)) {
        continue;
      }

      seenDistributionIds.add(distribution.id);
      distributionNodes.push(preservedDistributionNode(distribution, idx));
    }

    const dataset = buildDatasetCandidate(
      entry,
      datasetId,
      ctx,
      existingDataset,
      [...managedDistributionIds, ...preservedDistributionIds],
      datasetSeriesId
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
        () => entry.slug
      ),
      data: dataset,
      merged: existingDataset !== null
    });

    catalogRecordNodes.push({
      _tag: "catalog-record",
      slug: stableSlug(
        existingCatalogRecord === null
          ? undefined
          : idx.catalogRecordFileSlugById.get(existingCatalogRecord.id),
        () => energyInstituteCatalogRecordSlug(entry)
      ),
      data: catalogRecord,
      merged: existingCatalogRecord !== null
    });
  }

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
    ...catalogRecordNodes
  ];
};
