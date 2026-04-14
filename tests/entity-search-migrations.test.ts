import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { SqlClient } from "effect/unstable/sql";
import { runEntitySearchMigrations } from "../src/search/migrate";
import { makeSqliteLayer } from "./support/runtime";

describe("entity search migrations", () => {
  it.effect("create the dedicated search tables and remain idempotent", () =>
    Effect.gen(function* () {
      yield* runEntitySearchMigrations;
      yield* runEntitySearchMigrations;
      const sql = yield* SqlClient.SqlClient;

      const tables = yield* sql<{ name: string }>`
        SELECT name as name
        FROM sqlite_master
        WHERE type IN ('table', 'virtual table')
          AND name IN ('entity_search_docs', 'entity_search_fts')
        ORDER BY name ASC
      `;
      const applied = yield* sql<{ id: number; name: string }>`
        SELECT id as id, name as name
        FROM _migrations
        ORDER BY id ASC
      `;
      const columns = yield* sql<{ name: string }>`
        SELECT name as name
        FROM pragma_table_info('entity_search_docs')
        ORDER BY cid ASC
      `;
      const indexes = yield* sql<{ name: string; isUnique: number }>`
        SELECT name as name, "unique" as isUnique
        FROM pragma_index_list('entity_search_docs')
        WHERE origin = 'c'
        ORDER BY name ASC
      `;

      expect(tables.map((row) => row.name)).toEqual([
        "entity_search_docs",
        "entity_search_fts"
      ]);
      expect(applied).toEqual([
        { id: 1, name: "entity_search_init" }
      ]);
      expect(columns.map((row) => row.name)).toEqual([
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
      ]);
      expect(indexes).toEqual([
        { name: "idx_entity_search_docs_access_hostname", isUnique: 0 },
        { name: "idx_entity_search_docs_dataset_id", isUnique: 0 },
        { name: "idx_entity_search_docs_download_hostname", isUnique: 0 },
        { name: "idx_entity_search_docs_entity_type", isUnique: 0 },
        { name: "idx_entity_search_docs_homepage_hostname", isUnique: 0 },
        { name: "idx_entity_search_docs_landing_page_hostname", isUnique: 0 },
        { name: "idx_entity_search_docs_publisher_agent_id", isUnique: 0 },
        { name: "idx_entity_search_docs_series_id", isUnique: 0 },
        { name: "idx_entity_search_docs_statistic_type", isUnique: 0 },
        { name: "idx_entity_search_docs_unit_family", isUnique: 0 },
        { name: "idx_entity_search_docs_variable_id", isUnique: 0 }
      ]);
    }).pipe(Effect.provide(makeSqliteLayer()))
  );
});
