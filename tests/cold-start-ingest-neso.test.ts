import { describe, expect, it } from "@effect/vitest";
import * as BunFileSystem from "@effect/platform-bun/BunFileSystem";
import * as BunPath from "@effect/platform-bun/BunPath";
import { Effect, Layer, Option, Schema } from "effect";
import { HttpClient, HttpClientResponse } from "effect/unstable/http";
import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as nodePath from "node:path";
import {
  Agent,
  Catalog,
  DataService,
  Dataset,
  Distribution
} from "../src/domain/data-layer";
import {
  type CatalogIndex,
  EntityIdLedger,
  loadCatalogIndexWith
} from "../src/ingest/dcat-harness";
import {
  NesoPackageInfo,
  buildCandidateNodes,
  buildContextFromIndex,
  catalogUrl,
  nesoDatasetSlug,
  runNesoIngest
} from "../src/ingest/dcat-adapters/neso";
import { decodeJsonStringWith } from "../src/platform/Json";
import { type ScriptConfigShape } from "../scripts/cold-start-ingest-neso";

const bunFsLayer = Layer.mergeAll(BunFileSystem.layer, BunPath.layer);
const FIXTURE_NOW = "2026-04-13T00:00:00.000Z";
const FIXTURE_BASE_URL = "https://example.neso.test/api/3/action";

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
  nodePath.resolve(
    process.cwd(),
    "references",
    "cold-start",
    "catalog",
    ...segments
  );

const NESO_AGENT = Schema.decodeUnknownSync(Agent)(
  JSON.parse(fs.readFileSync(repoCatalogFile("agents", "neso.json"), "utf8"))
);

const makeSeededColdStartRoot = async (): Promise<string> => {
  const tmp = await fsp.mkdtemp(nodePath.join(os.tmpdir(), "skygest-neso-"));
  const catalogDir = nodePath.join(tmp, "catalog");
  for (const subDir of FIXTURE_SUBDIRS) {
    await fsp.mkdir(nodePath.join(catalogDir, subDir), { recursive: true });
  }

  await fsp.copyFile(
    repoCatalogFile("agents", "neso.json"),
    nodePath.join(catalogDir, "agents", "neso.json")
  );

  return tmp;
};

const cleanup = (tmp: string) => fsp.rm(tmp, { recursive: true, force: true });

const emptyIndexWithNesoAgent = (): CatalogIndex => ({
  datasetsByMergeKey: new Map(),
  datasetFileSlugById: new Map(),
  datasetSeriesById: new Map(),
  datasetSeriesFileSlugById: new Map(),
  distributionsByDatasetIdKind: new Map(),
  distributionFileSlugById: new Map(),
  catalogRecordsByCatalogAndPrimaryTopic: new Map(),
  catalogRecordFileSlugById: new Map(),
  agentsById: new Map([[NESO_AGENT.id, NESO_AGENT]]),
  agentFileSlugById: new Map([[NESO_AGENT.id, "neso"]]),
  agentsByName: new Map([
    [NESO_AGENT.name, NESO_AGENT],
    ...(NESO_AGENT.alternateNames ?? []).map((name) => [name, NESO_AGENT] as const)
  ]),
  catalogsById: new Map(),
  dataServicesById: new Map(),
  allDatasets: [],
  allDatasetSeries: [],
  allDistributions: [],
  allCatalogRecords: [],
  allCatalogs: [],
  allDataServices: [],
  allAgents: [NESO_AGENT]
});

const decodeInfo = Schema.decodeUnknownSync(NesoPackageInfo);
const readCatalog = decodeJsonStringWith(Catalog);
const readDataset = decodeJsonStringWith(Dataset);
const readDistribution = decodeJsonStringWith(Distribution);
const readDataService = decodeJsonStringWith(DataService);
const readLedger = decodeJsonStringWith(EntityIdLedger);

const makePackage = (
  datasetName: string,
  overrides?: Record<string, unknown>
) =>
  decodeInfo({
    id: `${datasetName}-id`,
    name: datasetName,
    title: "Historic Demand Data",
    state: "active",
    metadata_created: "2020-01-01T00:00:00.000Z",
    metadata_modified: "2026-04-13T21:41:40.318308",
    notes: "Historic demand data.<br>Updated when new files arrive.",
    license_url: "https://www.neso.energy/data-portal/ngeso-open-licence",
    tags: [
      { name: "Demand", display_name: "Demand" },
      { name: "Historic", display_name: "Historic" }
    ],
    extras: [{ key: "Update Frequency", value: "Monthly" }],
    organization: {
      name: "demand-data",
      title: "Demand",
      description: "Demand data feed"
    },
    resources: [
      {
        id: "faq-doc",
        name: "FAQ",
        description: "Historic demand FAQ",
        format: "DOC",
        mimetype: "application/msword",
        state: "active",
        url: "https://downloads.example/faq.doc",
        created: "2024-01-01T00:00:00.000Z",
        last_modified: "2024-01-02T00:00:00.000Z",
        metadata_modified: "2024-01-02T00:00:00.000Z"
      },
      {
        id: "csv-older",
        name: "Demand 2009",
        description: "Older annual file",
        format: "CSV",
        mimetype: "text/csv",
        state: "active",
        url: "https://downloads.example/demand-2009.csv",
        datastore_active: false,
        position: 0,
        created: "2020-01-01T00:00:00.000Z",
        last_modified: "2024-01-01T00:00:00.000Z",
        metadata_modified: "2024-01-01T00:00:00.000Z"
      },
      {
        id: "csv-newer",
        name: "Demand 2010",
        description: "Latest annual file",
        format: "CSV",
        mimetype: "text/csv",
        state: "active",
        url: "https://downloads.example/demand-2010.csv",
        datastore_active: true,
        position: 1,
        created: "2021-01-01T00:00:00.000Z",
        last_modified: "2025-01-01T00:00:00.000Z",
        metadata_modified: "2025-01-01T00:00:00.000Z"
      }
    ],
    ...overrides
  });

describe("neso adapter", () => {
  it("chooses the latest data file and keeps documentation separately", () => {
    const idx = emptyIndexWithNesoAgent();
    const ctx = buildContextFromIndex(idx, FIXTURE_NOW);
    const candidates = buildCandidateNodes(
      [makePackage("historic-demand-data")],
      idx,
      ctx
    );

    expect(candidates).toHaveLength(7);

    const datasetNode = candidates.find(
      (candidate): candidate is Extract<typeof candidates[number], { _tag: "dataset" }> =>
        candidate._tag === "dataset"
    );
    const downloadDistributionNode = candidates.find(
      (candidate): candidate is Extract<
        typeof candidates[number],
        { _tag: "distribution" }
      > =>
        candidate._tag === "distribution" &&
        candidate.slug === `${nesoDatasetSlug("historic-demand-data")}-download`
    );
    const documentationDistributionNode = candidates.find(
      (candidate): candidate is Extract<
        typeof candidates[number],
        { _tag: "distribution" }
      > =>
        candidate._tag === "distribution" &&
        candidate.slug === `${nesoDatasetSlug("historic-demand-data")}-docs`
    );

    expect(datasetNode?.data.distributionIds).toEqual([
      downloadDistributionNode!.data.id,
      documentationDistributionNode!.data.id
    ]);
    expect(downloadDistributionNode?.data.downloadURL).toBe(
      "https://downloads.example/demand-2010.csv"
    );
    expect(downloadDistributionNode?.data.accessServiceId).toBe(ctx.dataService.id);
    expect(documentationDistributionNode?.data.accessURL).toBe(
      "https://downloads.example/faq.doc"
    );
  });

  it.effect("writes NESO catalog files and reuses the same ids on rerun", () =>
    Effect.gen(function* () {
      const tmp = yield* Effect.promise(makeSeededColdStartRoot);
      const config: ScriptConfigShape = {
        rootDir: tmp,
        dryRun: false,
        noCache: false,
        baseUrl: FIXTURE_BASE_URL,
        minIntervalMs: 0,
        maxDatasets: 10,
        onlyDataset: Option.none()
      };
      const fetchedRows = [makePackage("historic-demand-data")];
      const expectedUrl = catalogUrl(FIXTURE_BASE_URL, 100, 0);

      const layer = Layer.mergeAll(
        bunFsLayer,
        makeHttpLayer((request, url) =>
          Effect.gen(function* () {
            expect(url.toString()).toBe(expectedUrl);
            return jsonResponse(request, {
              result: {
                count: fetchedRows.length,
                results: fetchedRows
              }
            });
          })
        )
      );

      yield* runNesoIngest(config).pipe(Effect.provide(layer));

      const catalogPath = nodePath.join(
        tmp,
        "catalog",
        "catalogs",
        "neso-data-portal.json"
      );
      const dataServicePath = nodePath.join(
        tmp,
        "catalog",
        "data-services",
        "neso-ckan-api.json"
      );
      const datasetPath = nodePath.join(
        tmp,
        "catalog",
        "datasets",
        "neso-historic-demand-data.json"
      );
      const downloadDistributionPath = nodePath.join(
        tmp,
        "catalog",
        "distributions",
        "neso-historic-demand-data-download.json"
      );
      const documentationDistributionPath = nodePath.join(
        tmp,
        "catalog",
        "distributions",
        "neso-historic-demand-data-docs.json"
      );
      const ledgerPath = nodePath.join(tmp, ".entity-ids.json");

      const firstCatalog = yield* Effect.promise(() =>
        fsp.readFile(catalogPath, "utf8").then(readCatalog)
      );
      const firstDataService = yield* Effect.promise(() =>
        fsp.readFile(dataServicePath, "utf8").then(readDataService)
      );
      const firstDataset = yield* Effect.promise(() =>
        fsp.readFile(datasetPath, "utf8").then(readDataset)
      );
      const firstDownloadDistribution = yield* Effect.promise(() =>
        fsp.readFile(downloadDistributionPath, "utf8").then(readDistribution)
      );
      const firstDocumentationDistribution = yield* Effect.promise(() =>
        fsp.readFile(documentationDistributionPath, "utf8").then(readDistribution)
      );
      const firstLedger = yield* Effect.promise(() =>
        fsp.readFile(ledgerPath, "utf8").then(readLedger)
      );

      expect(firstCatalog.publisherAgentId).toBe(NESO_AGENT.id);
      expect(firstDataService.publisherAgentId).toBe(NESO_AGENT.id);
      expect(firstDataService.servesDatasetIds).toEqual([firstDataset.id]);
      expect(firstDataset.distributionIds).toEqual([
        firstDownloadDistribution.id,
        firstDocumentationDistribution.id
      ]);

      yield* runNesoIngest(config).pipe(Effect.provide(layer));

      const secondDataset = yield* Effect.promise(() =>
        fsp.readFile(datasetPath, "utf8").then(readDataset)
      );
      const secondDownloadDistribution = yield* Effect.promise(() =>
        fsp.readFile(downloadDistributionPath, "utf8").then(readDistribution)
      );
      const secondDocumentationDistribution = yield* Effect.promise(() =>
        fsp.readFile(documentationDistributionPath, "utf8").then(readDistribution)
      );
      const secondLedger = yield* Effect.promise(() =>
        fsp.readFile(ledgerPath, "utf8").then(readLedger)
      );

      expect(secondDataset.id).toBe(firstDataset.id);
      expect(secondDownloadDistribution.id).toBe(firstDownloadDistribution.id);
      expect(secondDocumentationDistribution.id).toBe(
        firstDocumentationDistribution.id
      );
      expect(secondLedger).toEqual(firstLedger);

      const reloaded = yield* loadCatalogIndexWith({
        rootDir: tmp,
        mergeAliasScheme: "url"
      }).pipe(Effect.provide(bunFsLayer));

      expect(reloaded.index.allDatasets).toHaveLength(1);
      expect(reloaded.index.allDistributions).toHaveLength(2);

      yield* Effect.promise(() => cleanup(tmp));
    })
  );
});
