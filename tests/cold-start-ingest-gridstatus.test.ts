import { describe, expect, it } from "@effect/vitest";
import * as BunFileSystem from "@effect/platform-bun/BunFileSystem";
import * as BunPath from "@effect/platform-bun/BunPath";
import { Effect, Layer, Redacted, Schema } from "effect";
import { HttpClient, HttpClientResponse } from "effect/unstable/http";
import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as nodePath from "node:path";
import {
  Agent,
  AliasSchemeValues,
  Catalog,
  CatalogRecord,
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
  datasetCatalogUrl,
  fetchCatalog,
  GRIDSTATUS_AGENT_NAME,
  GRIDSTATUS_AGENT_SLUG,
  GRIDSTATUS_BASE_URL,
  GRIDSTATUS_CATALOG_SLUG,
  GRIDSTATUS_CATALOG_TITLE,
  GRIDSTATUS_DATA_SERVICE_SLUG,
  GRIDSTATUS_DATA_SERVICE_TITLE,
  GRIDSTATUS_DATASET_ALIAS_SCHEME,
  gridstatusApiDistributionSlug,
  gridstatusCatalogRecordSlug,
  gridstatusCsvDistributionSlug,
  gridstatusDatasetSlug
} from "../src/ingest/dcat-adapters/gridstatus";
import { decodeJsonStringWith } from "../src/platform/Json";
import {
  runGridStatusIngest,
  type ScriptConfigShape
} from "../scripts/cold-start-ingest-gridstatus";

const bunFsLayer = Layer.mergeAll(BunFileSystem.layer, BunPath.layer);
const FIXTURE_NOW = "2026-04-11T00:00:00.000Z";
const PLACEHOLDER_AGENT_ID =
  "https://id.skygest.io/agent/ag_01KNQEZ5VF596JA72ARPNWXEEX";
const PLACEHOLDER_CATALOG_ID =
  "https://id.skygest.io/catalog/cat_01KNQEZ5VF596JA72ARPNWXEEF";
const PLACEHOLDER_DATASET_ID =
  "https://id.skygest.io/dataset/ds_01KNQEZ5VF596JA72ARPNWXEEG";
const PLACEHOLDER_API_DISTRIBUTION_ID =
  "https://id.skygest.io/distribution/dist_01KNQEZ5VF596JA72ARPNWXEEH";
const PLACEHOLDER_PYTHON_DISTRIBUTION_ID =
  "https://id.skygest.io/distribution/dist_01KNQEZ5VF596JA72ARPNWXEEJ";
const PLACEHOLDER_WEB_DISTRIBUTION_ID =
  "https://id.skygest.io/distribution/dist_01KNQEZ5VF596JA72ARPNWXEEK";
const PLACEHOLDER_CATALOG_RECORD_ID =
  "https://id.skygest.io/catalog-record/cr_01KNQEZ5VF596JA72ARPNWXEEM";

const DATASET_FIXTURE = {
  data: [
    {
      id: "pjm_load_forecast",
      name: "PJM Load Forecast",
      description: "Short-term PJM load forecast dataset",
      earliest_available_time_utc: "2020-01-01T00:00:00+00:00",
      latest_available_time_utc: "2026-04-09T00:00:00+00:00",
      source: "pjm",
      last_checked_time_utc: "2026-04-11T02:15:53+00:00",
      primary_key_columns: ["interval_start_utc"],
      publish_time_column: null,
      time_index_column: "interval_start_utc",
      subseries_index_column: null,
      all_columns: [
        {
          name: "interval_start_utc",
          type: "TIMESTAMP",
          is_date: false,
          is_numeric: false,
          is_datetime: true
        },
        {
          name: "load_mw",
          type: "DOUBLE PRECISION",
          is_date: false,
          is_numeric: true,
          is_datetime: false
        }
      ],
      number_of_rows_approximate: 1000,
      table_type: "table",
      is_in_snowflake: true,
      data_frequency: "1_HOUR",
      source_url: "https://services.pjm.com/",
      publication_frequency: null,
      is_published: true,
      created_at_utc: "2025-06-26T18:52:17+00:00",
      status: "active"
    },
    {
      id: "gridstatus_status",
      name: "GridStatus Status",
      description: "GridStatus self-published dataset",
      earliest_available_time_utc: null,
      latest_available_time_utc: "2026-04-09T00:00:00+00:00",
      source: "gridstatus",
      last_checked_time_utc: "2026-04-11T02:15:53+00:00",
      primary_key_columns: ["interval_start_utc"],
      publish_time_column: null,
      time_index_column: "interval_start_utc",
      subseries_index_column: null,
      all_columns: [
        {
          name: "interval_start_utc",
          type: "TIMESTAMP",
          is_date: false,
          is_numeric: false,
          is_datetime: true
        }
      ],
      number_of_rows_approximate: 24,
      table_type: "table",
      is_in_snowflake: true,
      data_frequency: "1_HOUR",
      source_url: null,
      publication_frequency: null,
      is_published: true,
      created_at_utc: "2025-06-26T18:52:17+00:00",
      status: "active"
    }
  ],
  meta: {
    page: 1,
    limit: null,
    page_size: null,
    hasNextPage: null,
    cursor: null
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
  "distributions",
  "catalog-records",
  "data-services"
] as const;

const repoCatalogFile = (...segments: ReadonlyArray<string>) =>
  nodePath.resolve(process.cwd(), "references", "cold-start", "catalog", ...segments);

const copyFixture = async (
  root: string,
  subDir: string,
  fileName: string
): Promise<void> => {
  const source = repoCatalogFile(subDir, fileName);
  const destination = nodePath.join(root, "catalog", subDir, fileName);
  await fsp.copyFile(source, destination);
};

const writeFixtureJson = async (
  root: string,
  subDir: string,
  fileName: string,
  value: unknown
): Promise<void> => {
  const destination = nodePath.join(root, "catalog", subDir, fileName);
  await fsp.writeFile(destination, `${JSON.stringify(value, null, 2)}\n`, "utf8");
};

const PLACEHOLDER_DATASET = Schema.decodeUnknownSync(Dataset)({
  _tag: "Dataset" as const,
  id: PLACEHOLDER_DATASET_ID,
  title: "GridStatus US Grid",
  description: "Legacy placeholder bundle for the overall GridStatus catalog",
  publisherAgentId: PLACEHOLDER_AGENT_ID,
  accessRights: "public",
  landingPage: "https://www.gridstatus.io/",
  distributionIds: [
    PLACEHOLDER_API_DISTRIBUTION_ID,
    PLACEHOLDER_PYTHON_DISTRIBUTION_ID,
    PLACEHOLDER_WEB_DISTRIBUTION_ID
  ],
  aliases: [
    {
      scheme: "url",
      value: "https://www.gridstatus.io/",
      relation: "exactMatch"
    }
  ],
  createdAt: FIXTURE_NOW,
  updatedAt: FIXTURE_NOW
});

const PLACEHOLDER_API_DISTRIBUTION = Schema.decodeUnknownSync(Distribution)({
  _tag: "Distribution" as const,
  id: PLACEHOLDER_API_DISTRIBUTION_ID,
  datasetId: PLACEHOLDER_DATASET_ID,
  kind: "api-access" as const,
  title: "GridStatus API access",
  accessURL: "https://api.gridstatus.io/v1/",
  aliases: [],
  createdAt: FIXTURE_NOW,
  updatedAt: FIXTURE_NOW
});

const PLACEHOLDER_PYTHON_DISTRIBUTION = Schema.decodeUnknownSync(Distribution)({
  _tag: "Distribution" as const,
  id: PLACEHOLDER_PYTHON_DISTRIBUTION_ID,
  datasetId: PLACEHOLDER_DATASET_ID,
  kind: "documentation" as const,
  title: "GridStatus Python client",
  accessURL: "https://github.com/gridstatus/gridstatus",
  aliases: [],
  createdAt: FIXTURE_NOW,
  updatedAt: FIXTURE_NOW
});

const PLACEHOLDER_WEB_DISTRIBUTION = Schema.decodeUnknownSync(Distribution)({
  _tag: "Distribution" as const,
  id: PLACEHOLDER_WEB_DISTRIBUTION_ID,
  datasetId: PLACEHOLDER_DATASET_ID,
  kind: "landing-page" as const,
  title: "GridStatus web catalog",
  accessURL: "https://www.gridstatus.io/",
  aliases: [],
  createdAt: FIXTURE_NOW,
  updatedAt: FIXTURE_NOW
});

const PLACEHOLDER_CATALOG_RECORD = Schema.decodeUnknownSync(CatalogRecord)({
  _tag: "CatalogRecord" as const,
  id: PLACEHOLDER_CATALOG_RECORD_ID,
  catalogId: PLACEHOLDER_CATALOG_ID,
  primaryTopicType: "dataset" as const,
  primaryTopicId: PLACEHOLDER_DATASET_ID,
  sourceRecordId: "gridstatus-us-grid",
  harvestedFrom: "https://www.gridstatus.io/",
  firstSeen: FIXTURE_NOW,
  lastSeen: FIXTURE_NOW,
  isAuthoritative: true
});

const makeSeededColdStartRoot = async (): Promise<string> => {
  const tmp = await fsp.mkdtemp(nodePath.join(os.tmpdir(), "skygest-gridstatus-"));
  const catalogDir = nodePath.join(tmp, "catalog");
  for (const subDir of FIXTURE_SUBDIRS) {
    await fsp.mkdir(nodePath.join(catalogDir, subDir), { recursive: true });
  }

  await copyFixture(tmp, "agents", "gridstatus.json");
  await copyFixture(tmp, "agents", "pjm.json");
  await copyFixture(tmp, "catalogs", "gridstatus.json");
  await copyFixture(tmp, "data-services", "gridstatus-api.json");
  await writeFixtureJson(
    tmp,
    "datasets",
    "gridstatus-us-grid.json",
    PLACEHOLDER_DATASET
  );
  await writeFixtureJson(
    tmp,
    "distributions",
    "gridstatus-api-access.json",
    PLACEHOLDER_API_DISTRIBUTION
  );
  await writeFixtureJson(
    tmp,
    "distributions",
    "gridstatus-python.json",
    PLACEHOLDER_PYTHON_DISTRIBUTION
  );
  await writeFixtureJson(
    tmp,
    "distributions",
    "gridstatus-web.json",
    PLACEHOLDER_WEB_DISTRIBUTION
  );
  await writeFixtureJson(
    tmp,
    "catalog-records",
    "gridstatus-us-grid-cr.json",
    PLACEHOLDER_CATALOG_RECORD
  );

  return tmp;
};

const cleanup = (tmp: string) => fsp.rm(tmp, { recursive: true, force: true });

const emptyIndex = (): CatalogIndex => ({
  datasetsByMergeKey: new Map(),
  datasetFileSlugById: new Map(),
  distributionsByDatasetIdKind: new Map(),
  distributionFileSlugById: new Map(),
  catalogRecordsByCatalogAndPrimaryTopic: new Map(),
  catalogRecordFileSlugById: new Map(),
  agentsById: new Map(),
  agentsByName: new Map(),
  catalogsById: new Map(),
  dataServicesById: new Map(),
  allDatasets: [],
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

describe("gridstatus adapter", () => {
  it("pins the GridStatus roots and merge alias scheme", () => {
    expect(GRIDSTATUS_AGENT_SLUG).toBe("gridstatus");
    expect(GRIDSTATUS_CATALOG_SLUG).toBe("gridstatus");
    expect(GRIDSTATUS_DATA_SERVICE_SLUG).toBe("gridstatus-api");
    expect(GRIDSTATUS_DATASET_ALIAS_SCHEME).toBe(
      AliasSchemeValues.gridstatusDatasetId
    );
    expect(GRIDSTATUS_AGENT_NAME).toBe("GridStatus");
    expect(GRIDSTATUS_CATALOG_TITLE).toBe("GridStatus Data Catalog");
    expect(GRIDSTATUS_DATA_SERVICE_TITLE).toBe("GridStatus API");
  });

  it.effect("fetches the dataset catalog with x-api-key auth", () =>
    Effect.gen(function* () {
      const response = yield* fetchCatalog(
        Redacted.make("gridstatus-secret"),
        GRIDSTATUS_BASE_URL
      );
      expect(response.data).toHaveLength(2);
      expect(response.data[0]?.id).toBe("pjm_load_forecast");
    }).pipe(
      Effect.provide(
        makeHttpLayer((request, url) =>
          Effect.gen(function* () {
            expect(url.toString()).toBe(datasetCatalogUrl(GRIDSTATUS_BASE_URL));
            expect(request.headers["x-api-key"]).toBe("gridstatus-secret");
            return jsonResponse(request, DATASET_FIXTURE);
          })
        )
      )
    )
  );

  it("derives stable slugs and the right candidate counts from dataset rows", () => {
    expect(gridstatusDatasetSlug("pjm_load_forecast")).toBe(
      "gridstatus-pjm-load-forecast"
    );
    expect(gridstatusApiDistributionSlug("pjm_load_forecast")).toBe(
      "gridstatus-pjm-load-forecast-api"
    );
    expect(gridstatusCsvDistributionSlug("pjm_load_forecast")).toBe(
      "gridstatus-pjm-load-forecast-csv"
    );
    expect(gridstatusCatalogRecordSlug("pjm_load_forecast")).toBe(
      "gridstatus-pjm-load-forecast-cr"
    );

    const ctx = buildContextFromIndex(emptyIndex(), FIXTURE_NOW);
    const candidates = buildCandidateNodes(
      DATASET_FIXTURE.data,
      emptyIndex(),
      ctx,
      GRIDSTATUS_BASE_URL
    );

    expect(candidates).toHaveLength(11);
    expect(candidates[0]).toMatchObject({
      _tag: "agent",
      slug: "gridstatus"
    });
    expect(candidates[1]).toMatchObject({
      _tag: "catalog",
      slug: "gridstatus"
    });
    expect(candidates[candidates.length - 1]).toMatchObject({
      _tag: "data-service",
      slug: "gridstatus-api"
    });
  });

  it.effect(
    "replaces the placeholder bundle, writes per-dataset files, and reuses ids on rerun",
    () =>
      Effect.gen(function* () {
        const tmp = yield* Effect.promise(makeSeededColdStartRoot);
        const config: ScriptConfigShape = {
          rootDir: tmp,
          dryRun: false,
          noCache: false,
          apiKey: Redacted.make("gridstatus-secret"),
          baseUrl: GRIDSTATUS_BASE_URL,
          minIntervalMs: 200
        };
        const layer = Layer.mergeAll(
          bunFsLayer,
          makeHttpLayer((request, url) =>
            Effect.gen(function* () {
              expect(url.toString()).toBe(datasetCatalogUrl(GRIDSTATUS_BASE_URL));
              expect(request.headers["x-api-key"]).toBe("gridstatus-secret");
              return jsonResponse(request, DATASET_FIXTURE);
            })
          )
        );

        yield* runGridStatusIngest(config).pipe(Effect.provide(layer));

        const agentPath = nodePath.join(
          tmp,
          "catalog",
          "agents",
          "gridstatus.json"
        );
        const catalogPath = nodePath.join(
          tmp,
          "catalog",
          "catalogs",
          "gridstatus.json"
        );
        const dataServicePath = nodePath.join(
          tmp,
          "catalog",
          "data-services",
          "gridstatus-api.json"
        );
        const datasetPath = nodePath.join(
          tmp,
          "catalog",
          "datasets",
          "gridstatus-pjm-load-forecast.json"
        );
        const apiDistributionPath = nodePath.join(
          tmp,
          "catalog",
          "distributions",
          "gridstatus-pjm-load-forecast-api.json"
        );
        const csvDistributionPath = nodePath.join(
          tmp,
          "catalog",
          "distributions",
          "gridstatus-pjm-load-forecast-csv.json"
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
        const firstApiDistribution = yield* Effect.promise(() =>
          fsp.readFile(apiDistributionPath, "utf8").then(readDistribution)
        );
        const firstCsvDistribution = yield* Effect.promise(() =>
          fsp.readFile(csvDistributionPath, "utf8").then(readDistribution)
        );
        const firstLedger = yield* Effect.promise(() =>
          fsp.readFile(ledgerPath, "utf8").then(readLedger)
        );

        expect(firstCatalog.publisherAgentId).toBe(firstAgent.id);
        expect(firstDataService.publisherAgentId).toBe(firstAgent.id);
        expect(firstDataService.servesDatasetIds).toHaveLength(2);
        expect(firstDataset.creatorAgentId).toBe(
          "https://id.skygest.io/agent/ag_01KNQEZ5VF596JA72ARPNWXEEX"
        );
        expect(firstDataset.publisherAgentId).toBe(firstAgent.id);
        expect(firstDataset.aliases).toEqual([
          {
            scheme: "gridstatus-dataset-id",
            value: "pjm_load_forecast",
            relation: "exactMatch"
          },
          {
            scheme: "url",
            value: "https://services.pjm.com/",
            relation: "closeMatch"
          }
        ]);
        expect(firstApiDistribution.accessURL).toBe(
          "https://api.gridstatus.io/v1/datasets/pjm_load_forecast/query?return_format=json"
        );
        expect(firstCsvDistribution.downloadURL).toBe(
          "https://api.gridstatus.io/v1/datasets/pjm_load_forecast/query?return_format=csv&download=true"
        );
        expect(firstLedger["Agent:gridstatus"]).toBe(firstAgent.id);
        expect(firstLedger["Catalog:gridstatus"]).toBe(firstCatalog.id);
        expect(firstLedger["DataService:gridstatus-api"]).toBe(
          firstDataService.id
        );

        expect(
          yield* Effect.promise(() =>
            fsp
              .access(
                nodePath.join(
                  tmp,
                  "catalog",
                  "datasets",
                  "gridstatus-us-grid.json"
                )
              )
              .then(() => true)
              .catch(() => false)
          )
        ).toBe(false);
        expect(
          yield* Effect.promise(() =>
            fsp
              .access(
                nodePath.join(
                  tmp,
                  "catalog",
                  "catalog-records",
                  "gridstatus-us-grid-cr.json"
                )
              )
              .then(() => true)
              .catch(() => false)
          )
        ).toBe(false);

        yield* runGridStatusIngest(config).pipe(Effect.provide(layer));

        const secondDataService = yield* Effect.promise(() =>
          fsp.readFile(dataServicePath, "utf8").then(readDataService)
        );
        const secondDataset = yield* Effect.promise(() =>
          fsp.readFile(datasetPath, "utf8").then(readDataset)
        );
        const secondApiDistribution = yield* Effect.promise(() =>
          fsp.readFile(apiDistributionPath, "utf8").then(readDistribution)
        );
        const secondLedger = yield* Effect.promise(() =>
          fsp.readFile(ledgerPath, "utf8").then(readLedger)
        );

        expect(secondDataService.id).toBe(firstDataService.id);
        expect(secondDataset.id).toBe(firstDataset.id);
        expect(secondApiDistribution.id).toBe(firstApiDistribution.id);
        expect(secondLedger).toEqual(firstLedger);

        yield* Effect.promise(() => cleanup(tmp));
      })
  );
});
