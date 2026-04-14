import { Schema } from "effect";
import type {
  EntitySearchDocument,
  EntitySearchEntityId
} from "../domain/entitySearch";
import type {
  AgentId,
  DatasetId,
  SeriesId,
  VariableId
} from "../domain/data-layer";
import { encodeJsonStringWith } from "../platform/Json";
import {
  EntitySearchAlias,
  EntitySearchUrl
} from "../domain/entitySearch";

export type EntitySearchDocumentWriteRow = {
  readonly entity_id: EntitySearchDocument["entityId"];
  readonly entity_type: EntitySearchDocument["entityType"];
  readonly primary_label: EntitySearchDocument["primaryLabel"];
  readonly secondary_label: string | null;
  readonly publisher_agent_id: AgentId | null;
  readonly agent_id: AgentId | null;
  readonly dataset_id: DatasetId | null;
  readonly variable_id: VariableId | null;
  readonly series_id: SeriesId | null;
  readonly measured_property: string | null;
  readonly domain_object: string | null;
  readonly technology_or_fuel: string | null;
  readonly statistic_type: string | null;
  readonly aggregation: string | null;
  readonly unit_family: string | null;
  readonly policy_instrument: string | null;
  readonly frequency: string | null;
  readonly place: string | null;
  readonly market: string | null;
  readonly homepage_hostname: string | null;
  readonly landing_page_hostname: string | null;
  readonly access_hostname: string | null;
  readonly download_hostname: string | null;
  readonly canonical_urls_json: EntitySearchDocument["canonicalUrls"];
  readonly aliases_json: EntitySearchDocument["aliases"];
  readonly payload_json: EntitySearchDocument["payloadJson"];
  readonly primary_text: EntitySearchDocument["primaryText"];
  readonly alias_text: EntitySearchDocument["aliasText"];
  readonly lineage_text: EntitySearchDocument["lineageText"];
  readonly url_text: EntitySearchDocument["urlText"];
  readonly ontology_text: EntitySearchDocument["ontologyText"];
  readonly semantic_text: EntitySearchDocument["semanticText"];
  readonly updated_at: EntitySearchDocument["updatedAt"];
  readonly deleted_at: null;
};

export const entitySearchDocumentWriteColumns = [
  "entity_id",
  "entity_type",
  "primary_label",
  "secondary_label",
  "publisher_agent_id",
  "agent_id",
  "dataset_id",
  "variable_id",
  "series_id",
  "measured_property",
  "domain_object",
  "technology_or_fuel",
  "statistic_type",
  "aggregation",
  "unit_family",
  "policy_instrument",
  "frequency",
  "place",
  "market",
  "homepage_hostname",
  "landing_page_hostname",
  "access_hostname",
  "download_hostname",
  "canonical_urls_json",
  "aliases_json",
  "payload_json",
  "primary_text",
  "alias_text",
  "lineage_text",
  "url_text",
  "ontology_text",
  "semantic_text",
  "updated_at",
  "deleted_at"
] as const satisfies ReadonlyArray<keyof EntitySearchDocumentWriteRow>;

export const entitySearchDocumentWriteColumnsWithoutId =
  entitySearchDocumentWriteColumns.filter(
    (column) => column !== "entity_id"
  ) as ReadonlyArray<
    Exclude<(typeof entitySearchDocumentWriteColumns)[number], "entity_id">
  >;

export const entitySearchDocWriteChunkSize = 25;
export const entitySearchUrlWriteChunkSize = 100;

const encodeAliasesJson = encodeJsonStringWith(Schema.Array(EntitySearchAlias));
const encodeUrlsJson = encodeJsonStringWith(Schema.Array(EntitySearchUrl));

export type EntitySearchDocumentSqlValue = string | number | boolean | null;

export const toEntitySearchDocumentWriteRow = (
  document: EntitySearchDocument
): EntitySearchDocumentWriteRow => ({
  entity_id: document.entityId,
  entity_type: document.entityType,
  primary_label: document.primaryLabel,
  secondary_label: document.secondaryLabel ?? null,
  publisher_agent_id: document.publisherAgentId ?? null,
  agent_id: document.agentId ?? null,
  dataset_id: document.datasetId ?? null,
  variable_id: document.variableId ?? null,
  series_id: document.seriesId ?? null,
  measured_property: document.measuredProperty ?? null,
  domain_object: document.domainObject ?? null,
  technology_or_fuel: document.technologyOrFuel ?? null,
  statistic_type: document.statisticType ?? null,
  aggregation: document.aggregation ?? null,
  unit_family: document.unitFamily ?? null,
  policy_instrument: document.policyInstrument ?? null,
  frequency: document.frequency ?? null,
  place: document.place ?? null,
  market: document.market ?? null,
  homepage_hostname: document.homepageHostname ?? null,
  landing_page_hostname: document.landingPageHostname ?? null,
  access_hostname: document.accessHostname ?? null,
  download_hostname: document.downloadHostname ?? null,
  canonical_urls_json: document.canonicalUrls,
  aliases_json: document.aliases,
  payload_json: document.payloadJson,
  primary_text: document.primaryText,
  alias_text: document.aliasText,
  lineage_text: document.lineageText,
  url_text: document.urlText,
  ontology_text: document.ontologyText,
  semantic_text: document.semanticText,
  updated_at: document.updatedAt,
  deleted_at: null
});

export const toEntitySearchDocumentWriteValues = (
  row: EntitySearchDocumentWriteRow
): ReadonlyArray<EntitySearchDocumentSqlValue> =>
  entitySearchDocumentWriteColumns.map((column) => {
    switch (column) {
      case "aliases_json":
        return encodeAliasesJson(row.aliases_json);
      case "canonical_urls_json":
        return encodeUrlsJson(row.canonical_urls_json);
      default:
        return row[column] as EntitySearchDocumentSqlValue;
    }
  });

export const toEntitySearchCanonicalUrlRows = (
  rows: ReadonlyArray<EntitySearchDocumentWriteRow>
): ReadonlyArray<readonly [entityId: EntitySearchEntityId, canonicalUrl: string]> =>
  rows.flatMap((row) =>
    row.canonical_urls_json.map(
      (canonicalUrl) =>
        [row.entity_id, canonicalUrl] as const
    )
  );
