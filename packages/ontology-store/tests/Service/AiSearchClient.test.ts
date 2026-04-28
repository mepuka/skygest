import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer } from "effect";

import {
  AiSearchClient,
  EntitySearchService,
  ExpertUnifiedProjection,
  ExpertProjectionFixture,
  makeAiSearchAdapter,
  type AiSearchInstanceBinding,
  type AiSearchItemInfo,
  type AiSearchNamespaceBinding,
  type AiSearchSearchRequest
} from "../../src";

const makeFakeNamespace = () => {
  const uploads: Array<{
    readonly name: string;
    readonly content: string;
    readonly metadata: Readonly<Record<string, unknown>> | undefined;
  }> = [];
  const deletes: string[] = [];
  const searches: AiSearchSearchRequest[] = [];
  const items: AiSearchItemInfo[] = [
    {
      id: "old-item",
      key: "entities/expert/old.md",
      status: "completed",
      metadata: {
        entity_type: "Expert",
        iri: ExpertProjectionFixture.fixture.iri,
        topic: "old",
        authority: "old",
        time_bucket: "unknown"
      }
    }
  ];

  const instance: AiSearchInstanceBinding = {
    items: {
      list: (params) => {
        const page = params?.page ?? 1;
        const perPage = params?.per_page ?? 100;
        const start = (page - 1) * perPage;
        const result = items.slice(start, start + perPage);
        return Promise.resolve({
          result,
          result_info: {
            count: result.length,
            page,
            per_page: perPage,
            total_count: items.length
          }
        });
      },
      upload: (name, content, options) => {
        uploads.push({ name, content, metadata: options?.metadata });
        const item: AiSearchItemInfo =
          options?.metadata === undefined
            ? {
                id: `item-${uploads.length}`,
                key: name,
                status: "completed"
              }
            : {
                id: `item-${uploads.length}`,
                key: name,
                status: "completed",
                metadata: options.metadata
              };
        items.push(item);
        return Promise.resolve(item);
      },
      delete: (itemId) => {
        deletes.push(itemId);
        const index = items.findIndex((item) => item.id === itemId);
        if (index >= 0) items.splice(index, 1);
        return Promise.resolve();
      }
    },
    search: (request) => {
      searches.push(request);
      return Promise.resolve({
        search_query: "hydrogen expert",
        chunks: [
          {
            id: "chunk-1",
            type: "text",
            score: 0.82,
            text: "Fixture Expert is a grid researcher.",
            item: {
              key: "entities/expert/did_plc_fixture.md",
              metadata: {
                entity_type: "Expert",
                iri: ExpertProjectionFixture.fixture.iri,
                topic: "grid",
                authority: "core",
                time_bucket: "unknown"
              }
            }
          }
        ]
      });
    }
  };

  const namespace: AiSearchNamespaceBinding = {
    get: (name) => {
      expect(name).toBe("entity-search");
      return instance;
    }
  };

  return { namespace, uploads, deletes, searches, items };
};

describe("AiSearchClient", () => {
  it.effect("builds projection adapters over the namespace binding upload API", () =>
    Effect.gen(function* () {
      const fake = makeFakeNamespace();
      const adapter = yield* makeAiSearchAdapter(ExpertUnifiedProjection).pipe(
        Effect.provide(AiSearchClient.layer(fake.namespace))
      );

      yield* adapter.upsert(ExpertProjectionFixture.fixture);

      expect(fake.uploads).toHaveLength(1);
      expect(fake.uploads[0]?.name).toBe("entities/expert/did_plc_fixture.md");
      expect(fake.uploads[0]?.metadata).toEqual({
        entity_type: "Expert",
        iri: ExpertProjectionFixture.fixture.iri,
        topic: "grid",
        authority: "core",
        time_bucket: "unknown"
      });
      expect(fake.uploads[0]?.content).toContain("# Fixture Expert");
    })
  );

  it.effect("renames by deleting previous keys before writing the current key", () =>
    Effect.gen(function* () {
      const fake = makeFakeNamespace();
      const projection = {
        ...ExpertUnifiedProjection,
        previousKeys: () => ["entities/expert/old.md"]
      };
      const adapter = yield* makeAiSearchAdapter(projection).pipe(
        Effect.provide(AiSearchClient.layer(fake.namespace))
      );

      yield* adapter.rename(ExpertProjectionFixture.fixture);

      expect(fake.deletes).toEqual(["old-item"]);
      expect(fake.uploads[0]?.name).toBe("entities/expert/did_plc_fixture.md");
    })
  );

  it.effect("searches the unified instance with typed metadata filters", () => {
    const fake = makeFakeNamespace();
    const serviceLayer = EntitySearchService.layer.pipe(
      Layer.provide(AiSearchClient.layer(fake.namespace))
    );
    return Effect.gen(function* () {
      const search = yield* EntitySearchService;

      const results = yield* search.search({
        query: "hydrogen expert",
        filters: {
          entity_type: ["Expert", "Organization"],
          topic: ["grid"]
        },
        maxResults: 5
      });

      expect(fake.searches).toHaveLength(1);
      expect(
        fake.searches[0]?.ai_search_options?.retrieval?.filters
      ).toEqual({
        entity_type: { $in: ["Expert", "Organization"] },
        topic: { $eq: "grid" }
      });
      expect(results).toEqual([
        {
          entityType: "Expert",
          iri: ExpertProjectionFixture.fixture.iri,
          key: "entities/expert/did_plc_fixture.md",
          score: 0.82,
          text: "Fixture Expert is a grid researcher.",
          metadata: {
            entity_type: "Expert",
            iri: ExpertProjectionFixture.fixture.iri,
            topic: "grid",
            authority: "core",
            time_bucket: "unknown"
          }
        }
      ]);
    }).pipe(Effect.provide(serviceLayer))
  });
});
