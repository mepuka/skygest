import { describe, expect, it } from "@effect/vitest";
import * as BunFileSystem from "@effect/platform-bun/BunFileSystem";
import * as BunPath from "@effect/platform-bun/BunPath";
import { Effect, Layer, Schema } from "effect";
import { HttpClient, HttpClientResponse } from "effect/unstable/http";
import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as nodePath from "node:path";
import { Dataset, DatasetSeries } from "../src/domain/data-layer";
import {
  type CatalogIndex,
  loadCatalogIndexWith
} from "../src/ingest/dcat-harness";
import {
  DataEuropaDatasetInfo,
  buildCandidateNodes,
  buildContextFromIndex,
  catalogUrl,
  europaDatasetSeriesSlug,
  runDataEuropaIngest
} from "../src/ingest/dcat-adapters/data-europa";
import { decodeJsonStringWith } from "../src/platform/Json";
import { type ScriptConfigShape } from "../scripts/cold-start-ingest-data-europa";

const bunFsLayer = Layer.mergeAll(BunFileSystem.layer, BunPath.layer);
const FIXTURE_NOW = "2026-04-13T00:00:00.000Z";
const FIXTURE_BASE_URL = "https://example.data.europa.test";

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
    nodePath.join(os.tmpdir(), "skygest-data-europa-")
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

const decodeInfo = Schema.decodeUnknownSync(DataEuropaDatasetInfo);
const readDataset = decodeJsonStringWith(Dataset);
const readDatasetSeries = decodeJsonStringWith(DatasetSeries);

const makeSeriesInfo = (overrides?: Record<string, unknown>) =>
  decodeInfo({
    id: "annual-energy-series",
    name: "annual-energy-series",
    type: "dataset_series",
    translation: {
      en: {
        title: "Annual Energy Review",
        notes: "Yearly energy releases"
      }
    },
    publisher: { name: "Eurostat" },
    frequency:
      "http://publications.europa.eu/resource/authority/frequency/ANNUAL",
    ...overrides
  });

const makeDatasetInfo = (
  datasetId: string,
  title: string,
  inSeries: unknown
) =>
  decodeInfo({
    id: datasetId,
    type: "dataset",
    translation: {
      en: {
        title,
        notes: `${title} notes`
      }
    },
    publisher: { name: "Eurostat" },
    resources: [
      {
        id: `${datasetId}-csv`,
        access_url: `https://downloads.example/${datasetId}.csv`,
        format: "csv",
        size: 128
      }
    ],
    in_series: inSeries
  });

describe("data-europa adapter", () => {
  it("creates dataset-series candidates from source rows and only links unambiguous memberships", () => {
    const index = emptyIndex();
    const ctx = buildContextFromIndex(index, FIXTURE_NOW);
    const candidates = buildCandidateNodes(
      [
        makeSeriesInfo(),
        makeDatasetInfo(
          "energy-review-2024",
          "Annual Energy Review 2024",
          ["annual-energy-series"]
        ),
        makeDatasetInfo(
          "energy-review-2023",
          "Annual Energy Review 2023",
          ["annual-energy-series", "second-series"]
        )
      ],
      index,
      ctx
    );

    expect(candidates).toHaveLength(10);

    const datasetSeriesNode = candidates.find(
      (node): node is Extract<(typeof candidates)[number], { _tag: "dataset-series" }> =>
        node._tag === "dataset-series"
    );
    const linkedDatasetNode = candidates.find(
      (node): node is Extract<(typeof candidates)[number], { _tag: "dataset" }> =>
        node._tag === "dataset" && node.slug === "europa-energy-review-2024"
    );
    const ambiguousDatasetNode = candidates.find(
      (node): node is Extract<(typeof candidates)[number], { _tag: "dataset" }> =>
        node._tag === "dataset" && node.slug === "europa-energy-review-2023"
    );

    expect(datasetSeriesNode?.slug).toBe(
      europaDatasetSeriesSlug("annual-energy-series")
    );
    expect(datasetSeriesNode?.data.aliases).toEqual([
      {
        scheme: "europa-dataset-id",
        value: "annual-energy-series",
        relation: "exactMatch"
      }
    ]);
    expect(linkedDatasetNode?.data.inSeries).toBe(datasetSeriesNode?.data.id);
    expect(ambiguousDatasetNode?.data.inSeries).toBeUndefined();
  });

  it.effect("writes dataset-series files and reuses the same ids on rerun", () => {
    let tmp = "";

    return Effect.gen(function* () {
      tmp = yield* Effect.promise(makeEmptyColdStartRoot);
      const config: ScriptConfigShape = {
        rootDir: tmp,
        dryRun: false,
        baseUrl: FIXTURE_BASE_URL,
        minIntervalMs: 0,
        maxDatasets: 10,
        noCache: false
      };
      const fetchedRows = [
        makeSeriesInfo({
          url: "https://example.data.europa.test/dataset/annual-energy-series"
        }),
        makeDatasetInfo(
          "energy-review-2024",
          "Annual Energy Review 2024",
          [{ id: "annual-energy-series", name: "annual-energy-series" }]
        )
      ];
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

      yield* runDataEuropaIngest(config).pipe(Effect.provide(layer));

      const datasetSeriesDir = nodePath.join(tmp, "catalog", "dataset-series");
      const datasetDir = nodePath.join(tmp, "catalog", "datasets");
      const firstSeriesFiles = yield* Effect.promise(() =>
        fsp.readdir(datasetSeriesDir)
      );
      const firstDatasetFiles = yield* Effect.promise(() =>
        fsp.readdir(datasetDir)
      );

      expect(firstSeriesFiles).toEqual([
        `${europaDatasetSeriesSlug("annual-energy-series")}.json`
      ]);
      expect(firstDatasetFiles).toEqual(["europa-energy-review-2024.json"]);

      const firstSeries = yield* Effect.promise(() =>
        fsp
          .readFile(nodePath.join(datasetSeriesDir, firstSeriesFiles[0]!), "utf8")
          .then(readDatasetSeries)
      );
      const firstDataset = yield* Effect.promise(() =>
        fsp
          .readFile(nodePath.join(datasetDir, firstDatasetFiles[0]!), "utf8")
          .then(readDataset)
      );

      expect(firstDataset.inSeries).toBe(firstSeries.id);

      yield* runDataEuropaIngest(config).pipe(Effect.provide(layer));

      const secondSeries = yield* Effect.promise(() =>
        fsp
          .readFile(nodePath.join(datasetSeriesDir, firstSeriesFiles[0]!), "utf8")
          .then(readDatasetSeries)
      );
      const secondDataset = yield* Effect.promise(() =>
        fsp
          .readFile(nodePath.join(datasetDir, firstDatasetFiles[0]!), "utf8")
          .then(readDataset)
      );

      expect(secondSeries.id).toBe(firstSeries.id);
      expect(secondDataset.id).toBe(firstDataset.id);
      expect(secondDataset.inSeries).toBe(secondSeries.id);

      const reloaded = yield* loadCatalogIndexWith({
        rootDir: tmp,
        mergeAliasScheme: "europa-dataset-id"
      }).pipe(Effect.provide(bunFsLayer));

      expect(reloaded.index.allDatasetSeries).toHaveLength(1);
      expect(reloaded.index.allDatasets).toHaveLength(1);
    }).pipe(
      Effect.ensuring(
        Effect.promise(() =>
          tmp.length === 0 ? Promise.resolve() : cleanup(tmp)
        )
      )
    );
  });
});
