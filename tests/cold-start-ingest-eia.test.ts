import { describe, expect, it } from "@effect/vitest";
import * as BunFileSystem from "@effect/platform-bun/BunFileSystem";
import * as BunPath from "@effect/platform-bun/BunPath";
import { Effect, Graph, Layer } from "effect";
import { HttpClient, HttpClientResponse } from "effect/unstable/http";
import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as nodePath from "node:path";
import type {
  Agent,
  Catalog,
  CatalogRecord,
  DataService,
  Dataset,
  Distribution
} from "../src/domain/data-layer";
import {
  buildIngestGraph,
  type EiaApiResponse,
  EiaIngestSchemaError,
  fetchRoute,
  type IngestNode,
  loadCatalogIndex,
  walkRoutes
} from "../scripts/cold-start-ingest-eia";

const jsonResponse = (
  request: Parameters<typeof HttpClientResponse.fromWeb>[0],
  body: unknown
) =>
  HttpClientResponse.fromWeb(
    request,
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" }
    })
  );

const makeHttpLayer = (
  handler: Parameters<typeof HttpClient.make>[0]
) => Layer.succeed(HttpClient.HttpClient, HttpClient.make(handler));

describe("fetchRoute", () => {
  it.effect("decodes a leaf route response into EiaApiResponse", () =>
    Effect.gen(function* () {
      const result = yield* fetchRoute(
        "electricity/retail-sales",
        "fake-key"
      );
      expect(result.response.id).toBe("retail-sales");
      expect(result.response.routes).toBeUndefined();
      expect(result.response.facets).toEqual([]);
    }).pipe(
      Effect.provide(
        makeHttpLayer((request, url) =>
          Effect.gen(function* () {
            // The fetcher must hit the EIA v2 base + the route path with
            // a trailing slash, and pass api_key as a urlParam.
            expect(url.host).toBe("api.eia.gov");
            expect(url.pathname).toBe("/v2/electricity/retail-sales/");
            expect(url.searchParams.get("api_key")).toBe("fake-key");
            return jsonResponse(request, {
              response: {
                id: "retail-sales",
                name: "Electricity Sales",
                facets: []
              }
            });
          })
        )
      )
    )
  );

  it.effect("decodes a parent route response carrying child routes", () =>
    Effect.gen(function* () {
      const result = yield* fetchRoute("electricity", "fake-key");
      expect(result.response.id).toBe("electricity");
      expect(result.response.routes).toEqual([
        { id: "retail-sales", name: "Retail Sales" },
        { id: "rto", name: "Real-Time Operations" }
      ]);
    }).pipe(
      Effect.provide(
        makeHttpLayer((request) =>
          Effect.succeed(
            jsonResponse(request, {
              response: {
                id: "electricity",
                name: "Electricity",
                routes: [
                  { id: "retail-sales", name: "Retail Sales" },
                  { id: "rto", name: "Real-Time Operations" }
                ]
              }
            })
          )
        )
      )
    )
  );

  it.effect("decodes the empty root route (path = '')", () =>
    Effect.gen(function* () {
      const result = yield* fetchRoute("", "fake-key");
      expect(result.response.id).toBe("root");
    }).pipe(
      Effect.provide(
        makeHttpLayer((request, url) =>
          Effect.gen(function* () {
            // Empty route should hit the bare /v2/ endpoint, no extra slashes.
            expect(url.pathname).toBe("/v2/");
            return jsonResponse(request, {
              response: { id: "root", name: "EIA API" }
            });
          })
        )
      )
    )
  );
});

describe("walkRoutes", () => {
  const collectRoutes = (
    map: Iterable<readonly [string, EiaApiResponse]>
  ): Array<string> => {
    const out: Array<string> = [];
    for (const [route] of map) out.push(route);
    return out.sort();
  };

  it.effect("walks a 2-level route tree and collects every response", () =>
    Effect.gen(function* () {
      const fakeResponses: Record<string, EiaApiResponse> = {
        "": {
          response: {
            id: "root",
            routes: [{ id: "electricity", name: "Electricity" }]
          }
        },
        electricity: {
          response: {
            id: "electricity",
            routes: [{ id: "retail-sales", name: "Retail Sales" }]
          }
        },
        "electricity/retail-sales": {
          response: { id: "retail-sales", facets: [] }
        }
      };
      const fakeFetcher = (route: string) =>
        Effect.succeed(fakeResponses[route]!);

      const result = yield* walkRoutes(fakeFetcher);
      expect(collectRoutes(result)).toEqual([
        "",
        "electricity",
        "electricity/retail-sales"
      ]);
    })
  );

  it.effect("walks only a subtree when startRoute is provided", () =>
    Effect.gen(function* () {
      const fakeResponses: Record<string, EiaApiResponse> = {
        electricity: {
          response: {
            id: "electricity",
            routes: [{ id: "retail-sales", name: "Retail Sales" }]
          }
        },
        "electricity/retail-sales": {
          response: { id: "retail-sales", facets: [] }
        }
      };
      const fakeFetcher = (route: string) =>
        Effect.succeed(fakeResponses[route]!);

      const result = yield* walkRoutes(fakeFetcher, "electricity");
      expect(collectRoutes(result)).toEqual([
        "electricity",
        "electricity/retail-sales"
      ]);
    })
  );

  it.effect("handles a single leaf with no children", () =>
    Effect.gen(function* () {
      const fakeResponses: Record<string, EiaApiResponse> = {
        "petroleum/pri/spt": {
          response: { id: "spt", facets: [] }
        }
      };
      const fakeFetcher = (route: string) =>
        Effect.succeed(fakeResponses[route]!);

      const result = yield* walkRoutes(fakeFetcher, "petroleum/pri/spt");
      expect(collectRoutes(result)).toEqual(["petroleum/pri/spt"]);
    })
  );

  it.effect("does not re-fetch a route that has already been seen", () =>
    Effect.gen(function* () {
      const callCounts: Record<string, number> = {};
      const fakeResponses: Record<string, EiaApiResponse> = {
        "": {
          response: {
            id: "root",
            // Same child appears twice — walkRoutes must dedupe via `seen`.
            routes: [
              { id: "electricity", name: "E1" },
              { id: "electricity", name: "E2" }
            ]
          }
        },
        electricity: {
          response: { id: "electricity", facets: [] }
        }
      };
      const fakeFetcher = (route: string) =>
        Effect.sync(() => {
          callCounts[route] = (callCounts[route] ?? 0) + 1;
        }).pipe(Effect.flatMap(() => Effect.succeed(fakeResponses[route]!)));

      yield* walkRoutes(fakeFetcher);
      expect(callCounts["electricity"]).toBe(1);
    })
  );
});

// ---------------------------------------------------------------------------
// IngestGraph
// ---------------------------------------------------------------------------

// Cast through `unknown` to satisfy the IsoTimestamp brand without
// pulling Schema decoders into every fake builder.
const NOW = "2026-04-10T00:00:00.000Z" as unknown as Agent["createdAt"];

// Hand-rolled fake nodes for graph tests. The IDs match the URI pattern
// enforced by the branded ID schemas (10+ alphanumeric chars after the
// prefix); we cast through `unknown` because the brand is opaque.
const fakeAgent = (slug: string, ulid: string): IngestNode => ({
  _tag: "agent",
  slug,
  data: {
    _tag: "Agent",
    id: `https://id.skygest.io/agent/ag_${ulid}` as unknown as Agent["id"],
    kind: "organization",
    name: slug,
    aliases: [],
    createdAt: NOW,
    updatedAt: NOW
  }
});

const fakeCatalog = (
  slug: string,
  ulid: string,
  publisherId: Agent["id"]
): IngestNode => ({
  _tag: "catalog",
  slug,
  data: {
    _tag: "Catalog",
    id: `https://id.skygest.io/catalog/cat_${ulid}` as unknown as Catalog["id"],
    title: slug,
    publisherAgentId: publisherId,
    aliases: [],
    createdAt: NOW,
    updatedAt: NOW
  }
});

const fakeDataset = (
  slug: string,
  ulid: string,
  publisherId: Agent["id"]
): IngestNode => ({
  _tag: "dataset",
  slug,
  merged: false,
  data: {
    _tag: "Dataset",
    id: `https://id.skygest.io/dataset/ds_${ulid}` as unknown as Dataset["id"],
    title: slug,
    publisherAgentId: publisherId,
    aliases: [],
    createdAt: NOW,
    updatedAt: NOW
  }
});

const fakeDistribution = (
  slug: string,
  ulid: string,
  datasetId: Dataset["id"]
): IngestNode => ({
  _tag: "distribution",
  slug,
  data: {
    _tag: "Distribution",
    id: `https://id.skygest.io/distribution/dist_${ulid}` as unknown as Distribution["id"],
    datasetId,
    kind: "api-access",
    aliases: [],
    createdAt: NOW,
    updatedAt: NOW
  }
});

const fakeDataService = (
  slug: string,
  ulid: string,
  publisherId: Agent["id"],
  servesDatasetIds: ReadonlyArray<Dataset["id"]>
): IngestNode => ({
  _tag: "data-service",
  slug,
  data: {
    _tag: "DataService",
    id: `https://id.skygest.io/data-service/svc_${ulid}` as unknown as DataService["id"],
    title: slug,
    publisherAgentId: publisherId,
    endpointURLs: ["https://api.example.org/"],
    servesDatasetIds,
    aliases: [],
    createdAt: NOW,
    updatedAt: NOW
  }
});

const fakeCatalogRecord = (
  slug: string,
  ulid: string,
  catalogId: Catalog["id"],
  primaryTopicId: Dataset["id"]
): IngestNode => ({
  _tag: "catalog-record",
  slug,
  data: {
    _tag: "CatalogRecord",
    id: `https://id.skygest.io/catalog-record/cr_${ulid}` as unknown as CatalogRecord["id"],
    catalogId,
    primaryTopicType: "dataset",
    primaryTopicId
  }
});

describe("buildIngestGraph", () => {
  it("produces a 6-node, 6-edge acyclic graph for a single leaf", () => {
    const agent = fakeAgent("eia", "01KNQEZ5V57VJJJFYV6HWM03VB");
    const catalog = fakeCatalog(
      "eia",
      "01KNQEZ5V57VJJJFYV6HWM03VC",
      (agent.data as Agent).id
    );
    const dataset = fakeDataset(
      "eia-electricity-retail-sales",
      "01KNQSXEPQHNVM0AVMA3SQRNK3",
      (agent.data as Agent).id
    );
    const distribution = fakeDistribution(
      "eia-electricity-retail-sales-api",
      "01KNQSXEPQE7D85JBAFH47Y9MS",
      (dataset.data as Dataset).id
    );
    const dataService = fakeDataService(
      "eia-api",
      "01KNQEZ5VHS74DM94ABW2ZM93Y",
      (agent.data as Agent).id,
      [(dataset.data as Dataset).id]
    );
    const cr = fakeCatalogRecord(
      "eia-electricity-retail-sales-cr",
      "01KNQSXEPQHNVM0AVMA3SQRNK4",
      (catalog.data as Catalog).id,
      (dataset.data as Dataset).id
    );

    const graph = buildIngestGraph([
      agent,
      catalog,
      dataset,
      distribution,
      dataService,
      cr
    ]);

    expect(Graph.nodeCount(graph)).toBe(6);
    // 3 publishes (agent→catalog, agent→dataset, agent→data-service) +
    // 1 contains-record (catalog→cr) +
    // 1 has-distribution (dataset→distribution) +
    // 1 primary-topic-of (dataset→cr) +
    // 1 served-by (dataset→data-service)
    expect(Graph.edgeCount(graph)).toBe(7);
    expect(Graph.isAcyclic(graph)).toBe(true);
  });

  it("emits Agent before Catalog before Dataset before {Distribution, CR, DataService} in topological order", () => {
    const agent = fakeAgent("eia", "01KNQEZ5V57VJJJFYV6HWM03VB");
    const catalog = fakeCatalog(
      "eia",
      "01KNQEZ5V57VJJJFYV6HWM03VC",
      (agent.data as Agent).id
    );
    const dataset = fakeDataset(
      "eia-electricity-retail-sales",
      "01KNQSXEPQHNVM0AVMA3SQRNK3",
      (agent.data as Agent).id
    );
    const distribution = fakeDistribution(
      "eia-electricity-retail-sales-api",
      "01KNQSXEPQE7D85JBAFH47Y9MS",
      (dataset.data as Dataset).id
    );
    const dataService = fakeDataService(
      "eia-api",
      "01KNQEZ5VHS74DM94ABW2ZM93Y",
      (agent.data as Agent).id,
      [(dataset.data as Dataset).id]
    );
    const cr = fakeCatalogRecord(
      "eia-electricity-retail-sales-cr",
      "01KNQSXEPQHNVM0AVMA3SQRNK4",
      (catalog.data as Catalog).id,
      (dataset.data as Dataset).id
    );

    const graph = buildIngestGraph([
      // Intentionally jumbled — buildIngestGraph + topo must reorder.
      cr,
      distribution,
      dataService,
      dataset,
      catalog,
      agent
    ]);

    const topoOrder = Array.from(Graph.values(Graph.topo(graph)));
    const positions = new Map<string, number>();
    topoOrder.forEach((node, idx) => positions.set(node.slug, idx));

    // Agent must come before Catalog, Dataset, and DataService
    expect(positions.get("eia")! < positions.get("eia-api")!).toBe(true);
    expect(positions.get("eia")! < positions.get("eia-electricity-retail-sales")!).toBe(true);
    // Dataset must come before its Distribution + CR + DataService
    expect(
      positions.get("eia-electricity-retail-sales")! <
        positions.get("eia-electricity-retail-sales-api")!
    ).toBe(true);
    expect(
      positions.get("eia-electricity-retail-sales")! <
        positions.get("eia-electricity-retail-sales-cr")!
    ).toBe(true);
    expect(
      positions.get("eia-electricity-retail-sales")! <
        positions.get("eia-api")!
    ).toBe(true);
    // Catalog must come before its CR
    expect(
      positions.get("eia")! <
        positions.get("eia-electricity-retail-sales-cr")!
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// loadCatalogIndex
// ---------------------------------------------------------------------------

// Real Bun/Node FS layer so the loader can hit an actual temp directory.
// Tests (unlike src/) are allowed to import node:* modules — see CLAUDE.md
// toolchain rules.
const bunFsLayer = Layer.mergeAll(BunFileSystem.layer, BunPath.layer);

interface FixtureEntity {
  readonly slug: string;
  readonly body: unknown;
}

interface FixtureSpec {
  readonly datasets?: ReadonlyArray<FixtureEntity>;
  readonly distributions?: ReadonlyArray<FixtureEntity>;
  readonly catalogRecords?: ReadonlyArray<FixtureEntity>;
  readonly dataServices?: ReadonlyArray<FixtureEntity>;
  readonly catalogs?: ReadonlyArray<FixtureEntity>;
  readonly agents?: ReadonlyArray<FixtureEntity>;
}

// Map each FixtureSpec key onto the on-disk subdirectory loadCatalogIndex
// walks. Kept as a single table so we never drift between "what the test
// can seed" and "what the loader reads".
const FIXTURE_SUBDIRS: ReadonlyArray<
  readonly [keyof FixtureSpec, string]
> = [
  ["datasets", "datasets"],
  ["distributions", "distributions"],
  ["catalogRecords", "catalog-records"],
  ["dataServices", "data-services"],
  ["catalogs", "catalogs"],
  ["agents", "agents"]
];

/**
 * Creates a temp fixture with the six catalog subdirectories and writes
 * any provided entity JSON blobs under the matching directory. Returns the
 * root directory path; caller is responsible for cleanup.
 */
const makeTmpFixture = async (entities: FixtureSpec): Promise<string> => {
  const tmp = await fsp.mkdtemp(
    nodePath.join(os.tmpdir(), "cold-start-index-")
  );
  const catalogDir = nodePath.join(tmp, "catalog");
  // All six subdirs must exist — loadCatalogIndex reads every one and
  // surfaces ENOENT as EiaIngestFsError.
  for (const [, sub] of FIXTURE_SUBDIRS) {
    await fsp.mkdir(nodePath.join(catalogDir, sub), { recursive: true });
  }
  for (const [key, sub] of FIXTURE_SUBDIRS) {
    for (const entity of entities[key] ?? []) {
      await fsp.writeFile(
        nodePath.join(catalogDir, sub, `${entity.slug}.json`),
        `${JSON.stringify(entity.body, null, 2)}\n`,
        "utf-8"
      );
    }
  }
  return tmp;
};

const cleanup = (tmp: string): Promise<void> =>
  fsp.rm(tmp, { recursive: true, force: true });

// Bodies below decode cleanly through Schema.decodeUnknown(<entity>).
// IDs match the branded URI patterns enforced in src/domain/data-layer/ids.ts.
const FIXTURE_NOW = "2026-04-10T00:00:00.000Z";

type FixtureAlias = {
  readonly scheme: string;
  readonly value: string;
  readonly relation: string;
};

const validDatasetBody = (
  title: string,
  ulid: string,
  aliases: ReadonlyArray<FixtureAlias>,
  publisherAgentId: string = "https://id.skygest.io/agent/ag_01KNQEZ5V57VJJJFYV6HWM03VB"
) => ({
  _tag: "Dataset",
  id: `https://id.skygest.io/dataset/ds_${ulid}`,
  title,
  publisherAgentId,
  accessRights: "public",
  createdAt: FIXTURE_NOW,
  updatedAt: FIXTURE_NOW,
  aliases
});

const validAgentBody = (
  name: string,
  ulid: string,
  aliases: ReadonlyArray<FixtureAlias>
) => ({
  _tag: "Agent",
  id: `https://id.skygest.io/agent/ag_${ulid}`,
  kind: "organization",
  name,
  createdAt: FIXTURE_NOW,
  updatedAt: FIXTURE_NOW,
  aliases
});

const validCatalogBody = (
  title: string,
  ulid: string,
  publisherAgentId: string,
  aliases: ReadonlyArray<FixtureAlias>
) => ({
  _tag: "Catalog",
  id: `https://id.skygest.io/catalog/cat_${ulid}`,
  title,
  publisherAgentId,
  createdAt: FIXTURE_NOW,
  updatedAt: FIXTURE_NOW,
  aliases
});

const validDistributionBody = (
  ulid: string,
  datasetId: string,
  aliases: ReadonlyArray<FixtureAlias>
) => ({
  _tag: "Distribution",
  id: `https://id.skygest.io/distribution/dist_${ulid}`,
  datasetId,
  kind: "api-access",
  createdAt: FIXTURE_NOW,
  updatedAt: FIXTURE_NOW,
  aliases
});

// CatalogRecord has NO aliases and NO createdAt/updatedAt — it does not
// carry TimestampedAliasedFields (see src/domain/data-layer/catalog.ts).
const validCatalogRecordBody = (
  ulid: string,
  catalogId: string,
  primaryTopicId: string
) => ({
  _tag: "CatalogRecord",
  id: `https://id.skygest.io/catalog-record/cr_${ulid}`,
  catalogId,
  primaryTopicType: "dataset",
  primaryTopicId
});

const validDataServiceBody = (
  title: string,
  ulid: string,
  publisherAgentId: string,
  servesDatasetIds: ReadonlyArray<string>,
  aliases: ReadonlyArray<FixtureAlias>
) => ({
  _tag: "DataService",
  id: `https://id.skygest.io/data-service/svc_${ulid}`,
  title,
  publisherAgentId,
  endpointURLs: ["https://api.eia.gov/v2/"],
  servesDatasetIds,
  createdAt: FIXTURE_NOW,
  updatedAt: FIXTURE_NOW,
  aliases
});

describe("loadCatalogIndex", () => {
  it.effect("indexes existing EIA dataset by eia-route alias", () =>
    Effect.gen(function* () {
      const tmp = yield* Effect.promise(() =>
        makeTmpFixture({
          datasets: [
            {
              slug: "eia-test",
              body: validDatasetBody(
                "Existing",
                "01KNQSXEPPXRC56GM4SED9D0KX",
                [
                  {
                    scheme: "eia-route",
                    value: "electricity/retail-sales",
                    relation: "exactMatch"
                  }
                ]
              )
            }
          ]
        })
      );

      const result = yield* loadCatalogIndex(tmp).pipe(
        Effect.ensuring(Effect.promise(() => cleanup(tmp)))
      );

      const ds = result.datasetsByRoute.get("electricity/retail-sales");
      expect(ds).toBeDefined();
      expect(ds!.title).toBe("Existing");
      // Sanity-check the rest of the shape
      expect(result.allDatasets.length).toBe(1);
      expect(result.allDistributions.length).toBe(0);
      expect(result.allCatalogRecords.length).toBe(0);
      expect(result.catalog).toBeNull();
      expect(result.dataService).toBeNull();
    }).pipe(Effect.provide(bunFsLayer))
  );

  it.effect(
    "skips datasets whose eia-route alias is a legacy bulk code (no slash)",
    () =>
      Effect.gen(function* () {
        // Route aliases without a "/" are legacy bulk-manifest codes;
        // Task 0.5 migrated most to eia-bulk-id but belt-and-braces
        // filtering here guards against any stragglers.
        const tmp = yield* Effect.promise(() =>
          makeTmpFixture({
            datasets: [
              {
                slug: "eia-legacy-bulk",
                body: validDatasetBody(
                  "LegacyBulk",
                  "01KNQSXEPPXRC56GM4SED9D0KY",
                  [
                    {
                      scheme: "eia-route",
                      value: "COAL",
                      relation: "exactMatch"
                    }
                  ]
                )
              }
            ]
          })
        );

        const result = yield* loadCatalogIndex(tmp).pipe(
          Effect.ensuring(Effect.promise(() => cleanup(tmp)))
        );

        expect(result.datasetsByRoute.size).toBe(0);
        expect(result.allDatasets.length).toBe(1);
      }).pipe(Effect.provide(bunFsLayer))
  );

  it.effect("fails with EiaIngestSchemaError on a malformed Dataset JSON", () =>
    Effect.gen(function* () {
      const tmp = yield* Effect.promise(() =>
        makeTmpFixture({
          datasets: [
            {
              slug: "broken",
              // Missing required `id`, `title`, `createdAt`, `updatedAt`,
              // `aliases` — any one is enough to fail Schema.decode.
              body: { _tag: "Dataset" }
            }
          ]
        })
      );

      // Effect.flip turns the typed failure channel into the success
      // channel so we can assert on the tagged error directly, without
      // reaching into Cause internals.
      const error = yield* loadCatalogIndex(tmp).pipe(
        Effect.ensuring(Effect.promise(() => cleanup(tmp))),
        Effect.flip
      );

      expect(error).toBeInstanceOf(EiaIngestSchemaError);
      expect(error._tag).toBe("EiaIngestSchemaError");
      if (error._tag === "EiaIngestSchemaError") {
        expect(error.kind).toBe("Dataset");
        expect(error.slug).toBe("broken");
      }
    }).pipe(Effect.provide(bunFsLayer))
  );

  it.effect("indexes all six entity kinds end-to-end", () =>
    Effect.gen(function* () {
      // Distinct 26-char ULID-shaped tails per entity so every ID is unique
      // and matches the ^[A-Za-z0-9]{10,}$ pattern enforced by ids.ts.
      const agentUlid = "01KNQEZ5V57VJJJFYV6HWM03VB";
      const catalogUlid = "01KNQEZ5V57VJJJFYV6HWM03VC";
      const datasetUlid = "01KNQSXEPQHNVM0AVMA3SQRNK3";
      const distributionUlid = "01KNQSXEPQE7D85JBAFH47Y9MS";
      const catalogRecordUlid = "01KNQSXEPQHNVM0AVMA3SQRNK4";
      const dataServiceUlid = "01KNQEZ5VHS74DM94ABW2ZM93Y";

      const agentId = `https://id.skygest.io/agent/ag_${agentUlid}`;
      const catalogId = `https://id.skygest.io/catalog/cat_${catalogUlid}`;
      const datasetId = `https://id.skygest.io/dataset/ds_${datasetUlid}`;
      const route = "electricity/retail-sales";

      const tmp = yield* Effect.promise(() =>
        makeTmpFixture({
          agents: [
            {
              slug: "eia",
              body: validAgentBody("U.S. Energy Information Administration", agentUlid, [
                // URL-alias lookup drives EIA-agent resolution in
                // loadCatalogIndex — keep this in sync with
                // EIA_AGENT_HOMEPAGE in the script.
                {
                  scheme: "url",
                  value: "https://www.eia.gov/",
                  relation: "exactMatch"
                }
              ])
            }
          ],
          catalogs: [
            {
              slug: "eia",
              body: validCatalogBody("EIA Open Data Catalog", catalogUlid, agentId, [])
            }
          ],
          datasets: [
            {
              slug: "eia-electricity-retail-sales",
              body: validDatasetBody(
                "Retail Sales of Electricity",
                datasetUlid,
                [
                  { scheme: "eia-route", value: route, relation: "exactMatch" }
                ],
                agentId
              )
            }
          ],
          distributions: [
            {
              slug: "eia-electricity-retail-sales-api",
              body: validDistributionBody(distributionUlid, datasetId, [])
            }
          ],
          catalogRecords: [
            {
              slug: "eia-electricity-retail-sales-cr",
              body: validCatalogRecordBody(catalogRecordUlid, catalogId, datasetId)
            }
          ],
          dataServices: [
            {
              slug: "eia-api",
              body: validDataServiceBody(
                "EIA API v2",
                dataServiceUlid,
                agentId,
                [datasetId],
                []
              )
            }
          ]
        })
      );

      const result = yield* loadCatalogIndex(tmp).pipe(
        Effect.ensuring(Effect.promise(() => cleanup(tmp)))
      );

      // Every kind round-trips through the loader at count 1.
      expect(result.allDatasets.length).toBe(1);
      expect(result.allDistributions.length).toBe(1);
      expect(result.allCatalogRecords.length).toBe(1);

      // Route lookup (the Task 7 merge key for Datasets).
      const ds = result.datasetsByRoute.get(route);
      expect(ds).toBeDefined();
      expect(ds!.title).toBe("Retail Sales of Electricity");

      // Compound distribution key: `${datasetId}::${kind}`.
      const dist = result.distributionsByDatasetIdKind.get(
        `${datasetId}::api-access`
      );
      expect(dist).toBeDefined();

      // Compound CR key: `${catalogId}::${primaryTopicId}`.
      const cr = result.catalogRecordsByCatalogAndPrimaryTopic.get(
        `${catalogId}::${datasetId}`
      );
      expect(cr).toBeDefined();

      // Agent-by-name lookup.
      const agent = result.agentsByName.get(
        "U.S. Energy Information Administration"
      );
      expect(agent).toBeDefined();
      expect(agent!.id).toBe(agentId);

      // EIA-published Catalog and DataService resolved via the URL-alias
      // agent lookup plus publisherAgentId filter.
      expect(result.catalog).not.toBeNull();
      expect(result.catalog!.id).toBe(catalogId);
      expect(result.dataService).not.toBeNull();
      expect(result.dataService!.id).toBe(
        `https://id.skygest.io/data-service/svc_${dataServiceUlid}`
      );
    }).pipe(Effect.provide(bunFsLayer))
  );
});
