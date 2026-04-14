import type {
  Agent,
  DataLayerRegistryEntity,
  Dataset,
  Distribution,
  Series,
  Variable
} from "../domain/data-layer";
import type { ExternalIdentifier } from "../domain/data-layer/alias";
import type {
  EntitySearchAlias,
  EntitySearchDocument
} from "../domain/entitySearch";
import { encodeJsonString, stripUndefined } from "../platform/Json";
import {
  buildUrlPrefixes,
  normalizeDistributionHostname,
  normalizeDistributionUrl,
  normalizeLookupText
} from "../platform/Normalize";
import type { PreparedDataLayerRegistry } from "../resolution/dataLayerRegistry";

type SearchGraph = {
  readonly agentsById: ReadonlyMap<string, Agent>;
  readonly datasetsById: ReadonlyMap<string, Dataset>;
  readonly variablesById: ReadonlyMap<string, Variable>;
  readonly datasetsByVariableId: ReadonlyMap<string, ReadonlyArray<Dataset>>;
  readonly distributionsByDatasetId: ReadonlyMap<string, ReadonlyArray<Distribution>>;
  readonly seriesByDatasetId: ReadonlyMap<string, ReadonlyArray<Series>>;
  readonly seriesByVariableId: ReadonlyMap<string, ReadonlyArray<Series>>;
};

// Phase 1 mirrors the DCAT-facing spine in
// `references/data-layer-spine/manifest.json`: index only the typed catalog
// entities that participate in resolver lookup, and keep posts as
// request-time evidence rather than part of this corpus.
const isInScopeEntity = (
  entity: DataLayerRegistryEntity
): entity is Agent | Dataset | Distribution | Series | Variable =>
  entity._tag === "Agent" ||
  entity._tag === "Dataset" ||
  entity._tag === "Distribution" ||
  entity._tag === "Series" ||
  entity._tag === "Variable";

const addToMultiMap = <A>(
  map: Map<string, Array<A>>,
  key: string | undefined,
  value: A
) => {
  if (key === undefined) {
    return;
  }

  const current = map.get(key);
  if (current === undefined) {
    map.set(key, [value]);
    return;
  }

  current.push(value);
};

const finalizeMultiMap = <A>(
  map: Map<string, Array<A>>
): ReadonlyMap<string, ReadonlyArray<A>> =>
  new Map(
    [...map.entries()].map(([key, items]) => [key, [...items]])
  );

const buildSearchGraph = (prepared: PreparedDataLayerRegistry): SearchGraph => {
  const agentsById = new Map<string, Agent>();
  const datasetsById = new Map<string, Dataset>();
  const variablesById = new Map<string, Variable>();
  const datasetsByVariableId = new Map<string, Array<Dataset>>();
  const distributionsByDatasetId = new Map<string, Array<Distribution>>();
  const seriesByDatasetId = new Map<string, Array<Series>>();
  const seriesByVariableId = new Map<string, Array<Series>>();

  for (const entity of prepared.entities) {
    switch (entity._tag) {
      case "Agent":
        agentsById.set(entity.id, entity);
        break;
      case "Dataset":
        datasetsById.set(entity.id, entity);
        for (const variableId of entity.variableIds ?? []) {
          addToMultiMap(datasetsByVariableId, variableId, entity);
        }
        break;
      case "Distribution":
        addToMultiMap(distributionsByDatasetId, entity.datasetId, entity);
        break;
      case "Series":
        addToMultiMap(seriesByDatasetId, entity.datasetId, entity);
        addToMultiMap(seriesByVariableId, entity.variableId, entity);
        break;
      case "Variable":
        variablesById.set(entity.id, entity);
        break;
      default:
        break;
    }
  }

  return {
    agentsById,
    datasetsById,
    variablesById,
    datasetsByVariableId: finalizeMultiMap(datasetsByVariableId),
    distributionsByDatasetId: finalizeMultiMap(distributionsByDatasetId),
    seriesByDatasetId: finalizeMultiMap(seriesByDatasetId),
    seriesByVariableId: finalizeMultiMap(seriesByVariableId)
  };
};

const pushUniqueText = (
  seen: Set<string>,
  values: Array<string>,
  raw: string | undefined | null
) => {
  if (typeof raw !== "string") {
    return;
  }

  const value = raw.trim();
  if (value.length === 0) {
    return;
  }

  const key = normalizeLookupText(value);
  if (seen.has(key)) {
    return;
  }

  seen.add(key);
  values.push(value);
};

const collectUniqueText = (
  ...inputs: ReadonlyArray<unknown>
): ReadonlyArray<string> => {
  const seen = new Set<string>();
  const values: Array<string> = [];

  const visit = (input: unknown): void => {
    if (input == null) {
      return;
    }

    if (typeof input === "string") {
      pushUniqueText(seen, values, input);
      return;
    }

    if (Array.isArray(input)) {
      for (const value of input) {
        visit(value);
      }
      return;
    }

    if (typeof input === "object") {
      for (const value of Object.values(input)) {
        visit(value);
      }
    }
  };

  for (const input of inputs) {
    visit(input);
  }

  return values;
};

const joinSearchText = (
  fallback: string,
  ...inputs: ReadonlyArray<unknown>
): string => {
  const values = collectUniqueText(...inputs);
  return values.length === 0 ? fallback : values.join("\n");
};

const firstDistinct = (
  primary: string,
  ...candidates: ReadonlyArray<string | undefined | null>
): string | undefined => {
  const normalizedPrimary = normalizeLookupText(primary);
  for (const candidate of candidates) {
    if (candidate == null) {
      continue;
    }

    const value = candidate.trim();
    if (value.length === 0) {
      continue;
    }

    if (normalizeLookupText(value) !== normalizedPrimary) {
      return value;
    }
  }

  return undefined;
};

const dedupeAliases = (
  aliases: ReadonlyArray<ExternalIdentifier>
): ReadonlyArray<EntitySearchAlias> => {
  const seen = new Set<string>();
  const deduped: Array<EntitySearchAlias> = [];

  for (const alias of aliases) {
    const key = `${alias.scheme}\u0000${alias.value}`;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push(alias);
  }

  return deduped;
};

const toDisplayAliases = (
  values: ReadonlyArray<string> | undefined
): ReadonlyArray<ExternalIdentifier> =>
  (values ?? []).map((value) => ({
    scheme: "display-alias",
    value,
    relation: "exactMatch"
  }));

const toCanonicalUrls = (
  ...inputs: ReadonlyArray<string | undefined | null>
): ReadonlyArray<string> => {
  const seen = new Set<string>();
  const urls: Array<string> = [];

  for (const input of inputs) {
    if (input == null) {
      continue;
    }

    const normalized = normalizeDistributionUrl(input);
    if (normalized === null || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    urls.push(normalized);
  }

  return urls;
};

const toOptionalHostname = (input: string | undefined): string | undefined =>
  input === undefined
    ? undefined
    : normalizeDistributionHostname(input) ?? undefined;

const prefixesForUrls = (urls: ReadonlyArray<string>) =>
  urls.flatMap((url) => buildUrlPrefixes(url));

const agentLabels = (
  graph: SearchGraph,
  agentIds: ReadonlyArray<string | undefined>
): ReadonlyArray<string> =>
  collectUniqueText(
    agentIds.flatMap((agentId) => {
      if (agentId === undefined) {
        return [];
      }

      const agent = graph.agentsById.get(agentId);
      return agent === undefined
        ? []
        : [agent.name, ...(agent.alternateNames ?? []), ...agent.aliases.map((alias) => alias.value)];
    })
  );

const variableFacetTexts = (
  variables: ReadonlyArray<Variable>
): ReadonlyArray<string> =>
  collectUniqueText(
    variables.flatMap((variable) => [
      variable.label,
      variable.definition,
      variable.measuredProperty,
      variable.domainObject,
      variable.technologyOrFuel,
      variable.statisticType,
      variable.aggregation,
      variable.unitFamily,
      variable.policyInstrument
    ])
  );

const singleDistinctValue = <A extends string>(
  values: ReadonlyArray<A | undefined>
): A | undefined => {
  const seen = new Map<string, A>();

  for (const value of values) {
    if (value == null || value.trim().length === 0) {
      continue;
    }

    const normalized = normalizeLookupText(value);
    if (!seen.has(normalized)) {
      seen.set(normalized, value);
    }
  }

  if (seen.size !== 1) {
    return undefined;
  }

  return seen.values().next().value;
};

const uniquePublisherId = (
  datasets: ReadonlyArray<Dataset>
): Dataset["publisherAgentId"] =>
  singleDistinctValue(datasets.map((dataset) => dataset.publisherAgentId));

const uniqueDatasetId = (
  datasets: ReadonlyArray<Dataset>
): Dataset["id"] | undefined =>
  singleDistinctValue(datasets.map((dataset) => dataset.id));

const projectAgent = (
  agent: Agent,
  graph: SearchGraph
): EntitySearchDocument => {
  const aliases = dedupeAliases([
    ...agent.aliases,
    ...toDisplayAliases(agent.alternateNames)
  ]);
  const canonicalUrls = toCanonicalUrls(
    agent.homepage,
    ...aliases.filter((alias) => alias.scheme === "url").map((alias) => alias.value)
  );
  const homepageHostname = toOptionalHostname(agent.homepage);
  const aliasValues = aliases.map((alias) => alias.value);
  const lineageValues = agent.parentAgentId === undefined
    ? []
    : agentLabels(graph, [agent.parentAgentId]);
  const urlValues = collectUniqueText(canonicalUrls, homepageHostname, prefixesForUrls(canonicalUrls));
  const primaryText = joinSearchText(agent.name, agent.name, agent.alternateNames);
  const aliasText = joinSearchText(agent.name, aliasValues);
  const lineageText = joinSearchText(agent.name, lineageValues);
  const ontologyText = joinSearchText(agent.name, agent.kind);
  const urlText = joinSearchText(agent.name, urlValues);

  return stripUndefined({
    entityId: agent.id,
    entityType: "Agent" as const,
    primaryLabel: agent.name,
    secondaryLabel: firstDistinct(agent.name, agent.alternateNames?.[0]),
    aliases,
    agentId: agent.id,
    homepageHostname,
    canonicalUrls,
    payloadJson: encodeJsonString(agent),
    primaryText,
    aliasText,
    lineageText,
    urlText,
    ontologyText,
    semanticText: joinSearchText(
      agent.name,
      primaryText,
      aliasText,
      lineageText,
      urlText,
      ontologyText
    ),
    updatedAt: agent.updatedAt
  }) as EntitySearchDocument;
};

const projectDataset = (
  dataset: Dataset,
  graph: SearchGraph
): EntitySearchDocument => {
  const aliases = dedupeAliases(dataset.aliases);
  const childVariables = (dataset.variableIds ?? [])
    .map((variableId) => graph.variablesById.get(variableId))
    .filter((variable): variable is Variable => variable !== undefined);
  const childDistributions = graph.distributionsByDatasetId.get(dataset.id) ?? [];
  const childSeries = graph.seriesByDatasetId.get(dataset.id) ?? [];
  const publisherLabels = dataset.publisherAgentId === undefined
    ? []
    : agentLabels(graph, [dataset.publisherAgentId]);
  const canonicalUrls = toCanonicalUrls(
    dataset.landingPage,
    ...aliases.filter((alias) => alias.scheme === "url").map((alias) => alias.value)
  );
  const landingPageHostname = toOptionalHostname(dataset.landingPage);
  const aliasValues = aliases.map((alias) => alias.value);
  const childVariableFacetValues = variableFacetTexts(childVariables);
  const distributionLineage = collectUniqueText(
    childDistributions.flatMap((distribution) => [
      distribution.title,
      toOptionalHostname(distribution.accessURL),
      toOptionalHostname(distribution.downloadURL)
    ])
  );
  const seriesLabels = childSeries.map((series) => series.label);
  const urlValues = collectUniqueText(canonicalUrls, landingPageHostname, prefixesForUrls(canonicalUrls));
  const primaryText = joinSearchText(
    dataset.title,
    dataset.title,
    dataset.description,
    dataset.keywords,
    dataset.themes
  );
  const aliasText = joinSearchText(dataset.title, aliasValues);
  const lineageText = joinSearchText(
    dataset.title,
    publisherLabels,
    childVariables.map((variable) => variable.label),
    seriesLabels,
    distributionLineage
  );
  const ontologyText = joinSearchText(
    dataset.title,
    dataset.keywords,
    dataset.themes,
    childVariableFacetValues
  );
  const urlText = joinSearchText(dataset.title, urlValues);

  return stripUndefined({
    entityId: dataset.id,
    entityType: "Dataset" as const,
    primaryLabel: dataset.title,
    secondaryLabel: firstDistinct(dataset.title, dataset.description),
    aliases,
    publisherAgentId: dataset.publisherAgentId,
    datasetId: dataset.id,
    homepageHostname: undefined,
    landingPageHostname,
    measuredProperty: singleDistinctValue(childVariables.map((variable) => variable.measuredProperty)),
    domainObject: singleDistinctValue(childVariables.map((variable) => variable.domainObject)),
    technologyOrFuel: singleDistinctValue(childVariables.map((variable) => variable.technologyOrFuel)),
    statisticType: singleDistinctValue(childVariables.map((variable) => variable.statisticType)),
    aggregation: singleDistinctValue(childVariables.map((variable) => variable.aggregation)),
    unitFamily: singleDistinctValue(childVariables.map((variable) => variable.unitFamily)),
    policyInstrument: singleDistinctValue(childVariables.map((variable) => variable.policyInstrument)),
    canonicalUrls,
    payloadJson: encodeJsonString(dataset),
    primaryText,
    aliasText,
    lineageText,
    urlText,
    ontologyText,
    semanticText: joinSearchText(
      dataset.title,
      primaryText,
      aliasText,
      lineageText,
      urlText,
      ontologyText
    ),
    updatedAt: dataset.updatedAt
  }) as EntitySearchDocument;
};

const projectDistribution = (
  distribution: Distribution,
  graph: SearchGraph
): EntitySearchDocument => {
  const aliases = dedupeAliases(distribution.aliases);
  const dataset = graph.datasetsById.get(distribution.datasetId);
  const childVariables = dataset?.variableIds?.map((variableId) => graph.variablesById.get(variableId))
    .filter((variable): variable is Variable => variable !== undefined) ?? [];
  const childSeries = graph.seriesByDatasetId.get(distribution.datasetId) ?? [];
  const publisherLabels = dataset?.publisherAgentId === undefined
    ? []
    : agentLabels(graph, [dataset.publisherAgentId]);
  const canonicalUrls = toCanonicalUrls(
    distribution.accessURL,
    distribution.downloadURL,
    ...aliases.filter((alias) => alias.scheme === "url").map((alias) => alias.value)
  );
  const accessHostname = toOptionalHostname(distribution.accessURL);
  const downloadHostname = toOptionalHostname(distribution.downloadURL);
  const aliasValues = aliases.map((alias) => alias.value);
  const urlValues = collectUniqueText(
    canonicalUrls,
    accessHostname,
    downloadHostname,
    prefixesForUrls(canonicalUrls)
  );
  const primaryLabel =
    distribution.title ??
    distribution.accessURL ??
    distribution.downloadURL ??
    distribution.id;
  const primaryText = joinSearchText(
    primaryLabel,
    distribution.title,
    distribution.description,
    distribution.kind,
    distribution.mediaType,
    distribution.format
  );
  const aliasText = joinSearchText(primaryLabel, aliasValues);
  const lineageText = joinSearchText(
    primaryLabel,
    dataset?.title,
    publisherLabels,
    childVariables.map((variable) => variable.label),
    childSeries.map((series) => series.label)
  );
  const ontologyText = joinSearchText(
    primaryLabel,
    distribution.kind,
    distribution.mediaType,
    distribution.format,
    variableFacetTexts(childVariables)
  );
  const urlText = joinSearchText(primaryLabel, urlValues);

  return stripUndefined({
    entityId: distribution.id,
    entityType: "Distribution" as const,
    primaryLabel,
    secondaryLabel: firstDistinct(primaryLabel, distribution.description, dataset?.title),
    aliases,
    publisherAgentId: dataset?.publisherAgentId,
    datasetId: distribution.datasetId,
    measuredProperty: singleDistinctValue(childVariables.map((variable) => variable.measuredProperty)),
    domainObject: singleDistinctValue(childVariables.map((variable) => variable.domainObject)),
    technologyOrFuel: singleDistinctValue(childVariables.map((variable) => variable.technologyOrFuel)),
    statisticType: singleDistinctValue(childVariables.map((variable) => variable.statisticType)),
    aggregation: singleDistinctValue(childVariables.map((variable) => variable.aggregation)),
    unitFamily: singleDistinctValue(childVariables.map((variable) => variable.unitFamily)),
    policyInstrument: singleDistinctValue(childVariables.map((variable) => variable.policyInstrument)),
    accessHostname,
    downloadHostname,
    canonicalUrls,
    payloadJson: encodeJsonString(distribution),
    primaryText,
    aliasText,
    lineageText,
    urlText,
    ontologyText,
    semanticText: joinSearchText(
      primaryLabel,
      primaryText,
      aliasText,
      lineageText,
      urlText,
      ontologyText
    ),
    updatedAt: distribution.updatedAt
  }) as EntitySearchDocument;
};

const projectSeries = (
  series: Series,
  graph: SearchGraph
): EntitySearchDocument => {
  const aliases = dedupeAliases(series.aliases);
  const variable = graph.variablesById.get(series.variableId);
  const dataset = series.datasetId === undefined
    ? undefined
    : graph.datasetsById.get(series.datasetId);
  const publisherLabels = dataset?.publisherAgentId === undefined
    ? []
    : agentLabels(graph, [dataset.publisherAgentId]);
  const canonicalUrls = toCanonicalUrls(
    ...aliases.filter((alias) => alias.scheme === "url").map((alias) => alias.value)
  );
  const aliasValues = aliases.map((alias) => alias.value);
  const fixedDimValues = collectUniqueText(
    series.fixedDims.place,
    series.fixedDims.market,
    series.fixedDims.frequency,
    series.fixedDims.sector,
    series.fixedDims.extra
  );
  const primaryText = joinSearchText(series.label, series.label);
  const aliasText = joinSearchText(series.label, aliasValues);
  const lineageText = joinSearchText(
    series.label,
    dataset?.title,
    publisherLabels,
    variable?.label,
    variable?.definition,
    fixedDimValues
  );
  const ontologyText = joinSearchText(
    series.label,
    fixedDimValues,
    variable === undefined
      ? []
      : [
          variable.measuredProperty,
          variable.domainObject,
          variable.technologyOrFuel,
          variable.statisticType,
          variable.aggregation,
          variable.unitFamily,
          variable.policyInstrument
        ]
  );
  const urlText = joinSearchText(series.label, canonicalUrls, prefixesForUrls(canonicalUrls));

  return stripUndefined({
    entityId: series.id,
    entityType: "Series" as const,
    primaryLabel: series.label,
    secondaryLabel: firstDistinct(series.label, dataset?.title, variable?.label),
    aliases,
    publisherAgentId: dataset?.publisherAgentId,
    datasetId: series.datasetId,
    variableId: series.variableId,
    seriesId: series.id,
    measuredProperty: variable?.measuredProperty,
    domainObject: variable?.domainObject,
    technologyOrFuel: variable?.technologyOrFuel,
    statisticType: variable?.statisticType,
    aggregation: variable?.aggregation,
    unitFamily: variable?.unitFamily,
    policyInstrument: variable?.policyInstrument,
    frequency: series.fixedDims.frequency,
    place: series.fixedDims.place,
    market: series.fixedDims.market,
    canonicalUrls,
    payloadJson: encodeJsonString(series),
    primaryText,
    aliasText,
    lineageText,
    urlText,
    ontologyText,
    semanticText: joinSearchText(
      series.label,
      primaryText,
      aliasText,
      lineageText,
      urlText,
      ontologyText
    ),
    updatedAt: series.updatedAt
  }) as EntitySearchDocument;
};

const projectVariable = (
  variable: Variable,
  graph: SearchGraph
): EntitySearchDocument => {
  const aliases = dedupeAliases(variable.aliases);
  const datasets = graph.datasetsByVariableId.get(variable.id) ?? [];
  const series = graph.seriesByVariableId.get(variable.id) ?? [];
  const publisherLabels = agentLabels(
    graph,
    datasets.map((dataset) => dataset.publisherAgentId)
  );
  const relatedDistributions = datasets.flatMap(
    (dataset) => graph.distributionsByDatasetId.get(dataset.id) ?? []
  );
  const distributionHosts = collectUniqueText(
    relatedDistributions.flatMap((distribution) => [
      toOptionalHostname(distribution.accessURL),
      toOptionalHostname(distribution.downloadURL)
    ])
  );
  const canonicalUrls = toCanonicalUrls(
    ...aliases.filter((alias) => alias.scheme === "url").map((alias) => alias.value)
  );
  const aliasValues = aliases.map((alias) => alias.value);
  const primaryText = joinSearchText(variable.label, variable.label, variable.definition);
  const aliasText = joinSearchText(variable.label, aliasValues);
  const lineageText = joinSearchText(
    variable.label,
    datasets.map((dataset) => dataset.title),
    series.map((item) => item.label),
    publisherLabels,
    distributionHosts
  );
  const ontologyText = joinSearchText(
    variable.label,
    variable.measuredProperty,
    variable.domainObject,
    variable.technologyOrFuel,
    variable.statisticType,
    variable.aggregation,
    variable.unitFamily,
    variable.policyInstrument
  );
  const urlText = joinSearchText(variable.label, canonicalUrls, prefixesForUrls(canonicalUrls));

  return stripUndefined({
    entityId: variable.id,
    entityType: "Variable" as const,
    primaryLabel: variable.label,
    secondaryLabel: firstDistinct(variable.label, variable.definition),
    aliases,
    publisherAgentId: uniquePublisherId(datasets),
    datasetId: uniqueDatasetId(datasets),
    variableId: variable.id,
    measuredProperty: variable.measuredProperty,
    domainObject: variable.domainObject,
    technologyOrFuel: variable.technologyOrFuel,
    statisticType: variable.statisticType,
    aggregation: variable.aggregation,
    unitFamily: variable.unitFamily,
    policyInstrument: variable.policyInstrument,
    canonicalUrls,
    payloadJson: encodeJsonString(variable),
    primaryText,
    aliasText,
    lineageText,
    urlText,
    ontologyText,
    semanticText: joinSearchText(
      variable.label,
      primaryText,
      aliasText,
      lineageText,
      urlText,
      ontologyText
    ),
    updatedAt: variable.updatedAt
  }) as EntitySearchDocument;
};

const projectEntitySearchDocument = (
  entity: Agent | Dataset | Distribution | Series | Variable,
  graph: SearchGraph
): EntitySearchDocument => {
  switch (entity._tag) {
    case "Agent":
      return projectAgent(entity, graph);
    case "Dataset":
      return projectDataset(entity, graph);
    case "Distribution":
      return projectDistribution(entity, graph);
    case "Series":
      return projectSeries(entity, graph);
    case "Variable":
      return projectVariable(entity, graph);
  }
};

export const projectEntitySearchDocs = (
  prepared: PreparedDataLayerRegistry
): ReadonlyArray<EntitySearchDocument> => {
  const graph = buildSearchGraph(prepared);

  return [...prepared.entities]
    .filter(isInScopeEntity)
    .map((entity) => projectEntitySearchDocument(entity, graph))
    .sort((left, right) => left.entityId.localeCompare(right.entityId));
};
