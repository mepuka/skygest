import { describe, expect, it } from "@effect/vitest";
import * as BunFileSystem from "@effect/platform-bun/BunFileSystem";
import * as BunPath from "@effect/platform-bun/BunPath";
import { Effect, Layer, Schema } from "effect";
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
  entsoeDatasetSeriesSlug,
  ENTSOE_MANIFEST
} from "../src/ingest/dcat-adapters/entsoe";
import { decodeJsonStringWith } from "../src/platform/Json";
import {
  runEntsoeIngest,
  type ScriptConfigShape
} from "../scripts/cold-start-ingest-entsoe";

const bunFsLayer = Layer.mergeAll(BunFileSystem.layer, BunPath.layer);
const FIXTURE_NOW = "2026-04-13T00:00:00.000Z";
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

const ENTSOE_AGENT = Schema.decodeUnknownSync(Agent)(
  JSON.parse(fs.readFileSync(repoCatalogFile("agents", "entso-e.json"), "utf8"))
);

const makeSeededColdStartRoot = async (): Promise<string> => {
  const tmp = await fsp.mkdtemp(nodePath.join(os.tmpdir(), "skygest-entsoe-"));
  const catalogDir = nodePath.join(tmp, "catalog");
  for (const subDir of FIXTURE_SUBDIRS) {
    await fsp.mkdir(nodePath.join(catalogDir, subDir), { recursive: true });
  }

  await fsp.copyFile(
    repoCatalogFile("agents", "entso-e.json"),
    nodePath.join(catalogDir, "agents", "entso-e.json")
  );

  return tmp;
};

const cleanup = (tmp: string) => fsp.rm(tmp, { recursive: true, force: true });

const emptyIndexWithEntsoeAgent = (): CatalogIndex => ({
  datasetsByMergeKey: new Map(),
  datasetFileSlugById: new Map(),
  datasetSeriesById: new Map(),
  datasetSeriesFileSlugById: new Map(),
  distributionsByDatasetIdKind: new Map(),
  distributionFileSlugById: new Map(),
  catalogRecordsByCatalogAndPrimaryTopic: new Map(),
  catalogRecordFileSlugById: new Map(),
  agentsById: new Map([[ENTSOE_AGENT.id, ENTSOE_AGENT]]),
  agentFileSlugById: new Map([[ENTSOE_AGENT.id, "entso-e"]]),
  agentsByName: new Map([[ENTSOE_AGENT.name, ENTSOE_AGENT]]),
  catalogsById: new Map(),
  dataServicesById: new Map(),
  allDatasets: [],
  allDatasetSeries: [],
  allDistributions: [],
  allCatalogRecords: [],
  allCatalogs: [],
  allDataServices: [],
  allAgents: [ENTSOE_AGENT]
});

const readCatalog = decodeJsonStringWith(Catalog);
const readDataset = decodeJsonStringWith(Dataset);
const readDatasetSeries = decodeJsonStringWith(DatasetSeries);
const readDataService = decodeJsonStringWith(DataService);
const readLedger = decodeJsonStringWith(EntityIdLedger);

describe("entsoe adapter", () => {
  it("groups repeated document-type families into dataset series", () => {
    const entries = ENTSOE_MANIFEST.filter(
      (entry) =>
        entry.documentType === "A65" ||
        (entry.documentType === "A70" && entry.processType === undefined)
    );
    const idx = emptyIndexWithEntsoeAgent();
    const ctx = buildContextFromIndex(idx, FIXTURE_NOW);
    const candidates = buildCandidateNodes(entries, idx, ctx);

    expect(candidates).toHaveLength(16);
    const datasetSeriesNode = candidates.find(
      (candidate): candidate is Extract<
        typeof candidates[number],
        { _tag: "dataset-series" }
      > =>
        candidate._tag === "dataset-series" &&
        candidate.slug === entsoeDatasetSeriesSlug("A65")
    );
    const actualLoadDataset = candidates.find(
      (candidate): candidate is Extract<typeof candidates[number], { _tag: "dataset" }> =>
        candidate._tag === "dataset" && candidate.slug === "entsoe-a65-a16"
    );
    const loadMarginDataset = candidates.find(
      (candidate): candidate is Extract<typeof candidates[number], { _tag: "dataset" }> =>
        candidate._tag === "dataset" && candidate.slug === "entsoe-a70"
    );

    expect(datasetSeriesNode?.data.title).toBe("ENTSO-E Total Load");
    expect(actualLoadDataset?.data.inSeries).toBe(datasetSeriesNode?.data.id);
    expect(loadMarginDataset?.data.inSeries).toBeUndefined();
  });

  it.effect("writes dataset-series files and reuses the same ids on rerun", () =>
    Effect.gen(function* () {
      const tmp = yield* Effect.promise(makeSeededColdStartRoot);
      const config: ScriptConfigShape = {
        rootDir: tmp,
        dryRun: false,
        noCache: false
      };

      yield* runEntsoeIngest(config).pipe(Effect.provide(bunFsLayer));

      const catalogPath = nodePath.join(
        tmp,
        "catalog",
        "catalogs",
        "entsoe-transparency.json"
      );
      const dataServicePath = nodePath.join(
        tmp,
        "catalog",
        "data-services",
        "entsoe-restful-api.json"
      );
      const datasetSeriesDir = nodePath.join(tmp, "catalog", "dataset-series");
      const datasetSeriesPath = nodePath.join(
        datasetSeriesDir,
        "entsoe-a65-series.json"
      );
      const datasetPath = nodePath.join(
        tmp,
        "catalog",
        "datasets",
        "entsoe-a65-a01.json"
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
      const datasetSeriesFiles = yield* Effect.promise(() =>
        fsp.readdir(datasetSeriesDir)
      );

      expect(firstCatalog.publisherAgentId).toBe(ENTSOE_AGENT.id);
      expect(firstDataService.publisherAgentId).toBe(ENTSOE_AGENT.id);
      expect(firstDataset.inSeries).toBe(firstDatasetSeries.id);
      expect(datasetSeriesFiles.sort()).toEqual([
        "entsoe-a09-series.json",
        "entsoe-a61-series.json",
        "entsoe-a65-series.json",
        "entsoe-a69-series.json"
      ]);

      yield* runEntsoeIngest(config).pipe(Effect.provide(bunFsLayer));

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
        mergeAliasScheme: "entsoe-document-type"
      }).pipe(Effect.provide(bunFsLayer));
      expect(reloaded.index.allDatasetSeries).toHaveLength(4);
      expect(reloaded.index.allDatasets).toHaveLength(ENTSOE_MANIFEST.length);

      yield* Effect.promise(() => cleanup(tmp));
    })
  );
});
