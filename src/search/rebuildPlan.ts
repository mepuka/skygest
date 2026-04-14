import type {
  EntitySearchDocument
} from "../domain/entitySearch";
import {
  entitySearchDocScriptRowsPerStatement,
  entitySearchDocScriptStatementsPerFile,
  entitySearchUrlScriptRowsPerStatement,
  entitySearchUrlScriptStatementsPerFile
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

const bundleStatementsIntoFiles = (
  statements: ReadonlyArray<string>,
  statementsPerFile: number,
  labelPrefix: string
): ReadonlyArray<EntitySearchSqlChunk> =>
  chunkValues(statements, statementsPerFile).map((group, index) => ({
    label: `${labelPrefix}-${String(index + 1)}`,
    sql: `${group.join("\n")}\n`
  }));

export const buildEntitySearchRebuildSqlChunks = (
  documents: ReadonlyArray<EntitySearchDocument>
): ReadonlyArray<EntitySearchSqlChunk> => {
  const docRows = toEntitySearchDocumentWriteRows(documents);
  const urlRows = toEntitySearchCanonicalUrlInsertRows(documents);

  const docInsertStatements = chunkValues(
    docRows,
    entitySearchDocScriptRowsPerStatement
  ).flatMap((rows) => {
    const sql = renderInsertEntitySearchDocsStatement(rows);
    return sql === null ? [] : [`${sql};`];
  });

  const urlInsertStatements = chunkValues(
    urlRows,
    entitySearchUrlScriptRowsPerStatement
  ).flatMap((rows) => {
    const sql = renderInsertEntitySearchDocUrlsStatement(rows);
    return sql === null ? [] : [`${sql};`];
  });

  const docChunks = bundleStatementsIntoFiles(
    docInsertStatements,
    entitySearchDocScriptStatementsPerFile,
    "entity-search-docs"
  );

  const urlChunks = bundleStatementsIntoFiles(
    urlInsertStatements,
    entitySearchUrlScriptStatementsPerFile,
    "entity-search-urls"
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
