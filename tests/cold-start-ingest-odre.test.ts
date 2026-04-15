import { describe, expect, it } from "@effect/vitest";
import * as BunFileSystem from "@effect/platform-bun/BunFileSystem";
import * as BunPath from "@effect/platform-bun/BunPath";
import { Effect, Layer, Schema } from "effect";
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
  DatasetSeries
} from "../src/domain/data-layer";
import {
  type CatalogIndex,
  EntityIdLedger,
  loadCatalogIndexWith
} from "../src/ingest/dcat-harness";
import {
  buildCandidateNodes,
  buildContextFromIndex,
  catalogUrl,
  OdreDatasetInfo,
  odreDatasetSeriesSlug,
  runOdreIngest
} from "../src/ingest/dcat-adapters/odre";
import { decodeJsonStringWith } from "../src/platform/Json";
import { type ScriptConfigShape } from "../scripts/cold-start-ingest-odre";

const bunFsLayer = Layer.mergeAll(BunFileSystem.layer, BunPath.layer);
const FIXTURE_NOW = "2026-04-13T00:00:00.000Z";
const FIXTURE_BASE_URL = "https://example.odre.test/api/explore/v2.1";
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

const RTE_AGENT = Schema.decodeUnknownSync(Agent)(
  JSON.parse(fs.readFileSync(repoCatalogFile("agents", "rte.json"), "utf8"))
);

const decodeInfo = Schema.decodeUnknownSync(OdreDatasetInfo);

const makeInfo = (datasetId: string, title: string) =>
  decodeInfo({
    dataset_id: datasetId,
    metas: {
      default: {
        title,
        description: `${title} description`,
        keyword: ["energy"],
        theme: ["grid"],
        modified: "2026-04-01T00:00:00Z",
        publisher: "RTE",
        language: "fr",
        license: "ODbL",
        records_count: 1
      },
      dcat: {
        temporal: null,
        created: "2026-01-01T00:00:00Z",
        creator: "RTE"
      },
      dcat_ap: {
        access_right: "public"
      }
    }
  });

const DATASET_FIXTURE = [
  makeInfo(
    "monitoring-capacites-echanges-cwe",
    "Monitoring capacites echanges CWE"
  ),
  makeInfo(
    "monitoring-capacites-echanges-cwe-2021-2022",
    "Monitoring capacites echanges CWE 2021-2022"
  )
] as const;

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

const makeSeededColdStartRoot = async (): Promise<string> => {
  const tmp = await fsp.mkdtemp(nodePath.join(os.tmpdir(), "skygest-odre-"));
  const catalogDir = nodePath.join(tmp, "catalog");
  for (const subDir of FIXTURE_SUBDIRS) {
    await fsp.mkdir(nodePath.join(catalogDir, subDir), { recursive: true });
  }

  await fsp.copyFile(
    repoCatalogFile("agents", "rte.json"),
    nodePath.join(catalogDir, "agents", "rte.json")
  );

  return tmp;
};

const cleanup = (tmp: string) => fsp.rm(tmp, { recursive: true, force: true });

const emptyIndexWithRteAgent = (): CatalogIndex => ({
  datasetsByMergeKey: new Map(),
  datasetFileSlugById: new Map(),
  datasetSeriesById: new Map(),
  datasetSeriesFileSlugById: new Map(),
  distributionsByDatasetIdKind: new Map(),
  distributionFileSlugById: new Map(),
  catalogRecordsByCatalogAndPrimaryTopic: new Map(),
  catalogRecordFileSlugById: new Map(),
  agentsById: new Map([[RTE_AGENT.id, RTE_AGENT]]),
  agentFileSlugById: new Map([[RTE_AGENT.id, "rte"]]),
  agentsByName: new Map([[RTE_AGENT.name, RTE_AGENT]]),
  catalogsById: new Map(),
  dataServicesById: new Map(),
  allDatasets: [],
  allDatasetSeries: [],
  allDistributions: [],
  allCatalogRecords: [],
  allCatalogs: [],
  allDataServices: [],
  allAgents: [RTE_AGENT]
});

const readCatalog = decodeJsonStringWith(Catalog);
const readDataset = decodeJsonStringWith(Dataset);
const readDatasetSeries = decodeJsonStringWith(DatasetSeries);
const readDataService = decodeJsonStringWith(DataService);
const readLedger = decodeJsonStringWith(EntityIdLedger);

describe("odre adapter", () => {
  it("groups year-stamped dataset ids into dataset series", () => {
    const idx = emptyIndexWithRteAgent();
    const ctx = buildContextFromIndex(idx, FIXTURE_NOW);
    const candidates = buildCandidateNodes(DATASET_FIXTURE, idx, ctx);

    expect(candidates).toHaveLength(10);
    const datasetSeriesNode = candidates.find(
      (candidate): candidate is Extract<
        typeof candidates[number],
        { _tag: "dataset-series" }
      > =>
        candidate._tag === "dataset-series" &&
        candidate.slug === odreDatasetSeriesSlug("monitoring-capacites-echanges-cwe")
    );
    const datedDataset = candidates.find(
      (candidate): candidate is Extract<typeof candidates[number], { _tag: "dataset" }> =>
        candidate._tag === "dataset" &&
        candidate.slug === "odre-monitoring-capacites-echanges-cwe-2021-2022"
    );

    expect(datasetSeriesNode?.data.cadence).toBe("annual");
    expect(datasetSeriesNode?.data.title).toBe(
      "Monitoring capacites echanges CWE"
    );
    expect(datedDataset?.data.inSeries).toBe(datasetSeriesNode?.data.id);
  });

  it.effect("writes dataset-series files and reuses ids on rerun", () =>
    Effect.gen(function* () {
      const tmp = yield* Effect.promise(makeSeededColdStartRoot);
      const config: ScriptConfigShape = {
        rootDir: tmp,
        dryRun: false,
        noCache: false,
        baseUrl: FIXTURE_BASE_URL,
        minIntervalMs: 0
      };
      const layer = Layer.mergeAll(
        bunFsLayer,
        makeHttpLayer((request, url) =>
          Effect.gen(function* () {
            expect(url.toString()).toBe(catalogUrl(FIXTURE_BASE_URL, 100, 0));
            return jsonResponse(request, {
              total_count: DATASET_FIXTURE.length,
              results: DATASET_FIXTURE
            });
          })
        )
      );

      yield* runOdreIngest(config).pipe(Effect.provide(layer));

      const catalogPath = nodePath.join(tmp, "catalog", "catalogs", "odre.json");
      const dataServicePath = nodePath.join(
        tmp,
        "catalog",
        "data-services",
        "odre-api.json"
      );
      const datasetSeriesPath = nodePath.join(
        tmp,
        "catalog",
        "dataset-series",
        "odre-monitoring-capacites-echanges-cwe-series.json"
      );
      const datasetPath = nodePath.join(
        tmp,
        "catalog",
        "datasets",
        "odre-monitoring-capacites-echanges-cwe-2021-2022.json"
      );
      const ledgerPath = nodePath.join(tmp, ".entity-ids.json");

      const firstCatalog = yield* Effect.promise(() =>
        fsp.readFile(catalogPath, "utf8").then(readCatalog)
      );
      const firstDataService = yield* Effect.promise(() =>
        fsp.readFile(dataServicePath, "utf8").then(readDataService)
      );
      const firstDatasetSeries = yield* Effect.promise(() =>
        fsp.readFile(datasetSeriesPath, "utf8").then(readDatasetSeries)
      );
      const firstDataset = yield* Effect.promise(() =>
        fsp.readFile(datasetPath, "utf8").then(readDataset)
      );
      const firstLedger = yield* Effect.promise(() =>
        fsp.readFile(ledgerPath, "utf8").then(readLedger)
      );

      expect(firstCatalog.publisherAgentId).toBe(RTE_AGENT.id);
      expect(firstDataService.publisherAgentId).toBe(RTE_AGENT.id);
      expect(firstDataset.inSeries).toBe(firstDatasetSeries.id);

      yield* runOdreIngest(config).pipe(Effect.provide(layer));

      const secondDatasetSeries = yield* Effect.promise(() =>
        fsp.readFile(datasetSeriesPath, "utf8").then(readDatasetSeries)
      );
      const secondDataset = yield* Effect.promise(() =>
        fsp.readFile(datasetPath, "utf8").then(readDataset)
      );
      const secondLedger = yield* Effect.promise(() =>
        fsp.readFile(ledgerPath, "utf8").then(readLedger)
      );

      expect(secondDatasetSeries.id).toBe(firstDatasetSeries.id);
      expect(secondDataset.id).toBe(firstDataset.id);
      expect(secondLedger).toEqual(firstLedger);

      const reloaded = yield* loadCatalogIndexWith({
        rootDir: tmp,
        mergeAliasScheme: "odre-dataset-id"
      }).pipe(Effect.provide(bunFsLayer));
      expect(reloaded.index.allDatasetSeries).toHaveLength(1);
      expect(reloaded.index.allDatasets).toHaveLength(2);

      yield* Effect.promise(() => cleanup(tmp));
    })
  );
});
