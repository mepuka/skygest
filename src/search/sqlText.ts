import type {
  EntitySearchDocument,
  EntitySearchEntityId
} from "../domain/entitySearch";
import {
  entitySearchDocumentWriteColumns,
  entitySearchDocumentWriteColumnsWithoutId,
  type EntitySearchDocumentSqlValue,
  type EntitySearchDocumentWriteRow,
  toEntitySearchCanonicalUrlRows,
  toEntitySearchDocumentWriteRow,
  toEntitySearchDocumentWriteValues
} from "./documentRows";

const quoteSqlString = (value: string) =>
  `'${value.replaceAll("'", "''")}'`;

export const renderSqlLiteral = (
  value: EntitySearchDocumentSqlValue
): string => {
  if (value === null) {
    return "NULL";
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : "NULL";
  }

  if (typeof value === "boolean") {
    return value ? "1" : "0";
  }

  return quoteSqlString(value);
};

const renderValuesTuple = (
  values: ReadonlyArray<EntitySearchDocumentSqlValue>
) => `(${values.map(renderSqlLiteral).join(", ")})`;

export const renderInsertEntitySearchDocsStatement = (
  rows: ReadonlyArray<EntitySearchDocumentWriteRow>
): string | null => {
  if (rows.length === 0) {
    return null;
  }

  const valuesSql = rows
    .map((row) => renderValuesTuple(toEntitySearchDocumentWriteValues(row)))
    .join(",\n  ");
  const updateAssignments = entitySearchDocumentWriteColumnsWithoutId
    .map((column) => `${column} = excluded.${column}`)
    .join(", ");

  return `INSERT INTO entity_search_docs (${entitySearchDocumentWriteColumns.join(", ")})
VALUES
  ${valuesSql}
ON CONFLICT(entity_id) DO UPDATE SET ${updateAssignments}`;
};

export const renderInsertEntitySearchDocUrlsStatement = (
  rows: ReadonlyArray<readonly [entityId: EntitySearchEntityId, canonicalUrl: string]>
): string | null => {
  if (rows.length === 0) {
    return null;
  }

  const valuesSql = rows
    .map(([entityId, canonicalUrl]) =>
      renderValuesTuple([entityId, canonicalUrl])
    )
    .join(",\n  ");

  return `INSERT OR IGNORE INTO entity_search_doc_urls (entity_id, canonical_url)
VALUES
  ${valuesSql}`;
};

export const renderRebuildEntitySearchFtsStatement = (
  entityIds?: ReadonlyArray<EntitySearchEntityId>
): string => {
  const scopeSql =
    entityIds === undefined || entityIds.length === 0
      ? ""
      : `
  AND d.entity_id IN (${entityIds.map(renderSqlLiteral).join(", ")})`;

  return `INSERT INTO entity_search_fts (
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
WHERE d.deleted_at IS NULL${scopeSql}`;
};

export const renderDeleteAllEntitySearchSql = () => [
  "DELETE FROM entity_search_fts",
  "DELETE FROM entity_search_doc_urls",
  "DELETE FROM entity_search_docs"
] as const;

export const renderDeleteEntitySearchByIdsSql = (
  entityIds: ReadonlyArray<EntitySearchEntityId>
) =>
  entityIds.length === 0
    ? []
    : [
        `DELETE FROM entity_search_fts WHERE entity_id IN (${entityIds.map(renderSqlLiteral).join(", ")})`,
        `DELETE FROM entity_search_doc_urls WHERE entity_id IN (${entityIds.map(renderSqlLiteral).join(", ")})`,
        `DELETE FROM entity_search_docs WHERE entity_id IN (${entityIds.map(renderSqlLiteral).join(", ")})`
      ];

export const summarizeEntitySearchDocuments = (
  documents: ReadonlyArray<EntitySearchDocument>
) =>
  Object.entries(
    documents.reduce<Record<string, number>>((acc, document) => {
      acc[document.entityType] = (acc[document.entityType] ?? 0) + 1;
      return acc;
    }, {})
  )
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([entityType, count]) => `${entityType}: ${String(count)}`)
    .join(", ");

export const toEntitySearchDocumentWriteRows = (
  documents: ReadonlyArray<EntitySearchDocument>
) => documents.map(toEntitySearchDocumentWriteRow);

export const toEntitySearchCanonicalUrlInsertRows = (
  documents: ReadonlyArray<EntitySearchDocument>
) =>
  toEntitySearchCanonicalUrlRows(
    toEntitySearchDocumentWriteRows(documents)
  );
