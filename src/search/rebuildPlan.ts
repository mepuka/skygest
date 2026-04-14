import type {
  EntitySearchDocument
} from "../domain/entitySearch";
import {
  entitySearchDocWriteChunkSize,
  entitySearchUrlWriteChunkSize
} from "./documentRows";
import {
  renderDeleteAllEntitySearchSql,
  renderInsertEntitySearchDocsStatement,
  renderInsertEntitySearchDocUrlsStatement,
  renderRebuildEntitySearchFtsStatement,
  toEntitySearchCanonicalUrlInsertRows,
  toEntitySearchDocumentWriteRows
} from "./sqlText";

export type EntitySearchSqlChunk = {
  readonly label: string;
  readonly sql: string;
};

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

const joinStatements = (statements: ReadonlyArray<string>) =>
  `${statements.join(";\n\n")};\n`;

export const buildEntitySearchRebuildSqlChunks = (
  documents: ReadonlyArray<EntitySearchDocument>
): ReadonlyArray<EntitySearchSqlChunk> => {
  const docRows = toEntitySearchDocumentWriteRows(documents);
  const urlRows = toEntitySearchCanonicalUrlInsertRows(documents);

  const docChunks = chunkValues(docRows, entitySearchDocWriteChunkSize).flatMap(
    (rows, index) => {
      const sql = renderInsertEntitySearchDocsStatement(rows);
      return sql === null
        ? []
        : [{
            label: `entity-search-docs-${String(index + 1)}`,
            sql: `${sql};\n`
          }];
    }
  );

  const urlChunks = chunkValues(urlRows, entitySearchUrlWriteChunkSize).flatMap(
    (rows, index) => {
      const sql = renderInsertEntitySearchDocUrlsStatement(rows);
      return sql === null
        ? []
        : [{
            label: `entity-search-urls-${String(index + 1)}`,
            sql: `${sql};\n`
          }];
    }
  );

  return [
    {
      label: "entity-search-reset",
      sql: joinStatements(renderDeleteAllEntitySearchSql())
    },
    ...docChunks,
    ...urlChunks,
    {
      label: "entity-search-fts-rebuild",
      sql: `${renderRebuildEntitySearchFtsStatement()};\n`
    }
  ];
};
