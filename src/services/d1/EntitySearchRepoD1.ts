import { D1Client } from "@effect/sql-d1";
import { Effect, Layer, Option, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/unstable/sql";
import type { SqlError } from "effect/unstable/sql/SqlError";
import {
  AgentId,
  DatasetId,
  SeriesId,
  VariableId
} from "../../domain/data-layer";
import { DbError } from "../../domain/errors";
import {
  EntitySearchAlias,
  EntitySearchDocument,
  EntitySearchEntityId,
  EntitySearchEntityType,
  EntitySearchHit,
  EntitySearchHostname,
  EntitySearchQueryInput,
  EntitySearchUrl
} from "../../domain/entitySearch";
import { stripUndefined } from "../../platform/Json";
import {
  normalizeDistributionHostname,
  normalizeDistributionUrl
} from "../../platform/Normalize";
import { EntitySearchSql } from "../../search/Layer";
import {
  entitySearchDocumentWriteColumns,
  entitySearchDocumentWriteColumnsWithoutId,
  entitySearchDocWriteChunkSize,
  entitySearchUrlWriteChunkSize,
  toEntitySearchCanonicalUrlRows,
  toEntitySearchDocumentWriteRow,
  toEntitySearchDocumentWriteValues,
  type EntitySearchDocumentWriteRow
} from "../../search/documentRows";
import { sanitizeFtsQuery } from "../../query/sanitizeFts";
import { EntitySearchRepo } from "../EntitySearchRepo";
import { decodeWithDbError, withSchemaDbError } from "./schemaDecode";

const EntitySearchAliasJson = Schema.fromJsonString(
  Schema.Array(EntitySearchAlias)
);
const EntitySearchUrlsJson = Schema.fromJsonString(
  Schema.Array(EntitySearchUrl)
);
const defaultSearchLimit = 20;

const EntitySearchDocumentRowSchema = Schema.Struct({
  entity_id: EntitySearchEntityId,
  entity_type: EntitySearchEntityType,
  primary_label: Schema.String,
  secondary_label: Schema.NullOr(Schema.String),
  publisher_agent_id: Schema.NullOr(AgentId),
  agent_id: Schema.NullOr(AgentId),
  dataset_id: Schema.NullOr(DatasetId),
  variable_id: Schema.NullOr(VariableId),
  series_id: Schema.NullOr(SeriesId),
  measured_property: Schema.NullOr(Schema.String),
  domain_object: Schema.NullOr(Schema.String),
  technology_or_fuel: Schema.NullOr(Schema.String),
  statistic_type: Schema.NullOr(Schema.String),
  aggregation: Schema.NullOr(Schema.String),
  unit_family: Schema.NullOr(Schema.String),
  policy_instrument: Schema.NullOr(Schema.String),
  frequency: Schema.NullOr(Schema.String),
  place: Schema.NullOr(Schema.String),
  market: Schema.NullOr(Schema.String),
  homepage_hostname: Schema.NullOr(EntitySearchHostname),
  landing_page_hostname: Schema.NullOr(EntitySearchHostname),
  access_hostname: Schema.NullOr(EntitySearchHostname),
  download_hostname: Schema.NullOr(EntitySearchHostname),
  canonical_urls_json: EntitySearchUrlsJson,
  aliases_json: EntitySearchAliasJson,
  payload_json: Schema.String,
  primary_text: Schema.String,
  alias_text: Schema.String,
  lineage_text: Schema.String,
  url_text: Schema.String,
  ontology_text: Schema.String,
  semantic_text: Schema.String,
  updated_at: Schema.String
});
type EntitySearchDocumentRow = Schema.Schema.Type<
  typeof EntitySearchDocumentRowSchema
>;

const EntitySearchDocumentUpsertRowSchema = Schema.Struct({
  entity_id: EntitySearchEntityId,
  entity_type: EntitySearchEntityType,
  primary_label: Schema.String,
  secondary_label: Schema.NullOr(Schema.String),
  publisher_agent_id: Schema.NullOr(AgentId),
  agent_id: Schema.NullOr(AgentId),
  dataset_id: Schema.NullOr(DatasetId),
  variable_id: Schema.NullOr(VariableId),
  series_id: Schema.NullOr(SeriesId),
  measured_property: Schema.NullOr(Schema.String),
  domain_object: Schema.NullOr(Schema.String),
  technology_or_fuel: Schema.NullOr(Schema.String),
  statistic_type: Schema.NullOr(Schema.String),
  aggregation: Schema.NullOr(Schema.String),
  unit_family: Schema.NullOr(Schema.String),
  policy_instrument: Schema.NullOr(Schema.String),
  frequency: Schema.NullOr(Schema.String),
  place: Schema.NullOr(Schema.String),
  market: Schema.NullOr(Schema.String),
  homepage_hostname: Schema.NullOr(EntitySearchHostname),
  landing_page_hostname: Schema.NullOr(EntitySearchHostname),
  access_hostname: Schema.NullOr(EntitySearchHostname),
  download_hostname: Schema.NullOr(EntitySearchHostname),
  canonical_urls_json: EntitySearchUrlsJson,
  aliases_json: EntitySearchAliasJson,
  payload_json: Schema.String,
  primary_text: Schema.String,
  alias_text: Schema.String,
  lineage_text: Schema.String,
  url_text: Schema.String,
  ontology_text: Schema.String,
  semantic_text: Schema.String,
  updated_at: Schema.String,
  deleted_at: Schema.Null
});
type EntitySearchDocumentUpsertRow = Schema.Schema.Type<
  typeof EntitySearchDocumentUpsertRowSchema
>;

const EntitySearchFtsRowSchema = Schema.Struct({
  entity_id: EntitySearchEntityId,
  entity_type: EntitySearchEntityType,
  primary_text: Schema.String,
  alias_text: Schema.String,
  lineage_text: Schema.String,
  url_text: Schema.String,
  ontology_text: Schema.String
});
type EntitySearchFtsRow = Schema.Schema.Type<typeof EntitySearchFtsRowSchema>;

const EntitySearchLexicalRowSchema = Schema.Struct({
  entity_id: EntitySearchEntityId,
  entity_type: EntitySearchEntityType,
  primary_label: Schema.String,
  secondary_label: Schema.NullOr(Schema.String),
  publisher_agent_id: Schema.NullOr(AgentId),
  agent_id: Schema.NullOr(AgentId),
  dataset_id: Schema.NullOr(DatasetId),
  variable_id: Schema.NullOr(VariableId),
  series_id: Schema.NullOr(SeriesId),
  measured_property: Schema.NullOr(Schema.String),
  domain_object: Schema.NullOr(Schema.String),
  technology_or_fuel: Schema.NullOr(Schema.String),
  statistic_type: Schema.NullOr(Schema.String),
  aggregation: Schema.NullOr(Schema.String),
  unit_family: Schema.NullOr(Schema.String),
  policy_instrument: Schema.NullOr(Schema.String),
  frequency: Schema.NullOr(Schema.String),
  place: Schema.NullOr(Schema.String),
  market: Schema.NullOr(Schema.String),
  homepage_hostname: Schema.NullOr(EntitySearchHostname),
  landing_page_hostname: Schema.NullOr(EntitySearchHostname),
  access_hostname: Schema.NullOr(EntitySearchHostname),
  download_hostname: Schema.NullOr(EntitySearchHostname),
  canonical_urls_json: EntitySearchUrlsJson,
  aliases_json: EntitySearchAliasJson,
  payload_json: Schema.String,
  primary_text: Schema.String,
  alias_text: Schema.String,
  lineage_text: Schema.String,
  url_text: Schema.String,
  ontology_text: Schema.String,
  semantic_text: Schema.String,
  updated_at: Schema.String,
  snippet: Schema.NullOr(Schema.String),
  raw_rank: Schema.Number
});
type EntitySearchLexicalRow = Schema.Schema.Type<
  typeof EntitySearchLexicalRowSchema
>;

type D1BatchBindValue = string | number | boolean | null;

const chunkValues = <A>(
  values: ReadonlyArray<A>,
  size: number
): ReadonlyArray<ReadonlyArray<A>> => {
  const chunks: Array<ReadonlyArray<A>> = [];

  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }

  return chunks;
};

const makeBatchDbError = (cause: unknown, message: string) =>
  new DbError({
    message: cause instanceof Error ? `${message}: ${cause.message}` : message
  });

const toDocument = (row: EntitySearchDocumentRow) =>
  decodeWithDbError(
    EntitySearchDocument,
    stripUndefined({
      entityId: row.entity_id,
      entityType: row.entity_type,
      primaryLabel: row.primary_label,
      secondaryLabel: row.secondary_label ?? undefined,
      aliases: row.aliases_json,
      publisherAgentId: row.publisher_agent_id ?? undefined,
      agentId: row.agent_id ?? undefined,
      datasetId: row.dataset_id ?? undefined,
      variableId: row.variable_id ?? undefined,
      seriesId: row.series_id ?? undefined,
      measuredProperty: row.measured_property ?? undefined,
      domainObject: row.domain_object ?? undefined,
      technologyOrFuel: row.technology_or_fuel ?? undefined,
      statisticType: row.statistic_type ?? undefined,
      aggregation: row.aggregation ?? undefined,
      unitFamily: row.unit_family ?? undefined,
      policyInstrument: row.policy_instrument ?? undefined,
      frequency: row.frequency ?? undefined,
      place: row.place ?? undefined,
      market: row.market ?? undefined,
      homepageHostname: row.homepage_hostname ?? undefined,
      landingPageHostname: row.landing_page_hostname ?? undefined,
      accessHostname: row.access_hostname ?? undefined,
      downloadHostname: row.download_hostname ?? undefined,
      canonicalUrls: row.canonical_urls_json,
      payloadJson: row.payload_json,
      primaryText: row.primary_text,
      aliasText: row.alias_text,
      lineageText: row.lineage_text,
      urlText: row.url_text,
      ontologyText: row.ontology_text,
      semanticText: row.semantic_text,
      updatedAt: row.updated_at
    }),
    `Failed to normalize entity-search row for ${row.entity_id}`
  );

const toFtsRow = (document: EntitySearchDocument): EntitySearchFtsRow => ({
  entity_id: document.entityId,
  entity_type: document.entityType,
  primary_text: document.primaryText,
  alias_text: document.aliasText,
  lineage_text: document.lineageText,
  url_text: document.urlText,
  ontology_text: document.ontologyText
});

const prepareBulkDocumentUpsertStatement = (
  db: D1Database,
  rows: ReadonlyArray<EntitySearchDocumentWriteRow>
): D1PreparedStatement | null => {
  if (rows.length === 0) {
    return null;
  }

  const placeholders = rows
    .map(
      () => `(${entitySearchDocumentWriteColumns.map(() => "?").join(", ")})`
    )
    .join(", ");
  const updateAssignments = entitySearchDocumentWriteColumnsWithoutId
    .map((column) => `${column} = excluded.${column}`)
    .join(", ");
  const values = rows.flatMap((row) =>
    toEntitySearchDocumentWriteValues(row) as ReadonlyArray<D1BatchBindValue>
  );

  return db.prepare(
    `INSERT INTO entity_search_docs (${entitySearchDocumentWriteColumns.join(", ")})
     VALUES ${placeholders}
     ON CONFLICT(entity_id) DO UPDATE SET ${updateAssignments}`
  ).bind(...values);
};

const prepareInsertCanonicalUrlStatement = (
  db: D1Database,
  rows: ReadonlyArray<readonly [entityId: string, canonicalUrl: string]>
): D1PreparedStatement | null => {
  if (rows.length === 0) {
    return null;
  }

  const placeholders = rows.map(() => "(?, ?)").join(", ");
  const values = rows.flatMap(([entityId, canonicalUrl]) => [
    entityId,
    canonicalUrl
  ]);

  return db.prepare(
    `INSERT OR IGNORE INTO entity_search_doc_urls (entity_id, canonical_url)
     VALUES ${placeholders}`
  ).bind(...values);
};

const prepareDeleteRowsByEntityIdsStatement = (
  db: D1Database,
  table: "entity_search_fts" | "entity_search_docs" | "entity_search_doc_urls",
  column: "entity_id",
  entityIds: ReadonlyArray<EntitySearchEntityId>
): D1PreparedStatement | null => {
  if (entityIds.length === 0) {
    return null;
  }

  const placeholders = entityIds.map(() => "?").join(", ");
  return db.prepare(
    `DELETE FROM ${table} WHERE ${column} IN (${placeholders})`
  ).bind(...entityIds);
};

const prepareRebuildFtsInsertStatement = (
  db: D1Database,
  entityIds?: ReadonlyArray<EntitySearchEntityId>
): D1PreparedStatement => {
  if (entityIds === undefined || entityIds.length === 0) {
    return db.prepare(
      `INSERT INTO entity_search_fts (
         entity_id,
         entity_type,
         primary_text,
         alias_text,
         lineage_text,
         url_text,
         ontology_text
       )
       SELECT
         d.entity_id,
         d.entity_type,
         d.primary_text,
         d.alias_text,
         d.lineage_text,
         d.url_text,
         d.ontology_text
       FROM entity_search_docs d
       WHERE d.deleted_at IS NULL`
    );
  }

  const placeholders = entityIds.map(() => "?").join(", ");
  return db.prepare(
    `INSERT INTO entity_search_fts (
       entity_id,
       entity_type,
       primary_text,
       alias_text,
       lineage_text,
       url_text,
       ontology_text
     )
     SELECT
       d.entity_id,
       d.entity_type,
       d.primary_text,
       d.alias_text,
       d.lineage_text,
       d.url_text,
       d.ontology_text
     FROM entity_search_docs d
     WHERE d.deleted_at IS NULL
       AND d.entity_id IN (${placeholders})`
  ).bind(...entityIds);
};

const runD1Batch = (
  db: D1Database,
  statements: ReadonlyArray<D1PreparedStatement | null>,
  operation: string
) => {
  const prepared = statements.filter(
    (statement): statement is D1PreparedStatement => statement !== null
  );

  return prepared.length === 0
    ? Effect.void
    : Effect.tryPromise({
        try: () => db.batch(Array.from(prepared)),
        catch: (cause) =>
          makeBatchDbError(cause, `Failed to execute D1 batch for ${operation}`)
      }).pipe(Effect.asVoid);
};

const dedupeValues = <A extends string>(
  values: ReadonlyArray<A> | undefined
): ReadonlyArray<A> | undefined => {
  if (values === undefined) {
    return undefined;
  }

  const unique = [...new Set(values)];
  return unique.length === 0 ? undefined : unique;
};

const normalizeExactUrls = (
  values: ReadonlyArray<string> | undefined
): ReadonlyArray<string> | undefined => {
  if (values === undefined) {
    return undefined;
  }

  const normalized = values.flatMap((value) => {
    const exact = normalizeDistributionUrl(value);
    return exact === null ? [] : [exact];
  });

  return dedupeValues(normalized);
};

const normalizeExactHostnames = (
  values: ReadonlyArray<string> | undefined
): ReadonlyArray<string> | undefined => {
  if (values === undefined) {
    return undefined;
  }

  const normalized = values.flatMap((value) => {
    const exact = normalizeDistributionHostname(value);
    return exact === null ? [] : [exact];
  });

  return dedupeValues(normalized);
};

const normalizeQueryInput = (
  input: EntitySearchQueryInput
): NormalizedEntitySearchQuery =>
  stripUndefined({
    query: input.query?.trim().length === 0 ? undefined : input.query?.trim(),
    entityTypes: dedupeValues(input.entityTypes),
    scope: input.scope === undefined
      ? undefined
      : stripUndefined({
          publisherAgentId: input.scope.publisherAgentId,
          agentId: input.scope.agentId,
          datasetId: input.scope.datasetId,
          variableId: input.scope.variableId,
          seriesId: input.scope.seriesId,
          measuredProperty: input.scope.measuredProperty,
          domainObject: input.scope.domainObject,
          technologyOrFuel: input.scope.technologyOrFuel,
          statisticType: input.scope.statisticType,
          aggregation: input.scope.aggregation,
          unitFamily: input.scope.unitFamily,
          policyInstrument: input.scope.policyInstrument,
          frequency: input.scope.frequency,
          place: input.scope.place,
          market: input.scope.market,
          homepageHostname:
            input.scope.homepageHostname === undefined
              ? undefined
              : normalizeDistributionHostname(input.scope.homepageHostname) ?? undefined,
          landingPageHostname:
            input.scope.landingPageHostname === undefined
              ? undefined
              : normalizeDistributionHostname(input.scope.landingPageHostname) ?? undefined,
          accessHostname:
            input.scope.accessHostname === undefined
              ? undefined
              : normalizeDistributionHostname(input.scope.accessHostname) ?? undefined,
          downloadHostname:
            input.scope.downloadHostname === undefined
              ? undefined
              : normalizeDistributionHostname(input.scope.downloadHostname) ?? undefined
        }),
    exactCanonicalUrls: normalizeExactUrls(input.exactCanonicalUrls),
    exactHostnames: normalizeExactHostnames(input.exactHostnames),
    limit: input.limit
  });

const rawRankToScore = (rawRank: number) =>
  1 / (1 + Math.abs(rawRank));

const exactScore = (kind: "exact-url" | "exact-hostname") =>
  kind === "exact-url" ? 100 : 90;

type InputScope = NonNullable<EntitySearchQueryInput["scope"]>;

type NormalizedEntitySearchScope = {
  readonly publisherAgentId?: InputScope["publisherAgentId"];
  readonly agentId?: InputScope["agentId"];
  readonly datasetId?: InputScope["datasetId"];
  readonly variableId?: InputScope["variableId"];
  readonly seriesId?: InputScope["seriesId"];
  readonly measuredProperty?: InputScope["measuredProperty"];
  readonly domainObject?: InputScope["domainObject"];
  readonly technologyOrFuel?: InputScope["technologyOrFuel"];
  readonly statisticType?: InputScope["statisticType"];
  readonly aggregation?: InputScope["aggregation"];
  readonly unitFamily?: InputScope["unitFamily"];
  readonly policyInstrument?: InputScope["policyInstrument"];
  readonly frequency?: InputScope["frequency"];
  readonly place?: InputScope["place"];
  readonly market?: InputScope["market"];
  readonly homepageHostname?: string;
  readonly landingPageHostname?: string;
  readonly accessHostname?: string;
  readonly downloadHostname?: string;
};

type NormalizedEntitySearchQuery = {
  readonly query?: string;
  readonly entityTypes?: EntitySearchQueryInput["entityTypes"];
  readonly scope?: NormalizedEntitySearchScope;
  readonly exactCanonicalUrls?: ReadonlyArray<string>;
  readonly exactHostnames?: ReadonlyArray<string>;
  readonly limit?: EntitySearchQueryInput["limit"];
};

const decodeHitSync = Schema.decodeUnknownSync(EntitySearchHit);

const makeExactHit = (
  document: EntitySearchDocument,
  matchKind: "exact-url" | "exact-hostname",
  score: number,
  snippet: string | null
): EntitySearchHit =>
  decodeHitSync({
    document,
    score,
    rank: 1,
    matchKind,
    snippet
  });

const buildDocumentConditions = (
  sql: SqlClient.SqlClient,
  input: NormalizedEntitySearchQuery
) => {
  const conditions = [
    sql`d.deleted_at IS NULL`
  ];

  if (input.entityTypes !== undefined) {
    conditions.push(
      sql`(${sql.join(" OR ", false)(
        input.entityTypes.map((entityType) => sql`d.entity_type = ${entityType}`)
      )})`
    );
  }

  const scope = input.scope;
  if (scope !== undefined) {
    if (scope.publisherAgentId !== undefined) {
      conditions.push(sql`d.publisher_agent_id = ${scope.publisherAgentId}`);
    }
    if (scope.agentId !== undefined) {
      conditions.push(sql`d.agent_id = ${scope.agentId}`);
    }
    if (scope.datasetId !== undefined) {
      conditions.push(sql`d.dataset_id = ${scope.datasetId}`);
    }
    if (scope.variableId !== undefined) {
      conditions.push(sql`d.variable_id = ${scope.variableId}`);
    }
    if (scope.seriesId !== undefined) {
      conditions.push(sql`d.series_id = ${scope.seriesId}`);
    }
    if (scope.measuredProperty !== undefined) {
      conditions.push(sql`d.measured_property = ${scope.measuredProperty}`);
    }
    if (scope.domainObject !== undefined) {
      conditions.push(sql`d.domain_object = ${scope.domainObject}`);
    }
    if (scope.technologyOrFuel !== undefined) {
      conditions.push(sql`d.technology_or_fuel = ${scope.technologyOrFuel}`);
    }
    if (scope.statisticType !== undefined) {
      conditions.push(sql`d.statistic_type = ${scope.statisticType}`);
    }
    if (scope.aggregation !== undefined) {
      conditions.push(sql`d.aggregation = ${scope.aggregation}`);
    }
    if (scope.unitFamily !== undefined) {
      conditions.push(sql`d.unit_family = ${scope.unitFamily}`);
    }
    if (scope.policyInstrument !== undefined) {
      conditions.push(sql`d.policy_instrument = ${scope.policyInstrument}`);
    }
    if (scope.frequency !== undefined) {
      conditions.push(sql`d.frequency = ${scope.frequency}`);
    }
    if (scope.place !== undefined) {
      conditions.push(sql`d.place = ${scope.place}`);
    }
    if (scope.market !== undefined) {
      conditions.push(sql`d.market = ${scope.market}`);
    }
    if (scope.homepageHostname !== undefined) {
      conditions.push(sql`d.homepage_hostname = ${scope.homepageHostname}`);
    }
    if (scope.landingPageHostname !== undefined) {
      conditions.push(sql`d.landing_page_hostname = ${scope.landingPageHostname}`);
    }
    if (scope.accessHostname !== undefined) {
      conditions.push(sql`d.access_hostname = ${scope.accessHostname}`);
    }
    if (scope.downloadHostname !== undefined) {
      conditions.push(sql`d.download_hostname = ${scope.downloadHostname}`);
    }
  }

  return conditions;
};

const firstMatchingUrl = (
  document: EntitySearchDocument,
  exactCanonicalUrls: ReadonlyArray<string> | undefined
) => exactCanonicalUrls?.find((url) => document.canonicalUrls.includes(url)) ?? null;

const firstMatchingHostname = (
  document: EntitySearchDocument,
  exactHostnames: ReadonlyArray<string> | undefined
) => {
  if (exactHostnames === undefined) {
    return null;
  }

  const candidates = [
    document.homepageHostname,
    document.landingPageHostname,
    document.accessHostname,
    document.downloadHostname
  ].filter((value): value is string => value !== undefined);

  return exactHostnames.find((hostname) => candidates.includes(hostname)) ?? null;
};

export const EntitySearchRepoD1 = {
  layer: Layer.effect(EntitySearchRepo, Effect.gen(function* () {
    const sql = yield* EntitySearchSql;
    const d1Client = yield* Effect.serviceOption(D1Client.D1Client);
    const rawDb = Option.match(d1Client, {
      onNone: () => null,
      onSome: (client) => client.config.db
    });

    const findDocumentRowByEntityId = SqlSchema.findOneOption({
      Request: EntitySearchEntityId,
      Result: EntitySearchDocumentRowSchema,
      execute: (entityId) =>
        sql`
          SELECT
            d.entity_id as entity_id,
            d.entity_type as entity_type,
            d.primary_label as primary_label,
            d.secondary_label as secondary_label,
            d.publisher_agent_id as publisher_agent_id,
            d.agent_id as agent_id,
            d.dataset_id as dataset_id,
            d.variable_id as variable_id,
            d.series_id as series_id,
            d.measured_property as measured_property,
            d.domain_object as domain_object,
            d.technology_or_fuel as technology_or_fuel,
            d.statistic_type as statistic_type,
            d.aggregation as aggregation,
            d.unit_family as unit_family,
            d.policy_instrument as policy_instrument,
            d.frequency as frequency,
            d.place as place,
            d.market as market,
            d.homepage_hostname as homepage_hostname,
            d.landing_page_hostname as landing_page_hostname,
            d.access_hostname as access_hostname,
            d.download_hostname as download_hostname,
            d.canonical_urls_json as canonical_urls_json,
            d.aliases_json as aliases_json,
            d.payload_json as payload_json,
            d.primary_text as primary_text,
            d.alias_text as alias_text,
            d.lineage_text as lineage_text,
            d.url_text as url_text,
            d.ontology_text as ontology_text,
            d.semantic_text as semantic_text,
            d.updated_at as updated_at
          FROM entity_search_docs d
          WHERE d.entity_id = ${entityId}
            AND d.deleted_at IS NULL
          LIMIT 1
        `
    });

    const upsertDocumentRow = SqlSchema.void({
      Request: EntitySearchDocumentUpsertRowSchema,
      execute: (row) =>
        sql`
          INSERT INTO entity_search_docs ${sql.insert(row)}
          ON CONFLICT(entity_id) DO UPDATE SET ${sql.update(row, ["entity_id"])}
        `
    });

    const deleteFtsRowsByEntityIds = (
      entityIds: ReadonlyArray<EntitySearchEntityId>
    ) =>
      entityIds.length === 0
        ? Effect.succeed(void 0)
        : sql`
            DELETE FROM entity_search_fts
            WHERE entity_id IN (${sql.join(", ", false)(
              entityIds.map((entityId) => sql`${entityId}`)
            )})
          `.pipe(Effect.asVoid);

    const deleteDocumentRowsByEntityIds = (
      entityIds: ReadonlyArray<EntitySearchEntityId>
    ) =>
      entityIds.length === 0
        ? Effect.succeed(void 0)
        : sql`
            DELETE FROM entity_search_docs
            WHERE entity_id IN (${sql.join(", ", false)(
              entityIds.map((entityId) => sql`${entityId}`)
            )})
          `.pipe(Effect.asVoid);

    const deleteDocumentUrlRowsByEntityIds = (
      entityIds: ReadonlyArray<EntitySearchEntityId>
    ) =>
      entityIds.length === 0
        ? Effect.succeed(void 0)
        : sql`
            DELETE FROM entity_search_doc_urls
            WHERE entity_id IN (${sql.join(", ", false)(
              entityIds.map((entityId) => sql`${entityId}`)
            )})
          `.pipe(Effect.asVoid);

    const insertFtsRow = SqlSchema.void({
      Request: EntitySearchFtsRowSchema,
      execute: (row) =>
        sql`
          INSERT INTO entity_search_fts (
            entity_id,
            entity_type,
            primary_text,
            alias_text,
            lineage_text,
            url_text,
            ontology_text
          ) VALUES (
            ${row.entity_id},
            ${row.entity_type},
            ${row.primary_text},
            ${row.alias_text},
            ${row.lineage_text},
            ${row.url_text},
            ${row.ontology_text}
          )
        `
    });

    const rebuildFtsBody = sql`
      DELETE FROM entity_search_fts
    `.pipe(
      Effect.asVoid,
      Effect.flatMap(() =>
        sql`
          INSERT INTO entity_search_fts (
            entity_id,
            entity_type,
            primary_text,
            alias_text,
            lineage_text,
            url_text,
            ontology_text
          )
          SELECT
            d.entity_id,
            d.entity_type,
            d.primary_text,
            d.alias_text,
            d.lineage_text,
            d.url_text,
            d.ontology_text
          FROM entity_search_docs d
          WHERE d.deleted_at IS NULL
        `.pipe(Effect.asVoid)
      )
    );

    const insertDocumentUrlRows = (
      entityId: EntitySearchEntityId,
      canonicalUrls: ReadonlyArray<EntitySearchUrl>
    ) =>
      Effect.forEach(
        canonicalUrls,
        (canonicalUrl) =>
          sql`
            INSERT OR IGNORE INTO entity_search_doc_urls (
              entity_id,
              canonical_url
            ) VALUES (
              ${entityId},
              ${canonicalUrl}
            )
          `.pipe(Effect.asVoid),
        { concurrency: 1, discard: true }
      );

    const runD1WriteBatch = (
      operation: string,
      statements: ReadonlyArray<D1PreparedStatement | null>
    ) =>
      rawDb === null
        ? Effect.fail(
            new DbError({
              message: `Missing D1 database binding for ${operation}`
            })
          )
        : runD1Batch(rawDb, statements, operation);

    const makeD1ReplaceAllStatements = (
      rows: ReadonlyArray<EntitySearchDocumentWriteRow>
    ) => {
      if (rawDb === null) {
        return [] as ReadonlyArray<D1PreparedStatement | null>;
      }

      const urlRows = toEntitySearchCanonicalUrlRows(rows);
      return [
        rawDb.prepare("DELETE FROM entity_search_fts"),
        rawDb.prepare("DELETE FROM entity_search_doc_urls"),
        rawDb.prepare("DELETE FROM entity_search_docs"),
        ...chunkValues(rows, entitySearchDocWriteChunkSize).map((chunk) =>
          prepareBulkDocumentUpsertStatement(rawDb, chunk)
        ),
        ...chunkValues(urlRows, entitySearchUrlWriteChunkSize).map((chunk) =>
          prepareInsertCanonicalUrlStatement(rawDb, chunk)
        ),
        prepareRebuildFtsInsertStatement(rawDb)
      ];
    };

    const makeD1UpsertStatements = (
      rows: ReadonlyArray<EntitySearchDocumentWriteRow>
    ) => {
      if (rawDb === null) {
        return [] as ReadonlyArray<D1PreparedStatement | null>;
      }

      const entityIds = rows.map((row) => row.entity_id);
      const urlRows = toEntitySearchCanonicalUrlRows(rows);
      return [
        ...chunkValues(entityIds, entitySearchUrlWriteChunkSize).map((chunk) =>
          prepareDeleteRowsByEntityIdsStatement(
            rawDb,
            "entity_search_fts",
            "entity_id",
            chunk
          )
        ),
        ...chunkValues(entityIds, entitySearchUrlWriteChunkSize).map((chunk) =>
          prepareDeleteRowsByEntityIdsStatement(
            rawDb,
            "entity_search_doc_urls",
            "entity_id",
            chunk
          )
        ),
        ...chunkValues(rows, entitySearchDocWriteChunkSize).map((chunk) =>
          prepareBulkDocumentUpsertStatement(rawDb, chunk)
        ),
        ...chunkValues(urlRows, entitySearchUrlWriteChunkSize).map((chunk) =>
          prepareInsertCanonicalUrlStatement(rawDb, chunk)
        ),
        ...chunkValues(entityIds, entitySearchUrlWriteChunkSize).map((chunk) =>
          prepareRebuildFtsInsertStatement(rawDb, chunk)
        )
      ];
    };

    const makeD1DeleteStatements = (
      entityIds: ReadonlyArray<EntitySearchEntityId>
    ) => {
      if (rawDb === null) {
        return [] as ReadonlyArray<D1PreparedStatement | null>;
      }

      return [
        ...chunkValues(entityIds, entitySearchUrlWriteChunkSize).map((chunk) =>
          prepareDeleteRowsByEntityIdsStatement(
            rawDb,
            "entity_search_fts",
            "entity_id",
            chunk
          )
        ),
        ...chunkValues(entityIds, entitySearchUrlWriteChunkSize).map((chunk) =>
          prepareDeleteRowsByEntityIdsStatement(
            rawDb,
            "entity_search_doc_urls",
            "entity_id",
            chunk
          )
        ),
        ...chunkValues(entityIds, entitySearchUrlWriteChunkSize).map((chunk) =>
          prepareDeleteRowsByEntityIdsStatement(
            rawDb,
            "entity_search_docs",
            "entity_id",
            chunk
          )
        )
      ];
    };

    const replaceAllDocuments = (
      documents: ReadonlyArray<EntitySearchDocument>
    ) =>
      Effect.forEach(
        documents,
        (document) =>
          decodeWithDbError(
            EntitySearchDocument,
            document,
            `Invalid entity-search document for ${document.entityId}`
          ),
        { concurrency: 1 }
      ).pipe(
        Effect.flatMap((validated) => {
          const rows = validated.map(toEntitySearchDocumentWriteRow);

          return rawDb === null
            ? sql.withTransaction(
                Effect.gen(function* () {
                  yield* sql`DELETE FROM entity_search_fts`.pipe(Effect.asVoid);
                  yield* sql`DELETE FROM entity_search_doc_urls`.pipe(
                    Effect.asVoid
                  );
                  yield* sql`DELETE FROM entity_search_docs`.pipe(Effect.asVoid);

                  for (const document of validated) {
                    yield* withSchemaDbError(
                      upsertDocumentRow(toEntitySearchDocumentWriteRow(document)),
                      `Failed to persist entity-search document ${document.entityId}`
                    );
                    yield* insertDocumentUrlRows(
                      document.entityId,
                      document.canonicalUrls
                    );
                  }

                  yield* rebuildFtsBody;
                })
              )
            : runD1WriteBatch(
                "replaceAllDocuments",
                makeD1ReplaceAllStatements(rows)
              );
        })
      );

    const upsertDocuments = (
      documents: ReadonlyArray<EntitySearchDocument>
    ) =>
      Effect.forEach(
        documents,
        (document) =>
          decodeWithDbError(
            EntitySearchDocument,
            document,
            `Invalid entity-search document for ${document.entityId}`
          ),
        { concurrency: 1 }
      ).pipe(
        Effect.flatMap((validated) => {
          const rows = validated.map(toEntitySearchDocumentWriteRow);

          return rawDb === null
            ? sql.withTransaction(
                Effect.gen(function* () {
                  const entityIds = validated.map((document) => document.entityId);

                  yield* deleteFtsRowsByEntityIds(entityIds);
                  yield* deleteDocumentUrlRowsByEntityIds(entityIds);

                  for (const document of validated) {
                    yield* withSchemaDbError(
                      upsertDocumentRow(toEntitySearchDocumentWriteRow(document)),
                      `Failed to persist entity-search document ${document.entityId}`
                    );
                    yield* insertDocumentUrlRows(
                      document.entityId,
                      document.canonicalUrls
                    );
                    yield* withSchemaDbError(
                      insertFtsRow(toFtsRow(document)),
                      `Failed to persist entity-search FTS row ${document.entityId}`
                    );
                  }
                })
              )
            : runD1WriteBatch(
                "upsertDocuments",
                makeD1UpsertStatements(rows)
              );
        })
      );

    const deleteDocuments = (
      entityIds: ReadonlyArray<EntitySearchEntityId>
    ) =>
      Effect.forEach(
        entityIds,
        (entityId) =>
          decodeWithDbError(
            EntitySearchEntityId,
            entityId,
            `Invalid entity-search entity id ${String(entityId)}`
          ),
        { concurrency: 1 }
      ).pipe(
        Effect.flatMap((validated): Effect.Effect<void, SqlError | DbError> =>
          rawDb === null
            ? sql.withTransaction(
                Effect.gen(function* () {
                  yield* deleteFtsRowsByEntityIds(validated);
                  yield* deleteDocumentUrlRowsByEntityIds(validated);
                  yield* deleteDocumentRowsByEntityIds(validated);
                })
              )
            : runD1WriteBatch(
                "deleteDocuments",
                makeD1DeleteStatements(validated)
              )
        )
      );

    const getByEntityId = (entityId: EntitySearchEntityId) =>
      decodeWithDbError(
        EntitySearchEntityId,
        entityId,
        `Invalid entity-search entity id ${String(entityId)}`
      ).pipe(
        Effect.flatMap((validated) =>
          withSchemaDbError(
            findDocumentRowByEntityId(validated),
            `Failed to decode entity-search row for ${validated}`
          ).pipe(
            Effect.flatMap(
              Option.match({
                onNone: () => Effect.succeed(null),
                onSome: toDocument
              })
            )
          )
        )
      );

    const getManyByEntityId = (
      entityIds: ReadonlyArray<EntitySearchEntityId>
    ) =>
      decodeWithDbError(
        Schema.Array(EntitySearchEntityId),
        entityIds,
        "Invalid entity-search entity ids"
      ).pipe(
        Effect.map((validated) => [...new Set(validated)]),
        Effect.flatMap((validated) => {
          if (validated.length === 0) {
            return Effect.succeed([] as ReadonlyArray<EntitySearchDocument>);
          }

          return sql<any>`
            SELECT
              d.entity_id as entity_id,
              d.entity_type as entity_type,
              d.primary_label as primary_label,
              d.secondary_label as secondary_label,
              d.publisher_agent_id as publisher_agent_id,
              d.agent_id as agent_id,
              d.dataset_id as dataset_id,
              d.variable_id as variable_id,
              d.series_id as series_id,
              d.measured_property as measured_property,
              d.domain_object as domain_object,
              d.technology_or_fuel as technology_or_fuel,
              d.statistic_type as statistic_type,
              d.aggregation as aggregation,
              d.unit_family as unit_family,
              d.policy_instrument as policy_instrument,
              d.frequency as frequency,
              d.place as place,
              d.market as market,
              d.homepage_hostname as homepage_hostname,
              d.landing_page_hostname as landing_page_hostname,
              d.access_hostname as access_hostname,
              d.download_hostname as download_hostname,
              d.canonical_urls_json as canonical_urls_json,
              d.aliases_json as aliases_json,
              d.payload_json as payload_json,
              d.primary_text as primary_text,
              d.alias_text as alias_text,
              d.lineage_text as lineage_text,
              d.url_text as url_text,
              d.ontology_text as ontology_text,
              d.semantic_text as semantic_text,
              d.updated_at as updated_at
            FROM entity_search_docs d
            WHERE d.deleted_at IS NULL
              AND d.entity_id IN (${sql.join(", ", false)(
                validated.map((entityId) => sql`${entityId}`)
              )})
            ORDER BY d.entity_id ASC
          `.pipe(
            Effect.flatMap((rows) =>
              decodeWithDbError(
                Schema.Array(EntitySearchDocumentRowSchema),
                rows,
                "Failed to decode batched entity-search rows"
              )
            ),
            Effect.flatMap((rows) =>
              Effect.forEach(rows, toDocument, { concurrency: 1 })
            )
          );
        })
      );

    const searchExactUrlDocuments = (
      input: NormalizedEntitySearchQuery
    ) => {
      const exactCanonicalUrls = input.exactCanonicalUrls;
      if (exactCanonicalUrls === undefined || exactCanonicalUrls.length === 0) {
        return Effect.succeed([] as ReadonlyArray<EntitySearchDocument>);
      }

      const conditions = buildDocumentConditions(sql, input);
      conditions.push(
        sql`EXISTS (
          SELECT 1
          FROM entity_search_doc_urls exact_url
          WHERE exact_url.entity_id = d.entity_id
            AND exact_url.canonical_url IN (${sql.join(", ", false)(
              exactCanonicalUrls.map((canonicalUrl) => sql`${canonicalUrl}`)
            )})
        )`
      );

      return sql<any>`
        SELECT
          d.entity_id as entity_id,
          d.entity_type as entity_type,
          d.primary_label as primary_label,
          d.secondary_label as secondary_label,
          d.publisher_agent_id as publisher_agent_id,
          d.agent_id as agent_id,
          d.dataset_id as dataset_id,
          d.variable_id as variable_id,
          d.series_id as series_id,
          d.measured_property as measured_property,
          d.domain_object as domain_object,
          d.technology_or_fuel as technology_or_fuel,
          d.statistic_type as statistic_type,
          d.aggregation as aggregation,
          d.unit_family as unit_family,
          d.policy_instrument as policy_instrument,
          d.frequency as frequency,
          d.place as place,
          d.market as market,
          d.homepage_hostname as homepage_hostname,
          d.landing_page_hostname as landing_page_hostname,
          d.access_hostname as access_hostname,
          d.download_hostname as download_hostname,
          d.canonical_urls_json as canonical_urls_json,
          d.aliases_json as aliases_json,
          d.payload_json as payload_json,
          d.primary_text as primary_text,
          d.alias_text as alias_text,
          d.lineage_text as lineage_text,
          d.url_text as url_text,
          d.ontology_text as ontology_text,
          d.semantic_text as semantic_text,
          d.updated_at as updated_at
        FROM entity_search_docs d
        WHERE ${sql.join(" AND ", false)(conditions)}
        ORDER BY d.updated_at DESC, d.entity_id ASC
        LIMIT ${input.limit ?? defaultSearchLimit}
      `.pipe(
        Effect.flatMap((rows) =>
          decodeWithDbError(
            Schema.Array(EntitySearchDocumentRowSchema),
            rows,
            "Failed to decode exact-url entity-search rows"
          )
        ),
        Effect.flatMap((rows) => Effect.forEach(rows, toDocument, { concurrency: 1 }))
      );
    };

    const searchExactHostnameDocuments = (
      input: NormalizedEntitySearchQuery
    ) => {
      const exactHostnames = input.exactHostnames;
      if (exactHostnames === undefined || exactHostnames.length === 0) {
        return Effect.succeed([] as ReadonlyArray<EntitySearchDocument>);
      }

      const conditions = buildDocumentConditions(sql, input);
      conditions.push(
        sql`(${sql.join(" OR ", false)(
          exactHostnames.map((hostname) =>
            sql`(
              d.homepage_hostname = ${hostname}
              OR d.landing_page_hostname = ${hostname}
              OR d.access_hostname = ${hostname}
              OR d.download_hostname = ${hostname}
            )`
          )
        )})`
      );

      return sql<any>`
        SELECT
          d.entity_id as entity_id,
          d.entity_type as entity_type,
          d.primary_label as primary_label,
          d.secondary_label as secondary_label,
          d.publisher_agent_id as publisher_agent_id,
          d.agent_id as agent_id,
          d.dataset_id as dataset_id,
          d.variable_id as variable_id,
          d.series_id as series_id,
          d.measured_property as measured_property,
          d.domain_object as domain_object,
          d.technology_or_fuel as technology_or_fuel,
          d.statistic_type as statistic_type,
          d.aggregation as aggregation,
          d.unit_family as unit_family,
          d.policy_instrument as policy_instrument,
          d.frequency as frequency,
          d.place as place,
          d.market as market,
          d.homepage_hostname as homepage_hostname,
          d.landing_page_hostname as landing_page_hostname,
          d.access_hostname as access_hostname,
          d.download_hostname as download_hostname,
          d.canonical_urls_json as canonical_urls_json,
          d.aliases_json as aliases_json,
          d.payload_json as payload_json,
          d.primary_text as primary_text,
          d.alias_text as alias_text,
          d.lineage_text as lineage_text,
          d.url_text as url_text,
          d.ontology_text as ontology_text,
          d.semantic_text as semantic_text,
          d.updated_at as updated_at
        FROM entity_search_docs d
        WHERE ${sql.join(" AND ", false)(conditions)}
        ORDER BY d.updated_at DESC, d.entity_id ASC
        LIMIT ${input.limit ?? defaultSearchLimit}
      `.pipe(
        Effect.flatMap((rows) =>
          decodeWithDbError(
            Schema.Array(EntitySearchDocumentRowSchema),
            rows,
            "Failed to decode exact-hostname entity-search rows"
          )
        ),
        Effect.flatMap((rows) => Effect.forEach(rows, toDocument, { concurrency: 1 }))
      );
    };

    const searchLexicalDocuments = (
      input: NormalizedEntitySearchQuery
    ) => {
      const sanitizedQuery =
        input.query === undefined ? "" : sanitizeFtsQuery(input.query);
      if (sanitizedQuery.length === 0) {
        return Effect.succeed([] as ReadonlyArray<EntitySearchHit>);
      }

      const conditions = buildDocumentConditions(sql, input);

      return sql<any>`
        SELECT
          d.entity_id as entity_id,
          d.entity_type as entity_type,
          d.primary_label as primary_label,
          d.secondary_label as secondary_label,
          d.publisher_agent_id as publisher_agent_id,
          d.agent_id as agent_id,
          d.dataset_id as dataset_id,
          d.variable_id as variable_id,
          d.series_id as series_id,
          d.measured_property as measured_property,
          d.domain_object as domain_object,
          d.technology_or_fuel as technology_or_fuel,
          d.statistic_type as statistic_type,
          d.aggregation as aggregation,
          d.unit_family as unit_family,
          d.policy_instrument as policy_instrument,
          d.frequency as frequency,
          d.place as place,
          d.market as market,
          d.homepage_hostname as homepage_hostname,
          d.landing_page_hostname as landing_page_hostname,
          d.access_hostname as access_hostname,
          d.download_hostname as download_hostname,
          d.canonical_urls_json as canonical_urls_json,
          d.aliases_json as aliases_json,
          d.payload_json as payload_json,
          d.primary_text as primary_text,
          d.alias_text as alias_text,
          d.lineage_text as lineage_text,
          d.url_text as url_text,
          d.ontology_text as ontology_text,
          d.semantic_text as semantic_text,
          d.updated_at as updated_at,
          snippet(entity_search_fts, 2, '<mark>', '</mark>', '...', 12) as snippet,
          bm25(entity_search_fts, 10.0, 6.0, 4.0, 3.0, 2.0) as raw_rank
        FROM entity_search_fts
        JOIN entity_search_docs d ON d.entity_id = entity_search_fts.entity_id
        WHERE entity_search_fts MATCH ${sanitizedQuery}
          AND ${sql.join(" AND ", false)(conditions)}
        ORDER BY raw_rank ASC, d.updated_at DESC, d.entity_id ASC
        LIMIT ${input.limit ?? defaultSearchLimit}
      `.pipe(
        Effect.flatMap((rows) =>
          decodeWithDbError(
            Schema.Array(EntitySearchLexicalRowSchema),
            rows,
            "Failed to decode lexical entity-search rows"
          )
        ),
        Effect.flatMap((rows) =>
          Effect.forEach(
            rows,
            (row) =>
              toDocument(row).pipe(
                Effect.flatMap((document) =>
                  decodeWithDbError(
                    EntitySearchHit,
                    {
                      document,
                      score: rawRankToScore(row.raw_rank),
                      rank: 1,
                      matchKind: "lexical",
                      snippet: row.snippet
                    },
                    `Failed to normalize lexical entity-search hit ${row.entity_id}`
                  )
                )
              ),
            { concurrency: 1 }
          )
        )
      );
    };

    const rebuildFts = () =>
      rawDb === null
        ? sql.withTransaction(rebuildFtsBody)
        : runD1WriteBatch("rebuildFts", [
            rawDb.prepare("DELETE FROM entity_search_fts"),
            prepareRebuildFtsInsertStatement(rawDb)
          ]);

    const optimizeFts = () =>
      sql`
        INSERT INTO entity_search_fts(entity_search_fts)
        VALUES ('optimize')
      `.pipe(Effect.asVoid);

    const searchLexical = (input: EntitySearchQueryInput) =>
      decodeWithDbError(
        EntitySearchQueryInput,
        input,
        "Invalid entity-search query input"
      ).pipe(
        Effect.map(normalizeQueryInput),
        Effect.flatMap((validated) => {
          const limit = validated.limit ?? defaultSearchLimit;
          const hasExactUrls =
            validated.exactCanonicalUrls !== undefined &&
            validated.exactCanonicalUrls.length > 0;
          const hasExactHostnames =
            validated.exactHostnames !== undefined &&
            validated.exactHostnames.length > 0;
          const hasLexicalQuery =
            validated.query !== undefined &&
            sanitizeFtsQuery(validated.query).length > 0;

          if (!hasExactUrls && !hasExactHostnames && !hasLexicalQuery) {
            return Effect.succeed([]);
          }

          return Effect.all({
            exactUrlDocs: searchExactUrlDocuments({
              ...validated,
              limit
            }),
            exactHostnameDocs: searchExactHostnameDocuments({
              ...validated,
              limit
            }),
            lexicalHits: searchLexicalDocuments({
              ...validated,
              limit
            })
          }).pipe(
            Effect.flatMap(({ exactUrlDocs, exactHostnameDocs, lexicalHits }) => {
              const merged = new Map<string, EntitySearchHit>();

              for (const document of exactUrlDocs) {
                if (merged.has(document.entityId)) {
                  continue;
                }

                const snippet =
                  firstMatchingUrl(document, validated.exactCanonicalUrls) ??
                  null;
                const hit = makeExactHit(
                  document,
                  "exact-url",
                  exactScore("exact-url"),
                  snippet
                );
                merged.set(document.entityId, hit);
              }

              for (const document of exactHostnameDocs) {
                if (merged.has(document.entityId)) {
                  continue;
                }

                const snippet =
                  firstMatchingHostname(document, validated.exactHostnames) ??
                  null;
                const hit = makeExactHit(
                  document,
                  "exact-hostname",
                  exactScore("exact-hostname"),
                  snippet
                );
                merged.set(document.entityId, hit);
              }

              for (const hit of lexicalHits) {
                if (merged.has(hit.document.entityId)) {
                  continue;
                }
                merged.set(hit.document.entityId, hit);
              }

              return Effect.forEach(
                [...merged.values()].slice(0, limit),
                (hit, index) =>
                  decodeWithDbError(
                    EntitySearchHit,
                    {
                      ...hit,
                      rank: index + 1
                    },
                    `Failed to normalize ranked entity-search hit ${hit.document.entityId}`
                  ),
                { concurrency: 1 }
              );
            })
          );
        })
      );

    return EntitySearchRepo.of({
      replaceAllDocuments,
      upsertDocuments,
      deleteDocuments,
      getByEntityId,
      getManyByEntityId,
      searchLexical,
      rebuildFts,
      optimizeFts
    });
  }))
};
