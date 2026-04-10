import { Chunk, Option, Order, Result } from "effect";
import type { Agent, Catalog, CatalogRecord, Dataset, DataService, DatasetSeries, Distribution, Series, Variable } from "../domain/data-layer";
import type { AliasScheme, ExternalIdentifier } from "../domain/data-layer/alias";
import type {
  DataLayerRegistryDiagnostic,
  DataLayerRegistryEntity,
  DataLayerRegistryIssue,
  DataLayerRegistrySeed,
  DuplicateCanonicalIdIssue,
  LookupCollisionIssue,
  MissingReferenceIssue,
  SemanticConsistencyIssue
} from "../domain/data-layer/registry";
import {
  buildUrlPrefixes,
  normalizeAliasLookupValue,
  normalizeDistributionHostname,
  normalizeDistributionUrl,
  normalizeLookupText
} from "./normalize";

const distributionOrder = Order.mapInput(
  Order.String,
  (distribution: Distribution) => distribution.id
);

const sortDistributions = (items: Iterable<Distribution>) =>
  Chunk.sort(Chunk.fromIterable(items), distributionOrder);

type RegistryRecord = {
  readonly entity: DataLayerRegistryEntity;
  readonly path: string;
};

export type PreparedDataLayerRegistry = {
  readonly seed: DataLayerRegistrySeed;
  readonly entities: Chunk.Chunk<DataLayerRegistryEntity>;
  readonly entityById: ReadonlyMap<string, DataLayerRegistryEntity>;
  readonly pathById: ReadonlyMap<string, string>;
  readonly agentByLabel: ReadonlyMap<string, Agent>;
  readonly agentByHomepageDomain: ReadonlyMap<string, Agent>;
  readonly datasetByTitle: ReadonlyMap<string, Dataset>;
  readonly datasetByAlias: ReadonlyMap<string, Dataset>;
  readonly variableByAlias: ReadonlyMap<string, Variable>;
  readonly distributionByUrl: ReadonlyMap<string, Distribution>;
  readonly distributionsByHostname: ReadonlyMap<string, Chunk.Chunk<Distribution>>;
  readonly distributionUrlPrefixEntries: ReadonlyArray<{
    readonly prefix: string;
    readonly distribution: Distribution;
  }>;
};

export type DataLayerRegistryLookup = {
  readonly entities: Chunk.Chunk<DataLayerRegistryEntity>;
  readonly findByCanonicalUri: (
    canonicalUri: string
  ) => Option.Option<DataLayerRegistryEntity>;
  readonly findAgentByLabel: (label: string) => Option.Option<Agent>;
  readonly findAgentByHomepageDomain: (domain: string) => Option.Option<Agent>;
  readonly findDatasetByTitle: (title: string) => Option.Option<Dataset>;
  readonly findDatasetByAlias: (
    scheme: AliasScheme,
    value: string
  ) => Option.Option<Dataset>;
  readonly findDistributionByUrl: (
    url: string
  ) => Option.Option<Distribution>;
  readonly findDistributionsByHostname: (
    hostname: string
  ) => Chunk.Chunk<Distribution>;
  readonly findDistributionsByUrlPrefix: (url: string) => Chunk.Chunk<Distribution>;
  readonly findVariableByAlias: (
    scheme: AliasScheme,
    value: string
  ) => Option.Option<Variable>;
};

type PrepareOptions = {
  readonly root?: string;
  readonly pathById?: ReadonlyMap<string, string>;
};

const defaultPathFor = (entity: DataLayerRegistryEntity) => `${entity._tag}:${entity.id}`;

const toRegistryRecords = (
  seed: DataLayerRegistrySeed,
  pathById: ReadonlyMap<string, string>
): ReadonlyArray<RegistryRecord> => {
  const records: Array<RegistryRecord> = [];
  const push = <A extends DataLayerRegistryEntity>(items: ReadonlyArray<A>) => {
    for (const entity of items) {
      records.push({
        entity,
        path: pathById.get(entity.id) ?? defaultPathFor(entity)
      });
    }
  };

  push(seed.agents);
  push(seed.catalogs);
  push(seed.catalogRecords);
  push(seed.datasets);
  push(seed.distributions);
  push(seed.dataServices);
  push(seed.datasetSeries);
  push(seed.variables);
  push(seed.series);

  return records;
};

const pushIssue = <A extends DataLayerRegistryIssue>(
  issues: Array<DataLayerRegistryIssue>,
  issue: A
) => {
  issues.push(issue);
};

const makeMissingReferenceIssue = (
  path: string,
  field: string,
  targetId: string,
  expectedTag: string
): MissingReferenceIssue => ({
  _tag: "MissingReferenceIssue",
  path,
  field,
  targetId,
  expectedTag
});

const makeSemanticConsistencyIssue = (
  path: string,
  message: string
): SemanticConsistencyIssue => ({
  _tag: "SemanticConsistencyIssue",
  path,
  message
});

const makeLookupCollisionIssue = (
  lookup: string,
  key: string,
  entityIds: ReadonlyArray<string>
): LookupCollisionIssue => ({
  _tag: "LookupCollisionIssue",
  lookup,
  key,
  entityIds: [...entityIds].sort((left, right) => left.localeCompare(right))
});

const aliasLookupKey = (scheme: AliasScheme, value: string) =>
  `${scheme}\u0000${normalizeAliasLookupValue(scheme, value)}`;

const checkReference = (
  issues: Array<DataLayerRegistryIssue>,
  path: string,
  field: string,
  targetId: string | undefined,
  expectedTag: DataLayerRegistryEntity["_tag"],
  entityById: ReadonlyMap<string, DataLayerRegistryEntity>
) => {
  if (targetId === undefined) {
    return;
  }

  const target = entityById.get(targetId);
  if (target === undefined) {
    pushIssue(
      issues,
      makeMissingReferenceIssue(path, field, targetId, expectedTag)
    );
    return;
  }

  if (target._tag !== expectedTag) {
    pushIssue(
      issues,
      makeSemanticConsistencyIssue(
        path,
        `${field} points to ${target._tag}, expected ${expectedTag}`
      )
    );
  }
};

const validateReferences = (
  records: ReadonlyArray<RegistryRecord>,
  entityById: ReadonlyMap<string, DataLayerRegistryEntity>
) => {
  const issues: Array<DataLayerRegistryIssue> = [];

  for (const { entity, path } of records) {
    switch (entity._tag) {
      case "Agent":
        checkReference(issues, path, "parentAgentId", entity.parentAgentId, "Agent", entityById);
        break;
      case "Catalog":
        checkReference(issues, path, "publisherAgentId", entity.publisherAgentId, "Agent", entityById);
        break;
      case "CatalogRecord": {
        checkReference(issues, path, "catalogId", entity.catalogId, "Catalog", entityById);
        const expectedTag = entity.primaryTopicType === "dataset" ? "Dataset" : "DataService";
        checkReference(
          issues,
          path,
          "primaryTopicId",
          entity.primaryTopicId,
          expectedTag,
          entityById
        );
        checkReference(
          issues,
          path,
          "duplicateOf",
          entity.duplicateOf,
          "CatalogRecord",
          entityById
        );
        break;
      }
      case "Dataset":
        checkReference(issues, path, "publisherAgentId", entity.publisherAgentId, "Agent", entityById);
        checkReference(issues, path, "inSeries", entity.inSeries, "DatasetSeries", entityById);
        for (const distributionId of entity.distributionIds ?? []) {
          checkReference(issues, path, "distributionIds", distributionId, "Distribution", entityById);
          const distribution = entityById.get(distributionId);
          if (distribution !== undefined && distribution._tag === "Distribution" && distribution.datasetId !== entity.id) {
            pushIssue(
              issues,
              makeSemanticConsistencyIssue(
                path,
                `distribution ${distributionId} belongs to dataset ${distribution.datasetId}, not ${entity.id}`
              )
            );
          }
        }
        for (const serviceId of entity.dataServiceIds ?? []) {
          checkReference(issues, path, "dataServiceIds", serviceId, "DataService", entityById);
        }
        break;
      case "Distribution":
        checkReference(issues, path, "datasetId", entity.datasetId, "Dataset", entityById);
        checkReference(
          issues,
          path,
          "accessServiceId",
          entity.accessServiceId,
          "DataService",
          entityById
        );
        break;
      case "DataService":
        checkReference(issues, path, "publisherAgentId", entity.publisherAgentId, "Agent", entityById);
        for (const datasetId of entity.servesDatasetIds) {
          checkReference(issues, path, "servesDatasetIds", datasetId, "Dataset", entityById);
        }
        break;
      case "DatasetSeries":
        checkReference(issues, path, "publisherAgentId", entity.publisherAgentId, "Agent", entityById);
        break;
      case "Variable":
        break;
      case "Series":
        checkReference(issues, path, "variableId", entity.variableId, "Variable", entityById);
        break;
    }
  }

  return issues;
};

const collectDuplicateIdIssues = (records: ReadonlyArray<RegistryRecord>) => {
  const pathsById = new Map<string, Array<string>>();

  for (const record of records) {
    const current = pathsById.get(record.entity.id) ?? [];
    current.push(record.path);
    pathsById.set(record.entity.id, current);
  }

  const issues: Array<DuplicateCanonicalIdIssue> = [];
  for (const [canonicalId, paths] of pathsById) {
    if (paths.length > 1) {
      issues.push({
        _tag: "DuplicateCanonicalIdIssue",
        canonicalId,
        paths: [...paths].sort((left, right) => left.localeCompare(right))
      });
    }
  }

  return issues;
};

const registerExactLookup = <A extends { readonly id: string }>(
  issues: Array<DataLayerRegistryIssue>,
  lookupName: string,
  map: Map<string, A>,
  key: string,
  entity: A
) => {
  const existing = map.get(key);
  if (existing !== undefined && existing.id !== entity.id) {
    pushIssue(
      issues,
      makeLookupCollisionIssue(lookupName, key, [existing.id, entity.id])
    );
    return;
  }

  map.set(key, entity);
};

const registerManyLookup = <A extends { readonly id: string }>(
  map: Map<string, Array<A>>,
  key: string,
  entity: A
) => {
  const existing = map.get(key) ?? [];
  if (!existing.some((item) => item.id === entity.id)) {
    existing.push(entity);
  }
  map.set(key, existing);
};

const collectEntityUrls = (distribution: Distribution) => {
  const urls = new Set<string>();
  if (distribution.accessURL !== undefined) {
    urls.add(distribution.accessURL);
  }
  if (distribution.downloadURL !== undefined) {
    urls.add(distribution.downloadURL);
  }
  for (const alias of distribution.aliases) {
    if (alias.scheme === "url") {
      urls.add(alias.value);
    }
  }
  return [...urls];
};

const distributionPathSegmentCount = (normalizedUrl: string) =>
  normalizedUrl.split("/").filter((segment) => segment.length > 0).length - 1;

const isExactDistributionUrl = (
  distribution: Distribution,
  normalizedUrl: string
) =>
  (distribution.kind === "api-access" || distribution.kind === "download") &&
  distributionPathSegmentCount(normalizedUrl) >= 2;

const buildPreparedRegistry = (
  seed: DataLayerRegistrySeed,
  records: ReadonlyArray<RegistryRecord>,
  root: string
): Result.Result<PreparedDataLayerRegistry, DataLayerRegistryDiagnostic> => {
  const duplicateIdIssues = collectDuplicateIdIssues(records);
  if (duplicateIdIssues.length > 0) {
    return Result.fail({
      root,
      issues: duplicateIdIssues
    });
  }

  const entityById = new Map<string, DataLayerRegistryEntity>();
  const pathById = new Map<string, string>();
  for (const record of records) {
    entityById.set(record.entity.id, record.entity);
    pathById.set(record.entity.id, record.path);
  }

  const issues = validateReferences(records, entityById);
  const agentByLabel = new Map<string, Agent>();
  const agentByHomepageDomain = new Map<string, Agent>();
  const datasetByTitle = new Map<string, Dataset>();
  const datasetByAlias = new Map<string, Dataset>();
  const variableByAlias = new Map<string, Variable>();
  const distributionByUrl = new Map<string, Distribution>();
  const distributionsByHostname = new Map<string, Array<Distribution>>();
  const distributionUrlPrefixEntries: Array<{
    readonly prefix: string;
    readonly distribution: Distribution;
  }> = [];

  for (const agent of seed.agents) {
    registerExactLookup(
      issues,
      "agent-label",
      agentByLabel,
      normalizeLookupText(agent.name),
      agent
    );
    for (const alternateName of agent.alternateNames ?? []) {
      registerExactLookup(
        issues,
        "agent-label",
        agentByLabel,
        normalizeLookupText(alternateName),
        agent
      );
    }
    if (agent.homepage !== undefined) {
      const homepageDomain = normalizeDistributionHostname(agent.homepage);
      if (homepageDomain !== null) {
        registerExactLookup(
          issues,
          "agent-homepage-domain",
          agentByHomepageDomain,
          homepageDomain,
          agent
        );
      }
    }
  }

  for (const dataset of seed.datasets) {
    registerExactLookup(
      issues,
      "dataset-title",
      datasetByTitle,
      normalizeLookupText(dataset.title),
      dataset
    );
    for (const alias of dataset.aliases) {
      registerExactLookup(
        issues,
        "dataset-alias",
        datasetByAlias,
        aliasLookupKey(alias.scheme, alias.value),
        dataset
      );
    }
  }

  for (const variable of seed.variables) {
    for (const alias of variable.aliases) {
      registerExactLookup(
        issues,
        "variable-alias",
        variableByAlias,
        aliasLookupKey(alias.scheme, alias.value),
        variable
      );
    }
  }

  for (const distribution of seed.distributions) {
    for (const rawUrl of collectEntityUrls(distribution)) {
      const normalizedUrl = normalizeDistributionUrl(rawUrl);
      const normalizedHostname = normalizeDistributionHostname(rawUrl);

      if (normalizedUrl !== null) {
        if (isExactDistributionUrl(distribution, normalizedUrl)) {
          registerExactLookup(
            issues,
            "distribution-url",
            distributionByUrl,
            normalizedUrl,
            distribution
          );
        }

        for (const prefix of buildUrlPrefixes(normalizedUrl)) {
          distributionUrlPrefixEntries.push({ prefix, distribution });
        }
      }

      if (normalizedHostname !== null) {
        registerManyLookup(
          distributionsByHostname,
          normalizedHostname,
          distribution
        );
      }
    }
  }

  if (issues.length > 0) {
    return Result.fail({ root, issues });
  }

  const sortedPrefixEntries = [...distributionUrlPrefixEntries].sort(
    (left, right) => {
      const byLength = right.prefix.length - left.prefix.length;
      if (byLength !== 0) {
        return byLength;
      }

      return left.distribution.id.localeCompare(right.distribution.id);
    }
  );

  return Result.succeed({
    seed,
    entities: Chunk.fromIterable([...entityById.values()]),
    entityById,
    pathById,
    agentByLabel,
    agentByHomepageDomain,
    datasetByTitle,
    datasetByAlias,
    variableByAlias,
    distributionByUrl,
    distributionsByHostname: new Map(
      [...distributionsByHostname.entries()].map(([key, value]) => [
        key,
        sortDistributions(value)
      ])
    ),
    distributionUrlPrefixEntries: sortedPrefixEntries
  });
};

export const prepareDataLayerRegistry = (
  seed: DataLayerRegistrySeed,
  options: PrepareOptions = {}
): Result.Result<PreparedDataLayerRegistry, DataLayerRegistryDiagnostic> => {
  const root = options.root ?? "manual-seed";
  const pathById = options.pathById ?? new Map<string, string>();
  const records = toRegistryRecords(seed, pathById);
  return buildPreparedRegistry(seed, records, root);
};

export const toDataLayerRegistryLookup = (
  prepared: PreparedDataLayerRegistry
): DataLayerRegistryLookup => ({
  entities: prepared.entities,
  findByCanonicalUri: (canonicalUri) =>
    Option.fromNullishOr(prepared.entityById.get(canonicalUri)),
  findAgentByLabel: (label) =>
    Option.fromNullishOr(prepared.agentByLabel.get(normalizeLookupText(label))),
  findAgentByHomepageDomain: (domain) =>
    Option.fromNullishOr(
      prepared.agentByHomepageDomain.get(
        normalizeDistributionHostname(domain) ?? normalizeLookupText(domain)
      )
    ),
  findDatasetByTitle: (title) =>
    Option.fromNullishOr(prepared.datasetByTitle.get(normalizeLookupText(title))),
  findDatasetByAlias: (scheme, value) =>
    Option.fromNullishOr(
      prepared.datasetByAlias.get(aliasLookupKey(scheme, value))
    ),
  findDistributionByUrl: (url) => {
    const normalized = normalizeDistributionUrl(url);
    return normalized === null
      ? Option.none()
      : Option.fromNullishOr(prepared.distributionByUrl.get(normalized));
  },
  findDistributionsByHostname: (hostname) => {
    const normalized = normalizeDistributionHostname(hostname);
    return normalized === null
      ? Chunk.empty()
      : prepared.distributionsByHostname.get(normalized) ?? Chunk.empty();
  },
  findDistributionsByUrlPrefix: (url) => {
    const normalized = normalizeDistributionUrl(url);
    if (normalized === null) {
      return Chunk.empty();
    }

    const matches: Array<Distribution> = [];
    const seen = new Set<string>();
    for (const entry of prepared.distributionUrlPrefixEntries) {
      if (!normalized.startsWith(entry.prefix) || seen.has(entry.distribution.id)) {
        continue;
      }

      seen.add(entry.distribution.id);
      matches.push(entry.distribution);
    }

    return sortDistributions(matches);
  },
  findVariableByAlias: (scheme, value) =>
    Option.fromNullishOr(
      prepared.variableByAlias.get(aliasLookupKey(scheme, value))
    )
});

export const formatDataLayerRegistryDiagnostic = (
  diagnostic: DataLayerRegistryDiagnostic
) => {
  const lines = [
    `Data layer registry validation failed for ${diagnostic.root}`,
    ...diagnostic.issues.map((issue) => {
      switch (issue._tag) {
        case "FileReadIssue":
          return `- ${issue.path}: read failed — ${issue.message}`;
        case "JsonParseIssue":
          return `- ${issue.path}: invalid JSON — ${issue.message}`;
        case "TagMismatchIssue":
          return `- ${issue.path}: expected ${issue.expectedTag}, found ${issue.actualTag ?? "missing _tag"}`;
        case "SchemaDecodeIssue":
          return `- ${issue.path}: ${issue.entityTag} decode failed — ${issue.message}`;
        case "DuplicateCanonicalIdIssue":
          return `- duplicate id ${issue.canonicalId}: ${issue.paths.join(", ")}`;
        case "MissingReferenceIssue":
          return `- ${issue.path}: ${issue.field} -> ${issue.targetId} missing (${issue.expectedTag})`;
        case "SemanticConsistencyIssue":
          return `- ${issue.path}: ${issue.message}`;
        case "LookupCollisionIssue":
          return `- ${issue.lookup} collision on "${issue.key}": ${issue.entityIds.join(", ")}`;
      }
    })
  ];

  return lines.join("\n");
};
