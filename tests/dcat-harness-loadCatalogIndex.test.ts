import { describe, expect, it } from "@effect/vitest";
import * as BunFileSystem from "@effect/platform-bun/BunFileSystem";
import * as BunPath from "@effect/platform-bun/BunPath";
import { Effect, Layer } from "effect";
import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as nodePath from "node:path";
import { AliasSchemeValues } from "../src/domain/data-layer";
import { loadCatalogIndexWith } from "../src/ingest/dcat-harness";

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
  readonly distributions: ReadonlyArray<FixtureFile>;
  readonly catalogRecords: ReadonlyArray<FixtureFile>;
  readonly dataServices: ReadonlyArray<FixtureFile>;
}>;

const FIXTURE_SUBDIRS = [
  ["agents", "agents"],
  ["catalogs", "catalogs"],
  ["datasets", "datasets"],
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
      expect(result.index.allCatalogs).toHaveLength(1);
      expect(result.index.allDataServices).toHaveLength(1);
      expect(result.skippedDatasets).toEqual([]);
      expect("catalog" in result.index).toBe(false);
      expect("dataService" in result.index).toBe(false);
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
});
