import { describe, expect, it } from "@effect/vitest";
import { SearchDbScriptError } from "../src/domain/errors";
import { entitySearchMigrations } from "../src/search/migrations";
import { renderSearchMigrationSql } from "../src/search/migrationSql";

describe("renderSearchMigrationSql", () => {
  it("renders the search migrations plus migration bookkeeping", () => {
    const sql = renderSearchMigrationSql(entitySearchMigrations, 1234567890);

    expect(sql).toContain("CREATE TABLE IF NOT EXISTS _migrations");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS entity_search_docs");
    expect(sql).toContain("CREATE VIRTUAL TABLE IF NOT EXISTS entity_search_fts");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS entity_search_doc_urls");
    expect(sql).toContain("INSERT OR IGNORE INTO _migrations");
    expect(sql).toContain("1234567890");
  });

  it("fails on imperative migrations that cannot be rendered safely", () => {
    expect(() =>
      renderSearchMigrationSql([
        {
          id: 99,
          name: "imperative",
          run: () => {
            throw new Error("not used");
          }
        }
      ])
    ).toThrow(SearchDbScriptError);
  });
});
