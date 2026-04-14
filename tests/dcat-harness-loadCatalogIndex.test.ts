import { describe, expect, it } from "@effect/vitest";
import * as BunFileSystem from "@effect/platform-bun/BunFileSystem";
import * as BunPath from "@effect/platform-bun/BunPath";
import { Effect, Layer } from "effect";
import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as nodePath from "node:path";
import { AliasSchemeValues, type DistributionKind } from "../src/domain/data-layer";
import {
  distributionLookupKey,
  IngestHarnessError,
  loadCatalogIndexWith
} from "../src/ingest/dcat-harness";

const bunFsLayer = Layer.mergeAll(BunFileSystem.layer, BunPath.layer);
const FIXTURE_NOW = "2026-04-10T00:00:00.000Z";

type FixtureAlias = {
  readonly scheme: string;
  readonly value: string;
  readonly relation: string;
};

type FixtureFile = {
  readonly slug: string;
  readonly body: unknown;
};

type FixtureSpec = Partial<{
  readonly agents: ReadonlyArray<FixtureFile>;
  readonly catalogs: ReadonlyArray<FixtureFile>;
  readonly datasets: ReadonlyArray<FixtureFile>;
  readonly datasetSeries: ReadonlyArray<FixtureFile>;
  readonly distributions: ReadonlyArray<FixtureFile>;
  readonly catalogRecords: ReadonlyArray<FixtureFile>;
  readonly dataServices: ReadonlyArray<FixtureFile>;
}>;

const FIXTURE_SUBDIRS = [
  ["agents", "agents"],
  ["catalogs", "catalogs"],
  ["datasets", "datasets"],
  ["datasetSeries", "dataset-series"],
  ["distributions", "distributions"],
  ["catalogRecords", "catalog-records"],
  ["dataServices", "data-services"]
] as const;

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
  aliases: ReadonlyArray<FixtureAlias>,
  overrides?: Partial<{
    readonly kind: DistributionKind;
    readonly accessURL: string;
    readonly downloadURL: string;
    readonly format: string;
  }>
) => ({
  _tag: "Distribution",
  id: `https://id.skygest.io/distribution/dist_${ulid}`,
  datasetId,
  kind: overrides?.kind ?? "api-access",
  ...(overrides?.accessURL === undefined
    ? {}
    : { accessURL: overrides.accessURL }),
  ...(overrides?.downloadURL === undefined
    ? {}
    : { downloadURL: overrides.downloadURL }),
  ...(overrides?.format === undefined
    ? {}
    : { format: overrides.format }),
  createdAt: FIXTURE_NOW,
  updatedAt: FIXTURE_NOW,
  aliases
});

const validDatasetSeriesBody = (
  title: string,
  ulid: string,
  publisherAgentId: string,
  aliases: ReadonlyArray<FixtureAlias>
) => ({
  _tag: "DatasetSeries",
  id: `https://id.skygest.io/dataset-series/dser_${ulid}`,
  title,
  publisherAgentId,
  cadence: "annual",
  createdAt: FIXTURE_NOW,
  updatedAt: FIXTURE_NOW,
  aliases
});

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

const makeTmpFixture = async (spec: FixtureSpec): Promise<string> => {
  const tmp = await fsp.mkdtemp(
    nodePath.join(os.tmpdir(), "skygest-dcat-harness-index-")
  );
  const catalogDir = nodePath.join(tmp, "catalog");

  for (const [, subDir] of FIXTURE_SUBDIRS) {
    await fsp.mkdir(nodePath.join(catalogDir, subDir), { recursive: true });
  }

  for (const [specKey, subDir] of FIXTURE_SUBDIRS) {
    const files = spec[specKey] ?? [];
    for (const file of files) {
      await fsp.writeFile(
        nodePath.join(catalogDir, subDir, `${file.slug}.json`),
        JSON.stringify(file.body, null, 2)
      );
    }
  }

  return tmp;
};

const cleanup = (tmp: string) => fsp.rm(tmp, { recursive: true, force: true });

describe("loadCatalogIndexWith", () => {
  it.effect("builds shared lookup maps without resolving adapter roots", () =>
    Effect.gen(function* () {
      const agentUlid = "01KNQEZ5V57VJJJFYV6HWM03VB";
      const catalogUlid = "01KNQEZ5V57VJJJFYV6HWM03VC";
      const datasetUlid = "01KNQSXEPQHNVM0AVMA3SQRNK3";
      const distributionUlid = "01KNQSXEPQE7D85JBAFH47Y9MS";
      const catalogRecordUlid = "01KNQSXEPQHNVM0AVMA3SQRNK4";
      const dataServiceUlid = "01KNQEZ5VHS74DM94ABW2ZM93Y";
      const agentId = `https://id.skygest.io/agent/ag_${agentUlid}`;
      const catalogId = `https://id.skygest.io/catalog/cat_${catalogUlid}`;
      const datasetId = `https://id.skygest.io/dataset/ds_${datasetUlid}`;
      const dataServiceId = `https://id.skygest.io/data-service/svc_${dataServiceUlid}`;
      const route = "electricity/retail-sales";

      const tmp = yield* Effect.promise(() =>
        makeTmpFixture({
          agents: [
            {
              slug: "eia",
              body: validAgentBody("U.S. Energy Information Administration", agentUlid, [
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
              body: validDatasetBody("Retail Sales of Electricity", datasetUlid, [
                {
                  scheme: "eia-route",
                  value: route,
                  relation: "exactMatch"
                }
              ])
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

      const result = yield* loadCatalogIndexWith({
        rootDir: tmp,
        mergeAliasScheme: AliasSchemeValues.eiaRoute,
        isMergeableDatasetAlias: (alias) => alias.value !== "COAL",
        mapFsError: (input) => input,
        mapSchemaError: (input) => input
      }).pipe(Effect.ensuring(Effect.promise(() => cleanup(tmp))));

      expect(result.index.datasetsByMergeKey.get(route)?.id).toBe(datasetId);
      expect(result.index.datasetFileSlugById.get(datasetId as never)).toBe(
        "eia-electricity-retail-sales"
      );
      expect(
        result.index.distributionsByDatasetIdKind.get(`${datasetId}::api-access`)
          ?.id
      ).toBe(`https://id.skygest.io/distribution/dist_${distributionUlid}`);
      expect(
        result.index.catalogRecordsByCatalogAndPrimaryTopic.get(
          `${catalogId}::${datasetId}`
        )?.id
      ).toBe(`https://id.skygest.io/catalog-record/cr_${catalogRecordUlid}`);
      expect(result.index.agentsById.get(agentId as never)?.name).toBe(
        "U.S. Energy Information Administration"
      );
      expect(result.index.catalogsById.get(catalogId as never)?.title).toBe(
        "EIA Open Data Catalog"
      );
      expect(
        result.index.dataServicesById.get(dataServiceId as never)?.title
      ).toBe("EIA API v2");
      expect(result.index.allDatasets).toHaveLength(1);
      expect(result.index.allDatasetSeries).toHaveLength(0);
      expect(result.index.allCatalogs).toHaveLength(1);
      expect(result.index.allDataServices).toHaveLength(1);
      expect(result.skippedDatasets).toEqual([]);
      expect("catalog" in result.index).toBe(false);
      expect("dataService" in result.index).toBe(false);
    }).pipe(Effect.provide(bunFsLayer))
  );

  it.effect("loads checked-in dataset-series records into the shared catalog index", () =>
    Effect.gen(function* () {
      const agentUlid = "01KNQEZ5V57VJJJFYV6HWM03VB";
      const seriesUlid = "01KNQEZ5V57VJJJFYV6HWM03VD";
      const agentId = `https://id.skygest.io/agent/ag_${agentUlid}`;
      const seriesId = `https://id.skygest.io/dataset-series/dser_${seriesUlid}`;

      const tmp = yield* Effect.promise(() =>
        makeTmpFixture({
          agents: [
            {
              slug: "eia",
              body: validAgentBody(
                "U.S. Energy Information Administration",
                agentUlid,
                []
              )
            }
          ],
          datasetSeries: [
            {
              slug: "eia-mer",
              body: validDatasetSeriesBody(
                "EIA Monthly Energy Review",
                seriesUlid,
                agentId,
                []
              )
            }
          ]
        })
      );

      const result = yield* loadCatalogIndexWith({
        rootDir: tmp,
        mergeAliasScheme: AliasSchemeValues.eiaRoute
      }).pipe(Effect.ensuring(Effect.promise(() => cleanup(tmp))));

      expect(result.index.allDatasetSeries).toHaveLength(1);
      expect(result.index.datasetSeriesById.get(seriesId as never)?.title).toBe(
        "EIA Monthly Energy Review"
      );
      expect(
        result.index.datasetSeriesFileSlugById.get(seriesId as never)
      ).toBe("eia-mer");
    }).pipe(Effect.provide(bunFsLayer))
  );

  it.effect("tracks missing and unmergeable merge aliases separately", () =>
    Effect.gen(function* () {
      const tmp = yield* Effect.promise(() =>
        makeTmpFixture({
          datasets: [
            {
              slug: "eia-legacy-bulk",
              body: validDatasetBody("Legacy Bulk", "01KNQSXEPPXRC56GM4SED9D0KY", [
                {
                  scheme: "eia-route",
                  value: "COAL",
                  relation: "exactMatch"
                }
              ])
            },
            {
              slug: "eia-missing-route",
              body: validDatasetBody(
                "Missing Route",
                "01KNQSXEPPXRC56GM4SED9D0KZ",
                []
              )
            }
          ]
        })
      );

      const result = yield* loadCatalogIndexWith({
        rootDir: tmp,
        mergeAliasScheme: AliasSchemeValues.eiaRoute,
        isMergeableDatasetAlias: (alias) => alias.value !== "COAL",
        mapFsError: (input) => input,
        mapSchemaError: (input) => input
      }).pipe(Effect.ensuring(Effect.promise(() => cleanup(tmp))));

      expect(result.index.datasetsByMergeKey.size).toBe(0);
      expect(result.skippedDatasets).toEqual([
        {
          slug: "eia-legacy-bulk",
          datasetId:
            "https://id.skygest.io/dataset/ds_01KNQSXEPPXRC56GM4SED9D0KY",
          reason: "unmergeableAlias",
          mergeAliasValue: "COAL"
        },
        {
          slug: "eia-missing-route",
          datasetId:
            "https://id.skygest.io/dataset/ds_01KNQSXEPPXRC56GM4SED9D0KZ",
          reason: "missingMergeAlias",
          mergeAliasValue: null
        }
      ]);
    }).pipe(Effect.provide(bunFsLayer))
  );

  it.effect("fails when two datasets share the same merge key", () =>
    Effect.gen(function* () {
      const tmp = yield* Effect.promise(() =>
        makeTmpFixture({
          datasets: [
            {
              slug: "eia-electricity-retail-sales",
              body: validDatasetBody("Retail Sales A", "01KNQSXEPPXRC56GM4SED9D0K1", [
                {
                  scheme: "eia-route",
                  value: "electricity/retail-sales",
                  relation: "exactMatch"
                }
              ])
            },
            {
              slug: "eia-electricity-retail-sales-duplicate",
              body: validDatasetBody("Retail Sales B", "01KNQSXEPPXRC56GM4SED9D0K2", [
                {
                  scheme: "eia-route",
                  value: "electricity/retail-sales",
                  relation: "exactMatch"
                }
              ])
            }
          ]
        })
      );

      const error = yield* loadCatalogIndexWith({
        rootDir: tmp,
        mergeAliasScheme: AliasSchemeValues.eiaRoute
      }).pipe(
        Effect.flip,
        Effect.ensuring(Effect.promise(() => cleanup(tmp)))
      );

      expect(error).toBeInstanceOf(IngestHarnessError);
      expect(error.message).toContain("Duplicate dataset merge key");
    }).pipe(Effect.provide(bunFsLayer))
  );

  it.effect("keeps distinct download distributions for one dataset when their URLs differ", () =>
    Effect.gen(function* () {
      const datasetUlid = "01KQ3G4K21G6D4RNB87B8DME61";
      const datasetId = `https://id.skygest.io/dataset/ds_${datasetUlid}`;
      const firstDistribution = validDistributionBody(
        "01KQ3G4K21R5Q6E6JS7DWEY511",
        datasetId,
        [],
        {
          kind: "download",
          accessURL: "https://downloads.example.test/solar/2024-a.json",
          format: "application/json"
        }
      );
      const secondDistribution = validDistributionBody(
        "01KQ3G4K21W7J7M9VAX7V4Y512",
        datasetId,
        [],
        {
          kind: "download",
          accessURL: "https://downloads.example.test/solar/2024-b.json",
          format: "application/json"
        }
      );

      const tmp = yield* Effect.promise(() =>
        makeTmpFixture({
          distributions: [
            {
              slug: "solar-2024-json-a",
              body: firstDistribution
            },
            {
              slug: "solar-2024-json-b",
              body: secondDistribution
            }
          ]
        })
      );

      const result = yield* loadCatalogIndexWith({
        rootDir: tmp,
        mergeAliasScheme: AliasSchemeValues.eiaRoute
      }).pipe(Effect.ensuring(Effect.promise(() => cleanup(tmp))));

      expect(result.index.allDistributions).toHaveLength(2);
      expect(
        result.index.distributionsByDatasetIdKind.get(
          distributionLookupKey(firstDistribution)
        )?.id
      ).toBe(firstDistribution.id);
      expect(
        result.index.distributionsByDatasetIdKind.get(
          distributionLookupKey(secondDistribution)
        )?.id
      ).toBe(secondDistribution.id);
    }).pipe(Effect.provide(bunFsLayer))
  );

  it.effect("keeps distinct landing pages for one dataset when their URLs differ", () =>
    Effect.gen(function* () {
      const datasetUlid = "01KQ3GG0F0W4Q5WQKXS4VYJ6X1";
      const datasetId = `https://id.skygest.io/dataset/ds_${datasetUlid}`;
      const firstLandingPage = validDistributionBody(
        "01KQ3GG0F01V0ANQ56FYQKJ7X2",
        datasetId,
        [],
        {
          kind: "landing-page",
          accessURL: "https://example.test/catalog/solar/overview",
          format: "html"
        }
      );
      const secondLandingPage = validDistributionBody(
        "01KQ3GG0F0A68TV5D53D3KJ7X3",
        datasetId,
        [],
        {
          kind: "landing-page",
          accessURL: "https://example.test/catalog/solar/methodology",
          format: "html"
        }
      );

      const tmp = yield* Effect.promise(() =>
        makeTmpFixture({
          distributions: [
            {
              slug: "solar-overview",
              body: firstLandingPage
            },
            {
              slug: "solar-methodology",
              body: secondLandingPage
            }
          ]
        })
      );

      const result = yield* loadCatalogIndexWith({
        rootDir: tmp,
        mergeAliasScheme: AliasSchemeValues.eiaRoute
      }).pipe(Effect.ensuring(Effect.promise(() => cleanup(tmp))));

      expect(result.index.allDistributions).toHaveLength(2);
      expect(
        result.index.distributionsByDatasetIdKind.get(
          distributionLookupKey(firstLandingPage)
        )?.id
      ).toBe(firstLandingPage.id);
      expect(
        result.index.distributionsByDatasetIdKind.get(
          distributionLookupKey(secondLandingPage)
        )?.id
      ).toBe(secondLandingPage.id);
    }).pipe(Effect.provide(bunFsLayer))
  );
});
