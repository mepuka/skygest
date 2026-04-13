import { describe, expect, it } from "@effect/vitest";
import * as BunFileSystem from "@effect/platform-bun/BunFileSystem";
import * as BunPath from "@effect/platform-bun/BunPath";
import { Effect, Layer } from "effect";
import { HttpClient, HttpClientResponse } from "effect/unstable/http";
import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as nodePath from "node:path";
import {
  Agent,
  AliasSchemeValues,
  Catalog,
  DataService,
  Dataset,
  Distribution
} from "../src/domain/data-layer";
import {
  type CatalogIndex,
  EntityIdLedger
} from "../src/ingest/dcat-harness";
import {
  buildCandidateNodes,
  buildContextFromIndex,
  endpointKeyFromPath,
  energyChartsCatalogRecordSlug,
  energyChartsDatasetSlug,
  energyChartsDistributionSlug,
  ENERGY_CHARTS_AGENT_NAME,
  ENERGY_CHARTS_AGENT_SLUG,
  ENERGY_CHARTS_API_BASE_URL,
  ENERGY_CHARTS_CATALOG_SLUG,
  ENERGY_CHARTS_CATALOG_TITLE,
  ENERGY_CHARTS_DATASET_ALIAS_SCHEME,
  ENERGY_CHARTS_DATA_SERVICE_SLUG,
  ENERGY_CHARTS_DATA_SERVICE_TITLE,
  ENERGY_CHARTS_OPENAPI_URL,
  fetchSpec,
  listEndpointFamilies
} from "../src/ingest/dcat-adapters/energy-charts";
import { decodeJsonStringWith } from "../src/platform/Json";
import {
  runEnergyChartsIngest,
  type ScriptConfigShape
} from "../scripts/cold-start-ingest-energy-charts";

const bunFsLayer = Layer.mergeAll(BunFileSystem.layer, BunPath.layer);
const FIXTURE_NOW = "2026-04-10T00:00:00.000Z";

const OPENAPI_FIXTURE = {
  paths: {
    "/public_power": {
      get: {
        summary: "Public power generation",
        description: "Generation by source and time interval"
      }
    },
    "/price": {
      get: {
        summary: "Power price"
      }
    },
    "/": {
      get: {
        summary: "Root"
      }
    },
    "/health": {}
  }
} as const;

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

const FIXTURE_SUBDIRS = [
  "agents",
  "catalogs",
  "datasets",
  "dataset-series",
  "distributions",
  "catalog-records",
  "data-services"
] as const;

const makeEmptyColdStartRoot = async (): Promise<string> => {
  const tmp = await fsp.mkdtemp(
    nodePath.join(os.tmpdir(), "skygest-energy-charts-")
  );
  const catalogDir = nodePath.join(tmp, "catalog");
  for (const subDir of FIXTURE_SUBDIRS) {
    await fsp.mkdir(nodePath.join(catalogDir, subDir), { recursive: true });
  }
  return tmp;
};

const cleanup = (tmp: string) => fsp.rm(tmp, { recursive: true, force: true });

const emptyIndex = (): CatalogIndex => ({
  datasetsByMergeKey: new Map(),
  datasetFileSlugById: new Map(),
  datasetSeriesById: new Map(),
  datasetSeriesFileSlugById: new Map(),
  distributionsByDatasetIdKind: new Map(),
  distributionFileSlugById: new Map(),
  catalogRecordsByCatalogAndPrimaryTopic: new Map(),
  catalogRecordFileSlugById: new Map(),
  agentsById: new Map(),
  agentFileSlugById: new Map(),
  agentsByName: new Map(),
  catalogsById: new Map(),
  dataServicesById: new Map(),
  allDatasets: [],
  allDatasetSeries: [],
  allDistributions: [],
  allCatalogRecords: [],
  allCatalogs: [],
  allDataServices: [],
  allAgents: []
});

const readAgent = decodeJsonStringWith(Agent);
const readCatalog = decodeJsonStringWith(Catalog);
const readDataset = decodeJsonStringWith(Dataset);
const readDistribution = decodeJsonStringWith(Distribution);
const readDataService = decodeJsonStringWith(DataService);
const readLedger = decodeJsonStringWith(EntityIdLedger);

describe("energy-charts adapter", () => {
  it("pins the root slugs and merge alias scheme for first-time publisher seeding", () => {
    expect(ENERGY_CHARTS_AGENT_SLUG).toBe("fraunhofer-ise");
    expect(ENERGY_CHARTS_CATALOG_SLUG).toBe("energy-charts");
    expect(ENERGY_CHARTS_DATA_SERVICE_SLUG).toBe("energy-charts-api");
    expect(ENERGY_CHARTS_DATASET_ALIAS_SCHEME).toBe(
      AliasSchemeValues.energyChartsEndpoint
    );
    expect(ENERGY_CHARTS_AGENT_NAME).toBe(
      "Fraunhofer Institute for Solar Energy Systems ISE"
    );
    expect(ENERGY_CHARTS_CATALOG_TITLE).toBe("Energy Charts API Catalog");
    expect(ENERGY_CHARTS_DATA_SERVICE_TITLE).toBe("Energy Charts API");
    expect(ENERGY_CHARTS_API_BASE_URL).toBe("https://api.energy-charts.info/");
    expect(ENERGY_CHARTS_OPENAPI_URL).toBe(
      "https://api.energy-charts.info/openapi.json"
    );
  });

  it.effect("fetches and decodes the flat OpenAPI spec", () =>
    Effect.gen(function* () {
      const spec = yield* fetchSpec();
      expect(Object.keys(spec.paths)).toEqual([
        "/public_power",
        "/price",
        "/",
        "/health"
      ]);
    }).pipe(
      Effect.provide(
        makeHttpLayer((request, url) =>
          Effect.gen(function* () {
            expect(url.toString()).toBe(ENERGY_CHARTS_OPENAPI_URL);
            return jsonResponse(request, OPENAPI_FIXTURE);
          })
        )
      )
    )
  );

  it("derives stable endpoint families and candidate nodes from the OpenAPI path list", () => {
    expect(endpointKeyFromPath("/public_power")).toBe("public_power");
    expect(energyChartsDatasetSlug("public_power")).toBe(
      "energy-charts-public-power"
    );
    expect(energyChartsDistributionSlug("public_power")).toBe(
      "energy-charts-public-power-api"
    );
    expect(energyChartsCatalogRecordSlug("public_power")).toBe(
      "energy-charts-public-power-cr"
    );

    const families = listEndpointFamilies(OPENAPI_FIXTURE);
    expect(families).toEqual([
      {
        path: "/price",
        endpointKey: "price",
        datasetSlug: "energy-charts-price",
        distributionSlug: "energy-charts-price-api",
        catalogRecordSlug: "energy-charts-price-cr",
        title: "Energy Charts Price",
        summary: "Power price"
      },
      {
        path: "/public_power",
        endpointKey: "public_power",
        datasetSlug: "energy-charts-public-power",
        distributionSlug: "energy-charts-public-power-api",
        catalogRecordSlug: "energy-charts-public-power-cr",
        title: "Energy Charts Public Power",
        summary: "Public power generation",
        description: "Generation by source and time interval"
      }
    ]);

    const ctx = buildContextFromIndex(emptyIndex(), FIXTURE_NOW);
    const candidates = buildCandidateNodes(families, emptyIndex(), ctx);

    expect(candidates).toHaveLength(9);
    expect(candidates[0]).toMatchObject({
      _tag: "agent",
      slug: "fraunhofer-ise"
    });
    expect(candidates[1]).toMatchObject({
      _tag: "catalog",
      slug: "energy-charts"
    });
    expect(candidates[candidates.length - 1]).toMatchObject({
      _tag: "data-service",
      slug: "energy-charts-api"
    });

    const priceDataset = candidates.find(
      (node): node is Extract<(typeof candidates)[number], { _tag: "dataset" }> =>
        node._tag === "dataset" && node.slug === "energy-charts-price"
    );
    const priceDistribution = candidates.find(
      (node): node is Extract<
        (typeof candidates)[number],
        { _tag: "distribution" }
      > => node._tag === "distribution" && node.slug === "energy-charts-price-api"
    );
    expect(priceDataset?.merged).toBe(false);
    expect(priceDataset?.data.aliases).toEqual([
      {
        scheme: "energy-charts-endpoint",
        value: "price",
        relation: "exactMatch"
      }
    ]);
    expect(priceDistribution?.data.accessURL).toBe(
      "https://api.energy-charts.info/price"
    );

    const dataService = candidates.find(
      (node): node is Extract<
        (typeof candidates)[number],
        { _tag: "data-service" }
      > => node._tag === "data-service"
    );
    expect(dataService?.data.servesDatasetIds).toHaveLength(2);
  });

  it.effect("writes the first Fraunhofer run and reuses the same ids on rerun", () =>
    Effect.gen(function* () {
      const tmp = yield* Effect.promise(makeEmptyColdStartRoot);
      const config: ScriptConfigShape = {
        rootDir: tmp,
        dryRun: false,
        noCache: false,
        openApiUrl: ENERGY_CHARTS_OPENAPI_URL
      };
      const layer = Layer.mergeAll(
        bunFsLayer,
        makeHttpLayer((request, url) =>
          Effect.gen(function* () {
            expect(url.toString()).toBe(ENERGY_CHARTS_OPENAPI_URL);
            return jsonResponse(request, OPENAPI_FIXTURE);
          })
        )
      );

      yield* runEnergyChartsIngest(config).pipe(
        Effect.provide(layer),
        Effect.ensuring(Effect.promise(() => Promise.resolve()))
      );

      const agentPath = nodePath.join(
        tmp,
        "catalog",
        "agents",
        "fraunhofer-ise.json"
      );
      const catalogPath = nodePath.join(
        tmp,
        "catalog",
        "catalogs",
        "energy-charts.json"
      );
      const dataServicePath = nodePath.join(
        tmp,
        "catalog",
        "data-services",
        "energy-charts-api.json"
      );
      const datasetPath = nodePath.join(
        tmp,
        "catalog",
        "datasets",
        "energy-charts-price.json"
      );
      const distributionPath = nodePath.join(
        tmp,
        "catalog",
        "distributions",
        "energy-charts-price-api.json"
      );
      const ledgerPath = nodePath.join(tmp, ".entity-ids.json");

      const firstAgent = yield* Effect.promise(() =>
        fsp.readFile(agentPath, "utf8").then(readAgent)
      );
      const firstCatalog = yield* Effect.promise(() =>
        fsp.readFile(catalogPath, "utf8").then(readCatalog)
      );
      const firstDataService = yield* Effect.promise(() =>
        fsp.readFile(dataServicePath, "utf8").then(readDataService)
      );
      const firstDataset = yield* Effect.promise(() =>
        fsp.readFile(datasetPath, "utf8").then(readDataset)
      );
      const firstDistribution = yield* Effect.promise(() =>
        fsp.readFile(distributionPath, "utf8").then(readDistribution)
      );
      const firstLedger = yield* Effect.promise(() =>
        fsp.readFile(ledgerPath, "utf8").then(readLedger)
      );

      expect(firstCatalog.publisherAgentId).toBe(firstAgent.id);
      expect(firstDataService.publisherAgentId).toBe(firstAgent.id);
      expect(firstDataset.dataServiceIds).toEqual([firstDataService.id]);
      expect(firstDataset.aliases).toEqual([
        {
          scheme: "energy-charts-endpoint",
          value: "price",
          relation: "exactMatch"
        }
      ]);
      expect(firstDistribution.accessServiceId).toBe(firstDataService.id);
      expect(firstLedger["Agent:fraunhofer-ise"]).toBe(firstAgent.id);
      expect(firstLedger["Catalog:energy-charts"]).toBe(firstCatalog.id);
      expect(firstLedger["DataService:energy-charts-api"]).toBe(
        firstDataService.id
      );

      yield* runEnergyChartsIngest(config).pipe(Effect.provide(layer));

      const secondAgent = yield* Effect.promise(() =>
        fsp.readFile(agentPath, "utf8").then(readAgent)
      );
      const secondCatalog = yield* Effect.promise(() =>
        fsp.readFile(catalogPath, "utf8").then(readCatalog)
      );
      const secondDataService = yield* Effect.promise(() =>
        fsp.readFile(dataServicePath, "utf8").then(readDataService)
      );
      const secondDataset = yield* Effect.promise(() =>
        fsp.readFile(datasetPath, "utf8").then(readDataset)
      );
      const secondLedger = yield* Effect.promise(() =>
        fsp.readFile(ledgerPath, "utf8").then(readLedger)
      );

      expect(secondAgent.id).toBe(firstAgent.id);
      expect(secondCatalog.id).toBe(firstCatalog.id);
      expect(secondDataService.id).toBe(firstDataService.id);
      expect(secondDataset.id).toBe(firstDataset.id);
      expect(secondDataService.servesDatasetIds).toHaveLength(2);
      expect(secondLedger).toEqual(firstLedger);

      yield* Effect.promise(() => cleanup(tmp));
    })
  );
});
