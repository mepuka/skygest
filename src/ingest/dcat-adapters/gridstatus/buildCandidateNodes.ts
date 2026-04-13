import { Result, Schema } from "effect";
import {
  AgentId,
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
import type { GridStatusDatasetInfo } from "./api";
import type { BuildContext } from "./buildContext";
import {
  GRIDSTATUS_DATASET_ALIAS_SCHEME,
  gridstatusApiDistributionSlug,
  gridstatusCatalogRecordSlug,
  gridstatusCsvDistributionSlug,
  gridstatusDatasetLandingPage,
  gridstatusDatasetQueryUrl,
  gridstatusDatasetSeriesSlug,
  gridstatusDatasetSlug
} from "./endpointCatalog";

const decodeDataset = stripUndefinedAndDecodeWith(Dataset);
const decodeDatasetSeries = stripUndefinedAndDecodeWith(DatasetSeries);
const decodeDistribution = stripUndefinedAndDecodeWith(Distribution);
const decodeCatalogRecord = stripUndefinedAndDecodeWith(CatalogRecord);
const decodeDataService = stripUndefinedAndDecodeWith(DataService);

export const GridStatusProvenanceWarning = Schema.Struct({
  datasetId: Schema.String,
  source: Schema.NullOr(Schema.String),
  reason: Schema.Literals(["unknownSourceLabel", "missingRegistryAgent"]),
  message: Schema.String
});
export type GridStatusProvenanceWarning = Schema.Schema.Type<
  typeof GridStatusProvenanceWarning
>;

export interface BuildCandidateNodesResult {
  readonly candidates: ReadonlyArray<IngestNode>;
  readonly provenanceWarnings: ReadonlyArray<GridStatusProvenanceWarning>;
}

type SourceAgentResolution =
  | { readonly _tag: "resolved"; readonly agentId: AgentId }
  | { readonly _tag: "selfPublished" }
  | {
      readonly _tag: "warning";
      readonly warning: GridStatusProvenanceWarning;
      readonly fallbackAgentId: AgentId | undefined;
    };

const normalize = (value: string): string => value.trim().toLowerCase();

const SOURCE_AGENT_SLUGS: Record<string, string> = {
  "alberta electric system operator": "aeso",
  aeso: "aeso",
  "california independent system operator": "caiso",
  caiso: "caiso",
  "u.s. energy information administration": "eia",
  "us energy information administration": "eia",
  "energy information administration": "eia",
  eia: "eia",
  "electric reliability council of texas": "ercot",
  ercot: "ercot",
  "independent electricity system operator": "ieso",
  ieso: "ieso",
  "iso new england": "iso-ne",
  "iso-ne": "iso-ne",
  isone: "iso-ne",
  "midcontinent independent system operator": "miso",
  miso: "miso",
  "new york independent system operator": "nyiso",
  nyiso: "nyiso",
  "pjm interconnection": "pjm",
  "pjm interconnection, l.l.c.": "pjm",
  pjm: "pjm",
  "southwest power pool": "spp",
  spp: "spp",
  "hydro-quebec": "hydro-quebec",
  hq: "hydro-quebec",
  gridstatus: "gridstatus"
};

const temporalRange = (
  dataset: GridStatusDatasetInfo
): string | undefined => {
  const start = dataset.earliest_available_time_utc;
  const end = dataset.latest_available_time_utc;
  if (
    start === null ||
    start === undefined ||
    end === null ||
    end === undefined
  ) {
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

const freshDatasetSeriesAliases = (
  datasetId: string
): ReadonlyArray<ExternalIdentifier> => [
  {
    scheme: GRIDSTATUS_DATASET_ALIAS_SCHEME,
    value: `series:${datasetId}`,
    relation: "exactMatch"
  }
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

const CADENCE_TOKENS = new Set([
  "hourly",
  "daily",
  "weekly",
  "monthly",
  "annual",
  "yearly"
]);

const NUMERIC_UNIT_TOKENS = new Set([
  "second",
  "seconds",
  "min",
  "minute",
  "minutes",
  "hour",
  "hours",
  "day",
  "days"
]);

const MARKET_STAGE_SUFFIXES: ReadonlyArray<ReadonlyArray<string>> = [
  ["day", "ahead"],
  ["real", "time"],
  ["intraday"],
  ["dam"],
  ["hasp"],
  ["ruc"],
  ["sced"],
  ["rtd"],
  ["rtpd"],
  ["fmm"],
  ["ifm"],
  ["ex", "post", "final"]
];

const GRIDSTATUS_TOKEN_DISPLAY: Record<string, string> = {
  aeso: "AESO",
  caiso: "CAISO",
  eia: "EIA",
  ercot: "ERCOT",
  ieso: "IESO",
  isone: "ISO-NE",
  miso: "MISO",
  nyiso: "NYISO",
  pjm: "PJM",
  spp: "SPP",
  lmp: "LMP",
  btm: "BTM",
  as: "AS",
  dam: "DAM",
  hasp: "HASP",
  ruc: "RUC",
  sced: "SCED",
  rtd: "RTD",
  rtpd: "RTPD",
  ifm: "IFM",
  fmm: "FMM"
};

const stripCadenceSuffixTokens = (
  tokens: ReadonlyArray<string>
): ReadonlyArray<string> => {
  const out = [...tokens];

  while (out.length > 0) {
    const last = out[out.length - 1]!;
    const previous = out.length >= 2 ? out[out.length - 2]! : undefined;

    if (CADENCE_TOKENS.has(last)) {
      out.pop();
      continue;
    }

    if (
      previous !== undefined &&
      /^\d+$/u.test(previous) &&
      NUMERIC_UNIT_TOKENS.has(last)
    ) {
      out.splice(out.length - 2, 2);
      continue;
    }

    break;
  }

  return out;
};

const endsWithTokens = (
  tokens: ReadonlyArray<string>,
  suffix: ReadonlyArray<string>
): boolean =>
  tokens.length >= suffix.length &&
  suffix.every(
    (token, index) => tokens[tokens.length - suffix.length + index] === token
  );

const stripMarketStageSuffixTokens = (
  tokens: ReadonlyArray<string>,
  knownIds: ReadonlySet<string>
): ReadonlyArray<string> => {
  let out = [...tokens];

  while (true) {
    let changed = false;

    for (const suffix of MARKET_STAGE_SUFFIXES) {
      if (!endsWithTokens(out, suffix)) {
        continue;
      }

      const candidate = out.slice(0, out.length - suffix.length).join("_");
      if (candidate.length === 0 || !knownIds.has(candidate)) {
        continue;
      }

      out = out.slice(0, out.length - suffix.length);
      changed = true;
      break;
    }

    if (!changed) {
      return out;
    }
  }
};

const gridstatusSeriesKeyForDataset = (
  datasetId: string,
  knownIds: ReadonlySet<string>
): string => {
  const cadenceStripped = stripCadenceSuffixTokens(
    datasetId.split("_").filter((token) => token.length > 0)
  );
  return stripMarketStageSuffixTokens(cadenceStripped, knownIds).join("_");
};

const titleToken = (token: string): string =>
  GRIDSTATUS_TOKEN_DISPLAY[token] ??
  token[0]!.toUpperCase() + token.slice(1);

const humanizeSeriesKey = (datasetId: string): string =>
  datasetId
    .split("_")
    .filter((token) => token.length > 0)
    .map(titleToken)
    .join(" ");

const cadenceFromPublicationFrequency = (
  datasetInfo: GridStatusDatasetInfo
): DatasetSeries["cadence"] | undefined => {
  const frequency = datasetInfo.publication_frequency;
  if (frequency === null || frequency === undefined) {
    return undefined;
  }

  const normalized = frequency.trim().toLowerCase();
  if (normalized.includes("annual") || normalized.includes("yearly")) {
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

  return undefined;
};

const cadenceForDatasetSeries = (
  members: ReadonlyArray<GridStatusDatasetInfo>
): DatasetSeries["cadence"] => {
  const cadences = Array.from(
    new Set(
      members
        .map(cadenceFromPublicationFrequency)
        .filter((value): value is DatasetSeries["cadence"] => value !== undefined)
    )
  );

  return cadences.length === 1 ? cadences[0]! : "irregular";
};

const buildDatasetSeriesTitle = (
  familyKey: string,
  members: ReadonlyArray<GridStatusDatasetInfo>
): string =>
  gridstatusDatasetTitle(
    members.find((member) => member.id === familyKey)?.name ??
      humanizeSeriesKey(familyKey)
  );

const buildDatasetSeriesDescription = (familyKey: string): string =>
  `Collection of GridStatus ${humanizeSeriesKey(familyKey).toLowerCase()} datasets published as separate but related feeds.`;

const existingDatasetSeriesForKey = (
  idx: CatalogIndex,
  ctx: BuildContext,
  familyKey: string,
  members: ReadonlyArray<GridStatusDatasetInfo>
): DatasetSeries | null =>
  idx.allDatasetSeries.find(
    (series) =>
      series.aliases.some(
        (alias) =>
          alias.scheme === GRIDSTATUS_DATASET_ALIAS_SCHEME &&
          alias.value === `series:${familyKey}`
      ) ||
      (series.title === buildDatasetSeriesTitle(familyKey, members) &&
        (series.publisherAgentId ?? ctx.agent.id) === ctx.agent.id)
  ) ?? null;

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

  return dataService.servesDatasetIds.filter((datasetId) =>
    validIds.has(datasetId)
  );
};

const existingDerivedFromAgentId = (
  existing: Dataset | null
): AgentId | undefined => {
  const [firstSource] = existing?.wasDerivedFrom ?? [];
  if (firstSource === undefined) {
    return undefined;
  }

  const decoded = Schema.decodeUnknownResult(AgentId)(firstSource);
  return Result.isSuccess(decoded) ? decoded.success : undefined;
};

const resolveSourceAgent = (
  idx: CatalogIndex,
  datasetInfo: GridStatusDatasetInfo,
  existing: Dataset | null
): SourceAgentResolution => {
  const source = datasetInfo.source;
  if (source === undefined || source === null || source.trim().length === 0) {
    return {
      _tag: "warning",
      warning: {
        datasetId: datasetInfo.id,
        source: source ?? null,
        reason: "unknownSourceLabel",
        message: `GridStatus dataset ${datasetInfo.id} has no source label`
      },
      fallbackAgentId: existingDerivedFromAgentId(existing)
    };
  }

  const normalizedSource = normalize(source);
  if (normalizedSource === "gridstatus") {
    return { _tag: "selfPublished" };
  }

  const expectedSlug = SOURCE_AGENT_SLUGS[normalizedSource];
  if (expectedSlug === undefined) {
    return {
      _tag: "warning",
      warning: {
        datasetId: datasetInfo.id,
        source,
        reason: "unknownSourceLabel",
        message: `Unknown GridStatus source label "${source}" for dataset ${datasetInfo.id}`
      },
      fallbackAgentId: existingDerivedFromAgentId(existing)
    };
  }

  const existingAgent = idx.allAgents.find(
    (agent) => idx.agentFileSlugById.get(agent.id) === expectedSlug
  );
  if (existingAgent === undefined) {
    return {
      _tag: "warning",
      warning: {
        datasetId: datasetInfo.id,
        source,
        reason: "missingRegistryAgent",
        message: `GridStatus source "${source}" mapped to "${expectedSlug}" but no matching registry agent exists`
      },
      fallbackAgentId: existingDerivedFromAgentId(existing)
    };
  }

  return { _tag: "resolved", agentId: existingAgent.id };
};

const resolvedDerivedFrom = (
  resolution: SourceAgentResolution
): ReadonlyArray<AgentId> | undefined => {
  switch (resolution._tag) {
    case "resolved":
      return [resolution.agentId];
    case "selfPublished":
      return undefined;
    case "warning":
      return resolution.fallbackAgentId === undefined
        ? undefined
        : [resolution.fallbackAgentId];
  }
};

const gridstatusDatasetTitle = (name: string): string =>
  name.startsWith("GridStatus ") ? name : `GridStatus ${name}`;

const buildDatasetCandidate = (input: {
  readonly datasetInfo: GridStatusDatasetInfo;
  readonly datasetId: Dataset["id"];
  readonly ctx: BuildContext;
  readonly idx: CatalogIndex;
  readonly existing: Dataset | null;
  readonly distributionIds: ReadonlyArray<Distribution["id"]>;
  readonly datasetSeriesId: DatasetSeries["id"] | undefined;
}): {
  readonly dataset: Dataset;
  readonly provenanceWarning: GridStatusProvenanceWarning | undefined;
} => {
  const source = input.datasetInfo.source ?? undefined;
  const description = input.datasetInfo.description ?? undefined;
  const resolution = resolveSourceAgent(
    input.idx,
    input.datasetInfo,
    input.existing
  );

  return {
    dataset: decodeDataset({
      _tag: "Dataset" as const,
      id: input.datasetId,
      title: gridstatusDatasetTitle(input.datasetInfo.name),
      description: input.existing?.description ?? description,
      wasDerivedFrom: resolvedDerivedFrom(resolution),
      publisherAgentId: input.ctx.agent.id,
      landingPage:
        input.existing?.landingPage ??
        gridstatusDatasetLandingPage(input.datasetInfo.id),
      accessRights: input.existing?.accessRights ?? "public",
      temporal: input.existing?.temporal ?? temporalRange(input.datasetInfo),
      keywords:
        input.existing?.keywords ??
        [
          input.datasetInfo.id,
          ...(source === undefined ? [] : [source]),
          ...(input.datasetInfo.table_type === undefined ||
          input.datasetInfo.table_type === null
            ? []
            : [input.datasetInfo.table_type]),
          ...(input.datasetInfo.data_frequency === undefined ||
          input.datasetInfo.data_frequency === null
            ? []
            : [input.datasetInfo.data_frequency])
        ],
      themes: input.existing?.themes ?? ["grid operations"],
      distributionIds: input.distributionIds,
      dataServiceIds: [input.ctx.dataService.id],
      inSeries: input.existing?.inSeries ?? input.datasetSeriesId,
      aliases: unionAliases(
        input.existing?.aliases ?? [],
        freshDatasetAliases(input.datasetInfo)
      ),
      createdAt: input.existing?.createdAt ?? input.ctx.nowIso,
      updatedAt: input.ctx.nowIso
    }),
    provenanceWarning:
      resolution._tag === "warning" ? resolution.warning : undefined
  };
};

const buildDatasetSeriesCandidate = (input: {
  readonly familyKey: string;
  readonly members: ReadonlyArray<GridStatusDatasetInfo>;
  readonly ctx: BuildContext;
  readonly existing: DatasetSeries | null;
}): DatasetSeries =>
  decodeDatasetSeries({
    _tag: "DatasetSeries" as const,
    id: input.existing?.id ?? mintDatasetSeriesId(),
    title:
      input.existing?.title ??
      buildDatasetSeriesTitle(input.familyKey, input.members),
    description:
      input.existing?.description ??
      buildDatasetSeriesDescription(input.familyKey),
    publisherAgentId: input.existing?.publisherAgentId ?? input.ctx.agent.id,
    cadence:
      input.existing?.cadence ?? cadenceForDatasetSeries(input.members),
    aliases: unionAliases(
      input.existing?.aliases ?? [],
      freshDatasetSeriesAliases(input.familyKey)
    ),
    createdAt: input.existing?.createdAt ?? input.ctx.nowIso,
    updatedAt: input.ctx.nowIso
  });

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
    firstSeen: existing?.firstSeen ?? datasetInfo.created_at_utc ?? ctx.nowIso,
    lastSeen:
      datasetInfo.last_checked_time_utc ?? existing?.lastSeen ?? ctx.nowIso,
    sourceModified:
      datasetInfo.latest_available_time_utc ??
      existing?.sourceModified ??
      undefined,
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
  datasets: ReadonlyArray<GridStatusDatasetInfo>,
  idx: CatalogIndex,
  ctx: BuildContext,
  baseUrl: string
): BuildCandidateNodesResult => {
  const datasetSeriesNodes: Array<
    Extract<IngestNode, { _tag: "dataset-series" }>
  > = [];
  const datasetNodes: Array<Extract<IngestNode, { _tag: "dataset" }>> = [];
  const distributionNodes: Array<Extract<IngestNode, { _tag: "distribution" }>> =
    [];
  const catalogRecordNodes: Array<
    Extract<IngestNode, { _tag: "catalog-record" }>
  > = [];
  const provenanceWarnings: Array<GridStatusProvenanceWarning> = [];

  const knownIds = new Set(datasets.map((dataset) => dataset.id));
  const datasetsBySeriesKey = new Map<string, Array<GridStatusDatasetInfo>>();
  for (const datasetInfo of datasets) {
    const key = gridstatusSeriesKeyForDataset(datasetInfo.id, knownIds);
    const bucket = datasetsBySeriesKey.get(key);
    if (bucket === undefined) {
      datasetsBySeriesKey.set(key, [datasetInfo]);
    } else {
      bucket.push(datasetInfo);
    }
  }

  const datasetSeriesIdByKey = new Map<string, DatasetSeries["id"]>();
  for (const [familyKey, members] of datasetsBySeriesKey) {
    if (members.length < 2) {
      continue;
    }

    const existingDatasetSeries = existingDatasetSeriesForKey(
      idx,
      ctx,
      familyKey,
      members
    );
    const datasetSeries = buildDatasetSeriesCandidate({
      familyKey,
      members,
      ctx,
      existing: existingDatasetSeries
    });

    datasetSeriesIdByKey.set(familyKey, datasetSeries.id);
    datasetSeriesNodes.push({
      _tag: "dataset-series",
      slug: stableSlug(
        existingDatasetSeries === null
          ? undefined
          : idx.datasetSeriesFileSlugById.get(existingDatasetSeries.id),
        () => gridstatusDatasetSeriesSlug(familyKey)
      ),
      data: datasetSeries,
      merged: existingDatasetSeries !== null
    });
  }

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
    const { dataset, provenanceWarning } = buildDatasetCandidate({
      datasetInfo,
      datasetId,
      ctx,
      idx,
      existing: existingDataset,
      distributionIds: [
        ...preservedDistributionIds,
        apiDistribution.id,
        csvDistribution.id
      ],
      datasetSeriesId: datasetSeriesIdByKey.get(
        gridstatusSeriesKeyForDataset(datasetInfo.id, knownIds)
      )
    });
    if (provenanceWarning !== undefined) {
      provenanceWarnings.push(provenanceWarning);
    }
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
  const dataService = buildDataServiceCandidate(ctx, servedDatasetIds);

  return {
    candidates: [
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
    ],
    provenanceWarnings
  };
};
