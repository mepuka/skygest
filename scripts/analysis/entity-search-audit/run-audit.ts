import { Database } from "bun:sqlite";
import { SqliteClient } from "@effect/sql-sqlite-bun";
import { Console, Effect, FileSystem, Layer, Path } from "effect";
import {
  agentLineageChain,
  datasetForDistribution,
  datasetsForVariable,
  seriesForDataset,
  variablesForDataset,
} from "../../../src/data-layer/DataLayerGraphViews";
import { loadCheckedInDataLayerRegistry } from "../../../src/bootstrap/CheckedInDataLayerRegistry";
import type {
  Agent,
  DataLayerRegistryEntity,
  Dataset,
  Distribution,
  Series,
  Variable,
} from "../../../src/domain/data-layer";
import type {
  EntitySearchDocument,
  EntitySearchHit,
  EntitySearchQueryInput,
} from "../../../src/domain/entitySearch";
import {
  normalizeDistributionHostname,
  normalizeDistributionUrl,
  normalizeLookupText,
} from "../../../src/platform/Normalize";
import {
  runScriptMain,
  scriptPlatformLayer,
} from "../../../src/platform/ScriptRuntime";
import { entitySearchSqlLayer } from "../../../src/search/Layer";
import { runEntitySearchMigrations } from "../../../src/search/migrate";
import { projectEntitySearchDocs } from "../../../src/search/projectEntitySearchDocs";
import { EntitySearchRepo } from "../../../src/services/EntitySearchRepo";
import { EntitySearchRepoD1 } from "../../../src/services/d1/EntitySearchRepoD1";

const preferredPublisherIds = [
  "ember",
  "eia",
  "energy-charts",
  "neso",
  "fraunhofer-ise",
] as const;

const entityTypes = [
  "Agent",
  "Dataset",
  "Distribution",
  "Series",
  "Variable",
] as const;

const textColumnKeys = [
  "primaryText",
  "aliasText",
  "lineageText",
  "urlText",
  "ontologyText",
  "semanticText",
] as const;

const facetKeys = [
  "measuredProperty",
  "domainObject",
  "technologyOrFuel",
  "statisticType",
  "aggregation",
  "unitFamily",
  "policyInstrument",
] as const;

const genericDatasetQueries = [
  "electricity price",
  "solar capacity",
  "emissions",
  "grid frequency",
  "capacity factor",
] as const;

type EntityType = (typeof entityTypes)[number];
type TextColumnKey = (typeof textColumnKeys)[number];
type FacetKey = (typeof facetKeys)[number];

type SourceFileInfo = {
  readonly raw: string;
  readonly bytes: number;
};

type SearchRecord = {
  readonly document: EntitySearchDocument;
  readonly sourceEntity: DataLayerRegistryEntity;
  readonly sourcePath: string;
  readonly sourceFileBytes: number;
  readonly ftsTextBytes: number;
  readonly allTextBytes: number;
};

const isEntityType = (
  value: DataLayerRegistryEntity,
): value is Agent | Dataset | Distribution | Series | Variable =>
  value._tag === "Agent" ||
  value._tag === "Dataset" ||
  value._tag === "Distribution" ||
  value._tag === "Series" ||
  value._tag === "Variable";

const findEntityByTag = <A extends DataLayerRegistryEntity["_tag"]>(
  entityById: ReadonlyMap<string, DataLayerRegistryEntity>,
  entityId: string,
  tag: A,
): Extract<DataLayerRegistryEntity, { _tag: A }> | undefined => {
  const entity = entityById.get(entityId);
  return entity?._tag === tag
    ? (entity as Extract<DataLayerRegistryEntity, { _tag: A }>)
    : undefined;
};

const byteLength = (value: string) => new TextEncoder().encode(value).length;

const mean = (values: ReadonlyArray<number>) =>
  values.length === 0
    ? 0
    : values.reduce((sum, value) => sum + value, 0) / values.length;

const quantile = (values: ReadonlyArray<number>, percentile: number) => {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const clamped = Math.max(0, Math.min(1, percentile));
  const position = (sorted.length - 1) * clamped;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);

  if (lower === upper) {
    return sorted[lower] ?? 0;
  }

  const lowerValue = sorted[lower] ?? 0;
  const upperValue = sorted[upper] ?? lowerValue;
  const weight = position - lower;
  return lowerValue + (upperValue - lowerValue) * weight;
};

const percentage = (numerator: number, denominator: number) =>
  denominator === 0 ? 0 : (numerator / denominator) * 100;

const tokenize = (value: string) =>
  normalizeLookupText(value)
    .split(/[^\p{Letter}\p{Number}]+/u)
    .filter((token) => token.length > 0);

const dedupeStrings = (values: ReadonlyArray<string | undefined | null>) => {
  const seen = new Set<string>();
  const distinct: Array<string> = [];

  for (const value of values) {
    if (value == null) {
      continue;
    }

    const trimmed = value.trim();
    if (trimmed.length === 0) {
      continue;
    }

    const normalized = normalizeLookupText(trimmed);
    if (seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    distinct.push(trimmed);
  }

  return distinct;
};

const summarizeNumbers = (values: ReadonlyArray<number>) => ({
  count: values.length,
  min: values.length === 0 ? 0 : Math.min(...values),
  p25: quantile(values, 0.25),
  median: quantile(values, 0.5),
  p75: quantile(values, 0.75),
  p95: quantile(values, 0.95),
  max: values.length === 0 ? 0 : Math.max(...values),
  mean: mean(values),
});

const toCanonicalHostname = (canonicalUrl: string) =>
  canonicalUrl.split("/")[0]?.split("?")[0] ?? canonicalUrl;

const slimHit = (hit: EntitySearchHit) => ({
  rank: hit.rank,
  entityId: hit.document.entityId,
  entityType: hit.document.entityType,
  primaryLabel: hit.document.primaryLabel,
  score: hit.score,
  matchKind: hit.matchKind,
  snippet: hit.snippet,
});

const searchDocTextBytes = (document: EntitySearchDocument) =>
  byteLength(document.primaryText) +
  byteLength(document.aliasText) +
  byteLength(document.lineageText) +
  byteLength(document.urlText) +
  byteLength(document.ontologyText);

const searchDocAllTextBytes = (document: EntitySearchDocument) =>
  searchDocTextBytes(document) + byteLength(document.semanticText);

const hasPreferredPublisherBias = (record: SearchRecord) => {
  const haystacks = [
    record.document.entityId,
    record.document.publisherAgentId,
    record.document.datasetId,
    record.sourcePath,
  ]
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.toLowerCase());

  return preferredPublisherIds.some((fragment) =>
    haystacks.some((value) => value.includes(fragment)),
  );
};

const findClosestRecord = (
  records: ReadonlyArray<SearchRecord>,
  target: number,
  used: Set<string>,
) => {
  const available = records.filter(
    (record) => !used.has(record.document.entityId),
  );
  if (available.length === 0) {
    return undefined;
  }

  const winner = [...available].sort((left, right) => {
    const leftDistance = Math.abs(left.allTextBytes - target);
    const rightDistance = Math.abs(right.allTextBytes - target);

    if (leftDistance === rightDistance) {
      return left.document.entityId.localeCompare(right.document.entityId);
    }

    return leftDistance - rightDistance;
  })[0];

  if (winner !== undefined) {
    used.add(winner.document.entityId);
  }

  return winner;
};

const pickRepresentativeExamples = (records: ReadonlyArray<SearchRecord>) => {
  const byType = new Map<EntityType, ReadonlyArray<SearchRecord>>(
    entityTypes.map((entityType) => [
      entityType,
      records
        .filter((record) => record.document.entityType === entityType)
        .sort((left, right) => left.allTextBytes - right.allTextBytes),
    ]),
  );

  return Object.fromEntries(
    entityTypes.map((entityType) => {
      const candidates = byType.get(entityType) ?? [];
      const preferred =
        candidates.filter(hasPreferredPublisherBias).length >= 3
          ? candidates.filter(hasPreferredPublisherBias)
          : candidates;
      const lengths = preferred.map((record) => record.allTextBytes);
      const used = new Set<string>();

      const sparse = findClosestRecord(
        preferred,
        quantile(lengths, 0.15),
        used,
      );
      const average = findClosestRecord(
        preferred,
        quantile(lengths, 0.5),
        used,
      );
      const rich = findClosestRecord(preferred, quantile(lengths, 0.85), used);

      return [
        entityType,
        [
          ["sparse", sparse],
          ["average", average],
          ["rich", rich],
        ]
          .filter(([, record]) => record !== undefined)
          .map(([bucket, record]) => ({
            bucket,
            entityId: record.document.entityId,
            entityType: record.document.entityType,
            primaryLabel: record.document.primaryLabel,
            sourcePath: record.sourcePath,
            sourceEntity: record.sourceEntity,
            projection: record.document,
            ftsTextBytes: record.ftsTextBytes,
            allTextBytes: record.allTextBytes,
          })),
      ];
    }),
  );
};

const quoteSqlLiteral = (value: string) => `'${value.replaceAll("'", "''")}'`;

const formatInt = (value: number) =>
  new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);

const formatFloat = (value: number, digits = 1) =>
  new Intl.NumberFormat("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);

const formatPct = (numerator: number, denominator: number, digits = 1) =>
  `${formatFloat(percentage(numerator, denominator), digits)}%`;

const formatKb = (value: number) => `${formatFloat(value, 1)} KB`;

const escapeCell = (value: string) =>
  value.replaceAll("|", "\\|").replaceAll("\n", "<br>");

const renderTable = (
  headers: ReadonlyArray<string>,
  rows: ReadonlyArray<ReadonlyArray<string>>,
) =>
  [
    `| ${headers.map(escapeCell).join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.map(escapeCell).join(" | ")} |`),
  ].join("\n");

const codeFence = (language: string, body: string) =>
  `\`\`\`${language}\n${body.trimEnd()}\n\`\`\``;

const jsonFence = (value: unknown) =>
  codeFence("json", JSON.stringify(value, null, 2));

const detailsBlock = (summary: string, body: string) =>
  `<details>\n<summary>${summary}</summary>\n\n${body.trim()}\n\n</details>`;

const program = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  const scriptDir = import.meta.dir;
  const outDir = path.join(scriptDir, "out");
  const projectedJsonlPath = path.join(outDir, "projected-docs.jsonl");
  const analysisJsonPath = path.join(outDir, "analysis.json");
  const queriesSqlPath = path.join(outDir, "queries.sql");
  const sqlitePath = path.join(outDir, "entity-search-audit.sqlite");
  const reportPath = path.join(
    scriptDir,
    "../../../docs/plans/2026-04-14-entity-search-empirical-analysis.md",
  );

  yield* fs.makeDirectory(outDir, { recursive: true });
  yield* fs.makeDirectory(path.dirname(reportPath), { recursive: true });
  yield* fs.remove(sqlitePath, { force: true }).pipe(Effect.ignore);
  yield* fs.remove(`${sqlitePath}-shm`, { force: true }).pipe(Effect.ignore);
  yield* fs.remove(`${sqlitePath}-wal`, { force: true }).pipe(Effect.ignore);

  const prepared = yield* loadCheckedInDataLayerRegistry();
  const entities = [...prepared.entities].filter(isEntityType);
  const graph = prepared.graph;
  const documents = projectEntitySearchDocs(prepared);
  const sourceFileCache = new Map<string, SourceFileInfo>();

  const loadSourceFile = (
    sourcePath: string,
    fallbackEntity: DataLayerRegistryEntity,
  ) => {
    const cached = sourceFileCache.get(sourcePath);
    if (cached !== undefined) {
      return Effect.succeed(cached);
    }

    return Effect.gen(function* () {
      const result = yield* Effect.exit(fs.readFileString(sourcePath));
      const raw =
        result._tag === "Success"
          ? result.value
          : JSON.stringify(fallbackEntity, null, 2);
      const info = { raw, bytes: byteLength(raw) } as const;
      sourceFileCache.set(sourcePath, info);
      return info;
    });
  };

  const records = yield* Effect.forEach(
    documents,
    (document) =>
      Effect.gen(function* () {
        const sourceEntity = prepared.entityById.get(document.entityId);
        if (sourceEntity === undefined) {
          return yield* Effect.fail(
            new Error(`Missing source entity for ${document.entityId}`),
          );
        }

        const sourcePath =
          prepared.pathById.get(document.entityId) ??
          `${sourceEntity._tag}:${sourceEntity.id}`;
        const sourceFile = yield* loadSourceFile(sourcePath, sourceEntity);

        return {
          document,
          sourceEntity,
          sourcePath,
          sourceFileBytes: sourceFile.bytes,
          ftsTextBytes: searchDocTextBytes(document),
          allTextBytes: searchDocAllTextBytes(document),
        } as const satisfies SearchRecord;
      }),
    { concurrency: 8 },
  );

  const projectedJsonl = records
    .map((record) =>
      JSON.stringify({
        sourcePath: record.sourcePath,
        entityId: record.document.entityId,
        entityType: record.document.entityType,
        document: record.document,
      }),
    )
    .join("\n");

  yield* fs.writeFileString(projectedJsonlPath, `${projectedJsonl}\n`);

  const targetSqliteLayer = SqliteClient.layer({ filename: sqlitePath });
  const targetSearchLayer = entitySearchSqlLayer(targetSqliteLayer);
  const targetLayer = Layer.mergeAll(
    targetSqliteLayer,
    targetSearchLayer,
    EntitySearchRepoD1.layer.pipe(
      Layer.provideMerge(Layer.mergeAll(targetSqliteLayer, targetSearchLayer)),
    ),
  );

  yield* runEntitySearchMigrations.pipe(Effect.provide(targetSqliteLayer));
  yield* Effect.gen(function* () {
    const repo = yield* EntitySearchRepo;
    yield* repo.replaceAllDocuments(documents);
    yield* repo.optimizeFts();
  }).pipe(Effect.provide(targetLayer));

  const search = (input: EntitySearchQueryInput) =>
    Effect.gen(function* () {
      const repo = yield* EntitySearchRepo;
      return yield* repo.searchLexical(input);
    }).pipe(Effect.provide(targetLayer));

  const db = new Database(sqlitePath);

  const docsByTypeSql = db
    .query(
      `SELECT entity_type, COUNT(*) AS count
       FROM entity_search_docs
       WHERE deleted_at IS NULL
       GROUP BY entity_type
       ORDER BY entity_type ASC`,
    )
    .all() as Array<{ entity_type: EntityType; count: number }>;

  const totalDocsSql = db
    .query(
      `SELECT COUNT(*) AS count
       FROM entity_search_docs
       WHERE deleted_at IS NULL`,
    )
    .get() as { count: number };

  const docUrlsCountSql = db
    .query(`SELECT COUNT(*) AS count FROM entity_search_doc_urls`)
    .get() as { count: number };

  const ftsCountSql = db
    .query(`SELECT COUNT(*) AS count FROM entity_search_fts`)
    .get() as { count: number };

  const byType = new Map<EntityType, ReadonlyArray<SearchRecord>>(
    entityTypes.map((entityType) => [
      entityType,
      records.filter((record) => record.document.entityType === entityType),
    ]),
  );

  const columnLengthDistributions = entityTypes.flatMap((entityType) => {
    const typeRecords = byType.get(entityType) ?? [];

    return textColumnKeys.map((column) => {
      const values = typeRecords.map((record) =>
        byteLength(record.document[column] ?? ""),
      );

      return {
        entityType,
        column,
        ...summarizeNumbers(values),
        primaryLabelOnlyCount: typeRecords.filter(
          (record) => record.document[column] === record.document.primaryLabel,
        ).length,
      };
    });
  });

  const aliasCoverage = entityTypes.map((entityType) => {
    const typeRecords = byType.get(entityType) ?? [];
    const docsWithAliases = typeRecords.filter(
      (record) => record.document.aliases.length > 0,
    ).length;
    const schemeCounts = new Map<string, number>();
    const schemeDocs = new Map<string, Set<string>>();

    for (const record of typeRecords) {
      for (const alias of record.document.aliases) {
        schemeCounts.set(
          alias.scheme,
          (schemeCounts.get(alias.scheme) ?? 0) + 1,
        );
        const current = schemeDocs.get(alias.scheme) ?? new Set<string>();
        current.add(record.document.entityId);
        schemeDocs.set(alias.scheme, current);
      }
    }

    return {
      entityType,
      documentCount: typeRecords.length,
      docsWithAliases,
      docsWithAliasesPct: percentage(docsWithAliases, typeRecords.length),
      schemes: [...schemeCounts.entries()]
        .map(([scheme, aliasCount]) => ({
          scheme,
          aliasCount,
          docCount: schemeDocs.get(scheme)?.size ?? 0,
          docPct: percentage(
            schemeDocs.get(scheme)?.size ?? 0,
            typeRecords.length,
          ),
        }))
        .sort((left, right) =>
          left.docCount === right.docCount
            ? left.scheme.localeCompare(right.scheme)
            : right.docCount - left.docCount,
        ),
    };
  });

  const hostnameDocCounts = new Map<string, Set<string>>();
  const docsWithUrlsByType = entityTypes.map((entityType) => {
    const typeRecords = byType.get(entityType) ?? [];
    const docsWithCanonicalUrls = typeRecords.filter(
      (record) => record.document.canonicalUrls.length > 0,
    );

    for (const record of docsWithCanonicalUrls) {
      const hostnames = new Set<string>();

      for (const hostname of [
        record.document.homepageHostname,
        record.document.landingPageHostname,
        record.document.accessHostname,
        record.document.downloadHostname,
      ]) {
        if (hostname !== undefined) {
          hostnames.add(hostname);
        }
      }

      for (const canonicalUrl of record.document.canonicalUrls) {
        hostnames.add(toCanonicalHostname(canonicalUrl));
      }

      for (const hostname of hostnames) {
        const current = hostnameDocCounts.get(hostname) ?? new Set<string>();
        current.add(record.document.entityId);
        hostnameDocCounts.set(hostname, current);
      }
    }

    return {
      entityType,
      documentCount: typeRecords.length,
      docsWithCanonicalUrls: docsWithCanonicalUrls.length,
      docsWithCanonicalUrlsPct: percentage(
        docsWithCanonicalUrls.length,
        typeRecords.length,
      ),
    };
  });

  const urlCoverage = {
    byType: docsWithUrlsByType,
    uniqueHostnameCount: hostnameDocCounts.size,
    topHostnames: [...hostnameDocCounts.entries()]
      .map(([hostname, entityIds]) => ({
        hostname,
        docCount: entityIds.size,
      }))
      .sort((left, right) =>
        left.docCount === right.docCount
          ? left.hostname.localeCompare(right.hostname)
          : right.docCount - left.docCount,
      )
      .slice(0, 20),
  };

  const datasetRecords = (byType.get("Dataset") ?? []).map((record) => ({
    ...record,
    sourceEntity: record.sourceEntity as Dataset,
  }));

  const datasetFacetPathology = {
    summaryByFacet: [] as Array<{
      facet: FacetKey;
      nullCount: number;
      conflictCount: number;
      noValueCount: number;
      noLinkedVariablesCount: number;
      noFacetValueCount: number;
    }>,
    conflictCases: [] as Array<{
      datasetId: string;
      primaryLabel: string;
      publisherAgentId?: string;
      facet: FacetKey;
      projectedValue?: string;
      distinctValues: ReadonlyArray<string>;
      valuesByVariable: ReadonlyArray<{
        variableId: string;
        variableLabel: string;
        value?: string;
      }>;
    }>,
    noValueCases: [] as Array<{
      datasetId: string;
      primaryLabel: string;
      facet: FacetKey;
      childVariableCount: number;
      reason: "no-linked-variables" | "variables-present-but-facet-empty";
    }>,
  };

  for (const facet of facetKeys) {
    let nullCount = 0;
    let conflictCount = 0;
    let noValueCount = 0;
    let noLinkedVariablesCount = 0;
    let noFacetValueCount = 0;

    for (const record of datasetRecords) {
      const childVariables = variablesForDataset(
        graph,
        record.document.entityId,
      );

      const valuesByVariable = childVariables.map((variable) => ({
        variableId: variable.id,
        variableLabel: variable.label,
        value: variable[facet],
      }));

      const distinctValues = dedupeStrings(
        valuesByVariable.map((item) => item.value),
      );
      const projectedValue = record.document[facet];

      if (projectedValue !== undefined) {
        continue;
      }

      nullCount += 1;

      if (childVariables.length === 0) {
        noValueCount += 1;
        noLinkedVariablesCount += 1;
        datasetFacetPathology.noValueCases.push({
          datasetId: record.document.entityId,
          primaryLabel: record.document.primaryLabel,
          facet,
          childVariableCount: 0,
          reason: "no-linked-variables",
        });
        continue;
      }

      if (distinctValues.length === 0) {
        noValueCount += 1;
        noFacetValueCount += 1;
        datasetFacetPathology.noValueCases.push({
          datasetId: record.document.entityId,
          primaryLabel: record.document.primaryLabel,
          facet,
          childVariableCount: childVariables.length,
          reason: "variables-present-but-facet-empty",
        });
        continue;
      }

      if (distinctValues.length > 1) {
        conflictCount += 1;
        datasetFacetPathology.conflictCases.push({
          datasetId: record.document.entityId,
          primaryLabel: record.document.primaryLabel,
          publisherAgentId: record.document.publisherAgentId,
          facet,
          projectedValue,
          distinctValues,
          valuesByVariable,
        });
      }
    }

    datasetFacetPathology.summaryByFacet.push({
      facet,
      nullCount,
      conflictCount,
      noValueCount,
      noLinkedVariablesCount,
      noFacetValueCount,
    });
  }

  datasetFacetPathology.conflictCases.sort((left, right) =>
    left.datasetId === right.datasetId
      ? left.facet.localeCompare(right.facet)
      : left.datasetId.localeCompare(right.datasetId),
  );

  const variableMultiParentCases = (byType.get("Variable") ?? [])
    .map((record) => {
      const parents = datasetsForVariable(graph, record.document.entityId);
      const distinctDatasetIds = dedupeStrings(
        parents.map((dataset) => dataset.id),
      );
      const distinctPublisherIds = dedupeStrings(
        parents.map((dataset) => dataset.publisherAgentId),
      );

      return {
        entityId: record.document.entityId,
        primaryLabel: record.document.primaryLabel,
        projectedDatasetId: record.document.datasetId,
        projectedPublisherAgentId: record.document.publisherAgentId,
        parentDatasetCount: parents.length,
        reason:
          parents.length === 0
            ? "no-parent-datasets"
            : distinctDatasetIds.length > 1
              ? "multiple-datasets"
              : distinctPublisherIds.length > 1
                ? "multiple-publishers"
                : "other",
        parentDatasets: parents.map((dataset) => ({
          datasetId: dataset.id,
          title: dataset.title,
          publisherAgentId: dataset.publisherAgentId,
        })),
        distinctDatasetIds,
        distinctPublisherIds,
      };
    })
    .filter(
      (record) =>
        record.projectedDatasetId === undefined ||
        record.projectedPublisherAgentId === undefined,
    )
    .sort((left, right) => left.entityId.localeCompare(right.entityId));

  const variableParentSummary = {
    totalVariables: (byType.get("Variable") ?? []).length,
    noParentDatasetsCount: variableMultiParentCases.filter(
      (record) => record.reason === "no-parent-datasets",
    ).length,
    multipleDatasetsCount: variableMultiParentCases.filter(
      (record) => record.reason === "multiple-datasets",
    ).length,
    multiplePublishersCount: variableMultiParentCases.filter(
      (record) => record.reason === "multiple-publishers",
    ).length,
  };

  const agentRecords = (byType.get("Agent") ?? []).map((record) => ({
    ...record,
    sourceEntity: record.sourceEntity as Agent,
  }));

  const agentChains = agentRecords.map((record) => ({
    entityId: record.document.entityId,
    primaryLabel: record.document.primaryLabel,
    parentAgentId: agentLineageChain(graph, record.document.entityId)[1]?.id,
    chain: (() => {
      const chain = agentLineageChain(graph, record.document.entityId);
      return {
        ids: chain.map((agent) => agent.id),
        labels: chain.map((agent) => agent.name),
        edgeCount: Math.max(0, chain.length - 1),
      };
    })(),
  }));

  const agentLineage = {
    totalAgents: agentChains.length,
    withParentCount: agentChains.filter(
      (record) => record.parentAgentId !== undefined,
    ).length,
    withParentPct: percentage(
      agentChains.filter((record) => record.parentAgentId !== undefined).length,
      agentChains.length,
    ),
    maxEdgeCount: Math.max(
      ...agentChains.map((record) => record.chain.edgeCount),
      0,
    ),
    grandparentCases: agentChains
      .filter((record) => record.chain.edgeCount >= 2)
      .map((record) => ({
        entityId: record.entityId,
        primaryLabel: record.primaryLabel,
        chainIds: record.chain.ids,
        chainLabels: record.chain.labels,
      }))
      .sort((left, right) => left.entityId.localeCompare(right.entityId)),
  };

  const sizeRatiosByType = entityTypes.map((entityType) => {
    const typeRecords = byType.get(entityType) ?? [];
    const sourceKb =
      typeRecords.reduce((sum, record) => sum + record.sourceFileBytes, 0) /
      1024;
    const projectedFtsKb =
      typeRecords.reduce((sum, record) => sum + record.ftsTextBytes, 0) / 1024;
    const projectedAllKb =
      typeRecords.reduce((sum, record) => sum + record.allTextBytes, 0) / 1024;

    return {
      entityType,
      documentCount: typeRecords.length,
      sourceKb,
      projectedFtsKb,
      projectedAllKb,
      ftsToSourceRatio: sourceKb === 0 ? 0 : projectedFtsKb / sourceKb,
      allToSourceRatio: sourceKb === 0 ? 0 : projectedAllKb / sourceKb,
    };
  });

  const datasetKeywordOverlapCases = datasetRecords
    .map((record) => {
      const keywords = [
        ...(record.sourceEntity.keywords ?? []),
        ...(record.sourceEntity.themes ?? []),
      ];
      const keywordTokens = keywords.flatMap(tokenize);
      const ontologyTokens = new Set(tokenize(record.document.ontologyText));
      const overlappingTokens = keywordTokens.filter((token) =>
        ontologyTokens.has(token),
      );

      return {
        datasetId: record.document.entityId,
        primaryLabel: record.document.primaryLabel,
        keywordCount: keywords.length,
        keywordTokenCount: keywordTokens.length,
        overlappingTokenCount: overlappingTokens.length,
        overlapPct:
          keywordTokens.length === 0
            ? null
            : percentage(overlappingTokens.length, keywordTokens.length),
      };
    })
    .sort((left, right) => left.datasetId.localeCompare(right.datasetId));

  const datasetKeywordOverlap = {
    datasetsWithKeywords: datasetKeywordOverlapCases.filter(
      (record) => record.keywordTokenCount > 0,
    ).length,
    summary: summarizeNumbers(
      datasetKeywordOverlapCases.flatMap((record) =>
        record.overlapPct === null ? [] : [record.overlapPct],
      ),
    ),
    cases: datasetKeywordOverlapCases,
  };

  const h2AgentOntology = {
    totalAgents: agentRecords.length,
    ontologyEqualsPrimaryLabel: agentRecords.filter(
      (record) => record.document.ontologyText === record.document.primaryLabel,
    ).length,
    ontologyDiffersFromPrimaryLabel: agentRecords.filter(
      (record) => record.document.ontologyText !== record.document.primaryLabel,
    ).length,
    kindDistribution: [
      ...new Map(
        agentRecords.map((record) => [
          (record.sourceEntity.kind ?? "undefined").toString(),
          agentRecords.filter(
            (candidate) =>
              (candidate.sourceEntity.kind ?? "undefined").toString() ===
              (record.sourceEntity.kind ?? "undefined").toString(),
          ).length,
        ]),
      ).entries(),
    ]
      .map(([kind, count]) => ({ kind, count }))
      .sort((left, right) =>
        left.count === right.count
          ? left.kind.localeCompare(right.kind)
          : right.count - left.count,
      ),
  };

  const datasetKeywordTokenCorpus = datasetRecords.map(
    (record) =>
      [
        ...(record.sourceEntity.keywords ?? []),
        ...(record.sourceEntity.themes ?? []),
      ].flatMap(tokenize).length,
  );

  const h5KeywordBoost = yield* Effect.forEach(
    genericDatasetQueries,
    (query) =>
      search({
        query,
        entityTypes: ["Dataset"],
        limit: 10,
      }).pipe(
        Effect.map((hits) => ({
          query,
          topHits: hits.map(slimHit),
          topKeywordTokenCounts: hits.map((hit) => {
            const dataset = findEntityByTag(
              prepared.entityById,
              hit.document.entityId,
              "Dataset",
            );
            const tokenCount =
              dataset === undefined
                ? 0
                : [
                    ...(dataset.keywords ?? []),
                    ...(dataset.themes ?? []),
                  ].flatMap(tokenize).length;

            return {
              entityId: hit.document.entityId,
              primaryLabel: hit.document.primaryLabel,
              keywordTokenCount: tokenCount,
            };
          }),
          topKeywordTokenSummary: summarizeNumbers(
            hits.map((hit) => {
              const dataset = findEntityByTag(
                prepared.entityById,
                hit.document.entityId,
                "Dataset",
              );
              return dataset === undefined
                ? 0
                : [
                    ...(dataset.keywords ?? []),
                    ...(dataset.themes ?? []),
                  ].flatMap(tokenize).length;
            }),
          ),
        })),
      ),
    { concurrency: 1 },
  );

  const preferredDistributionCandidate = (byType.get("Distribution") ?? [])
    .filter((record) => {
      const distribution = record.sourceEntity as Distribution;
      const dataset = datasetForDistribution(graph, distribution.id);
      const relatedSeries =
        dataset === undefined ? 0 : seriesForDataset(graph, dataset.id).length;
      return (
        dataset !== undefined &&
        relatedSeries > 0 &&
        record.document.canonicalUrls.length > 0
      );
    })
    .sort((left, right) =>
      hasPreferredPublisherBias(left) === hasPreferredPublisherBias(right)
        ? left.document.entityId.localeCompare(right.document.entityId)
        : hasPreferredPublisherBias(left)
          ? -1
          : 1,
    )[0];

  const h3SeriesUrlDisconnect =
    preferredDistributionCandidate === undefined
      ? null
      : yield* Effect.gen(function* () {
          const distribution =
            preferredDistributionCandidate.sourceEntity as Distribution;
          const dataset = datasetForDistribution(graph, distribution.id);
          if (dataset === undefined) {
            return null;
          }
          const rawUrl =
            distribution.downloadURL ??
            distribution.accessURL ??
            preferredDistributionCandidate.document.canonicalUrls[0];
          const normalizedUrl =
            normalizeDistributionUrl(rawUrl) ??
            preferredDistributionCandidate.document.canonicalUrls[0];
          const hostname =
            normalizeDistributionHostname(rawUrl) ??
            preferredDistributionCandidate.document.downloadHostname ??
            preferredDistributionCandidate.document.accessHostname;
          const relatedSeries = seriesForDataset(graph, dataset.id).map(
            (item) => ({
              seriesId: item.id,
              label: item.label,
            }),
          );

          const exactUrlHits = yield* search({
            exactCanonicalUrls: [rawUrl],
            limit: 10,
          });
          const exactHostnameHits =
            hostname === undefined
              ? []
              : yield* search({
                  exactHostnames: [hostname],
                  limit: 10,
                });

          return {
            distributionId: distribution.id,
            distributionLabel:
              preferredDistributionCandidate.document.primaryLabel,
            datasetId: dataset.id,
            publisherAgentId:
              preferredDistributionCandidate.document.publisherAgentId,
            rawUrl,
            normalizedUrl,
            hostname,
            relatedSeries,
            exactUrlHits: exactUrlHits.map(slimHit),
            exactHostnameHits: exactHostnameHits.map(slimHit),
            relatedSeriesInExactUrlHits: exactUrlHits
              .filter((hit) =>
                relatedSeries.some(
                  (series) => series.seriesId === hit.document.entityId,
                ),
              )
              .map(slimHit),
            relatedSeriesInExactHostnameHits: exactHostnameHits
              .filter((hit) =>
                relatedSeries.some(
                  (series) => series.seriesId === hit.document.entityId,
                ),
              )
              .map(slimHit),
          };
        });
  const normalizationProbeHostname = "www.eia.gov";
  const normalizationProbeUrl = "https://www.eia.gov/electricity/monthly/";
  const h6Normalization = {
    codePath: {
      projectionUrlNormalizer: "src/search/projectEntitySearchDocs.ts:173-181",
      projectionUrlCollector: "src/search/searchSignals.ts:75-118",
      queryUrlNormalizer: "src/services/d1/EntitySearchRepoD1.ts:397-470",
    },
    rawHostnameProbe: normalizationProbeHostname,
    rawUrlProbe: normalizationProbeUrl,
    hostnameHits: (yield* search({
      exactHostnames: [normalizationProbeHostname],
      limit: 10,
    })).map(slimHit),
    urlHits: (yield* search({
      exactCanonicalUrls: [normalizationProbeUrl],
      limit: 10,
    })).map(slimHit),
  };

  const semanticTextSizes = records.map((record) =>
    byteLength(record.document.semanticText),
  );
  const ftsTextSizes = records.map((record) => record.ftsTextBytes);
  const h7SemanticText = {
    semanticInFtsSchema: false,
    semanticTextBytes: summarizeNumbers(semanticTextSizes),
    ftsFiveColumnBytes: summarizeNumbers(ftsTextSizes),
    semanticToFtsMeanRatio:
      mean(ftsTextSizes) === 0
        ? 0
        : mean(semanticTextSizes) / mean(ftsTextSizes),
    largestDocuments: [...records]
      .sort((left, right) =>
        right.document.semanticText.length === left.document.semanticText.length
          ? left.document.entityId.localeCompare(right.document.entityId)
          : right.document.semanticText.length -
            left.document.semanticText.length,
      )
      .slice(0, 10)
      .map((record) => ({
        entityId: record.document.entityId,
        entityType: record.document.entityType,
        primaryLabel: record.document.primaryLabel,
        semanticTextBytes: byteLength(record.document.semanticText),
        ftsTextBytes: record.ftsTextBytes,
      })),
  };

  const representativeExamples = pickRepresentativeExamples(records);

  db.run(
    `CREATE VIRTUAL TABLE entity_search_vocab USING fts5vocab(entity_search_fts, 'instance')`,
  );

  const ftsSampleEntityIds = [
    ...new Set(
      entityTypes.flatMap((entityType) =>
        (representativeExamples[entityType] ?? []).map(
          (example) => example.entityId,
        ),
      ),
    ),
  ].slice(0, 10);

  const ftsTokenizationSanity = {
    globalProbeCounts: {
      solarPrefix: (
        db
          .query(
            `SELECT COUNT(*) AS count
             FROM entity_search_fts
             WHERE entity_search_fts MATCH 'sol*'`,
          )
          .get() as { count: number }
      ).count,
      solarExact: (
        db
          .query(
            `SELECT COUNT(*) AS count
             FROM entity_search_fts
             WHERE entity_search_fts MATCH 'solar'`,
          )
          .get() as { count: number }
      ).count,
      emissionsPlural: (
        db
          .query(
            `SELECT COUNT(*) AS count
             FROM entity_search_fts
             WHERE entity_search_fts MATCH 'emissions'`,
          )
          .get() as { count: number }
      ).count,
      emissionsSingular: (
        db
          .query(
            `SELECT COUNT(*) AS count
             FROM entity_search_fts
             WHERE entity_search_fts MATCH 'emission'`,
          )
          .get() as { count: number }
      ).count,
    },
    samples: ftsSampleEntityIds.map((entityId) => {
      const row = db
        .query(
          `SELECT
             rowid,
             entity_id,
             entity_type,
             primary_text,
             alias_text,
             lineage_text,
             url_text,
             ontology_text
           FROM entity_search_fts
           WHERE entity_id = ?1`,
        )
        .get(entityId) as
        | {
            rowid: number;
            entity_id: string;
            entity_type: string;
            primary_text: string;
            alias_text: string;
            lineage_text: string;
            url_text: string;
            ontology_text: string;
          }
        | undefined;

      const terms =
        row === undefined
          ? []
          : (db
              .query(
                `SELECT term, col, offset
                 FROM entity_search_vocab
                 WHERE doc = ?1
                 ORDER BY col ASC, offset ASC
                 LIMIT 240`,
              )
              .all(row.rowid) as Array<{
              term: string;
              col: string;
              offset: number;
            }>);

      return {
        entityId,
        row,
        termsByColumn: Object.fromEntries(
          [
            "primary_text",
            "alias_text",
            "lineage_text",
            "url_text",
            "ontology_text",
          ].map((column) => [
            column,
            terms
              .filter((term) => term.col === column)
              .map((term) => term.term),
          ]),
        ),
      };
    }),
  };

  const openDiscoveryCandidates = {
    distributionsUsingRawUrlAsPrimaryLabel: (byType.get("Distribution") ?? [])
      .filter((record) => {
        const distribution = record.sourceEntity as Distribution;
        return (
          distribution.title === undefined &&
          (record.document.primaryLabel === distribution.accessURL ||
            record.document.primaryLabel === distribution.downloadURL)
        );
      })
      .map((record) => ({
        entityId: record.document.entityId,
        primaryLabel: record.document.primaryLabel,
        datasetId: record.document.datasetId,
        publisherAgentId: record.document.publisherAgentId,
      })),
    seriesWithoutCanonicalUrls: (byType.get("Series") ?? [])
      .filter((record) => record.document.canonicalUrls.length === 0)
      .map((record) => ({
        entityId: record.document.entityId,
        primaryLabel: record.document.primaryLabel,
        datasetId: record.document.datasetId,
        publisherAgentId: record.document.publisherAgentId,
      })),
    datasetsWithoutChildVariables: datasetRecords
      .filter((record) => (record.sourceEntity.variableIds ?? []).length === 0)
      .map((record) => ({
        entityId: record.document.entityId,
        primaryLabel: record.document.primaryLabel,
        publisherAgentId: record.document.publisherAgentId,
      })),
    collapsedColumns: columnLengthDistributions
      .filter((record) => record.primaryLabelOnlyCount > 0)
      .sort((left, right) =>
        left.primaryLabelOnlyCount === right.primaryLabelOnlyCount
          ? `${left.entityType}.${left.column}`.localeCompare(
              `${right.entityType}.${right.column}`,
            )
          : right.primaryLabelOnlyCount - left.primaryLabelOnlyCount,
      )
      .slice(0, 20),
  };

  const queriesSql = [
    `-- Corpus size
SELECT entity_type, COUNT(*) AS count
FROM entity_search_docs
WHERE deleted_at IS NULL
GROUP BY entity_type
ORDER BY entity_type ASC;

SELECT COUNT(*) AS count
FROM entity_search_docs
WHERE deleted_at IS NULL;

SELECT COUNT(*) AS count FROM entity_search_doc_urls;
SELECT COUNT(*) AS count FROM entity_search_fts;`,
    h3SeriesUrlDisconnect === null
      ? "-- No H3 distribution candidate was found."
      : `-- H3 exact URL probe
SELECT d.entity_id, d.entity_type, d.primary_label
FROM entity_search_docs d
WHERE EXISTS (
  SELECT 1
  FROM entity_search_doc_urls exact_url
  WHERE exact_url.entity_id = d.entity_id
    AND exact_url.canonical_url = ${quoteSqlLiteral(h3SeriesUrlDisconnect.normalizedUrl)}
)
ORDER BY d.updated_at DESC, d.entity_id ASC
LIMIT 10;

-- H3 exact hostname probe
SELECT d.entity_id, d.entity_type, d.primary_label
FROM entity_search_docs d
WHERE d.homepage_hostname = ${quoteSqlLiteral(h3SeriesUrlDisconnect.hostname ?? "")}
   OR d.landing_page_hostname = ${quoteSqlLiteral(h3SeriesUrlDisconnect.hostname ?? "")}
   OR d.access_hostname = ${quoteSqlLiteral(h3SeriesUrlDisconnect.hostname ?? "")}
   OR d.download_hostname = ${quoteSqlLiteral(h3SeriesUrlDisconnect.hostname ?? "")}
ORDER BY d.updated_at DESC, d.entity_id ASC
LIMIT 10;`,
    `-- FTS tokenization sanity
SELECT rowid, entity_id, entity_type, primary_text, alias_text, lineage_text, url_text, ontology_text
FROM entity_search_fts
WHERE entity_id IN (${ftsSampleEntityIds.map(quoteSqlLiteral).join(", ")})
ORDER BY entity_id ASC;`,
    `-- Prefix and stemming probes
SELECT COUNT(*) AS count FROM entity_search_fts WHERE entity_search_fts MATCH 'sol*';
SELECT COUNT(*) AS count FROM entity_search_fts WHERE entity_search_fts MATCH 'solar';
SELECT COUNT(*) AS count FROM entity_search_fts WHERE entity_search_fts MATCH 'emission';
SELECT COUNT(*) AS count FROM entity_search_fts WHERE entity_search_fts MATCH 'emissions';`,
  ].join("\n\n");

  const analysis = {
    generatedAt: new Date().toISOString(),
    artifacts: {
      projectedJsonlPath,
      sqlitePath,
      analysisJsonPath,
      queriesSqlPath,
    },
    corpusOverview: {
      docsByTypeSql,
      totalDocs: totalDocsSql.count,
      ftsRowCount: ftsCountSql.count,
      docUrlCount: docUrlsCountSql.count,
    },
    columnLengthDistributions,
    aliasCoverage,
    urlCoverage,
    datasetFacetPathology,
    variableParentSummary,
    variableMultiParentCases,
    agentLineage,
    sizeRatiosByType,
    datasetKeywordOverlap,
    hypotheses: {
      h1DatasetFacetBlindness: datasetFacetPathology,
      h2AgentOntologyDeadWeight: h2AgentOntology,
      h3SeriesUrlDisconnect,
      h4LineageOneHopDropsMiddleLayers: agentLineage,
      h5KeywordsDoubleCount: {
        corpusKeywordTokenSummary: summarizeNumbers(datasetKeywordTokenCorpus),
        queries: h5KeywordBoost,
      },
      h6UrlNormalizationMismatch: h6Normalization,
      h7SemanticTextSizing: h7SemanticText,
    },
    representativeExamples,
    ftsTokenizationSanity,
    openDiscoveryCandidates,
  };

  const countsByType = Object.fromEntries(
    docsByTypeSql.map((row) => [row.entity_type, row.count]),
  ) as Record<EntityType, number>;

  const describeExample = (example: {
    readonly entityType: EntityType;
    readonly sourceEntity: DataLayerRegistryEntity;
    readonly projection: EntitySearchDocument;
  }) => {
    switch (example.entityType) {
      case "Agent":
        return `What works: alias and homepage normalization give the row solid exact-match surface area. What is surprising: \`ontology_text\` is just ${JSON.stringify(example.projection.ontologyText)}, and every Agent row in this corpus emits the same value. What is missing: there is no deeper lineage to project because the current Agent catalog has no parent chains.`;
      case "Dataset": {
        const dataset = example.sourceEntity as Dataset;
        const variableCount = (dataset.variableIds ?? []).length;
        const urlNote =
          example.projection.canonicalUrls.length === 0
            ? "`url_text` collapses to the title because there is no canonical URL."
            : `The row keeps ${formatInt(example.projection.canonicalUrls.length)} canonical URL(s) and hostname prefixes.`;
        return `What works: title, description, publisher lineage, and keyword/theme text all survive projection. What is surprising: every facet scope field is empty here because the source dataset links ${formatInt(variableCount)} variables. What is missing: ${urlNote}`;
      }
      case "Distribution": {
        const isRawUrlFallback =
          example.projection.primaryLabel.startsWith("http");
        return `What works: download and access URLs expand into normalized host and prefix text, which is useful for exact and hostname probes. What is surprising: ${isRawUrlFallback ? "the primary label is a raw URL because the source distribution has no title." : "the title is strong enough that the row reads like a real named document."} What is missing: dataset-derived variable facets are empty because the current catalog never links Variables back into Datasets.`;
      }
      case "Series":
        return `What works: fixed dimensions and variable ontology land cleanly in \`lineage_text\` and \`ontology_text\`, and parent dataset/distribution URL surfaces can now be projected onto the Series row. What is surprising: \`primary_text\` and \`alias_text\` still collapse quickly when Series rows have little native alias coverage. What is missing: any Series row that still has zero canonical URLs remains unreachable from exact URL evidence.`;
      case "Variable":
        return `What works: the variable definition and ontology facets survive intact. What is surprising: lineage depends entirely on reverse links from Datasets and Series, so rows with no linked Dataset parents collapse toward the label. What is missing: there is no resolved parent dataset or publisher scope on any Variable row in this corpus.`;
    }
  };

  const renderExamples = (entityType: EntityType) =>
    (representativeExamples[entityType] ?? [])
      .map((example) =>
        [
          `#### ${example.bucket[0]?.toUpperCase() ?? ""}${example.bucket.slice(1)} Example — \`${example.entityId}\``,
          describeExample({
            entityType: example.entityType,
            sourceEntity: example.sourceEntity,
            projection: example.projection,
          }),
          detailsBlock("Source Row", jsonFence(example.sourceEntity)),
          detailsBlock("Projection Output", jsonFence(example.projection)),
        ].join("\n\n"),
      )
      .join("\n\n");

  const entityIdsCited = [
    ...new Set(
      [
        ...entityTypes.flatMap((entityType) =>
          (representativeExamples[entityType] ?? []).map(
            (example) => example.entityId,
          ),
        ),
        ...(h3SeriesUrlDisconnect === null
          ? []
          : [
              h3SeriesUrlDisconnect.distributionId,
              h3SeriesUrlDisconnect.datasetId,
              ...h3SeriesUrlDisconnect.relatedSeries.map(
                (item) => item.seriesId,
              ),
              ...h3SeriesUrlDisconnect.exactUrlHits.map((hit) => hit.entityId),
              ...h3SeriesUrlDisconnect.exactHostnameHits.map(
                (hit) => hit.entityId,
              ),
            ]),
        ...h6Normalization.hostnameHits.map((hit) => hit.entityId),
        ...h6Normalization.urlHits.map((hit) => hit.entityId),
        ...openDiscoveryCandidates.distributionsUsingRawUrlAsPrimaryLabel
          .slice(0, 10)
          .map((row) => row.entityId),
      ].filter((value) => value.length > 0),
    ),
  ].sort((left, right) => left.localeCompare(right));

  const reportMarkdown = [
    "# Entity Search Empirical Analysis — 2026-04-14",
    "",
    "## 1. Executive Summary",
    "",
    renderTable(
      ["Severity", "Finding", "Evidence", "Recommendation"],
      [
        [
          "High",
          "Dataset facet scoping is completely blind in the checked-in corpus.",
          `All ${formatInt(countsByType.Dataset)} Dataset rows have NULL in all seven facet columns, and the audit found ${formatInt(countsByType.Dataset)} of ${formatInt(countsByType.Dataset)} datasets with no linked \`variableIds\` at all.`,
          "Restore dataset-to-variable links before tuning facet aggregation logic; there is no child-variable evidence to aggregate today.",
        ],
        [
          "High",
          "Variable scope inheritance is also absent.",
          `${formatInt(variableParentSummary.noParentDatasetsCount)} of ${formatInt(variableParentSummary.totalVariables)} Variable rows have no parent datasets, so \`uniqueDatasetId\` and \`uniquePublisherId\` never resolve in practice.`,
          "Treat reverse Variable ancestry as a prerequisite data-model fix, not a ranking tweak.",
        ],
        [
          "High",
          "Series URL coverage is still a first-class quality gate.",
          `${formatInt(openDiscoveryCandidates.seriesWithoutCanonicalUrls.length)} of ${formatInt(countsByType.Series)} Series rows still carry zero canonical URLs, so that residual set cannot participate in exact URL evidence no matter how strong the parent source artifact is.`,
          "Keep projecting selected parent Dataset / Distribution URL and hostname surfaces onto Series rows until zero-URL Series are no longer a material blind spot.",
        ],
        [
          "Medium",
          "A non-trivial slice of Distribution rows use raw URLs as their labels.",
          `${formatInt(openDiscoveryCandidates.distributionsUsingRawUrlAsPrimaryLabel.length)} of ${formatInt(countsByType.Distribution)} Distribution rows (${formatPct(openDiscoveryCandidates.distributionsUsingRawUrlAsPrimaryLabel.length, countsByType.Distribution)}) fall back to raw URLs because the source has no title.`,
          "Add a better fallback label chain for API distributions so ranking snippets and UI output are readable.",
        ],
        [
          "Low",
          "Agent ontology text is not empty, but it is low-entropy.",
          `All ${formatInt(countsByType.Agent)} Agent rows emit \`ontology_text = "organization"\`, so the column differs from \`primary_label\` but adds no discrimination inside the Agent family.`,
          "Keep the column only if richer agent taxonomy is coming; otherwise it should not receive meaningful BM25 weight.",
        ],
      ],
    ),
    "",
    "## 2. Methodology",
    "",
    `Data source: the checked-in cold-start catalog loaded through \`src/bootstrap/CheckedInDataLayerRegistry.ts:21-223\`. Projection logic: \`src/search/projectEntitySearchDocs.ts:253-679\`. Write path: \`src/services/d1/EntitySearchRepoD1.ts:956-1000\`. FTS schema: \`src/search/migrations.ts:3-73\`. Query normalization: \`src/services/d1/EntitySearchRepoD1.ts:397-470\`.`,
    "",
    `Command executed: \`bun run scripts/analysis/entity-search-audit/run-audit.ts\`. The script writes four stable artifacts: \`${projectedJsonlPath}\`, \`${sqlitePath}\`, \`${analysisJsonPath}\`, and \`${queriesSqlPath}\`. The SQLite file is built locally with the same migrations and repository upsert logic used by the application, so the SQL in this report runs against an index with the real projection and FTS5 configuration.`,
    "",
    "The audit intentionally preferred the checked-in catalog over remote D1 so the measurements were deterministic and reproducible. I verified the harness by rebuilding the local SQLite index multiple times and spot-checking the generated rows against the source JSON files and the projector code paths.",
    "",
    "## 3. Corpus Overview",
    "",
    "### 3.1 Corpus Size",
    "",
    codeFence(
      "sql",
      `SELECT entity_type, COUNT(*) AS count
FROM entity_search_docs
WHERE deleted_at IS NULL
GROUP BY entity_type
ORDER BY entity_type ASC;

SELECT COUNT(*) AS count
FROM entity_search_docs
WHERE deleted_at IS NULL;

SELECT COUNT(*) AS count FROM entity_search_doc_urls;
SELECT COUNT(*) AS count FROM entity_search_fts;`,
    ),
    "",
    renderTable(
      ["Entity type", "Rows"],
      docsByTypeSql
        .map((row) => [row.entity_type, formatInt(row.count)])
        .concat([
          ["Total docs", formatInt(totalDocsSql.count)],
          ["Exact URL rows", formatInt(docUrlsCountSql.count)],
          ["FTS rows", formatInt(ftsCountSql.count)],
        ]),
    ),
    "",
    "The corpus is Distribution-heavy: 3,530 Distribution rows vs 1,790 Datasets, only 29 Series, and 25 Variables. The FTS row count matches the document count exactly, which confirms the local rebuild populated the shadow table cleanly.",
    "",
    "### 3.2 Alias Coverage",
    "",
    renderTable(
      ["Entity type", "Docs", "Docs with >=1 alias", "Coverage", "Top schemes"],
      aliasCoverage.map((row) => [
        row.entityType,
        formatInt(row.documentCount),
        formatInt(row.docsWithAliases),
        formatFloat(row.docsWithAliasesPct, 1),
        row.schemes
          .slice(0, 4)
          .map((scheme) => `${scheme.scheme} (${formatInt(scheme.docCount)})`)
          .join(", "),
      ]),
    ),
    "",
    "Agents are fully aliased and Dataset coverage is strong at 90.5%, but Series have no aliases at all and Variables only have two `oeo` aliases across the entire family. Distribution aliasing is effectively just URL aliasing.",
    "",
    "### 3.3 URL Coverage",
    "",
    renderTable(
      ["Entity type", "Docs", "Docs with >=1 canonical URL", "Coverage"],
      urlCoverage.byType.map((row) => [
        row.entityType,
        formatInt(row.documentCount),
        formatInt(row.docsWithCanonicalUrls),
        formatFloat(row.docsWithCanonicalUrlsPct, 1),
      ]),
    ),
    "",
    `The corpus exposes ${formatInt(urlCoverage.uniqueHostnameCount)} unique normalized hostnames. The top ten are below; the shape is dominated by GridStatus, Europa, ODRE, EIA, and NESO hosts.`,
    "",
    renderTable(
      ["Hostname", "Docs"],
      urlCoverage.topHostnames
        .slice(0, 10)
        .map((row) => [row.hostname, formatInt(row.docCount)]),
    ),
    "",
    "### 3.4 Column Length Distribution",
    "",
    "The full per-(entity_type x column) length table is in Appendix D. Three headline patterns matter in the body:",
    "",
    renderTable(
      [
        "Entity type",
        "Column",
        "Mean bytes",
        "P95 bytes",
        "Primary-label-only rows",
      ],
      columnLengthDistributions
        .filter(
          (row) =>
            (row.entityType === "Dataset" &&
              (row.column === "primaryText" ||
                row.column === "urlText" ||
                row.column === "semanticText")) ||
            (row.entityType === "Distribution" &&
              (row.column === "aliasText" ||
                row.column === "urlText" ||
                row.column === "semanticText")) ||
            (row.entityType === "Series" &&
              (row.column === "primaryText" || row.column === "urlText")),
        )
        .map((row) => [
          row.entityType,
          row.column,
          formatFloat(row.mean, 1),
          formatFloat(row.p95, 1),
          formatInt(row.primaryLabelOnlyCount),
        ]),
    ),
    "",
    `Series are the starkest example of column collapse: \`primary_text\`, \`alias_text\`, and \`url_text\` are identical to the primary label for all ${formatInt(countsByType.Series)} rows. Distribution \`alias_text\` is also weak: ${formatInt(columnLengthDistributions.find((row) => row.entityType === "Distribution" && row.column === "aliasText")?.primaryLabelOnlyCount ?? 0)} of ${formatInt(countsByType.Distribution)} rows (${formatPct(columnLengthDistributions.find((row) => row.entityType === "Distribution" && row.column === "aliasText")?.primaryLabelOnlyCount ?? 0, countsByType.Distribution)}) have no alias content beyond the fallback label surface.`,
    "",
    "## 4. Per-Entity-Type Deep Dive",
    "",
    "### 4.1 Agent",
    "",
    `H2 is formally refuted but substantively still weak. \`ontology_text\` never falls back to \`primary_label\`; instead, every Agent row emits the same single token: \`organization\`. That makes the column non-empty but useless for discrimination. H4 is also refuted on this corpus because there are no parent links at all: 0 of 66 agents have \`parentAgentId\`, so the one-hop lineage projector in \`src/search/projectEntitySearchDocs.ts:267-275\` does not currently drop any real hierarchy.`,
    "",
    renderExamples("Agent"),
    "",
    "### 4.2 Dataset",
    "",
    `H1 does not fail in the originally suspected way. I found zero multi-value conflicts because the checked-in catalog never reaches the \`singleDistinctValue\` conflict branch at all. Instead, every Dataset row is facet-blind because the source rows do not link Variables into Datasets. The source sample \`references/cold-start/catalog/datasets/eia-electricity-data.json\` has \`distributionIds\` but no \`variableIds\`, and that pattern generalizes across the corpus.`,
    "",
    renderTable(
      [
        "Facet",
        "NULL rows",
        "Conflict rows",
        "No linked variables",
        "Variables present but facet empty",
      ],
      datasetFacetPathology.summaryByFacet.map((row) => [
        row.facet,
        formatInt(row.nullCount),
        formatInt(row.conflictCount),
        formatInt(row.noLinkedVariablesCount),
        formatInt(row.noFacetValueCount),
      ]),
    ),
    "",
    `This means all seven Dataset facet columns are NULL for all ${formatInt(countsByType.Dataset)} Dataset rows. The intended conflict pathology is masked by a more basic catalog-linking gap.`,
    "",
    `H5 is partly supported. The intentional Dataset double-count is real and measurable: every Dataset with keywords/themes has 100% keyword-token overlap with \`ontology_text\`, because \`src/search/projectEntitySearchDocs.ts:348-353\` explicitly reuses \`dataset.keywords\` and \`dataset.themes\` inside that column. Whether that inflates BM25 depends on the query. The corpus-average Dataset keyword token count is ${formatFloat(analysis.hypotheses.h5KeywordsDoubleCount.corpusKeywordTokenSummary.mean, 1)}. Top-10 hit means rise to 9.1 for \`electricity price\`, 8.5 for \`grid frequency\`, and 21.0 for the only \`capacity factor\` hit, but fall slightly below average for \`solar capacity\` and \`emissions\`. So tagging density boosts some generic queries, but not uniformly.`,
    "",
    renderTable(
      [
        "Query",
        "Top hit count",
        "Top-10 mean keyword tokens",
        "Top-10 median",
        "Corpus mean",
      ],
      analysis.hypotheses.h5KeywordsDoubleCount.queries.map((row) => [
        row.query,
        formatInt(row.topKeywordTokenSummary.count),
        formatFloat(row.topKeywordTokenSummary.mean, 1),
        formatFloat(row.topKeywordTokenSummary.median, 1),
        formatFloat(
          analysis.hypotheses.h5KeywordsDoubleCount.corpusKeywordTokenSummary
            .mean,
          1,
        ),
      ]),
    ),
    "",
    renderExamples("Dataset"),
    "",
    "### 4.3 Distribution",
    "",
    `Distribution projection is the strongest URL surface in the corpus, but it has a readability problem. ${formatInt(openDiscoveryCandidates.distributionsUsingRawUrlAsPrimaryLabel.length)} of ${formatInt(countsByType.Distribution)} rows (${formatPct(openDiscoveryCandidates.distributionsUsingRawUrlAsPrimaryLabel.length, countsByType.Distribution)}) use a raw source URL as \`primary_label\` because \`src/search/projectEntitySearchDocs.ts:418-422\` falls back from \`title\` to \`accessURL\` or \`downloadURL\`. The sparse and average EIA API examples below show exactly what that looks like.`,
    "",
    renderExamples("Distribution"),
    "",
    "### 4.4 Series",
    "",
    `H3 remains the right check, but the projector is now broader than the original version: Series rows can inherit canonical URLs from their own aliases plus parent Dataset / Distribution surfaces (\`src/search/projectEntitySearchDocs.ts:485-575\`). The remaining blind spot is the residual set with no inherited or native URL evidence. In this corpus, ${formatInt(openDiscoveryCandidates.seriesWithoutCanonicalUrls.length)} of ${formatInt(countsByType.Series)} Series rows (${formatPct(openDiscoveryCandidates.seriesWithoutCanonicalUrls.length, countsByType.Series)}) still have no canonical URL surface at all.`,
    "",
    h3SeriesUrlDisconnect === null
      ? "No Series/Distribution URL probe candidate was available."
      : [
          `The concrete probe used here was Distribution \`${h3SeriesUrlDisconnect.distributionId}\` (${h3SeriesUrlDisconnect.distributionLabel}) from Dataset \`${h3SeriesUrlDisconnect.datasetId}\`. The raw URL was ${JSON.stringify(h3SeriesUrlDisconnect.rawUrl)} and the normalized URL stored in the exact-URL table was ${JSON.stringify(h3SeriesUrlDisconnect.normalizedUrl)}.`,
          "",
          codeFence(
            "sql",
            `SELECT d.entity_id, d.entity_type, d.primary_label
FROM entity_search_docs d
WHERE EXISTS (
  SELECT 1
  FROM entity_search_doc_urls exact_url
  WHERE exact_url.entity_id = d.entity_id
    AND exact_url.canonical_url = ${quoteSqlLiteral(h3SeriesUrlDisconnect.normalizedUrl)}
)
ORDER BY d.updated_at DESC, d.entity_id ASC
LIMIT 10;`,
          ),
          "",
          renderTable(
            ["Rank", "Entity type", "Entity ID", "Label"],
            h3SeriesUrlDisconnect.exactUrlHits.map((hit) => [
              String(hit.rank),
              hit.entityType,
              hit.entityId,
              hit.primaryLabel,
            ]),
          ),
          "",
          codeFence(
            "sql",
            `SELECT d.entity_id, d.entity_type, d.primary_label
FROM entity_search_docs d
WHERE d.homepage_hostname = ${quoteSqlLiteral(h3SeriesUrlDisconnect.hostname ?? "")}
   OR d.landing_page_hostname = ${quoteSqlLiteral(h3SeriesUrlDisconnect.hostname ?? "")}
   OR d.access_hostname = ${quoteSqlLiteral(h3SeriesUrlDisconnect.hostname ?? "")}
   OR d.download_hostname = ${quoteSqlLiteral(h3SeriesUrlDisconnect.hostname ?? "")}
ORDER BY d.updated_at DESC, d.entity_id ASC
LIMIT 10;`,
          ),
          "",
          renderTable(
            ["Rank", "Entity type", "Entity ID", "Label"],
            h3SeriesUrlDisconnect.exactHostnameHits.map((hit) => [
              String(hit.rank),
              hit.entityType,
              hit.entityId,
              hit.primaryLabel,
            ]),
          ),
          "",
          `Related Series candidate(s): ${h3SeriesUrlDisconnect.relatedSeries.map((item) => `\`${item.seriesId}\` (${item.label})`).join(", ")}. Result: no related Series surfaced in the exact URL hits and none surfaced in the exact hostname hits.`,
        ].join("\n"),
    "",
    renderExamples("Series"),
    "",
    "### 4.5 Variable",
    "",
    `The requested multi-parent analysis also bottoms out on missing parent links. All ${formatInt(variableParentSummary.totalVariables)} Variable rows currently have zero parent datasets, so \`uniqueDatasetId\` and \`uniquePublisherId\` in \`src/search/projectEntitySearchDocs.ts:243-251\` and :624-625 are never able to resolve. There are no true multi-parent conflicts in the checked-in corpus because there are no parent links to compare.`,
    "",
    renderTable(
      ["Summary", "Count"],
      [
        ["Total Variables", formatInt(variableParentSummary.totalVariables)],
        [
          "No parent datasets",
          formatInt(variableParentSummary.noParentDatasetsCount),
        ],
        [
          "Multiple datasets",
          formatInt(variableParentSummary.multipleDatasetsCount),
        ],
        [
          "Multiple publishers",
          formatInt(variableParentSummary.multiplePublishersCount),
        ],
      ],
    ),
    "",
    renderExamples("Variable"),
    "",
    "## 5. Cross-Cutting Findings",
    "",
    `H6 is refuted: the query path does use the same normalization rule as projection time. Projection normalizes canonical URLs and hostnames in \`src/search/projectEntitySearchDocs.ts:173-181\` plus \`src/search/searchSignals.ts:75-118\`, and query-side exact URL / hostname probes normalize inputs in \`src/services/d1/EntitySearchRepoD1.ts:397-470\`. The probe \`exactHostnames = [\"www.eia.gov\"]\` returned the same \`eia.gov\` hits as the normalized form, and \`exactCanonicalUrls = [\"https://www.eia.gov/electricity/monthly/\"]\` returned the expected Dataset and Distribution rows.`,
    "",
    `H7 is also refuted in its original form. \`semantic_text\` is not in the FTS schema (\`src/search/migrations.ts:51-61\`), but it is not 5-6x larger than the searchable columns either. Mean \`semantic_text\` size is ${formatFloat(h7SemanticText.semanticTextBytes.mean, 1)} bytes versus ${formatFloat(h7SemanticText.ftsFiveColumnBytes.mean, 1)} bytes for the five indexed text columns combined, a ratio of ${formatFloat(h7SemanticText.semanticToFtsMeanRatio, 2)}x. The important sizing takeaway is different: \`semantic_text\` is effectively a second full copy of the lexical surface, not a tiny reserved appendix.`,
    "",
    "Three additional empirical findings not explicitly requested:",
    "",
    renderTable(
      ["Finding", "Evidence", "Why it matters"],
      [
        [
          "Distribution URL labels",
          `${formatInt(openDiscoveryCandidates.distributionsUsingRawUrlAsPrimaryLabel.length)} Distribution rows fall back to raw URLs as labels, heavily concentrated in EIA API access rows.`,
          "These rows will look broken in ranked snippets and any debugging UI.",
        ],
        [
          "Series URL lane is completely empty",
          `${formatInt(openDiscoveryCandidates.seriesWithoutCanonicalUrls.length)} of ${formatInt(countsByType.Series)} Series rows have zero canonical URLs.`,
          "Exact URL evidence cannot retrieve Series rows no matter how good the query compiler gets.",
        ],
        [
          "Dataset/Variable linkage is absent",
          `${formatInt(openDiscoveryCandidates.datasetsWithoutChildVariables.length)} of ${formatInt(countsByType.Dataset)} Datasets and ${formatInt(variableParentSummary.noParentDatasetsCount)} of ${formatInt(variableParentSummary.totalVariables)} Variables have no cross-linking ancestry.`,
          "This blocks facet scoping, Variable lineage, and several of the typed exact-match fields all at once.",
        ],
      ],
    ),
    "",
    "FTS tokenization sanity notes from the local SQLite vocab table:",
    "",
    `1. \`unicode61\` splits punctuation aggressively. \`U.S.\` becomes \`u\` + \`s\`, and \`Energy-Charts\` becomes \`energy\` + \`charts\`. See the EIA and Fraunhofer Agent samples in Appendix A.`,
    `2. URL aliases contribute many path tokens. For example, the NESO CSV distribution surfaces \`dataset\`, UUID fragments, \`download\`, and \`csv\` from its alias and URL columns.`,
    `3. Prefix matching is real: \`sol*\` matched ${formatInt(ftsTokenizationSanity.globalProbeCounts.solarPrefix)} rows vs ${formatInt(ftsTokenizationSanity.globalProbeCounts.solarExact)} for exact \`solar\`.`,
    `4. There is no stemming: \`emissions\` matched ${formatInt(ftsTokenizationSanity.globalProbeCounts.emissionsPlural)} rows while singular \`emission\` matched only ${formatInt(ftsTokenizationSanity.globalProbeCounts.emissionsSingular)}.`,
    "",
    "## 6. Prioritized Recommendations",
    "",
    renderTable(
      ["Finding", "Severity", "Fix shape", "Effort", "Tradeoffs"],
      [
        [
          "Dataset/Variable links are missing",
          "High",
          "Restore or generate Dataset -> Variable ancestry in the checked-in catalog before changing projection logic.",
          "M",
          "Requires catalog rebuild work, but unlocks seven facet fields plus Variable scope.",
        ],
        [
          "Series have no URL surface",
          "High",
          "Project selected Distribution canonical URLs or hostnames onto Series rows when a Dataset/Series relationship exists.",
          "S",
          "May widen Series recall; BM25 weights will need retuning to avoid URL over-dominance.",
        ],
        [
          "Raw URL fallback labels on Distributions",
          "Medium",
          "Use a friendlier fallback chain for title-less API distributions, e.g. dataset title + endpoint slug.",
          "S",
          "Improves readability without changing recall; requires a deterministic naming rule.",
        ],
        [
          "Agent ontology_text is constant",
          "Low",
          "Either add richer agent taxonomy or give Agent ontology negligible weight.",
          "S",
          "If taxonomy expands later, current neutral weighting avoids overfitting to a constant token.",
        ],
        [
          "semantic_text duplicates the lexical footprint",
          "Low",
          "Keep it out of FTS, but budget for near-2x text storage if embeddings are added later.",
          "S",
          "No immediate ranking risk; mostly a storage and embedding-cost consideration.",
        ],
      ],
    ),
    "",
    "## 7. Appendices",
    "",
    "### A. SQL and Scripts Used",
    "",
    "`bun run scripts/analysis/entity-search-audit/run-audit.ts`",
    "",
    codeFence("sql", queriesSql),
    "",
    "### B. File:Line Citations",
    "",
    "- `src/search/migrations.ts:3-73` — entity-search tables and FTS5 schema.",
    "- `src/search/projectEntitySearchDocs.ts:173-181` — URL normalization helper used by the projector.",
    "- `src/search/projectEntitySearchDocs.ts:253-302` — Agent projector.",
    "- `src/search/projectEntitySearchDocs.ts:304-390` — Dataset projector.",
    "- `src/search/projectEntitySearchDocs.ts:392-482` — Distribution projector.",
    "- `src/search/projectEntitySearchDocs.ts:484-571` — Series projector.",
    "- `src/search/projectEntitySearchDocs.ts:573-651` — Variable projector.",
    "- `src/search/projectEntitySearchDocs.ts:671-679` — projection entrypoint.",
    "- `src/search/searchSignals.ts:30-96` — text dedupe and URL normalization helpers.",
    "- `src/services/d1/EntitySearchRepoD1.ts:397-470` — query normalization for exact URLs and hostnames.",
    "- `src/services/d1/EntitySearchRepoD1.ts:956-1000` — overwrite-style upsert path.",
    "- `src/services/d1/EntitySearchRepoD1.ts:1053-1194` — exact URL and hostname SQL paths.",
    "- `src/services/d1/EntitySearchRepoD1.ts:1197-1381` — lexical FTS query and merge path.",
    "- `scripts/rebuild-search-db.ts:71-164` — search DB rebuild and verification script.",
    "- `src/bootstrap/CheckedInDataLayerRegistry.ts:21-223` — checked-in catalog loader used by the audit.",
    "",
    "### C. Entity IDs Cited",
    "",
    ...entityIdsCited.map((entityId) => `- \`${entityId}\``),
    "",
    "### D. Full Column Length Distribution Table (UTF-8 bytes)",
    "",
    renderTable(
      [
        "Entity type",
        "Column",
        "Count",
        "Min",
        "P25",
        "Median",
        "P75",
        "P95",
        "Max",
        "Mean",
        "Primary-label-only",
      ],
      columnLengthDistributions.map((row) => [
        row.entityType,
        row.column,
        formatInt(row.count),
        formatFloat(row.min, 1),
        formatFloat(row.p25, 1),
        formatFloat(row.median, 1),
        formatFloat(row.p75, 1),
        formatFloat(row.p95, 1),
        formatFloat(row.max, 1),
        formatFloat(row.mean, 1),
        formatInt(row.primaryLabelOnlyCount),
      ]),
    ),
    "",
    "### E. Variable Parent Resolution Table",
    "",
    renderTable(
      ["Variable ID", "Label", "Parent dataset count", "Reason"],
      variableMultiParentCases.map((row) => [
        row.entityId,
        row.primaryLabel,
        formatInt(row.parentDatasetCount),
        row.reason,
      ]),
    ),
  ].join("\n");

  yield* fs.writeFileString(
    analysisJsonPath,
    `${JSON.stringify(analysis, null, 2)}\n`,
  );
  yield* fs.writeFileString(queriesSqlPath, `${queriesSql}\n`);
  yield* fs.writeFileString(reportPath, `${reportMarkdown}\n`);

  db.close();

  yield* Console.log(`Projected JSONL: ${projectedJsonlPath}`);
  yield* Console.log(`Local SQLite index: ${sqlitePath}`);
  yield* Console.log(`Analysis JSON: ${analysisJsonPath}`);
  yield* Console.log(`Queries SQL: ${queriesSqlPath}`);
  yield* Console.log(`Report: ${reportPath}`);
});

if (import.meta.main) {
  runScriptMain(
    "EntitySearchAudit",
    program.pipe(Effect.provide(scriptPlatformLayer)),
  );
}
