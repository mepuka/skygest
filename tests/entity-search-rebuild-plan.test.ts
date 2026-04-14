import { describe, expect, it } from "@effect/vitest";
import { Schema } from "effect";
import {
  mintDatasetId
} from "../src/domain/data-layer";
import { EntitySearchDocument } from "../src/domain/entitySearch";
import { buildEntitySearchRebuildSqlChunks } from "../src/search/rebuildPlan";

const decodeDocument = Schema.decodeUnknownSync(EntitySearchDocument);

const makeDocument = (index: number) => {
  const datasetId = mintDatasetId();

  return decodeDocument({
    entityId: datasetId,
    entityType: "Dataset",
    primaryLabel: index === 0 ? "Operator's dataset" : `Dataset ${String(index)}`,
    aliases: [],
    datasetId,
    canonicalUrls: [`example.com/datasets/${String(index)}`],
    payloadJson: "{}",
    primaryText: index === 0 ? "Operator's dataset" : `Dataset ${String(index)}`,
    aliasText: `Alias ${String(index)}`,
    lineageText: "U.S. Energy Information Administration",
    urlText: `example.com/datasets/${String(index)}`,
    ontologyText: "electricity grid hourly",
    semanticText: "hourly electricity dataset",
    updatedAt: "2026-04-14T00:00:00.000Z"
  });
};

describe("buildEntitySearchRebuildSqlChunks", () => {
  it("creates a reset chunk, bundled inserts, and an FTS rebuild chunk", () => {
    // 250 docs → 50 INSERT statements (5 rows each) → 3 doc files (20 stmts each)
    const documents = Array.from({ length: 250 }, (_, index) => makeDocument(index));
    const chunks = buildEntitySearchRebuildSqlChunks(documents);

    expect(chunks[0]?.label).toBe("entity-search-reset");
    expect(chunks.at(-1)?.label).toBe("entity-search-fts-rebuild");

    const docFiles = chunks.filter((chunk) =>
      chunk.label.startsWith("entity-search-docs-")
    );
    expect(docFiles.length).toBeGreaterThanOrEqual(2);
    expect(docFiles[0]?.sql).toContain("INSERT INTO entity_search_docs");
    expect(docFiles[0]?.sql.match(/INSERT INTO entity_search_docs/g)?.length).toBeGreaterThan(1);

    expect(
      chunks.some((chunk) => chunk.label === "entity-search-urls-1")
    ).toBe(true);
    expect(chunks.at(-1)?.sql).toContain("INSERT INTO entity_search_fts");
  });

  it("escapes SQL string literals in rendered insert statements", () => {
    const [reset, docsChunk] = buildEntitySearchRebuildSqlChunks([makeDocument(0)]);

    expect(reset?.sql).toContain("DELETE FROM entity_search_docs");
    expect(docsChunk?.sql).toContain("Operator''s dataset");
  });
});
