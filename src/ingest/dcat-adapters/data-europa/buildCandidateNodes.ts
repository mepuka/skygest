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
import { normalizeDistributionUrl } from "../../../resolution/normalize";
import type { DataEuropaDatasetInfo } from "./api";
import type { BuildContext } from "./buildContext";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const EUROPA_DATASET_ALIAS_SCHEME = AliasSchemeValues.europaDatasetId;
const EUROPA_SITE_BASE = "https://data.europa.eu";
const EUROPA_API_BASE = "https://data.europa.eu/api/hub/search";
const EUROPA_HARVEST_SOURCE = `${EUROPA_API_BASE}/ckan/package_search`;

// ---------------------------------------------------------------------------
// Decoders
// ---------------------------------------------------------------------------

const decodeDataset = stripUndefinedAndDecodeWith(Dataset);
const decodeDatasetSeries = stripUndefinedAndDecodeWith(DatasetSeries);
const decodeDistribution = stripUndefinedAndDecodeWith(Distribution);
const decodeCatalogRecord = stripUndefinedAndDecodeWith(CatalogRecord);
const decodeDataService = stripUndefinedAndDecodeWith(DataService);

// ---------------------------------------------------------------------------
// Theme mapping
// ---------------------------------------------------------------------------

const GROUP_TO_THEME: Record<string, string> = {
  ENER: "energy",
  ENVI: "environment",
  TECH: "technology",
  ECON: "economy",
  TRAN: "transport",
  AGRI: "agriculture",
  SOCI: "society",
  GOVE: "government",
  REGI: "regions",
  EDUC: "education",
  HEAL: "health",
  JUST: "justice",
  INTR: "international"
};

// ---------------------------------------------------------------------------
// Format to media type mapping
// ---------------------------------------------------------------------------

const FORMAT_TO_MEDIA_TYPE: Record<string, string> = {
  csv: "text/csv",
  json: "application/json",
  xml: "application/xml",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  xls: "application/vnd.ms-excel",
  pdf: "application/pdf",
  html: "text/html",
  rdf: "application/rdf+xml",
  zip: "application/zip",
  geojson: "application/geo+json",
  sparql: "application/sparql-results+xml",
  tsv: "text/tab-separated-values",
  ods: "application/vnd.oasis.opendocument.spreadsheet"
};

const deriveMediaType = (format: string | null | undefined): string | undefined => {
  if (format === null || format === undefined) {
    return undefined;
  }

  return FORMAT_TO_MEDIA_TYPE[format.toLowerCase().trim()] ?? undefined;
};

const deriveDistributionKind = (
  format: string | null | undefined
): "download" | "landing-page" => {
  if (format === null || format === undefined) {
    return "download";
  }

  const lower = format.toLowerCase().trim();
  return lower === "html" ? "landing-page" : "download";
};

// ---------------------------------------------------------------------------
// Slug helpers
// ---------------------------------------------------------------------------

const europaSlugPart = (value: string): string =>
  value
    .replace(/[^a-z0-9-]/giu, "-")
    .replace(/-+/gu, "-")
    .replace(/^-|-$/gu, "");

const europaDatasetSlug = (datasetId: string): string =>
  `europa-${europaSlugPart(datasetId)}`;

export const europaDatasetSeriesSlug = (datasetId: string): string =>
  `europa-series-${europaSlugPart(datasetId)}`;

const europaDistributionSlug = (
  datasetId: string,
  resourceIndex: number
): string => `${europaDatasetSlug(datasetId)}-r${resourceIndex}`;

const europaCatalogRecordSlug = (datasetId: string): string =>
  `${europaDatasetSlug(datasetId)}-cr`;

const europaDatasetLandingPage = (datasetId: string): string =>
  `${EUROPA_SITE_BASE}/data/datasets/${datasetId}`;

// ---------------------------------------------------------------------------
// Translation helpers
// ---------------------------------------------------------------------------

const extractFieldFromEntry = (
  entry: { readonly title?: string | null; readonly notes?: string | null },
  field: "title" | "notes"
): string | null | undefined =>
  field === "title" ? entry.title : entry.notes;

const extractTranslationField = (
  info: DataEuropaDatasetInfo,
  field: "title" | "notes"
): string | undefined => {
  const translation = info.translation;
  if (translation === null || translation === undefined) {
    return undefined;
  }

  // Prefer English
  const en = translation.en;
  if (en !== undefined && en !== null) {
    const value = extractFieldFromEntry(en, field);
    if (value !== null && value !== undefined && value.trim().length > 0) {
      return value;
    }
  }

  // Fall back to first available language
  for (const lang of Object.keys(translation)) {
    const entry = translation[lang];
    if (entry !== undefined && entry !== null) {
      const value = extractFieldFromEntry(entry, field);
      if (value !== null && value !== undefined && value.trim().length > 0) {
        return value;
      }
    }
  }

  return undefined;
};

const trimmedString = (value: string | null | undefined): string | undefined => {
  if (value === null || value === undefined) {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const normalizeDatasetType = (
  value: string | null | undefined
): string | undefined =>
  trimmedString(value)?.toLowerCase().replace(/-/gu, "_");

const isDatasetSeriesInfo = (info: DataEuropaDatasetInfo): boolean =>
  normalizeDatasetType(info.type) === "dataset_series";

const rememberSeriesReference = <Id extends string>(
  map: Map<string, Id>,
  key: string | undefined,
  id: Id
) => {
  if (key === undefined) {
    return;
  }

  map.set(key, id);
};

const appendSeriesReference = (
  out: Array<string>,
  seen: Set<string>,
  value: string | undefined
) => {
  if (value === undefined || seen.has(value)) {
    return;
  }

  seen.add(value);
  out.push(value);
};

const extractSeriesReferenceKeys = (value: unknown): ReadonlyArray<string> => {
  const out: Array<string> = [];
  const seen = new Set<string>();

  const visit = (input: unknown): void => {
    if (typeof input === "string") {
      appendSeriesReference(out, seen, trimmedString(input));
      return;
    }

    if (Array.isArray(input)) {
      for (const item of input) {
        visit(item);
      }
      return;
    }

    if (typeof input !== "object" || input === null) {
      return;
    }

    if ("id" in input && typeof input.id === "string") {
      appendSeriesReference(out, seen, trimmedString(input.id));
    }

    if ("name" in input && typeof input.name === "string") {
      appendSeriesReference(out, seen, trimmedString(input.name));
    }

    if ("url" in input && typeof input.url === "string") {
      appendSeriesReference(out, seen, trimmedString(input.url));
    }

    if ("uri" in input && typeof input.uri === "string") {
      appendSeriesReference(out, seen, trimmedString(input.uri));
    }
  };

  visit(value);
  return out;
};

const seriesSourceKeys = (
  info: DataEuropaDatasetInfo
): ReadonlyArray<string> => {
  const out: Array<string> = [];
  const seen = new Set<string>();

  appendSeriesReference(out, seen, trimmedString(info.id));
  appendSeriesReference(out, seen, trimmedString(info.name ?? undefined));
  appendSeriesReference(out, seen, trimmedString(info.url ?? undefined));

  return out;
};

const extractDatasetSeriesReferences = (
  info: DataEuropaDatasetInfo
): ReadonlyArray<string> => {
  const out: Array<string> = [];
  const seen = new Set<string>();

  for (const key of extractSeriesReferenceKeys(info.in_series)) {
    appendSeriesReference(out, seen, key);
  }

  for (const key of extractSeriesReferenceKeys(info.series_navigation)) {
    appendSeriesReference(out, seen, key);
  }

  return out;
};

const deriveCadence = (
  frequency: string | null | undefined
): DatasetSeries["cadence"] | undefined => {
  const normalized = trimmedString(frequency)?.toLowerCase();
  if (normalized === undefined) {
    return undefined;
  }

  if (
    normalized.includes("annual") ||
    normalized.includes("yearly") ||
    normalized.includes("annually")
  ) {
    return "annual";
  }

  if (normalized.includes("quarter")) {
    return "quarterly";
  }

  if (normalized.includes("month")) {
    return "monthly";
  }

  if (normalized.includes("week")) {
    return "weekly";
  }

  if (normalized.includes("day") || normalized.includes("daily")) {
    return "daily";
  }

  if (
    normalized.includes("irregular") ||
    normalized.includes("adhoc") ||
    normalized.includes("ad hoc") ||
    normalized.includes("as-needed")
  ) {
    return "irregular";
  }

  return undefined;
};

// ---------------------------------------------------------------------------
// Alias builders
// ---------------------------------------------------------------------------

const freshDatasetAliases = (
  datasetId: string
): ReadonlyArray<ExternalIdentifier> => [
  {
    scheme: EUROPA_DATASET_ALIAS_SCHEME,
    value: datasetId,
    relation: "exactMatch"
  }
];

const freshDatasetSeriesAliases = (
  info: DataEuropaDatasetInfo
): ReadonlyArray<ExternalIdentifier> => [
  {
    scheme: EUROPA_DATASET_ALIAS_SCHEME,
    value: info.id,
    relation: "exactMatch"
  },
  ...(trimmedString(info.url ?? undefined) === undefined
    ? []
    : [
        {
          scheme: AliasSchemeValues.url,
          value: trimmedString(info.url ?? undefined)!,
          relation: "exactMatch" as const
        }
      ])
];

// No URL aliases for EU federated catalog distributions — WMS/WFS endpoints
// are shared across many datasets, causing registry URL-lookup collisions.
// The europa-dataset-id alias on the parent dataset is the merge key.
const freshDistributionAliases = (
  _accessUrl: string
): ReadonlyArray<ExternalIdentifier> => [];

// ---------------------------------------------------------------------------
// Entity lookup
// ---------------------------------------------------------------------------

const existingDatasetForInfo = (
  idx: CatalogIndex,
  datasetId: string
): Dataset | null => idx.datasetsByMergeKey.get(datasetId) ?? null;

const existingDatasetSeriesForInfo = (
  idx: CatalogIndex,
  ctx: BuildContext,
  info: DataEuropaDatasetInfo
): DatasetSeries | null => {
  const title = buildDatasetSeriesTitle(info);
  const url = trimmedString(info.url ?? undefined);

  return idx.allDatasetSeries.find((series) =>
    series.aliases.some(
      (alias) =>
        (alias.scheme === EUROPA_DATASET_ALIAS_SCHEME &&
          alias.value === info.id) ||
        (url !== undefined &&
          alias.scheme === AliasSchemeValues.url &&
          alias.value === url)
    )
  ) ??
    idx.allDatasetSeries.find(
      (series) =>
        series.title === title &&
        (series.publisherAgentId ?? ctx.agent.id) === ctx.agent.id
    ) ??
    null;
};

// ---------------------------------------------------------------------------
// Dataset builder helpers
// ---------------------------------------------------------------------------

const buildDatasetTitle = (info: DataEuropaDatasetInfo): string => {
  const title = extractTranslationField(info, "title");
  const base = title ?? info.id;
  const publisherName =
    info.publisher !== null && info.publisher !== undefined
      ? (info.publisher.name ?? undefined)
      : undefined;
  // Disambiguate: federated catalog often has duplicate titles from different publishers
  return publisherName !== undefined && publisherName !== null
    ? `${base} (${publisherName})`
    : base;
};

const buildDatasetDescription = (info: DataEuropaDatasetInfo): string | undefined => {
  const notes = extractTranslationField(info, "notes");
  const publisherName =
    info.publisher !== null && info.publisher !== undefined
      ? info.publisher.name ?? undefined
      : undefined;

  if (notes === undefined) {
    return publisherName !== undefined && publisherName !== null
      ? `[Publisher: ${publisherName}]`
      : undefined;
  }

  return publisherName !== undefined && publisherName !== null
    ? `[Publisher: ${publisherName}] ${notes}`
    : notes;
};

const buildDatasetSeriesTitle = (info: DataEuropaDatasetInfo): string =>
  extractTranslationField(info, "title") ??
  trimmedString(info.name ?? undefined) ??
  info.id;

const buildDatasetSeriesDescription = (
  info: DataEuropaDatasetInfo
): string | undefined => extractTranslationField(info, "notes");

const buildDatasetKeywords = (info: DataEuropaDatasetInfo): ReadonlyArray<string> | undefined => {
  const tags = info.tags;
  if (tags === null || tags === undefined || tags.length === 0) {
    return undefined;
  }

  const keywords: Array<string> = [];
  for (const tag of tags) {
    if (typeof tag === "object" && tag !== null && "name" in tag && typeof tag.name === "string") {
      keywords.push(tag.name);
    } else if (typeof tag === "string") {
      keywords.push(tag);
    }
  }

  return keywords.length > 0 ? keywords : undefined;
};

const buildDatasetThemes = (
  info: DataEuropaDatasetInfo
): ReadonlyArray<string> | undefined => {
  const groups = info.groups;
  if (groups === null || groups === undefined || groups.length === 0) {
    return undefined;
  }

  const themes: Array<string> = [];
  for (const group of groups) {
    const groupId = group.id;
    if (groupId !== null && groupId !== undefined) {
      const theme = GROUP_TO_THEME[groupId] ?? groupId.toLowerCase();
      if (!themes.includes(theme)) {
        themes.push(theme);
      }
    }
  }

  return themes.length > 0 ? themes : undefined;
};

const buildDatasetTemporal = (
  info: DataEuropaDatasetInfo
): string | undefined => {
  const temporal = info.temporal;
  if (
    temporal === null ||
    temporal === undefined ||
    temporal.length === 0
  ) {
    return undefined;
  }

  const first = temporal[0];
  if (first === undefined) {
    return undefined;
  }

  const start = first.start_date;
  const end = first.end_date;
  if (
    (start === null || start === undefined) &&
    (end === null || end === undefined)
  ) {
    return undefined;
  }

  return `${start ?? ""}/${end ?? ""}`;
};

// ---------------------------------------------------------------------------
// Entity builders
// ---------------------------------------------------------------------------

const buildDatasetCandidate = (
  info: DataEuropaDatasetInfo,
  datasetId: Dataset["id"],
  ctx: BuildContext,
  existing: Dataset | null,
  distributionIds: ReadonlyArray<Distribution["id"]>,
  resolvedSeriesId: DatasetSeries["id"] | undefined
): Dataset =>
  decodeDataset({
    _tag: "Dataset" as const,
    id: datasetId,
    title: existing?.title ?? buildDatasetTitle(info),
    description: existing?.description ?? buildDatasetDescription(info),
    publisherAgentId: ctx.agent.id,
    landingPage:
      existing?.landingPage ?? europaDatasetLandingPage(info.id),
    accessRights: existing?.accessRights ?? "public",
    license: existing?.license ?? info.license_id ?? undefined,
    temporal: existing?.temporal ?? buildDatasetTemporal(info),
    keywords: existing?.keywords ?? buildDatasetKeywords(info),
    themes: existing?.themes ?? buildDatasetThemes(info),
    distributionIds,
    dataServiceIds: [ctx.dataService.id],
    inSeries: existing?.inSeries ?? resolvedSeriesId,
    aliases: unionAliases(
      existing?.aliases ?? [],
      freshDatasetAliases(info.id)
    ),
    createdAt: existing?.createdAt ?? ctx.nowIso,
    updatedAt: ctx.nowIso
  });

const buildDatasetSeriesCandidate = (
  info: DataEuropaDatasetInfo,
  ctx: BuildContext,
  existing: DatasetSeries | null
): DatasetSeries | null => {
  const cadence = existing?.cadence ?? deriveCadence(info.frequency ?? undefined);
  if (cadence === undefined) {
    return null;
  }

  return decodeDatasetSeries({
    _tag: "DatasetSeries" as const,
    id: existing?.id ?? mintDatasetSeriesId(),
    title: existing?.title ?? buildDatasetSeriesTitle(info),
    description:
      existing?.description ?? buildDatasetSeriesDescription(info),
    publisherAgentId: existing?.publisherAgentId ?? ctx.agent.id,
    cadence,
    aliases: unionAliases(
      existing?.aliases ?? [],
      freshDatasetSeriesAliases(info)
    ),
    createdAt: existing?.createdAt ?? ctx.nowIso,
    updatedAt: ctx.nowIso
  });
};

const buildDistributionCandidate = (
  resource: {
    readonly id: string;
    readonly access_url?: string | null;
    readonly format?: string | null;
    readonly size?: number | null;
  },
  datasetId: Dataset["id"],
  ctx: BuildContext,
  existing: Distribution | null,
  seenUrls: Set<string>
): Distribution | null => {
  const accessUrl =
    resource.access_url !== null && resource.access_url !== undefined
      ? resource.access_url
      : undefined;

  if (accessUrl === undefined) {
    return null;
  }

  // EU federated catalog has shared service endpoints (WMS, WFS, ATOM)
  // across many datasets — skip duplicates to avoid registry URL collisions.
  // Use the same normalization as the registry so we catch all collisions.
  const normalizedUrl = normalizeDistributionUrl(accessUrl);
  const dedupeKey = normalizedUrl ?? accessUrl;
  if (seenUrls.has(dedupeKey)) {
    return null;
  }
  seenUrls.add(dedupeKey);

  const format = resource.format ?? undefined;
  const kind = deriveDistributionKind(format);
  const mediaType = deriveMediaType(format);

  return decodeDistribution({
    _tag: "Distribution" as const,
    id: existing?.id ?? mintDistributionId(),
    datasetId,
    kind,
    title:
      existing?.title ??
      (format !== undefined && format !== null
        ? `${format.toUpperCase()} distribution`
        : "Distribution"),
    accessURL: existing?.accessURL ?? accessUrl,
    mediaType: existing?.mediaType ?? mediaType,
    format: existing?.format ?? (format !== null && format !== undefined ? format.toLowerCase().trim() : undefined),
    byteSize:
      existing?.byteSize ??
      (resource.size !== null && resource.size !== undefined
        ? resource.size
        : undefined),
    accessRights: existing?.accessRights ?? "public",
    accessServiceId: existing?.accessServiceId ?? ctx.dataService.id,
    aliases: unionAliases(
      existing?.aliases ?? [],
      freshDistributionAliases(accessUrl)
    ),
    createdAt: existing?.createdAt ?? ctx.nowIso,
    updatedAt: ctx.nowIso
  });
};

const buildCatalogRecordCandidate = (
  info: DataEuropaDatasetInfo,
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
    sourceRecordId: existing?.sourceRecordId ?? info.id,
    harvestedFrom: existing?.harvestedFrom ?? EUROPA_HARVEST_SOURCE,
    firstSeen: existing?.firstSeen ?? ctx.nowIso,
    lastSeen: ctx.nowIso,
    sourceModified:
      info.metadata_modified ?? existing?.sourceModified ?? undefined,
    isAuthoritative: existing?.isAuthoritative ?? true,
    duplicateOf: existing?.duplicateOf
  });

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export const buildCandidateNodes = (
  datasets: ReadonlyArray<DataEuropaDatasetInfo>,
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

  const seenTitles = new Set<string>();
  const seenDistributionUrls = new Set<string>();
  const datasetSeriesIdBySourceKey = new Map<string, DatasetSeries["id"]>();

  for (const existingSeries of idx.allDatasetSeries) {
    for (const alias of existingSeries.aliases) {
      if (
        alias.scheme === EUROPA_DATASET_ALIAS_SCHEME ||
        alias.scheme === AliasSchemeValues.url
      ) {
        rememberSeriesReference(
          datasetSeriesIdBySourceKey,
          alias.value,
          existingSeries.id
        );
      }
    }
  }

  for (const info of datasets) {
    if (!isDatasetSeriesInfo(info)) {
      continue;
    }

    const existingSeries = existingDatasetSeriesForInfo(idx, ctx, info);
    const datasetSeries = buildDatasetSeriesCandidate(info, ctx, existingSeries);
    if (datasetSeries === null) {
      continue;
    }

    for (const key of seriesSourceKeys(info)) {
      rememberSeriesReference(datasetSeriesIdBySourceKey, key, datasetSeries.id);
    }

    datasetSeriesNodes.push({
      _tag: "dataset-series",
      slug: stableSlug(
        existingSeries === null
          ? undefined
          : idx.datasetSeriesFileSlugById.get(existingSeries.id),
        () => europaDatasetSeriesSlug(info.id)
      ),
      data: datasetSeries,
      merged: existingSeries !== null
    });
  }

  for (const info of datasets) {
    if (isDatasetSeriesInfo(info)) {
      continue;
    }

    const title = buildDatasetTitle(info).toLowerCase();
    if (seenTitles.has(title)) continue;
    seenTitles.add(title);

    const existingDataset = existingDatasetForInfo(idx, info.id);
    const datasetId = existingDataset?.id ?? mintDatasetId();

    // Build distributions from resources
    const resources = info.resources ?? [];
    const builtDistributions: Array<{
      readonly distribution: Distribution;
      readonly slug: string;
      readonly merged: boolean;
    }> = [];

    for (let i = 0; i < resources.length; i++) {
      const resource = resources[i]!;
      const existingDistribution =
        idx.distributionsByDatasetIdKind.get(
          `${datasetId}::${deriveDistributionKind(resource.format)}`
        ) ?? null;

      const distribution = buildDistributionCandidate(
        resource,
        datasetId,
        ctx,
        existingDistribution,
        seenDistributionUrls
      );

      if (distribution !== null) {
        builtDistributions.push({
          distribution,
          slug: stableSlug(
            existingDistribution === null
              ? undefined
              : idx.distributionFileSlugById.get(existingDistribution.id),
            () => europaDistributionSlug(info.id, i)
          ),
          merged: existingDistribution !== null
        });
      }
    }

    const preservedDistributionIds = idx.allDistributions
      .filter(
        (distribution) =>
          distribution.datasetId === datasetId &&
          !builtDistributions.some(
            (built) => built.distribution.id === distribution.id
          )
      )
      .map((distribution) => distribution.id);

    const distributionIds = [
      ...preservedDistributionIds,
      ...builtDistributions.map((built) => built.distribution.id)
    ];

    const seriesReferences = extractDatasetSeriesReferences(info);
    const resolvedSeriesId =
      seriesReferences.length === 1
        ? datasetSeriesIdBySourceKey.get(seriesReferences[0]!)
        : undefined;

    const dataset = buildDatasetCandidate(
      info,
      datasetId,
      ctx,
      existingDataset,
      distributionIds,
      resolvedSeriesId
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
        () => europaDatasetSlug(info.id)
      ),
      data: dataset,
      merged: existingDataset !== null
    });

    for (const built of builtDistributions) {
      distributionNodes.push({
        _tag: "distribution",
        slug: built.slug,
        data: built.distribution,
        merged: built.merged
      });
    }

    catalogRecordNodes.push({
      _tag: "catalog-record",
      slug: stableSlug(
        existingCatalogRecord === null
          ? undefined
          : idx.catalogRecordFileSlugById.get(existingCatalogRecord.id),
        () => europaCatalogRecordSlug(info.id)
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
