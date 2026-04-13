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
  Dataset,
  DatasetSeries,
  Distribution
} from "../src/domain/data-layer";
import {
  type CatalogIndex,
  EntityIdLedger,
  loadCatalogIndexWith
} from "../src/ingest/dcat-harness";
import {
  ENERGY_INSTITUTE_MANIFEST,
  ENERGY_INSTITUTE_REVIEW_CHARTING_APP_URL,
  ENERGY_INSTITUTE_REVIEW_HOME_URL,
  ENERGY_INSTITUTE_REVIEW_RESOURCES_URL,
  ENERGY_INSTITUTE_TRACKER_APP_URL,
  buildCandidateNodes,
  buildContextFromIndex,
  isEnergyInstituteDatasetAlias,
  runEnergyInstituteIngest
} from "../src/ingest/dcat-adapters/energy-institute";
import { decodeJsonStringWith } from "../src/platform/Json";
import { type ScriptConfigShape } from "../scripts/cold-start-ingest-energy-institute";

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
  nodePath.resolve(
    process.cwd(),
    "references",
    "cold-start",
    "catalog",
    ...segments
  );

const ENERGY_INSTITUTE_AGENT = Schema.decodeUnknownSync(Agent)(
  JSON.parse(
    fs.readFileSync(repoCatalogFile("agents", "energy-institute.json"), "utf8")
  )
);
const ENERGY_INSTITUTE_CATALOG = Schema.decodeUnknownSync(Catalog)(
  JSON.parse(
    fs.readFileSync(
      repoCatalogFile("catalogs", "energy-institute.json"),
      "utf8"
    )
  )
);
const REVIEW_DATASET = Schema.decodeUnknownSync(Dataset)(
  JSON.parse(
    fs.readFileSync(
      repoCatalogFile("datasets", "ei-statistical-review-dataset.json"),
      "utf8"
    )
  )
);
const REVIEW_SERIES = Schema.decodeUnknownSync(DatasetSeries)(
  JSON.parse(
    fs.readFileSync(
      repoCatalogFile("dataset-series", "ei-statistical-review.json"),
      "utf8"
    )
  )
);
const REVIEW_DOWNLOAD = Schema.decodeUnknownSync(Distribution)(
  JSON.parse(
    fs.readFileSync(
      repoCatalogFile("distributions", "ei-review-download.json"),
      "utf8"
    )
  )
);
const REVIEW_WEB = Schema.decodeUnknownSync(Distribution)(
  JSON.parse(
    fs.readFileSync(
      repoCatalogFile("distributions", "ei-review-web.json"),
      "utf8"
    )
  )
);

const makeSeededColdStartRoot = async (): Promise<string> => {
  const tmp = await fsp.mkdtemp(nodePath.join(os.tmpdir(), "skygest-energy-institute-"));
  const catalogDir = nodePath.join(tmp, "catalog");
  for (const subDir of FIXTURE_SUBDIRS) {
    await fsp.mkdir(nodePath.join(catalogDir, subDir), { recursive: true });
  }

  await fsp.copyFile(
    repoCatalogFile("agents", "energy-institute.json"),
    nodePath.join(catalogDir, "agents", "energy-institute.json")
  );
  await fsp.copyFile(
    repoCatalogFile("catalogs", "energy-institute.json"),
    nodePath.join(catalogDir, "catalogs", "energy-institute.json")
  );
  await fsp.copyFile(
    repoCatalogFile("datasets", "ei-statistical-review-dataset.json"),
    nodePath.join(catalogDir, "datasets", "ei-statistical-review-dataset.json")
  );
  await fsp.copyFile(
    repoCatalogFile("dataset-series", "ei-statistical-review.json"),
    nodePath.join(catalogDir, "dataset-series", "ei-statistical-review.json")
  );
  await fsp.copyFile(
    repoCatalogFile("distributions", "ei-review-download.json"),
    nodePath.join(catalogDir, "distributions", "ei-review-download.json")
  );
  await fsp.copyFile(
    repoCatalogFile("distributions", "ei-review-web.json"),
    nodePath.join(catalogDir, "distributions", "ei-review-web.json")
  );

  return tmp;
};

const cleanup = (tmp: string) => fsp.rm(tmp, { recursive: true, force: true });

const seededIndex = (): CatalogIndex => ({
  datasetsByMergeKey: new Map(),
  datasetFileSlugById: new Map([[REVIEW_DATASET.id, "ei-statistical-review-dataset"]]),
  datasetSeriesById: new Map([[REVIEW_SERIES.id, REVIEW_SERIES]]),
  datasetSeriesFileSlugById: new Map([[REVIEW_SERIES.id, "ei-statistical-review"]]),
  distributionsByDatasetIdKind: new Map([
    [`${REVIEW_DATASET.id}::download`, REVIEW_DOWNLOAD],
    [`${REVIEW_DATASET.id}::interactive-web-app`, REVIEW_WEB]
  ]),
  distributionFileSlugById: new Map([
    [REVIEW_DOWNLOAD.id, "ei-review-download"],
    [REVIEW_WEB.id, "ei-review-web"]
  ]),
  catalogRecordsByCatalogAndPrimaryTopic: new Map(),
  catalogRecordFileSlugById: new Map(),
  agentsById: new Map([[ENERGY_INSTITUTE_AGENT.id, ENERGY_INSTITUTE_AGENT]]),
  agentFileSlugById: new Map([[ENERGY_INSTITUTE_AGENT.id, "energy-institute"]]),
  agentsByName: new Map([
    [ENERGY_INSTITUTE_AGENT.name, ENERGY_INSTITUTE_AGENT],
    ...(ENERGY_INSTITUTE_AGENT.alternateNames ?? []).map((name) => [
      name,
      ENERGY_INSTITUTE_AGENT
    ] as const)
  ]),
  catalogsById: new Map([[ENERGY_INSTITUTE_CATALOG.id, ENERGY_INSTITUTE_CATALOG]]),
  dataServicesById: new Map(),
  allDatasets: [REVIEW_DATASET],
  allDatasetSeries: [REVIEW_SERIES],
  allDistributions: [REVIEW_DOWNLOAD, REVIEW_WEB],
  allCatalogRecords: [],
  allCatalogs: [ENERGY_INSTITUTE_CATALOG],
  allDataServices: [],
  allAgents: [ENERGY_INSTITUTE_AGENT]
});

const readCatalog = decodeJsonStringWith(Catalog);
const readDataset = decodeJsonStringWith(Dataset);
const readDatasetSeries = decodeJsonStringWith(DatasetSeries);
const readDistribution = decodeJsonStringWith(Distribution);
const readLedger = decodeJsonStringWith(EntityIdLedger);

describe("energy institute adapter", () => {
  it("upgrades the manual statistical review entry and adds the tracker dataset", () => {
    const idx = seededIndex();
    const ctx = buildContextFromIndex(idx, FIXTURE_NOW);
    const candidates = buildCandidateNodes(ENERGY_INSTITUTE_MANIFEST, idx, ctx);

    expect(candidates).toHaveLength(15);

    const reviewDatasetNode = candidates.find(
      (candidate): candidate is Extract<typeof candidates[number], { _tag: "dataset" }> =>
        candidate._tag === "dataset" &&
        candidate.slug === "ei-statistical-review-dataset"
    );
    const reviewSeriesNode = candidates.find(
      (candidate): candidate is Extract<
        typeof candidates[number],
        { _tag: "dataset-series" }
      > =>
        candidate._tag === "dataset-series" &&
        candidate.slug === "ei-statistical-review"
    );
    const reviewDownloadNode = candidates.find(
      (candidate): candidate is Extract<
        typeof candidates[number],
        { _tag: "distribution" }
      > =>
        candidate._tag === "distribution" &&
        candidate.slug === "ei-review-download"
    );
    const reviewWebNode = candidates.find(
      (candidate): candidate is Extract<
        typeof candidates[number],
        { _tag: "distribution" }
      > =>
        candidate._tag === "distribution" &&
        candidate.slug === "ei-review-web"
    );
    const trackerDatasetNode = candidates.find(
      (candidate): candidate is Extract<typeof candidates[number], { _tag: "dataset" }> =>
        candidate._tag === "dataset" &&
        candidate.slug === "ei-country-transition-tracker-dataset"
    );
    const trackerSeriesNode = candidates.find(
      (candidate): candidate is Extract<
        typeof candidates[number],
        { _tag: "dataset-series" }
      > =>
        candidate._tag === "dataset-series" &&
        candidate.slug === "ei-country-transition-tracker"
    );
    const trackerWebNode = candidates.find(
      (candidate): candidate is Extract<
        typeof candidates[number],
        { _tag: "distribution" }
      > =>
        candidate._tag === "distribution" &&
        candidate.slug === "ei-tracker-web"
    );

    expect(reviewSeriesNode?.merged).toBe(true);
    expect(reviewDatasetNode?.merged).toBe(true);
    expect(reviewDatasetNode?.data.id).toBe(REVIEW_DATASET.id);
    expect(reviewDatasetNode?.data.inSeries).toBe(REVIEW_SERIES.id);
    expect(reviewDatasetNode?.data.aliases.some((alias) => alias.value === ENERGY_INSTITUTE_REVIEW_HOME_URL)).toBe(
      true
    );

    expect(reviewDownloadNode?.merged).toBe(true);
    expect(reviewDownloadNode?.data.id).toBe(REVIEW_DOWNLOAD.id);
    expect(reviewDownloadNode?.data.accessURL).toBe(
      ENERGY_INSTITUTE_REVIEW_RESOURCES_URL
    );
    expect(reviewWebNode?.merged).toBe(true);
    expect(reviewWebNode?.data.id).toBe(REVIEW_WEB.id);
    expect(reviewWebNode?.data.accessURL).toBe(
      ENERGY_INSTITUTE_REVIEW_CHARTING_APP_URL
    );

    expect(trackerSeriesNode?.merged).toBe(false);
    expect(trackerDatasetNode?.merged).toBe(false);
    expect(trackerDatasetNode?.data.inSeries).toBe(trackerSeriesNode?.data.id);
    expect(trackerWebNode?.data.accessURL).toBe(ENERGY_INSTITUTE_TRACKER_APP_URL);
  });

  it.effect("writes repeatable review and tracker entities without duplicating ids", () =>
    Effect.gen(function* () {
      const tmp = yield* Effect.promise(makeSeededColdStartRoot);
      const config: ScriptConfigShape = {
        rootDir: tmp,
        dryRun: false,
        noCache: false
      };

      yield* runEnergyInstituteIngest(config).pipe(Effect.provide(bunFsLayer));

      const catalogPath = nodePath.join(
        tmp,
        "catalog",
        "catalogs",
        "energy-institute.json"
      );
      const reviewDatasetPath = nodePath.join(
        tmp,
        "catalog",
        "datasets",
        "ei-statistical-review-dataset.json"
      );
      const trackerDatasetPath = nodePath.join(
        tmp,
        "catalog",
        "datasets",
        "ei-country-transition-tracker-dataset.json"
      );
      const reviewSeriesPath = nodePath.join(
        tmp,
        "catalog",
        "dataset-series",
        "ei-statistical-review.json"
      );
      const trackerSeriesPath = nodePath.join(
        tmp,
        "catalog",
        "dataset-series",
        "ei-country-transition-tracker.json"
      );
      const reviewDownloadPath = nodePath.join(
        tmp,
        "catalog",
        "distributions",
        "ei-review-download.json"
      );
      const reviewWebPath = nodePath.join(
        tmp,
        "catalog",
        "distributions",
        "ei-review-web.json"
      );
      const reportPath = nodePath.join(
        tmp,
        "reports",
        "harvest",
        "energy-institute-ingest-report.json"
      );
      const ledgerPath = nodePath.join(tmp, ".entity-ids.json");

      const firstCatalog = yield* Effect.promise(() =>
        fsp.readFile(catalogPath, "utf8").then(readCatalog)
      );
      const firstReviewDataset = yield* Effect.promise(() =>
        fsp.readFile(reviewDatasetPath, "utf8").then(readDataset)
      );
      const firstTrackerDataset = yield* Effect.promise(() =>
        fsp.readFile(trackerDatasetPath, "utf8").then(readDataset)
      );
      const firstReviewSeries = yield* Effect.promise(() =>
        fsp.readFile(reviewSeriesPath, "utf8").then(readDatasetSeries)
      );
      const firstTrackerSeries = yield* Effect.promise(() =>
        fsp.readFile(trackerSeriesPath, "utf8").then(readDatasetSeries)
      );
      const firstReviewDownload = yield* Effect.promise(() =>
        fsp.readFile(reviewDownloadPath, "utf8").then(readDistribution)
      );
      const firstReviewWeb = yield* Effect.promise(() =>
        fsp.readFile(reviewWebPath, "utf8").then(readDistribution)
      );
      const datasetSeriesFiles = yield* Effect.promise(() =>
        fsp.readdir(nodePath.join(tmp, "catalog", "dataset-series"))
      );
      const distributionFiles = yield* Effect.promise(() =>
        fsp.readdir(nodePath.join(tmp, "catalog", "distributions"))
      );
      const firstLedger = yield* Effect.promise(() =>
        fsp.readFile(ledgerPath, "utf8").then(readLedger)
      );
      const report = yield* Effect.promise(() =>
        fsp.readFile(reportPath, "utf8").then((text) => JSON.parse(text))
      );

      expect(firstCatalog.publisherAgentId).toBe(ENERGY_INSTITUTE_AGENT.id);
      expect(firstReviewDataset.id).toBe(REVIEW_DATASET.id);
      expect(firstReviewSeries.id).toBe(REVIEW_SERIES.id);
      expect(firstReviewDataset.inSeries).toBe(REVIEW_SERIES.id);
      expect(firstReviewDataset.aliases.some((alias) => alias.value === ENERGY_INSTITUTE_REVIEW_HOME_URL)).toBe(
        true
      );
      expect(firstReviewDataset.distributionIds).toHaveLength(4);
      expect(firstTrackerDataset.distributionIds).toHaveLength(3);
      expect(firstTrackerDataset.inSeries).toBe(firstTrackerSeries.id);
      expect(firstReviewDownload.id).toBe(REVIEW_DOWNLOAD.id);
      expect(firstReviewDownload.accessURL).toBe(
        ENERGY_INSTITUTE_REVIEW_RESOURCES_URL
      );
      expect(firstReviewWeb.id).toBe(REVIEW_WEB.id);
      expect(firstReviewWeb.accessURL).toBe(
        ENERGY_INSTITUTE_REVIEW_CHARTING_APP_URL
      );
      expect(datasetSeriesFiles.sort()).toEqual([
        "ei-country-transition-tracker.json",
        "ei-statistical-review.json"
      ]);
      expect(distributionFiles.sort()).toEqual([
        "ei-review-docs.json",
        "ei-review-download.json",
        "ei-review-resources.json",
        "ei-review-web.json",
        "ei-tracker-download.json",
        "ei-tracker-page.json",
        "ei-tracker-web.json"
      ]);
      expect(report.manifestEntryCount).toBe(2);
      expect(report.datasets.created).toEqual(["ei-country-transition-tracker-dataset"]);
      expect(report.datasets.merged).toEqual(["ei-statistical-review-dataset"]);
      expect(report.datasetSeries.merged).toEqual(["ei-statistical-review"]);

      yield* runEnergyInstituteIngest(config).pipe(Effect.provide(bunFsLayer));

      const secondReviewDataset = yield* Effect.promise(() =>
        fsp.readFile(reviewDatasetPath, "utf8").then(readDataset)
      );
      const secondTrackerDataset = yield* Effect.promise(() =>
        fsp.readFile(trackerDatasetPath, "utf8").then(readDataset)
      );
      const secondTrackerSeries = yield* Effect.promise(() =>
        fsp.readFile(trackerSeriesPath, "utf8").then(readDatasetSeries)
      );
      const secondLedger = yield* Effect.promise(() =>
        fsp.readFile(ledgerPath, "utf8").then(readLedger)
      );

      expect(secondReviewDataset.id).toBe(firstReviewDataset.id);
      expect(secondTrackerDataset.id).toBe(firstTrackerDataset.id);
      expect(secondTrackerSeries.id).toBe(firstTrackerSeries.id);
      expect(secondLedger).toEqual(firstLedger);

      const reloaded = yield* loadCatalogIndexWith({
        rootDir: tmp,
        mergeAliasScheme: "url",
        isMergeableDatasetAlias: isEnergyInstituteDatasetAlias
      }).pipe(Effect.provide(bunFsLayer));

      expect(reloaded.skippedDatasets).toHaveLength(0);
      expect(reloaded.index.allDatasets).toHaveLength(2);
      expect(reloaded.index.allDatasetSeries).toHaveLength(2);
      expect(reloaded.index.allDistributions).toHaveLength(7);
      expect(reloaded.index.allCatalogRecords).toHaveLength(2);

      yield* Effect.promise(() => cleanup(tmp));
    })
  );
});
