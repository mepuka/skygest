import { describe, expect, it } from "@effect/vitest";
import { Effect, Exit, Layer, Schema } from "effect";
import { SqlClient } from "effect/unstable/sql";
import { d1DataLayerRegistryLayer } from "../src/bootstrap/D1DataLayerRegistry";
import { runMigrations } from "../src/db/migrate";
import {
  Agent as AgentSchema,
  Catalog as CatalogSchema,
  CatalogRecord as CatalogRecordSchema,
  DataService as DataServiceSchema,
  Dataset as DatasetSchema,
  DatasetSeries as DatasetSeriesSchema,
  Distribution as DistributionSchema,
  Series as SeriesSchema,
  Variable as VariableSchema
} from "../src/domain/data-layer";
import { AgentsRepo } from "../src/services/AgentsRepo";
import { DataLayerRegistry } from "../src/services/DataLayerRegistry";
import { CatalogRecordsRepo } from "../src/services/CatalogRecordsRepo";
import { CatalogsRepo } from "../src/services/CatalogsRepo";
import { DataServicesRepo } from "../src/services/DataServicesRepo";
import { DatasetSeriesRepo } from "../src/services/DatasetSeriesRepo";
import { DatasetsRepo } from "../src/services/DatasetsRepo";
import { DistributionsRepo } from "../src/services/DistributionsRepo";
import { SeriesRepo } from "../src/services/SeriesRepo";
import { VariablesRepo } from "../src/services/VariablesRepo";
import { AgentsRepoD1 } from "../src/services/d1/AgentsRepoD1";
import { CatalogRecordsRepoD1 } from "../src/services/d1/CatalogRecordsRepoD1";
import { CatalogsRepoD1 } from "../src/services/d1/CatalogsRepoD1";
import { DataServicesRepoD1 } from "../src/services/d1/DataServicesRepoD1";
import { DatasetSeriesRepoD1 } from "../src/services/d1/DatasetSeriesRepoD1";
import { DatasetsRepoD1 } from "../src/services/d1/DatasetsRepoD1";
import { DistributionsRepoD1 } from "../src/services/d1/DistributionsRepoD1";
import { SeriesRepoD1 } from "../src/services/d1/SeriesRepoD1";
import { VariablesRepoD1 } from "../src/services/d1/VariablesRepoD1";
import { makeSqliteLayer } from "./support/runtime";

const decodeAgent = Schema.decodeUnknownSync(AgentSchema);
const decodeCatalog = Schema.decodeUnknownSync(CatalogSchema);
const decodeCatalogRecord = Schema.decodeUnknownSync(CatalogRecordSchema);
const decodeDataService = Schema.decodeUnknownSync(DataServiceSchema);
const decodeDataset = Schema.decodeUnknownSync(DatasetSchema);
const decodeDatasetSeries = Schema.decodeUnknownSync(DatasetSeriesSchema);
const decodeDistribution = Schema.decodeUnknownSync(DistributionSchema);
const decodeVariable = Schema.decodeUnknownSync(VariableSchema);
const decodeSeries = Schema.decodeUnknownSync(SeriesSchema);

const createdAt = "2026-04-11T12:00:00.000Z";
const updatedAt = "2026-04-11T12:30:00.000Z";
const deletedAt = "2026-04-11T13:00:00.000Z";
const updatedBy = "test-operator";
const persistenceCreatedAt = "2026-04-11T09:00:00.000Z";
const persistenceUpdatedAt = "2026-04-11T10:00:00.000Z";
const quoteSqlString = (value: string) => `'${value.replaceAll("'", "''")}'`;

const makeLayer = () => {
  const sqliteLayer = makeSqliteLayer();
  const agentsLayer = AgentsRepoD1.layer.pipe(Layer.provideMerge(sqliteLayer));
  const catalogsLayer = CatalogsRepoD1.layer.pipe(Layer.provideMerge(sqliteLayer));
  const catalogRecordsLayer = CatalogRecordsRepoD1.layer.pipe(Layer.provideMerge(sqliteLayer));
  const datasetsLayer = DatasetsRepoD1.layer.pipe(Layer.provideMerge(sqliteLayer));
  const distributionsLayer = DistributionsRepoD1.layer.pipe(Layer.provideMerge(sqliteLayer));
  const dataServicesLayer = DataServicesRepoD1.layer.pipe(Layer.provideMerge(sqliteLayer));
  const datasetSeriesLayer = DatasetSeriesRepoD1.layer.pipe(Layer.provideMerge(sqliteLayer));
  const variablesLayer = VariablesRepoD1.layer.pipe(Layer.provideMerge(sqliteLayer));
  const seriesLayer = SeriesRepoD1.layer.pipe(Layer.provideMerge(sqliteLayer));

  return Layer.mergeAll(
    sqliteLayer,
    agentsLayer,
    catalogsLayer,
    catalogRecordsLayer,
    datasetsLayer,
    distributionsLayer,
    dataServicesLayer,
    datasetSeriesLayer,
    variablesLayer,
    seriesLayer
  );
};

const agent = decodeAgent({
  _tag: "Agent",
  id: "https://id.skygest.io/agent/ag_TESTAGENT01",
  kind: "organization",
  name: "U.S. Energy Information Administration",
  alternateNames: ["Energy Information Administration"],
  homepage: "https://www.eia.gov/",
  aliases: [
    {
      scheme: "url",
      value: "https://www.eia.gov/",
      relation: "exactMatch"
    }
  ],
  createdAt,
  updatedAt
});

const updatedAgent = decodeAgent({
  ...agent,
  alternateNames: [...(agent.alternateNames ?? []), "EIA"],
  updatedAt: deletedAt
});

const variable = decodeVariable({
  _tag: "Variable",
  id: "https://id.skygest.io/variable/var_TESTVARIABLE01",
  label: "Retail electricity price",
  definition: "Average retail price of electricity.",
  measuredProperty: "price",
  domainObject: "electricity",
  statisticType: "price",
  aggregation: "average",
  basis: ["nominal"],
  unitFamily: "currency_per_energy",
  aliases: [
    {
      scheme: "eia-series",
      value: "ELEC.PRICE.US-ALL.M",
      relation: "exactMatch"
    }
  ],
  createdAt,
  updatedAt
});

const catalog = decodeCatalog({
  _tag: "Catalog",
  id: "https://id.skygest.io/catalog/cat_TESTCATALOG01",
  title: "EIA Open Data Catalog",
  description: "Public catalog of U.S. energy datasets.",
  publisherAgentId: agent.id,
  homepage: "https://www.eia.gov/opendata/",
  aliases: [
    {
      scheme: "url",
      value: "https://www.eia.gov/opendata/",
      relation: "exactMatch"
    }
  ],
  createdAt,
  updatedAt
});

const datasetSeries = decodeDatasetSeries({
  _tag: "DatasetSeries",
  id: "https://id.skygest.io/dataset-series/dser_TESTSERIES01",
  title: "EIA Electric Power Monthly",
  description: "Recurring monthly electric power releases.",
  publisherAgentId: agent.id,
  cadence: "monthly",
  aliases: [
    {
      scheme: "other",
      value: "eia-electric-power-monthly",
      relation: "exactMatch"
    }
  ],
  createdAt,
  updatedAt
});

const dataService = decodeDataService({
  _tag: "DataService",
  id: "https://id.skygest.io/data-service/svc_TESTSERVICE01",
  title: "EIA API v2",
  description: "Programmatic access to EIA datasets.",
  publisherAgentId: agent.id,
  endpointURLs: ["https://api.eia.gov/v2/"],
  endpointDescription: "https://www.eia.gov/opendata/documentation.php",
  conformsTo: "https://www.eia.gov/opendata/documentation.php",
  servesDatasetIds: ["https://id.skygest.io/dataset/ds_TESTDATASET01"],
  accessRights: "public",
  license: "https://www.usa.gov/government-works",
  aliases: [
    {
      scheme: "url",
      value: "https://api.eia.gov/v2/",
      relation: "exactMatch"
    }
  ],
  createdAt,
  updatedAt
});

const dataset = decodeDataset({
  _tag: "Dataset",
  id: "https://id.skygest.io/dataset/ds_TESTDATASET01",
  title: "Average Retail Price of Electricity",
  description: "Monthly retail electricity price dataset.",
  creatorAgentId: agent.id,
  wasDerivedFrom: [agent.id],
  publisherAgentId: agent.id,
  landingPage: "https://www.eia.gov/electricity/data/eia923/",
  accessRights: "public",
  license: "https://www.usa.gov/government-works",
  temporal: "monthly",
  keywords: ["electricity", "retail price"],
  themes: ["prices"],
  distributionIds: ["https://id.skygest.io/distribution/dist_TESTDIST01"],
  dataServiceIds: [dataService.id],
  inSeries: datasetSeries.id,
  aliases: [
    {
      scheme: "eia-route",
      value: "/electricity/retail-sales",
      relation: "exactMatch"
    }
  ],
  createdAt,
  updatedAt
});

const distribution = decodeDistribution({
  _tag: "Distribution",
  id: "https://id.skygest.io/distribution/dist_TESTDIST01",
  datasetId: dataset.id,
  kind: "download",
  title: "Retail electricity price CSV",
  description: "CSV export for monthly retail electricity prices.",
  accessURL: "https://www.eia.gov/electricity/data/eia923/",
  downloadURL: "https://www.eia.gov/electricity/data/browser/xls/elec_sales_2024.xlsx",
  mediaType: "text/csv",
  format: "csv",
  byteSize: 1234,
  checksum: "sha256:test",
  accessRights: "public",
  license: "https://www.usa.gov/government-works",
  accessServiceId: dataService.id,
  aliases: [
    {
      scheme: "url",
      value: "https://www.eia.gov/electricity/data/browser/xls/elec_sales_2024.xlsx",
      relation: "exactMatch"
    }
  ],
  createdAt,
  updatedAt
});

const catalogRecord = decodeCatalogRecord({
  _tag: "CatalogRecord",
  id: "https://id.skygest.io/catalog-record/cr_TESTRECORD01",
  catalogId: catalog.id,
  primaryTopicType: "dataset",
  primaryTopicId: dataset.id,
  sourceRecordId: "record-1",
  harvestedFrom: "https://www.eia.gov/opendata/",
  firstSeen: "2026-04-10",
  lastSeen: "2026-04-11",
  sourceModified: "2026-04-09",
  isAuthoritative: true
});

const updatedCatalogRecord = decodeCatalogRecord({
  ...catalogRecord,
  sourceRecordId: "record-1b",
  lastSeen: "2026-04-12",
  isAuthoritative: false
});

const series = decodeSeries({
  _tag: "Series",
  id: "https://id.skygest.io/series/ser_TESTSERIES01",
  label: "U.S. average retail electricity price",
  variableId: variable.id,
  fixedDims: {
    place: "us",
    frequency: "monthly"
  },
  aliases: [
    {
      scheme: "other",
      value: "series-us-monthly-price",
      relation: "exactMatch"
    }
  ],
  createdAt,
  updatedAt
});

describe("data layer registry repos", () => {
  it.effect("round-trips agents with schema-backed row decoding and audit writes", () =>
    Effect.gen(function* () {
      yield* runMigrations;

      const repo = yield* AgentsRepo;
      yield* repo.insert(agent, { updatedBy });
      yield* repo.update(updatedAgent, { updatedBy });

      const stored = yield* repo.findByUri(agent.id);
      const byLabel = yield* repo.findByLabel("energy information administration");
      const byHomepage = yield* repo.findByHomepageDomain("www.eia.gov");

      expect(stored).toEqual(updatedAgent);
      expect(byLabel).toEqual(updatedAgent);
      expect(byHomepage).toEqual(updatedAgent);

      yield* repo.delete(agent.id, deletedAt, updatedBy);

      const afterDelete = yield* repo.findByUri(agent.id);
      const sql = yield* SqlClient.SqlClient;
      const [auditCount] = yield* sql<{ count: number }>`
        SELECT COUNT(*) as count
        FROM data_layer_audit
        WHERE entity_kind = 'Agent'
          AND entity_id = ${agent.id}
      `;

      expect(afterDelete).toBeNull();
      expect(auditCount?.count).toBe(3);
    }).pipe(Effect.provide(makeLayer()))
  );

  it.effect("rolls back agent writes when the audit insert fails", () =>
    Effect.gen(function* () {
      yield* runMigrations;

      const repo = yield* AgentsRepo;
      const sql = yield* SqlClient.SqlClient;

      yield* sql`${sql.unsafe(`
        CREATE TRIGGER fail_agent_audit
        BEFORE INSERT ON data_layer_audit
        WHEN NEW.entity_id = ${quoteSqlString(agent.id)}
        BEGIN
          SELECT RAISE(FAIL, 'forced audit failure');
        END
      `)}`.pipe(Effect.asVoid);

      const exit = yield* Effect.exit(repo.insert(agent, { updatedBy }));
      const stored = yield* repo.findByUri(agent.id);

      expect(Exit.isFailure(exit)).toBe(true);
      expect(stored).toBeNull();
    }).pipe(Effect.provide(makeLayer()))
  );

  it.effect("round-trips variable alias lookups through schema-backed JSON columns", () =>
    Effect.gen(function* () {
      yield* runMigrations;

      const repo = yield* VariablesRepo;
      yield* repo.insert(variable, { updatedBy });

      const stored = yield* repo.findByUri(variable.id);
      const byAlias = yield* repo.findByAlias(
        "eia-series",
        "ELEC.PRICE.US-ALL.M"
      );

      expect(stored).toEqual(variable);
      expect(byAlias).toEqual(variable);
    }).pipe(Effect.provide(makeLayer()))
  );

  it.effect("round-trips series fixed dimensions through schema-backed JSON columns", () =>
    Effect.gen(function* () {
      yield* runMigrations;

      const variables = yield* VariablesRepo;
      const repo = yield* SeriesRepo;

      yield* variables.insert(variable, { updatedBy });
      yield* repo.insert(series, { updatedBy });

      const stored = yield* repo.findByUri(series.id);
      expect(stored).toEqual(series);

      yield* repo.delete(series.id, deletedAt, updatedBy);

      const afterDelete = yield* repo.findByUri(series.id);
      expect(afterDelete).toBeNull();
    }).pipe(Effect.provide(makeLayer()))
  );

  it.effect("round-trips catalogs and catalog records while preserving record creation timestamps", () =>
    Effect.gen(function* () {
      yield* runMigrations;

      const agents = yield* AgentsRepo;
      const catalogs = yield* CatalogsRepo;
      const records = yield* CatalogRecordsRepo;
      const datasets = yield* DatasetsRepo;
      const datasetSeriesRepo = yield* DatasetSeriesRepo;
      const dataServices = yield* DataServicesRepo;

      yield* agents.insert(agent, { updatedBy });
      yield* datasetSeriesRepo.insert(datasetSeries, { updatedBy });
      yield* dataServices.insert(dataService, { updatedBy });
      yield* datasets.insert(dataset, { updatedBy });
      yield* catalogs.insert(catalog, { updatedBy });
      yield* records.insert(catalogRecord, {
        updatedBy,
        timestamp: persistenceCreatedAt
      });
      yield* records.update(updatedCatalogRecord, {
        updatedBy,
        timestamp: persistenceUpdatedAt
      });

      const storedCatalog = yield* catalogs.findByUri(catalog.id);
      const storedRecord = yield* records.findByUri(catalogRecord.id);
      const sql = yield* SqlClient.SqlClient;
      const [persisted] = yield* sql<{
        createdAt: string;
        updatedAt: string;
        isAuthoritative: number | null;
      }>`
        SELECT
          created_at as createdAt,
          updated_at as updatedAt,
          is_authoritative as isAuthoritative
        FROM catalog_records
        WHERE id = ${catalogRecord.id}
      `;

      expect(storedCatalog).toEqual(catalog);
      expect(storedRecord).toEqual(updatedCatalogRecord);
      expect(persisted).toEqual({
        createdAt: persistenceCreatedAt,
        updatedAt: persistenceUpdatedAt,
        isAuthoritative: 0
      });
    }).pipe(Effect.provide(makeLayer()))
  );

  it.effect("round-trips datasets, distributions, data services, and dataset series lookups", () =>
    Effect.gen(function* () {
      yield* runMigrations;

      const agents = yield* AgentsRepo;
      const datasetSeriesRepo = yield* DatasetSeriesRepo;
      const dataServices = yield* DataServicesRepo;
      const datasets = yield* DatasetsRepo;
      const distributions = yield* DistributionsRepo;

      yield* agents.insert(agent, { updatedBy });
      yield* datasetSeriesRepo.insert(datasetSeries, { updatedBy });
      yield* dataServices.insert(dataService, { updatedBy });
      yield* datasets.insert(dataset, { updatedBy });
      yield* distributions.insert(distribution, { updatedBy });

      const storedSeries = yield* datasetSeriesRepo.findByUri(datasetSeries.id);
      const storedService = yield* dataServices.findByUri(dataService.id);
      const storedDataset = yield* datasets.findByUri(dataset.id);
      const byTitle = yield* datasets.findByTitle("average retail price of electricity");
      const byAlias = yield* datasets.findByAlias("eia-route", "/electricity/retail-sales");
      const storedDistribution = yield* distributions.findByUri(distribution.id);
      const byHostname = yield* distributions.findByHostname("www.eia.gov");

      expect(storedSeries).toEqual(datasetSeries);
      expect(storedService).toEqual(dataService);
      expect(storedDataset).toEqual(dataset);
      expect(byTitle).toEqual(dataset);
      expect(byAlias).toEqual(dataset);
      expect(storedDistribution).toEqual(distribution);
      expect(byHostname).toEqual([distribution]);
    }).pipe(Effect.provide(makeLayer()))
  );

  it.effect("builds the D1-backed registry lookup from the repo layer", () => {
    const baseLayer = makeLayer();

    return Effect.gen(function* () {
      yield* runMigrations;

      const agents = yield* AgentsRepo;
      const catalogs = yield* CatalogsRepo;
      const records = yield* CatalogRecordsRepo;
      const datasetSeriesRepo = yield* DatasetSeriesRepo;
      const dataServices = yield* DataServicesRepo;
      const datasets = yield* DatasetsRepo;
      const distributions = yield* DistributionsRepo;
      const variables = yield* VariablesRepo;
      const seriesRepo = yield* SeriesRepo;

      yield* agents.insert(agent, { updatedBy });
      yield* catalogs.insert(catalog, { updatedBy });
      yield* datasetSeriesRepo.insert(datasetSeries, { updatedBy });
      yield* dataServices.insert(dataService, { updatedBy });
      yield* datasets.insert(dataset, { updatedBy });
      yield* distributions.insert(distribution, { updatedBy });
      yield* records.insert(catalogRecord, {
        updatedBy,
        timestamp: persistenceCreatedAt
      });
      yield* variables.insert(variable, { updatedBy });
      yield* seriesRepo.insert(series, { updatedBy });

      const registry = yield* Effect.provide(
        Effect.service(DataLayerRegistry),
        d1DataLayerRegistryLayer().pipe(Layer.provideMerge(baseLayer))
      );

      expect(registry.prepared.seed.agents).toEqual([agent]);
      expect(registry.prepared.seed.catalogs).toEqual([catalog]);
      expect(registry.prepared.seed.catalogRecords).toEqual([catalogRecord]);
      expect(registry.prepared.seed.datasets).toEqual([dataset]);
      expect(registry.prepared.seed.distributions).toEqual([distribution]);
      expect(registry.prepared.seed.dataServices).toEqual([dataService]);
      expect(registry.prepared.seed.datasetSeries).toEqual([datasetSeries]);
      expect(registry.prepared.seed.variables).toEqual([variable]);
      expect(registry.prepared.seed.series).toEqual([series]);

      expect(registry.lookup.findAgentByLabel(agent.name)._tag).toBe("Some");
      expect(registry.lookup.findDatasetByTitle(dataset.title)._tag).toBe("Some");
      expect(
        registry.lookup.findDatasetByAlias("eia-route", "/electricity/retail-sales")._tag
      ).toBe("Some");
      expect(
        registry.lookup.findVariableByAlias("eia-series", "ELEC.PRICE.US-ALL.M")._tag
      ).toBe("Some");
      expect(
        [...registry.lookup.findDistributionsByHostname("www.eia.gov")]
      ).toEqual([distribution]);
    }).pipe(Effect.provide(baseLayer));
  });
});
