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
  buildCandidateNodes,
  buildCatalogRecord,
  buildContextFromIndex,
  buildDatasetCandidate,
  buildDistributionCandidates,
  buildIngestGraph,
  type BuildContext,
  type EiaApiResponse,
  EiaIngestLedgerError,
  EiaIngestSchemaError,
  fetchRoute,
  type IngestNode,
  loadCatalogIndex,
  slugifyRoute,
  unionAliases,
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

// ---------------------------------------------------------------------------
// Task 7 — Pure record builders
// ---------------------------------------------------------------------------

// Shared fixture ULIDs for builder tests. Kept at module scope so they're
// deterministic across assertions that need to match by id.
const BUILDER_AGENT_ULID = "01KNQEZ5V57VJJJFYV6HWM03VB";
const BUILDER_CATALOG_ULID = "01KNQEZ5V57VJJJFYV6HWM03VC";
const BUILDER_DATASET_ULID = "01KNQSXEPQHNVM0AVMA3SQRNK3";
const BUILDER_DIST_ULID = "01KNQSXEPQE7D85JBAFH47Y9MS";
const BUILDER_DS_ULID = "01KNQEZ5VHS74DM94ABW2ZM93Y";

const BUILDER_AGENT_ID = `https://id.skygest.io/agent/ag_${BUILDER_AGENT_ULID}`;
const BUILDER_CATALOG_ID = `https://id.skygest.io/catalog/cat_${BUILDER_CATALOG_ULID}`;
const BUILDER_DATASET_ID = `https://id.skygest.io/dataset/ds_${BUILDER_DATASET_ULID}`;
const BUILDER_DIST_ID = `https://id.skygest.io/distribution/dist_${BUILDER_DIST_ULID}`;
const BUILDER_DS_ID = `https://id.skygest.io/data-service/svc_${BUILDER_DS_ULID}`;

// Tiny factory that builds an in-memory BuildContext without reading from
// disk. Re-uses the validAgentBody / validCatalogBody / validDataServiceBody
// fixture helpers so there's a single source of truth for the body shapes.
// The outer `as unknown as Agent` casts mirror what loadCatalogIndex returns
// after Schema.decode — they're safe because the fixture bodies match the
// domain schemas exactly.
const makeBuilderCtx = (now: string): BuildContext => {
  const agent = validAgentBody(
    "U.S. Energy Information Administration",
    BUILDER_AGENT_ULID,
    []
  ) as unknown as Agent;
  const catalog = validCatalogBody(
    "EIA Open Data Catalog",
    BUILDER_CATALOG_ULID,
    agent.id as unknown as string,
    []
  ) as unknown as Catalog;
  const dataService = validDataServiceBody(
    "EIA API v2",
    BUILDER_DS_ULID,
    agent.id as unknown as string,
    [],
    []
  ) as unknown as DataService;
  return {
    nowIso: now,
    eiaAgent: agent,
    eiaCatalog: catalog,
    eiaDataService: dataService
  };
};

// An empty catalog index — suitable for fresh-build tests that don't need
// any lookups to resolve against existing records.
const emptyIndex = (): Parameters<typeof buildDistributionCandidates>[3] => ({
  datasetsByRoute: new Map(),
  distributionsByDatasetIdKind: new Map(),
  catalogRecordsByCatalogAndPrimaryTopic: new Map(),
  agentsByName: new Map(),
  catalog: null,
  dataService: null,
  allDatasets: [],
  allDistributions: [],
  allCatalogRecords: []
});

describe("slugifyRoute", () => {
  it("turns an API v2 route path into an eia- prefixed slug", () => {
    expect(slugifyRoute("electricity/retail-sales")).toBe(
      "eia-electricity-retail-sales"
    );
    expect(slugifyRoute("petroleum/pri/spt")).toBe("eia-petroleum-pri-spt");
  });
});

describe("unionAliases", () => {
  it("dedupes by (scheme, value), preserving existing entry on collision", () => {
    const existing = [
      { scheme: "eia-route", value: "electricity/retail-sales", relation: "exactMatch" },
      { scheme: "doi", value: "10.1234/eia", relation: "exactMatch" }
    ] as ReadonlyArray<Parameters<typeof unionAliases>[0][number]>;
    const fresh = [
      // duplicate (scheme, value) — must be dropped in favor of existing
      { scheme: "eia-route", value: "electricity/retail-sales", relation: "closeMatch" },
      // new scheme — must be appended
      { scheme: "wikidata", value: "Q12345", relation: "exactMatch" }
    ] as ReadonlyArray<Parameters<typeof unionAliases>[0][number]>;

    const result = unionAliases(existing, fresh);
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual(existing[0]); // existing wins on collision
    expect(result[1]).toEqual(existing[1]);
    expect(result[2]).toEqual(fresh[1]);
  });
});

describe("buildContextFromIndex", () => {
  it.effect("fails with EiaIngestLedgerError when the EIA catalog is missing", () =>
    Effect.gen(function* () {
      const idx = emptyIndex();
      const err = yield* buildContextFromIndex(idx, FIXTURE_NOW).pipe(Effect.flip);
      expect(err).toBeInstanceOf(EiaIngestLedgerError);
      expect(err.message).toContain("Catalog or DataService missing");
    })
  );

  it.effect("fails with EiaIngestLedgerError when the EIA agent is unresolvable", () =>
    Effect.gen(function* () {
      // catalog + dataService present, but the agent referenced by
      // catalog.publisherAgentId isn't in agentsByName.
      const ctx = makeBuilderCtx(FIXTURE_NOW);
      const idx = {
        ...emptyIndex(),
        catalog: ctx.eiaCatalog,
        dataService: ctx.eiaDataService
      };
      const err = yield* buildContextFromIndex(idx, FIXTURE_NOW).pipe(Effect.flip);
      expect(err).toBeInstanceOf(EiaIngestLedgerError);
      expect(err.message).toContain("Agent missing");
    })
  );

  it.effect("resolves the EIA agent via catalog.publisherAgentId", () =>
    Effect.gen(function* () {
      const ctx = makeBuilderCtx(FIXTURE_NOW);
      const agents = new Map<string, Agent>();
      agents.set(ctx.eiaAgent.name, ctx.eiaAgent);
      const idx = {
        ...emptyIndex(),
        catalog: ctx.eiaCatalog,
        dataService: ctx.eiaDataService,
        agentsByName: agents
      };
      const result = yield* buildContextFromIndex(idx, FIXTURE_NOW);
      expect(result.eiaAgent.id).toBe(ctx.eiaAgent.id);
      expect(result.eiaCatalog.id).toBe(ctx.eiaCatalog.id);
      expect(result.eiaDataService.id).toBe(ctx.eiaDataService.id);
      expect(result.nowIso).toBe(FIXTURE_NOW);
    })
  );
});

describe("buildDatasetCandidate", () => {
  const leaf = {
    path: "electricity/retail-sales",
    parents: ["electricity"],
    response: {
      id: "retail-sales",
      name: "Retail Sales of Electricity",
      description: "Retail sales of electricity by state and sector",
      facets: [
        { id: "stateid", description: "State identifier" },
        { id: "sectorid", description: "Sector identifier" }
      ],
      defaultFrequency: "monthly",
      startPeriod: "2001-01",
      endPeriod: "2024-12"
    } as unknown as EiaApiResponse["response"]
  };

  it("mints a fresh dataset candidate with title, themes, alias, and keywords", () => {
    const ctx = makeBuilderCtx(FIXTURE_NOW);
    const ds = buildDatasetCandidate(leaf, ctx, null);

    // title comes from response.name
    expect(ds.title).toBe("Retail Sales of Electricity");
    // description falls back to response.description on fresh build
    expect(ds.description).toBe(
      "Retail sales of electricity by state and sector"
    );
    // themes derived from parents when no existing themes
    expect(ds.themes).toEqual(["electricity"]);
    // keywords = facet ids + defaultFrequency, sorted deterministically
    // for stable Task 9 file diffs.
    expect(ds.keywords).toEqual(["monthly", "sectorid", "stateid"]);
    // defaultFrequency goes into keywords, NOT aliases
    expect(ds.aliases).toHaveLength(1);
    expect(ds.aliases[0]).toEqual({
      scheme: "eia-route",
      value: "electricity/retail-sales",
      relation: "exactMatch"
    });
    // publisherAgentId and dataServiceIds are structural
    expect(ds.publisherAgentId).toBe(ctx.eiaAgent.id);
    expect(ds.dataServiceIds).toEqual([ctx.eiaDataService.id]);
    // ID matches the branded pattern for datasets
    expect(ds.id).toMatch(
      /^https:\/\/id\.skygest\.io\/dataset\/ds_[0-9A-Z]{10,}$/u
    );
    // Fresh record: createdAt and updatedAt both equal nowIso
    expect(ds.createdAt).toBe(FIXTURE_NOW);
    expect(ds.updatedAt).toBe(FIXTURE_NOW);
    // Default license + accessRights
    expect(ds.license).toBe("https://www.eia.gov/about/copyrights_reuse.php");
    expect(ds.accessRights).toBe("public");
    // temporal synthesized from startPeriod/endPeriod
    expect(ds.temporal).toBe("2001-01/2024-12");
    // landingPage never synthesized on fresh build
    expect((ds as Dataset).landingPage).toBeUndefined();
    // distributionIds placeholder (re-stitched later)
    expect(ds.distributionIds).toEqual([]);
  });

  it("merges with an existing dataset, preserving id/createdAt/landingPage/curated themes", () => {
    const ctx = makeBuilderCtx("2026-05-01T00:00:00.000Z");
    // Existing curated record carries a landing page, bespoke themes, and
    // a description that shouldn't be clobbered by the terse API one.
    const existing = {
      _tag: "Dataset",
      id: BUILDER_DATASET_ID as unknown as Dataset["id"],
      title: "Old title",
      description: "Curated, human-written description",
      publisherAgentId: ctx.eiaAgent.id,
      landingPage: "https://www.eia.gov/electricity/data.php" as unknown as Dataset["landingPage"],
      accessRights: "public",
      license: "https://custom-license.example.org/",
      keywords: ["curated-keyword"],
      themes: ["energy-markets", "retail"],
      temporal: "1990-01/2020-12",
      aliases: [
        {
          scheme: "eia-route",
          value: "electricity/retail-sales",
          relation: "exactMatch"
        },
        { scheme: "doi", value: "10.1234/foo", relation: "exactMatch" }
      ],
      dataServiceIds: [ctx.eiaDataService.id],
      distributionIds: [],
      createdAt: "2025-01-01T00:00:00.000Z" as unknown as Dataset["createdAt"],
      updatedAt: "2025-01-01T00:00:00.000Z" as unknown as Dataset["updatedAt"]
    } as unknown as Dataset;

    const ds = buildDatasetCandidate(leaf, ctx, existing);

    // ID + createdAt preserved; updatedAt bumped.
    expect(ds.id).toBe(existing.id);
    expect(ds.createdAt).toBe(existing.createdAt);
    expect(ds.updatedAt).toBe("2026-05-01T00:00:00.000Z");
    // title overwritten from API (canonical structural source)
    expect(ds.title).toBe("Retail Sales of Electricity");
    // description preserved (API v2 descriptions are terse)
    expect(ds.description).toBe("Curated, human-written description");
    // landingPage preserved — never synthesized
    expect(ds.landingPage).toBe("https://www.eia.gov/electricity/data.php");
    // curated themes preserved when non-empty; not overwritten by parents
    expect(ds.themes).toEqual(["energy-markets", "retail"]);
    // license preserved
    expect(ds.license).toBe("https://custom-license.example.org/");
    // temporal preserved
    expect(ds.temporal).toBe("1990-01/2020-12");
    // keywords UNION: existing + facet ids + defaultFrequency, sorted
    // deterministically for stable Task 9 file diffs.
    expect(ds.keywords).toEqual([
      "curated-keyword",
      "monthly",
      "sectorid",
      "stateid"
    ]);
    // aliases: unioned; eia-route dedup preserved, doi preserved
    expect(ds.aliases).toHaveLength(2);
    const schemes = ds.aliases.map((a) => a.scheme).sort();
    expect(schemes).toEqual(["doi", "eia-route"]);
  });

  it("preserves existing curated title when API v2 response.name is null", () => {
    // Regression guard: the API occasionally returns `name: null` on
    // leaf routes. Falling back directly to `response.id` would clobber
    // a curated title like "Retail Sales of Electricity" with the raw
    // slug "retail-sales". The fallback order is:
    //   API name -> existing title -> API id (last resort)
    const ctx = makeBuilderCtx("2026-05-01T00:00:00.000Z");
    const leafWithNullName = {
      path: "electricity/retail-sales",
      parents: ["electricity"],
      response: {
        id: "retail-sales",
        name: null, // <- the case we're guarding against
        facets: [],
        defaultFrequency: null
      } as unknown as EiaApiResponse["response"]
    };
    const existing = {
      _tag: "Dataset",
      id: BUILDER_DATASET_ID as unknown as Dataset["id"],
      title: "Retail Sales of Electricity",
      publisherAgentId: ctx.eiaAgent.id,
      accessRights: "public",
      aliases: [],
      createdAt: FIXTURE_NOW as unknown as Dataset["createdAt"],
      updatedAt: FIXTURE_NOW as unknown as Dataset["updatedAt"]
    } as unknown as Dataset;

    const ds = buildDatasetCandidate(leafWithNullName, ctx, existing);
    expect(ds.title).toBe("Retail Sales of Electricity");
    // And sanity: a fresh build with null name still falls through to
    // the raw route id, since there's no existing title to fall back to.
    const fresh = buildDatasetCandidate(leafWithNullName, ctx, null);
    expect(fresh.title).toBe("retail-sales");
  });

  it("falls back to parent route segments for themes when existing themes are empty", () => {
    const ctx = makeBuilderCtx(FIXTURE_NOW);
    const existing = {
      _tag: "Dataset",
      id: BUILDER_DATASET_ID as unknown as Dataset["id"],
      title: "Old",
      publisherAgentId: ctx.eiaAgent.id,
      accessRights: "public",
      themes: [], // explicitly empty — builder must fall back to parents
      aliases: [],
      createdAt: FIXTURE_NOW as unknown as Dataset["createdAt"],
      updatedAt: FIXTURE_NOW as unknown as Dataset["updatedAt"]
    } as unknown as Dataset;
    const ds = buildDatasetCandidate(leaf, ctx, existing);
    expect(ds.themes).toEqual(["electricity"]);
  });
});

describe("buildDistributionCandidates", () => {
  const leaf = {
    path: "electricity/retail-sales",
    parents: ["electricity"],
    response: {
      id: "retail-sales",
      name: "Retail Sales of Electricity"
    } as unknown as EiaApiResponse["response"]
  };

  it("mints a fresh api-access distribution with the correct accessURL + kind", () => {
    const ctx = makeBuilderCtx(FIXTURE_NOW);
    const dists = buildDistributionCandidates(
      leaf,
      BUILDER_DATASET_ID as unknown as Dataset["id"],
      ctx,
      emptyIndex()
    );
    expect(dists).toHaveLength(1);
    const [api] = dists;
    expect(api!.kind).toBe("api-access");
    expect(api!.accessURL).toBe(
      "https://api.eia.gov/v2/electricity/retail-sales/"
    );
    expect(api!.datasetId).toBe(BUILDER_DATASET_ID);
    expect(api!.id).toMatch(
      /^https:\/\/id\.skygest\.io\/distribution\/dist_[0-9A-Z]{10,}$/u
    );
    expect(api!.createdAt).toBe(FIXTURE_NOW);
    expect(api!.updatedAt).toBe(FIXTURE_NOW);
  });

  it("merges with an existing api-access distribution, preserving id/accessURL/format/mediaType/title", () => {
    const datasetId = BUILDER_DATASET_ID as unknown as Dataset["id"];
    const existingApi = {
      _tag: "Distribution",
      id: BUILDER_DIST_ID as unknown as Distribution["id"],
      datasetId,
      kind: "api-access",
      title: "EIA v2 API — Retail Sales",
      accessURL: "https://custom.example.org/v2/retail/" as unknown as Distribution["accessURL"],
      format: "application/json",
      mediaType: "application/json",
      aliases: [],
      createdAt: "2025-01-01T00:00:00.000Z" as unknown as Distribution["createdAt"],
      updatedAt: "2025-01-01T00:00:00.000Z" as unknown as Distribution["updatedAt"]
    } as unknown as Distribution;

    const ctx = makeBuilderCtx("2026-05-01T00:00:00.000Z");
    const idx = emptyIndex();
    idx.distributionsByDatasetIdKind.set(`${datasetId}::api-access`, existingApi);
    (idx.allDistributions as Array<Distribution>) = [existingApi];

    const dists = buildDistributionCandidates(leaf, datasetId, ctx, idx);
    expect(dists).toHaveLength(1);
    const [api] = dists;
    expect(api!.id).toBe(existingApi.id);
    // accessURL preserved (existing is authoritative)
    expect(api!.accessURL).toBe("https://custom.example.org/v2/retail/");
    expect(api!.format).toBe("application/json");
    expect(api!.mediaType).toBe("application/json");
    expect(api!.title).toBe("EIA v2 API — Retail Sales");
    // createdAt preserved; updatedAt bumped
    expect(api!.createdAt).toBe("2025-01-01T00:00:00.000Z");
    expect(api!.updatedAt).toBe("2026-05-01T00:00:00.000Z");
  });

  it("preserves curated landing-page/download distributions alongside the minted api-access", () => {
    const datasetId = BUILDER_DATASET_ID as unknown as Dataset["id"];
    const existingLanding = {
      _tag: "Distribution",
      id: "https://id.skygest.io/distribution/dist_LANDING000000000000000001" as unknown as Distribution["id"],
      datasetId,
      kind: "landing-page",
      accessURL: "https://www.eia.gov/electricity/data.php" as unknown as Distribution["accessURL"],
      aliases: [],
      createdAt: FIXTURE_NOW as unknown as Distribution["createdAt"],
      updatedAt: FIXTURE_NOW as unknown as Distribution["updatedAt"]
    } as unknown as Distribution;
    const existingDownload = {
      _tag: "Distribution",
      id: "https://id.skygest.io/distribution/dist_DOWNLOAD00000000000000001" as unknown as Distribution["id"],
      datasetId,
      kind: "download",
      downloadURL: "https://www.eia.gov/bulk/retail-sales.zip" as unknown as Distribution["downloadURL"],
      aliases: [],
      createdAt: FIXTURE_NOW as unknown as Distribution["createdAt"],
      updatedAt: FIXTURE_NOW as unknown as Distribution["updatedAt"]
    } as unknown as Distribution;

    const ctx = makeBuilderCtx(FIXTURE_NOW);
    // Build the index as a fresh literal rather than casting through
    // the readonly `allDistributions` field of emptyIndex() — mutation
    // through a readonly cast obscures intent and makes it easy to
    // accidentally write to shared fixture state.
    const idx: Parameters<typeof buildDistributionCandidates>[3] = {
      datasetsByRoute: new Map(),
      distributionsByDatasetIdKind: new Map(),
      catalogRecordsByCatalogAndPrimaryTopic: new Map(),
      agentsByName: new Map(),
      catalog: null,
      dataService: null,
      allDatasets: [],
      allDistributions: [existingLanding, existingDownload],
      allCatalogRecords: []
    };

    const dists = buildDistributionCandidates(leaf, datasetId, ctx, idx);
    expect(dists).toHaveLength(3);
    const kinds = dists.map((d) => d.kind).sort();
    expect(kinds).toEqual(["api-access", "download", "landing-page"]);
    // Preserved distributions are the exact same objects (no mutation)
    expect(dists.find((d) => d.kind === "landing-page")).toBe(existingLanding);
    expect(dists.find((d) => d.kind === "download")).toBe(existingDownload);
  });
});

describe("buildCatalogRecord", () => {
  it("mints a fresh CatalogRecord bound to the EIA catalog + dataset", () => {
    const ctx = makeBuilderCtx(FIXTURE_NOW);
    const dataset = {
      _tag: "Dataset",
      id: BUILDER_DATASET_ID as unknown as Dataset["id"],
      title: "Retail Sales",
      publisherAgentId: ctx.eiaAgent.id,
      accessRights: "public",
      aliases: [],
      createdAt: FIXTURE_NOW as unknown as Dataset["createdAt"],
      updatedAt: FIXTURE_NOW as unknown as Dataset["updatedAt"]
    } as unknown as Dataset;

    const cr = buildCatalogRecord(dataset, ctx, null, "electricity/retail-sales");
    expect(cr.catalogId).toBe(ctx.eiaCatalog.id);
    expect(cr.primaryTopicType).toBe("dataset");
    expect(cr.primaryTopicId).toBe(dataset.id);
    expect(cr.firstSeen).toBe(FIXTURE_NOW);
    expect(cr.lastSeen).toBe(FIXTURE_NOW);
    expect(cr.harvestedFrom).toBe(
      "https://api.eia.gov/v2/electricity/retail-sales/"
    );
    expect(cr.isAuthoritative).toBe(true);
    expect(cr.id).toMatch(
      /^https:\/\/id\.skygest\.io\/catalog-record\/cr_[0-9A-Z]{10,}$/u
    );
  });

  it("preserves existing id/firstSeen/harvestedFrom/sourceRecordId on merge, only bumps lastSeen", () => {
    const ctx = makeBuilderCtx("2026-05-01T00:00:00.000Z");
    const dataset = {
      _tag: "Dataset",
      id: BUILDER_DATASET_ID as unknown as Dataset["id"],
      title: "Retail Sales",
      publisherAgentId: ctx.eiaAgent.id,
      accessRights: "public",
      aliases: [],
      createdAt: FIXTURE_NOW as unknown as Dataset["createdAt"],
      updatedAt: FIXTURE_NOW as unknown as Dataset["updatedAt"]
    } as unknown as Dataset;
    const existing = {
      _tag: "CatalogRecord",
      id: "https://id.skygest.io/catalog-record/cr_EXISTING0000000000000001" as unknown as CatalogRecord["id"],
      catalogId: ctx.eiaCatalog.id,
      primaryTopicType: "dataset",
      primaryTopicId: dataset.id,
      firstSeen: "2024-01-01T00:00:00.000Z",
      lastSeen: "2024-06-01T00:00:00.000Z",
      sourceRecordId: "EIA-RETAIL-SALES",
      harvestedFrom: "https://www.eia.gov/legacy/catalog.xml",
      isAuthoritative: true
    } as unknown as CatalogRecord;

    const cr = buildCatalogRecord(dataset, ctx, existing, "electricity/retail-sales");
    expect(cr.id).toBe(existing.id);
    expect(cr.firstSeen).toBe("2024-01-01T00:00:00.000Z");
    expect(cr.lastSeen).toBe("2026-05-01T00:00:00.000Z"); // bumped
    expect(cr.sourceRecordId).toBe("EIA-RETAIL-SALES"); // preserved
    expect(cr.harvestedFrom).toBe("https://www.eia.gov/legacy/catalog.xml"); // preserved
  });
});

describe("buildCandidateNodes", () => {
  // Minimal walkData: 1 root, 1 parent (electricity), 1 leaf
  // (electricity/retail-sales). Only the leaf produces Dataset /
  // Distribution / CatalogRecord candidates.
  const makeWalk = (): ReadonlyMap<string, EiaApiResponse> => {
    const walk = new Map<string, EiaApiResponse>();
    walk.set("", {
      response: {
        id: "root",
        name: "EIA API",
        routes: [{ id: "electricity", name: "Electricity" }]
      }
    } as unknown as EiaApiResponse);
    walk.set("electricity", {
      response: {
        id: "electricity",
        name: "Electricity",
        routes: [{ id: "retail-sales", name: "Retail Sales" }]
      }
    } as unknown as EiaApiResponse);
    walk.set("electricity/retail-sales", {
      response: {
        id: "retail-sales",
        name: "Retail Sales of Electricity",
        facets: [{ id: "stateid", description: null }],
        defaultFrequency: "monthly"
      }
    } as unknown as EiaApiResponse);
    return walk;
  };

  it("produces a 6-node candidate set for one leaf (agent + catalog + data-service + dataset + api distribution + cr)", () => {
    const ctx = makeBuilderCtx(FIXTURE_NOW);
    const nodes = buildCandidateNodes(makeWalk(), emptyIndex(), ctx);

    expect(nodes).toHaveLength(6);
    const tags = nodes.map((n) => n._tag).sort();
    expect(tags).toEqual([
      "agent",
      "catalog",
      "catalog-record",
      "data-service",
      "dataset",
      "distribution"
    ]);

    // Dataset node is merged=false on fresh build.
    const datasetNode = nodes.find((n) => n._tag === "dataset")!;
    expect(datasetNode._tag).toBe("dataset");
    if (datasetNode._tag === "dataset") {
      expect(datasetNode.merged).toBe(false);
      expect(datasetNode.data.title).toBe("Retail Sales of Electricity");
      expect(datasetNode.slug).toBe("eia-electricity-retail-sales");
      // distributionIds wired to the minted api-access distribution
      expect(datasetNode.data.distributionIds).toHaveLength(1);
    }

    // Distribution kind is api-access with the right accessURL.
    const distNode = nodes.find((n) => n._tag === "distribution")!;
    if (distNode._tag === "distribution") {
      expect(distNode.data.kind).toBe("api-access");
      expect(distNode.data.accessURL).toBe(
        "https://api.eia.gov/v2/electricity/retail-sales/"
      );
      expect(distNode.slug).toBe("eia-electricity-retail-sales-api-access");
    }

    // CatalogRecord node is bound to the EIA catalog and the minted dataset.
    const crNode = nodes.find((n) => n._tag === "catalog-record")!;
    if (crNode._tag === "catalog-record") {
      expect(crNode.data.catalogId).toBe(ctx.eiaCatalog.id);
      expect(crNode.data.primaryTopicType).toBe("dataset");
    }

    // DataService node's servesDatasetIds includes the minted dataset.
    const svcNode = nodes.find((n) => n._tag === "data-service")!;
    if (svcNode._tag === "data-service" && datasetNode._tag === "dataset") {
      expect(svcNode.data.servesDatasetIds).toContain(datasetNode.data.id);
    }

    // Integration: the candidate set must be a legal IngestGraph input.
    // This ties Task 5.5 (buildIngestGraph) + Task 6 (loadCatalogIndex)
    // + Task 7 (builders) together and catches any accidental cycle,
    // orphaned edge, or wiring bug introduced by the builders.
    const graph = buildIngestGraph(nodes);
    expect(Graph.isAcyclic(graph)).toBe(true);
    const topo = Array.from(Graph.values(Graph.topo(graph)));
    expect(topo.length).toBe(nodes.length);
    // Agent has no inbound edges, so it must emerge first from topo sort.
    expect(topo[0]?._tag).toBe("agent");
  });

  it("marks merged=true on a dataset whose route is already in the catalog index", () => {
    const ctx = makeBuilderCtx(FIXTURE_NOW);
    const existing = {
      _tag: "Dataset",
      id: BUILDER_DATASET_ID as unknown as Dataset["id"],
      title: "Old title",
      publisherAgentId: ctx.eiaAgent.id,
      accessRights: "public",
      aliases: [
        {
          scheme: "eia-route",
          value: "electricity/retail-sales",
          relation: "exactMatch"
        }
      ],
      createdAt: FIXTURE_NOW as unknown as Dataset["createdAt"],
      updatedAt: FIXTURE_NOW as unknown as Dataset["updatedAt"]
    } as unknown as Dataset;

    const idx = emptyIndex();
    idx.datasetsByRoute.set("electricity/retail-sales", existing);
    (idx.allDatasets as Array<Dataset>) = [existing];

    const nodes = buildCandidateNodes(makeWalk(), idx, ctx);
    const datasetNode = nodes.find((n) => n._tag === "dataset")!;
    if (datasetNode._tag === "dataset") {
      expect(datasetNode.merged).toBe(true);
      // Dataset ID reused from existing (not re-minted)
      expect(datasetNode.data.id).toBe(existing.id);
    }
  });
});
