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
import type { NesoPackageInfo } from "./api";
import type { BuildContext } from "./buildContext";

const NESO_SITE_BASE = "https://www.neso.energy/data-portal";
const NESO_HARVEST_SOURCE = "https://api.neso.energy/api/3/action/package_search";
type NesoResource = NonNullable<NesoPackageInfo["resources"]>[number];

const FORMAT_TO_MEDIA_TYPE: Record<string, string> = {
  csv: "text/csv",
  json: "application/json",
  xml: "application/xml",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  txt: "text/plain",
  zip: "application/zip"
};

const DOCUMENTATION_FORMATS = new Set([
  "doc",
  "docx",
  "pdf",
  "txt",
  "html",
  "htm"
]);

const decodeDataset = stripUndefinedAndDecodeWith(Dataset);
const decodeDistribution = stripUndefinedAndDecodeWith(Distribution);
const decodeCatalogRecord = stripUndefinedAndDecodeWith(CatalogRecord);
const decodeDataService = stripUndefinedAndDecodeWith(DataService);

const trimmedString = (value: string | null | undefined): string | undefined => {
  if (value === null || value === undefined) {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const decodeHtmlEntities = (value: string): string =>
  value
    .replace(/&nbsp;/giu, " ")
    .replace(/&amp;/giu, "&")
    .replace(/&quot;/giu, "\"")
    .replace(/&#0?39;/giu, "'")
    .replace(/&lt;/giu, "<")
    .replace(/&gt;/giu, ">");

const cleanText = (value: string | null | undefined): string | undefined => {
  const trimmed = trimmedString(value);
  if (trimmed === undefined) {
    return undefined;
  }

  const withoutBreaks = trimmed
    .replace(/<br\s*\/?>/giu, "\n")
    .replace(/<\/p>/giu, "\n")
    .replace(/<[^>]+>/gu, " ");
  const decoded = decodeHtmlEntities(withoutBreaks);
  const collapsed = decoded.replace(/\s+/gu, " ").trim();
  return collapsed.length > 0 ? collapsed : undefined;
};

const uniqueStrings = (
  values: ReadonlyArray<string | undefined>
): ReadonlyArray<string> => {
  const seen = new Set<string>();
  const out: Array<string> = [];

  for (const value of values) {
    if (value === undefined || seen.has(value)) {
      continue;
    }

    seen.add(value);
    out.push(value);
  }

  return out;
};

const normalizedFormat = (
  value: string | null | undefined
): string | undefined =>
  trimmedString(value)?.toLowerCase().replace(/^\./u, "");

const deriveMediaType = (resource: NesoResource): string | undefined =>
  trimmedString(resource.mimetype ?? undefined) ??
  FORMAT_TO_MEDIA_TYPE[normalizedFormat(resource.format ?? undefined) ?? ""] ??
  undefined;

const resourceUrl = (resource: NesoResource): string | undefined =>
  trimmedString(resource.url ?? undefined);

const isActiveResource = (resource: NesoResource): boolean => {
  const state = trimmedString(resource.state ?? undefined)?.toLowerCase();
  return (
    resourceUrl(resource) !== undefined &&
    (state === undefined || state === "active")
  );
};

const isDocumentationResource = (resource: NesoResource): boolean => {
  const format = normalizedFormat(resource.format ?? undefined);
  if (format !== undefined && DOCUMENTATION_FORMATS.has(format)) {
    return true;
  }

  const text = cleanText(
    `${resource.name ?? ""} ${resource.description ?? ""}`
  )?.toLowerCase();
  if (text === undefined) {
    return false;
  }

  return /faq|guide|guidance|documentation|methodolog|terms|licen[cs]e|readme|overview/u.test(
    text
  );
};

const parseTimestamp = (value: string | null | undefined): number => {
  const trimmed = trimmedString(value);
  if (trimmed === undefined) {
    return Number.NEGATIVE_INFINITY;
  }

  const parsed = Date.parse(trimmed);
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
};

const resourcePosition = (resource: NesoResource): number => {
  const value = resource.position;
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
  }

  return Number.NEGATIVE_INFINITY;
};

const resourceSortScore = (resource: NesoResource): readonly [number, number, number] => [
  parseTimestamp(resource.last_modified ?? undefined),
  parseTimestamp(resource.metadata_modified ?? undefined),
  resourcePosition(resource)
];

const compareResourcePriority = (
  left: NesoResource,
  right: NesoResource
): number => {
  const leftScore = resourceSortScore(left);
  const rightScore = resourceSortScore(right);

  for (let index = 0; index < leftScore.length; index += 1) {
    const delta = rightScore[index]! - leftScore[index]!;
    if (delta !== 0) {
      return delta;
    }
  }

  const leftDatastore = isDatastoreResource(left) ? 1 : 0;
  const rightDatastore = isDatastoreResource(right) ? 1 : 0;
  return rightDatastore - leftDatastore;
};

const isDatastoreResource = (resource: NesoResource): boolean =>
  resource.datastore_active === true;

const parseByteSize = (value: unknown): number | undefined => {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed >= 0) {
      return parsed;
    }
  }

  return undefined;
};

const extraValue = (
  dataset: NesoPackageInfo,
  key: string
): string | undefined => {
  const normalizedKey = key.trim().toLowerCase();
  const match = dataset.extras?.find(
    (extra) => extra.key?.trim().toLowerCase() === normalizedKey
  );
  return trimmedString(match?.value ?? undefined);
};

const nesoSlugPart = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9-]/gu, "-")
    .replace(/-+/gu, "-")
    .replace(/^-|-$/gu, "");

export const nesoDatasetSlug = (datasetName: string): string =>
  `neso-${nesoSlugPart(datasetName)}`;

const nesoDistributionSlug = (
  datasetName: string,
  kind: "download" | "docs"
): string => `${nesoDatasetSlug(datasetName)}-${kind}`;

const nesoCatalogRecordSlug = (datasetName: string): string =>
  `${nesoDatasetSlug(datasetName)}-cr`;

export const nesoDatasetLandingPage = (datasetName: string): string =>
  `${NESO_SITE_BASE}/${datasetName}`;

const freshDatasetAliases = (
  dataset: NesoPackageInfo
): ReadonlyArray<ExternalIdentifier> => [
  {
    scheme: AliasSchemeValues.url,
    value: nesoDatasetLandingPage(dataset.name),
    relation: "exactMatch"
  }
];

const freshDistributionAliases = (
  url: string
): ReadonlyArray<ExternalIdentifier> => [
  {
    scheme: AliasSchemeValues.url,
    value: url,
    relation: "exactMatch"
  }
];

const existingDatasetForPackage = (
  idx: CatalogIndex,
  dataset: NesoPackageInfo
): Dataset | null => idx.datasetsByMergeKey.get(nesoDatasetLandingPage(dataset.name)) ?? null;

const selectPrimaryDownload = (
  dataset: NesoPackageInfo
): NesoResource | null => {
  const resources = (dataset.resources ?? [])
    .filter(isActiveResource)
    .filter((resource) => !isDocumentationResource(resource))
    .sort(compareResourcePriority);

  return resources[0] ?? null;
};

const selectDocumentationResource = (
  dataset: NesoPackageInfo
): NesoResource | null => {
  const resources = (dataset.resources ?? [])
    .filter(isActiveResource)
    .filter(isDocumentationResource)
    .sort(compareResourcePriority);

  return resources[0] ?? null;
};

const packageDescription = (dataset: NesoPackageInfo): string | undefined =>
  cleanText(dataset.notes ?? undefined) ??
  cleanText(dataset.organization?.description ?? undefined);

const packageLicense = (dataset: NesoPackageInfo): string | undefined =>
  trimmedString(dataset.license_url ?? undefined);

const packageKeywords = (dataset: NesoPackageInfo): ReadonlyArray<string> =>
  uniqueStrings([
    ...((dataset.tags ?? []).flatMap((tag) => [
      cleanText(tag.display_name ?? undefined),
      cleanText(tag.name ?? undefined)
    ]) as ReadonlyArray<string | undefined>),
    cleanText(dataset.organization?.title ?? undefined),
    cleanText(extraValue(dataset, "Update Frequency"))
  ]);

const packageThemes = (dataset: NesoPackageInfo): ReadonlyArray<string> => {
  const text = [
    dataset.name,
    cleanText(dataset.title ?? undefined),
    packageDescription(dataset),
    ...packageKeywords(dataset)
  ]
    .filter((value): value is string => value !== undefined)
    .join(" ")
    .toLowerCase();

  const themes: Array<string> = [];
  if (
    /electricity|generation|demand|frequency|wind|solar|carbon|balancing/u.test(
      text
    )
  ) {
    themes.push("electricity");
  }
  if (/gas|hydrogen/u.test(text)) {
    themes.push("gas");
  }
  if (/market|trade|auction|reserve|tariff|capacity/u.test(text)) {
    themes.push("market");
  }
  if (/grid|network|constraint|transmission|interconnector|voltage|inertia/u.test(text)) {
    themes.push("grid");
  }
  if (/forecast|scenario|pathway|adequacy|future energy scenario|fes/u.test(text)) {
    themes.push("planning");
  }

  return themes.length > 0 ? uniqueStrings(themes) : ["energy"];
};

const buildDatasetCandidate = (
  source: NesoPackageInfo,
  datasetId: Dataset["id"],
  ctx: BuildContext,
  existing: Dataset | null,
  distributionIds: ReadonlyArray<Distribution["id"]>
): Dataset =>
  decodeDataset({
    _tag: "Dataset" as const,
    id: datasetId,
    title: existing?.title ?? cleanText(source.title ?? undefined) ?? source.name,
    description: existing?.description ?? packageDescription(source),
    publisherAgentId: ctx.agent.id,
    landingPage: existing?.landingPage ?? nesoDatasetLandingPage(source.name),
    license: existing?.license ?? packageLicense(source),
    accessRights: existing?.accessRights ?? "public",
    keywords: existing?.keywords ?? packageKeywords(source),
    themes: existing?.themes ?? packageThemes(source),
    distributionIds,
    dataServiceIds: Array.from(
      new Set([...(existing?.dataServiceIds ?? []), ctx.dataService.id])
    ),
    inSeries: existing?.inSeries,
    aliases: unionAliases(existing?.aliases ?? [], freshDatasetAliases(source)),
    createdAt: existing?.createdAt ?? ctx.nowIso,
    updatedAt: ctx.nowIso
  });

const buildDownloadDistributionCandidate = (
  source: NesoPackageInfo,
  resource: NesoResource,
  datasetId: Dataset["id"],
  ctx: BuildContext,
  existing: Distribution | null
): Distribution => {
  const url = resourceUrl(resource);
  if (url === undefined) {
    throw new Error(`NESO resource ${resource.id} missing URL`);
  }

  return decodeDistribution({
    _tag: "Distribution" as const,
    id: existing?.id ?? mintDistributionId(),
    datasetId,
    kind: "download" as const,
    title:
      existing?.title ??
      cleanText(resource.name ?? undefined) ??
      `${cleanText(source.title ?? undefined) ?? source.name} download`,
    description:
      existing?.description ??
      cleanText(resource.description ?? undefined) ??
      packageDescription(source),
    downloadURL: existing?.downloadURL ?? url,
    mediaType: existing?.mediaType ?? deriveMediaType(resource),
    format: existing?.format ?? normalizedFormat(resource.format ?? undefined),
    byteSize: existing?.byteSize ?? parseByteSize(resource.size),
    accessRights: existing?.accessRights ?? "public",
    license: existing?.license ?? packageLicense(source),
    accessServiceId:
      existing?.accessServiceId ??
      (isDatastoreResource(resource) ? ctx.dataService.id : undefined),
    aliases: unionAliases(existing?.aliases ?? [], freshDistributionAliases(url)),
    createdAt: existing?.createdAt ?? ctx.nowIso,
    updatedAt: ctx.nowIso
  });
};

const buildDocumentationDistributionCandidate = (
  source: NesoPackageInfo,
  resource: NesoResource,
  datasetId: Dataset["id"],
  ctx: BuildContext,
  existing: Distribution | null
): Distribution => {
  const url = resourceUrl(resource);
  if (url === undefined) {
    throw new Error(`NESO resource ${resource.id} missing URL`);
  }

  return decodeDistribution({
    _tag: "Distribution" as const,
    id: existing?.id ?? mintDistributionId(),
    datasetId,
    kind: "documentation" as const,
    title:
      existing?.title ??
      cleanText(resource.name ?? undefined) ??
      `${cleanText(source.title ?? undefined) ?? source.name} documentation`,
    description:
      existing?.description ??
      cleanText(resource.description ?? undefined) ??
      packageDescription(source),
    accessURL: existing?.accessURL ?? url,
    mediaType: existing?.mediaType ?? deriveMediaType(resource),
    format: existing?.format ?? normalizedFormat(resource.format ?? undefined),
    byteSize: existing?.byteSize ?? parseByteSize(resource.size),
    accessRights: existing?.accessRights ?? "public",
    license: existing?.license ?? packageLicense(source),
    aliases: unionAliases(existing?.aliases ?? [], freshDistributionAliases(url)),
    createdAt: existing?.createdAt ?? ctx.nowIso,
    updatedAt: ctx.nowIso
  });
};

const buildCatalogRecordCandidate = (
  source: NesoPackageInfo,
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
    sourceRecordId: existing?.sourceRecordId ?? source.id,
    harvestedFrom: existing?.harvestedFrom ?? NESO_HARVEST_SOURCE,
    firstSeen: existing?.firstSeen ?? source.metadata_created ?? ctx.nowIso,
    lastSeen: ctx.nowIso,
    sourceModified: source.metadata_modified ?? existing?.sourceModified,
    isAuthoritative: existing?.isAuthoritative ?? true,
    duplicateOf: existing?.duplicateOf
  });

const buildDataServiceCandidate = (
  ctx: BuildContext,
  servedDatasetIds: ReadonlyArray<Dataset["id"]>
): DataService =>
  decodeDataService({
    ...ctx.dataService,
    servesDatasetIds: servedDatasetIds,
    updatedAt: ctx.nowIso
  });

export const buildCandidateNodes = (
  datasets: ReadonlyArray<NesoPackageInfo>,
  idx: CatalogIndex,
  ctx: BuildContext
): ReadonlyArray<IngestNode> => {
  const datasetNodes: Array<Extract<IngestNode, { _tag: "dataset" }>> = [];
  const distributionNodes: Array<Extract<IngestNode, { _tag: "distribution" }>> =
    [];
  const catalogRecordNodes: Array<
    Extract<IngestNode, { _tag: "catalog-record" }>
  > = [];

  for (const source of datasets) {
    const existingDataset = existingDatasetForPackage(idx, source);
    const datasetId = existingDataset?.id ?? mintDatasetId();
    const existingDownloadDistribution =
      idx.distributionsByDatasetIdKind.get(`${datasetId}::download`) ?? null;
    const existingDocumentationDistribution =
      idx.distributionsByDatasetIdKind.get(`${datasetId}::documentation`) ?? null;
    const preservedDistributionIds = idx.allDistributions
      .filter(
        (distribution) =>
          distribution.datasetId === datasetId &&
          distribution.kind !== "download" &&
          distribution.kind !== "documentation"
      )
      .map((distribution) => distribution.id);

    const primaryDownload = selectPrimaryDownload(source);
    const documentation = selectDocumentationResource(source);

    const managedDistributionIds: Array<Distribution["id"]> = [];

    if (primaryDownload !== null) {
      const downloadDistribution = buildDownloadDistributionCandidate(
        source,
        primaryDownload,
        datasetId,
        ctx,
        existingDownloadDistribution
      );
      managedDistributionIds.push(downloadDistribution.id);
      distributionNodes.push({
        _tag: "distribution",
        slug: stableSlug(
          existingDownloadDistribution === null
            ? undefined
            : idx.distributionFileSlugById.get(existingDownloadDistribution.id),
          () => nesoDistributionSlug(source.name, "download")
        ),
        data: downloadDistribution,
        merged: existingDownloadDistribution !== null
      });
    }

    if (documentation !== null) {
      const documentationDistribution = buildDocumentationDistributionCandidate(
        source,
        documentation,
        datasetId,
        ctx,
        existingDocumentationDistribution
      );
      managedDistributionIds.push(documentationDistribution.id);
      distributionNodes.push({
        _tag: "distribution",
        slug: stableSlug(
          existingDocumentationDistribution === null
            ? undefined
            : idx.distributionFileSlugById.get(
                existingDocumentationDistribution.id
              ),
          () => nesoDistributionSlug(source.name, "docs")
        ),
        data: documentationDistribution,
        merged: existingDocumentationDistribution !== null
      });
    }

    const dataset = buildDatasetCandidate(
      source,
      datasetId,
      ctx,
      existingDataset,
      [...preservedDistributionIds, ...managedDistributionIds]
    );

    const existingCatalogRecord =
      idx.catalogRecordsByCatalogAndPrimaryTopic.get(
        `${ctx.catalog.id}::${dataset.id}`
      ) ?? null;
    const catalogRecord = buildCatalogRecordCandidate(
      source,
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
        () => nesoDatasetSlug(source.name)
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
        () => nesoCatalogRecordSlug(source.name)
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
  const dataService = buildDataServiceCandidate(ctx, servedDatasetIds);

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
