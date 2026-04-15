import { describe, expect, it } from "@effect/vitest";
import * as BunFileSystem from "@effect/platform-bun/BunFileSystem";
import * as BunPath from "@effect/platform-bun/BunPath";
import { Effect, Layer, Redacted } from "effect";
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
  DatasetSeries,
  Distribution
} from "../src/domain/data-layer";
import {
  type CatalogIndex,
  EntityIdLedger
} from "../src/ingest/dcat-harness";
import {
  buildCandidateNodes,
  buildContextFromIndex,
  EMBER_AGENT_SLUG,
  EMBER_CATALOG_SLUG,
  EMBER_DATA_SERVICE_SLUG,
  EMBER_AGENT_NAME,
  EMBER_CATALOG_TITLE,
  EMBER_DATA_SERVICE_TITLE,
  EMBER_DATASET_ALIAS_SCHEME,
  EMBER_OPENAPI_URL,
  EMBER_SITE_URL,
  fetchSpec,
  listEndpointFamilies,
  emberCatalogRecordSlug,
  emberDatasetSlug,
  emberDatasetSeriesSlug,
  emberDistributionSlug,
  routeFromPath
} from "../src/ingest/dcat-adapters/ember";
import { decodeJsonStringWith } from "../src/platform/Json";
import {
  runEmberIngest,
  type ScriptConfigShape
} from "../scripts/cold-start-ingest-ember";

const bunFsLayer = Layer.mergeAll(BunFileSystem.layer, BunPath.layer);
const FIXTURE_NOW = "2026-04-11T00:00:00.000Z";

const OPENAPI_FIXTURE = {
  paths: {
    "/v1/electricity-generation/monthly": {
      get: {
        summary: "Electricity generation by month",
        description: "Monthly generation by entity and series"
      }
    },
    "/v1/electricity-generation/yearly": {
      get: {
        summary: "Electricity generation by year",
        description: "Yearly generation by entity and series"
      }
    },
    "/v1/power-sector-emissions/yearly": {
      get: {
        summary: "Power-sector emissions by year"
      }
    },
    "/v1/options/electricity-generation/monthly/entity": {
      get: {
        summary: "Options"
      }
    },
    "/health": {
      get: {
        summary: "Health check"
      }
    }
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

const repoCatalogFile = (...segments: ReadonlyArray<string>) =>
  nodePath.resolve(process.cwd(), ".generated", "cold-start", "catalog", ...segments);

const copyFixture = async (
  root: string,
  subDir: string,
  fileName: string
): Promise<void> => {
  const source = repoCatalogFile(subDir, fileName);
  const destination = nodePath.join(root, "catalog", subDir, fileName);
  await fsp.copyFile(source, destination);
};

const makeSeededColdStartRoot = async (): Promise<string> => {
  const tmp = await fsp.mkdtemp(nodePath.join(os.tmpdir(), "skygest-ember-"));
  const catalogDir = nodePath.join(tmp, "catalog");
  for (const subDir of FIXTURE_SUBDIRS) {
    await fsp.mkdir(nodePath.join(catalogDir, subDir), { recursive: true });
  }

  await copyFixture(tmp, "agents", "ember.json");
  await copyFixture(tmp, "catalogs", "ember.json");
  await copyFixture(tmp, "datasets", "ember-turkiye.json");
  await copyFixture(tmp, "distributions", "ember-turkiye-web.json");
  await copyFixture(tmp, "catalog-records", "ember-turkiye-cr.json");

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
const readDatasetSeries = decodeJsonStringWith(DatasetSeries);
const readDistribution = decodeJsonStringWith(Distribution);
const readDataService = decodeJsonStringWith(DataService);
const readLedger = decodeJsonStringWith(EntityIdLedger);

describe("ember adapter", () => {
  it("pins the Ember roots and merge alias scheme", () => {
    expect(EMBER_AGENT_SLUG).toBe("ember");
    expect(EMBER_CATALOG_SLUG).toBe("ember");
    expect(EMBER_DATA_SERVICE_SLUG).toBe("ember-energy-api");
    expect(EMBER_DATASET_ALIAS_SCHEME).toBe(AliasSchemeValues.emberRoute);
    expect(EMBER_AGENT_NAME).toBe("Ember");
    expect(EMBER_CATALOG_TITLE).toBe("Ember Data Catalog");
    expect(EMBER_DATA_SERVICE_TITLE).toBe("Ember Energy API");
    expect(EMBER_SITE_URL).toBe("https://ember-energy.org/");
    expect(EMBER_OPENAPI_URL).toBe("https://api.ember-energy.org/v1/openapi.json");
  });

  it.effect("fetches the Ember spec with api_key query auth", () =>
    Effect.gen(function* () {
      const spec = yield* fetchSpec(Redacted.make("ember-secret"));
      expect(Object.keys(spec.paths)).toEqual([
        "/v1/electricity-generation/monthly",
        "/v1/electricity-generation/yearly",
        "/v1/power-sector-emissions/yearly",
        "/v1/options/electricity-generation/monthly/entity",
        "/health"
      ]);
    }).pipe(
      Effect.provide(
        makeHttpLayer((request, url) =>
          Effect.gen(function* () {
            expect(url.toString().startsWith(EMBER_OPENAPI_URL)).toBe(true);
            expect(url.searchParams.get("api_key")).toBe("ember-secret");
            return jsonResponse(request, OPENAPI_FIXTURE);
          })
        )
      )
    )
  );

  it("filters only real data endpoints and derives stable Ember slugs", () => {
    expect(routeFromPath("/v1/electricity-generation/monthly")).toBe(
      "electricity-generation/monthly"
    );
    expect(routeFromPath("/v1/options/electricity-generation/monthly/entity")).toBe(
      null
    );
    expect(emberDatasetSlug("electricity-generation/monthly")).toBe(
      "ember-electricity-generation-monthly"
    );
    expect(emberDatasetSeriesSlug("electricity-generation")).toBe(
      "ember-electricity-generation-series"
    );
    expect(emberDistributionSlug("electricity-generation/monthly")).toBe(
      "ember-electricity-generation-monthly-api"
    );
    expect(emberCatalogRecordSlug("electricity-generation/monthly")).toBe(
      "ember-electricity-generation-monthly-cr"
    );

    const families = listEndpointFamilies(OPENAPI_FIXTURE);
    expect(families).toEqual([
      {
        path: "/v1/electricity-generation/monthly",
        family: "electricity-generation",
        resolution: "monthly",
        route: "electricity-generation/monthly",
        datasetSlug: "ember-electricity-generation-monthly",
        datasetSeriesSlug: "ember-electricity-generation-series",
        distributionSlug: "ember-electricity-generation-monthly-api",
        catalogRecordSlug: "ember-electricity-generation-monthly-cr",
        title: "Ember Electricity Generation Monthly",
        summary: "Electricity generation by month",
        description: "Monthly generation by entity and series"
      },
      {
        path: "/v1/electricity-generation/yearly",
        family: "electricity-generation",
        resolution: "yearly",
        route: "electricity-generation/yearly",
        datasetSlug: "ember-electricity-generation-yearly",
        datasetSeriesSlug: "ember-electricity-generation-series",
        distributionSlug: "ember-electricity-generation-yearly-api",
        catalogRecordSlug: "ember-electricity-generation-yearly-cr",
        title: "Ember Electricity Generation Yearly",
        summary: "Electricity generation by year",
        description: "Yearly generation by entity and series"
      },
      {
        path: "/v1/power-sector-emissions/yearly",
        family: "power-sector-emissions",
        resolution: "yearly",
        route: "power-sector-emissions/yearly",
        datasetSlug: "ember-power-sector-emissions-yearly",
        datasetSeriesSlug: "ember-power-sector-emissions-series",
        distributionSlug: "ember-power-sector-emissions-yearly-api",
        catalogRecordSlug: "ember-power-sector-emissions-yearly-cr",
        title: "Ember Power Sector Emissions Yearly",
        summary: "Power-sector emissions by year"
      }
    ]);

    const ctx = buildContextFromIndex(emptyIndex(), FIXTURE_NOW);
    const candidates = buildCandidateNodes(families, emptyIndex(), ctx);
    expect(candidates).toHaveLength(13);
    expect(candidates[0]).toMatchObject({
      _tag: "agent",
      slug: "ember"
    });
    expect(candidates[1]).toMatchObject({
      _tag: "catalog",
      slug: "ember"
    });
    expect(candidates[candidates.length - 1]).toMatchObject({
      _tag: "data-service",
      slug: "ember-energy-api"
    });

    const generationDataset = candidates.find(
      (node): node is Extract<(typeof candidates)[number], { _tag: "dataset" }> =>
        node._tag === "dataset" &&
        node.slug === "ember-electricity-generation-monthly"
    );
    const generationSeries = candidates.find(
      (
        node
      ): node is Extract<(typeof candidates)[number], { _tag: "dataset-series" }> =>
        node._tag === "dataset-series" &&
        node.slug === "ember-electricity-generation-series"
    );
    expect(generationDataset?.data.aliases).toEqual([
      {
        scheme: "ember-route",
        value: "electricity-generation/monthly",
        relation: "exactMatch"
      }
    ]);
    expect(generationSeries?.data.aliases).toEqual([
      {
        scheme: "ember-route",
        value: "electricity-generation",
        relation: "exactMatch"
      }
    ]);
    expect(generationSeries?.data.cadence).toBe("monthly");
    expect(generationDataset?.data.inSeries).toBe(generationSeries?.data.id);
  });

  it.effect(
    "merges the existing Ember roots, adds API datasets, and preserves hand-curated Ember files",
    () =>
      Effect.gen(function* () {
        const tmp = yield* Effect.promise(makeSeededColdStartRoot);
        const config: ScriptConfigShape = {
          rootDir: tmp,
          dryRun: false,
          noCache: false,
          apiKey: Redacted.make("ember-secret"),
          openApiUrl: EMBER_OPENAPI_URL,
          minIntervalMs: 1000
        };
        const layer = Layer.mergeAll(
          bunFsLayer,
          makeHttpLayer((request, url) =>
            Effect.gen(function* () {
              expect(url.toString().startsWith(EMBER_OPENAPI_URL)).toBe(true);
              expect(url.searchParams.get("api_key")).toBe("ember-secret");
              return jsonResponse(request, OPENAPI_FIXTURE);
            })
          )
        );

        const emberTurkiyePath = nodePath.join(
          tmp,
          "catalog",
          "datasets",
          "ember-turkiye.json"
        );
        const emberTurkiyeBefore = yield* Effect.promise(() =>
          fsp.readFile(emberTurkiyePath, "utf8")
        );

        yield* runEmberIngest(config).pipe(Effect.provide(layer));

        const agentPath = nodePath.join(tmp, "catalog", "agents", "ember.json");
        const catalogPath = nodePath.join(tmp, "catalog", "catalogs", "ember.json");
        const dataServicePath = nodePath.join(
          tmp,
          "catalog",
          "data-services",
          "ember-energy-api.json"
        );
        const datasetPath = nodePath.join(
          tmp,
          "catalog",
          "datasets",
          "ember-electricity-generation-monthly.json"
        );
        const datasetYearlyPath = nodePath.join(
          tmp,
          "catalog",
          "datasets",
          "ember-electricity-generation-yearly.json"
        );
        const datasetSeriesPath = nodePath.join(
          tmp,
          "catalog",
          "dataset-series",
          "ember-electricity-generation-series.json"
        );
        const distributionPath = nodePath.join(
          tmp,
          "catalog",
          "distributions",
          "ember-electricity-generation-monthly-api.json"
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
        const firstYearlyDataset = yield* Effect.promise(() =>
          fsp.readFile(datasetYearlyPath, "utf8").then(readDataset)
        );
        const firstDatasetSeries = yield* Effect.promise(() =>
          fsp.readFile(datasetSeriesPath, "utf8").then(readDatasetSeries)
        );
        const firstDistribution = yield* Effect.promise(() =>
          fsp.readFile(distributionPath, "utf8").then(readDistribution)
        );
        const firstLedger = yield* Effect.promise(() =>
          fsp.readFile(ledgerPath, "utf8").then(readLedger)
        );
        const emberTurkiyeAfter = yield* Effect.promise(() =>
          fsp.readFile(emberTurkiyePath, "utf8")
        );

        expect(firstAgent.homepage).toBe("https://ember-energy.org/");
        expect(firstCatalog.publisherAgentId).toBe(firstAgent.id);
        expect(firstCatalog.homepage).toBe("https://ember-energy.org/");
        expect(firstDataService.publisherAgentId).toBe(firstAgent.id);
        expect(firstDataset.dataServiceIds).toEqual([firstDataService.id]);
        expect(firstDataset.inSeries).toBe(firstDatasetSeries.id);
        expect(firstYearlyDataset.inSeries).toBe(firstDatasetSeries.id);
        expect(firstDatasetSeries.cadence).toBe("monthly");
        expect(firstDataset.aliases).toEqual([
          {
            scheme: "ember-route",
            value: "electricity-generation/monthly",
            relation: "exactMatch"
          }
        ]);
        expect(firstDistribution.accessServiceId).toBe(firstDataService.id);
        expect(firstDistribution.accessURL).toBe(
          "https://api.ember-energy.org/v1/electricity-generation/monthly"
        );
        expect(firstLedger["Agent:ember"]).toBe(firstAgent.id);
        expect(firstLedger["Catalog:ember"]).toBe(firstCatalog.id);
        expect(firstLedger["DataService:ember-energy-api"]).toBe(
          firstDataService.id
        );
        expect(firstLedger["DatasetSeries:ember-electricity-generation-series"]).toBe(
          firstDatasetSeries.id
        );
        expect(emberTurkiyeAfter).toBe(emberTurkiyeBefore);

        yield* runEmberIngest(config).pipe(Effect.provide(layer));

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
        const secondYearlyDataset = yield* Effect.promise(() =>
          fsp.readFile(datasetYearlyPath, "utf8").then(readDataset)
        );
        const secondDatasetSeries = yield* Effect.promise(() =>
          fsp.readFile(datasetSeriesPath, "utf8").then(readDatasetSeries)
        );
        const secondLedger = yield* Effect.promise(() =>
          fsp.readFile(ledgerPath, "utf8").then(readLedger)
        );

        expect(secondAgent.id).toBe(firstAgent.id);
        expect(secondCatalog.id).toBe(firstCatalog.id);
        expect(secondDataService.id).toBe(firstDataService.id);
        expect(secondDataset.id).toBe(firstDataset.id);
        expect(secondYearlyDataset.id).toBe(firstYearlyDataset.id);
        expect(secondDatasetSeries.id).toBe(firstDatasetSeries.id);
        expect(secondDataService.servesDatasetIds).toHaveLength(3);
        expect(secondLedger).toEqual(firstLedger);

        yield* Effect.promise(() => cleanup(tmp));
      })
  );
});
