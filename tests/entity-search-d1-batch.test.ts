import { D1Client } from "@effect/sql-d1";
import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer, Schema } from "effect";
import {
  EntitySearchDocument
} from "../src/domain/entitySearch";
import {
  mintDatasetId
} from "../src/domain/data-layer";
import { entitySearchSqlLayer } from "../src/search/Layer";
import { EntitySearchRepo } from "../src/services/EntitySearchRepo";
import { EntitySearchRepoD1 } from "../src/services/d1/EntitySearchRepoD1";

type CapturedStatement = {
  readonly query: string;
  readonly params: ReadonlyArray<unknown>;
};

const decodeDocument = Schema.decodeUnknownSync(EntitySearchDocument);

const makeDocument = () => {
  const datasetId = mintDatasetId();

  return decodeDocument({
    entityId: datasetId,
    entityType: "Dataset",
    primaryLabel: "EIA U.S. Electric System Operating Data",
    aliases: [],
    datasetId,
    canonicalUrls: ["eia.gov/electricity/gridmonitor"],
    payloadJson: "{}",
    primaryText: "EIA U.S. Electric System Operating Data",
    aliasText: "EIA Hourly Electric Grid Monitor",
    lineageText: "U.S. Energy Information Administration",
    urlText: "eia.gov/electricity/gridmonitor",
    ontologyText: "electricity grid hourly",
    semanticText: "EIA grid monitor electricity hourly",
    updatedAt: "2026-04-14T00:00:00.000Z"
  });
};

const makeFakeD1Layer = (captures: {
  statements: Array<CapturedStatement>;
  batchCalls: number;
  allCalls: number;
}) => {
  const db = {
    prepare(query: string) {
      const prepared = {
        query,
        params: [] as ReadonlyArray<unknown>,
        bind(...params: ReadonlyArray<unknown>) {
          return {
            query,
            params,
            async all() {
              captures.allCalls += 1;
              return {
                results: [],
                success: true,
                meta: {
                  duration: 0
                }
              };
            },
            async raw() {
              captures.allCalls += 1;
              return [];
            }
          };
        }
      };
      captures.statements.push(prepared);
      return prepared;
    },
    async batch(statements: ReadonlyArray<CapturedStatement>) {
      captures.batchCalls += 1;
      return statements.map(() => ({
        results: [],
        success: true,
        meta: {
          duration: 0
        }
      }));
    }
  } as unknown as D1Database;

  const d1Layer = D1Client.layer({ db });
  const searchSqlLayer = entitySearchSqlLayer(d1Layer);

  return Layer.mergeAll(
    d1Layer,
    searchSqlLayer,
    EntitySearchRepoD1.layer.pipe(
      Layer.provideMerge(Layer.mergeAll(d1Layer, searchSqlLayer))
    )
  );
};

describe("entity search D1 write path", () => {
  it.effect("uses D1 batch writes instead of sql.withTransaction when a Worker D1 binding is present", () => {
    const captures = {
      statements: [] as Array<CapturedStatement>,
      batchCalls: 0,
      allCalls: 0
    };
    const repoLayer = makeFakeD1Layer(captures);

    return Effect.gen(function* () {
      const repo = yield* EntitySearchRepo;

      yield* repo.replaceAllDocuments([makeDocument()]);

      expect(captures.batchCalls).toBe(1);
      expect(captures.allCalls).toBe(0);
      expect(
        captures.statements.some((statement) =>
          statement.query.includes("DELETE FROM entity_search_docs")
        )
      ).toBe(true);
      expect(
        captures.statements.some((statement) =>
          statement.query.includes("INSERT INTO entity_search_docs")
        )
      ).toBe(true);
      expect(
        captures.statements.some((statement) =>
          statement.query.includes("INSERT OR IGNORE INTO entity_search_doc_urls")
        )
      ).toBe(true);
      expect(
        captures.statements.some((statement) =>
          statement.query.includes("INSERT INTO entity_search_fts")
        )
      ).toBe(true);
    }).pipe(Effect.provide(repoLayer));
  });
});
