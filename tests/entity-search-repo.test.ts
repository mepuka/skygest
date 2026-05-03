import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer, Result, Schema } from "effect";
import {
  Agent,
  Dataset,
  Distribution,
  Series,
  Variable,
  type DataLayerRegistrySeed,
  mintAgentId,
  mintDatasetId,
  mintDistributionId,
  mintSeriesId,
  mintVariableId
} from "../src/domain/data-layer";
import { prepareDataLayerRegistry } from "../src/resolution/dataLayerRegistry";
import { runEntitySearchMigrations } from "../src/search/migrate";
import { entitySearchSqlLayer } from "../src/search/Layer";
import { projectEntitySearchDocs } from "../src/search/projectEntitySearchDocs";
import { EntitySearchRepo } from "../src/services/EntitySearchRepo";
import { EntitySearchRepoD1 } from "../src/services/d1/EntitySearchRepoD1";
import { makeSqliteLayer } from "./support/runtime";

const decodeAgent = Schema.decodeUnknownSync(Agent);
const decodeDataset = Schema.decodeUnknownSync(Dataset);
const decodeDistribution = Schema.decodeUnknownSync(Distribution);
const decodeSeries = Schema.decodeUnknownSync(Series);
const decodeVariable = Schema.decodeUnknownSync(Variable);

const makeSyntheticSeed = (): DataLayerRegistrySeed => {
  const agentId = mintAgentId();
  const datasetId = mintDatasetId();
  const distributionId = mintDistributionId();
  const variableId = mintVariableId();
  const seriesId = mintSeriesId();

  const agent = decodeAgent({
    _tag: "Agent",
    id: agentId,
    kind: "organization",
    name: "U.S. Energy Information Administration",
    alternateNames: ["EIA", "Energy Information Administration"],
    homepage: "https://www.eia.gov/",
    aliases: [
      {
        scheme: "url",
        value: "https://www.eia.gov/",
        relation: "exactMatch"
      }
    ],
    createdAt: "2026-04-08T00:00:00.000Z",
    updatedAt: "2026-04-08T00:00:00.000Z"
  });

  const variable = decodeVariable({
    _tag: "Variable",
    id: variableId,
    label: "Wind electricity generation",
    definition: "Electrical energy produced by wind turbines",
    measuredProperty: "generation",
    domainObject: "electricity",
    technologyOrFuel: "wind",
    statisticType: "flow",
    aggregation: "sum",
    unitFamily: "energy",
    aliases: [
      {
        scheme: "display-alias",
        value: "Wind output",
        relation: "closeMatch"
      }
    ],
    createdAt: "2026-04-08T00:00:00.000Z",
    updatedAt: "2026-04-08T00:00:00.000Z"
  });

  const dataset = decodeDataset({
    _tag: "Dataset",
    id: datasetId,
    title: "EIA U.S. Electric System Operating Data",
    description:
      "Hourly electric system operating data including demand and generation by source.",
    publisherAgentId: agentId,
    landingPage: "https://www.eia.gov/electricity/gridmonitor/",
    keywords: ["electricity", "grid", "hourly"],
    themes: ["electricity", "grid operations"],
    variableIds: [variableId],
    distributionIds: [distributionId],
    aliases: [
      {
        scheme: "display-alias",
        value: "EIA Hourly Electric Grid Monitor",
        relation: "closeMatch"
      }
    ],
    createdAt: "2026-04-08T00:00:00.000Z",
    updatedAt: "2026-04-08T00:00:00.000Z"
  });

  const distribution = decodeDistribution({
    _tag: "Distribution",
    id: distributionId,
    datasetId,
    kind: "api-access",
    title: "EIA Grid Monitor API",
    description: "API access to hourly generation and demand values.",
    accessURL: "https://api.eia.gov/v2/electricity/rto/",
    downloadURL: "https://api.eia.gov/bulk/EBA.zip",
    aliases: [],
    createdAt: "2026-04-08T00:00:00.000Z",
    updatedAt: "2026-04-08T00:00:00.000Z"
  });

  const series = decodeSeries({
    _tag: "Series",
    id: seriesId,
    label: "ERCOT wind generation (hourly)",
    variableId,
    datasetId,
    fixedDims: {
      place: "US-TX",
      market: "ERCOT",
      frequency: "hourly"
    },
    aliases: [],
    createdAt: "2026-04-08T00:00:00.000Z",
    updatedAt: "2026-04-08T00:00:00.000Z"
  });

  return {
    agents: [agent],
    catalogs: [],
    catalogRecords: [],
    datasets: [dataset],
    distributions: [distribution],
    dataServices: [],
    datasetSeries: [],
    variables: [variable],
    series: [series]
  };
};

const makeProjectedDocs = () => {
  const prepared = prepareDataLayerRegistry(makeSyntheticSeed());
  expect(Result.isSuccess(prepared)).toBe(true);
  if (Result.isFailure(prepared)) {
    throw new Error("expected prepared registry");
  }
  return projectEntitySearchDocs(prepared.success);
};

const makeEntitySearchRepoLayer = () => {
  const sqliteLayer = makeSqliteLayer();
  const searchSqlLayer = entitySearchSqlLayer(sqliteLayer);

  return Layer.mergeAll(
    sqliteLayer,
    searchSqlLayer,
    EntitySearchRepoD1.layer.pipe(Layer.provideMerge(searchSqlLayer))
  );
};

describe("entity search repo", () => {
  it.effect("indexes projected docs and serves exact URL, hostname, and lexical hits", () =>
    Effect.gen(function* () {
      yield* runEntitySearchMigrations;
      const repo = yield* EntitySearchRepo;
      const docs = makeProjectedDocs();
      const datasetDoc = docs.find((doc) => doc.entityType === "Dataset");
      const distributionDoc = docs.find((doc) => doc.entityType === "Distribution");
      const seriesDoc = docs.find((doc) => doc.entityType === "Series");
      const variableDoc = docs.find((doc) => doc.entityType === "Variable");

      expect(datasetDoc).toBeDefined();
      expect(distributionDoc).toBeDefined();
      expect(seriesDoc).toBeDefined();
      expect(variableDoc).toBeDefined();

      const datasetScopeId = datasetDoc?.datasetId;
      expect(datasetScopeId).toBeDefined();
      if (datasetScopeId === undefined) {
        throw new Error("expected dataset doc to carry datasetId");
      }

      yield* repo.replaceAllDocuments(docs);

      const storedDataset = yield* repo.getByEntityId(datasetDoc!.entityId);
      expect(storedDataset?.primaryLabel).toBe(
        "EIA U.S. Electric System Operating Data"
      );

      const exactUrlHits = yield* repo.searchLexical({
        exactCanonicalUrls: ["https://www.eia.gov/electricity/gridmonitor/"],
        entityTypes: ["Dataset"]
      });
      expect(exactUrlHits.map((hit) => hit.matchKind)).toEqual(["exact-url"]);
      expect(exactUrlHits[0]?.document.entityId).toBe(datasetDoc!.entityId);

      const exactHostnameHits = yield* repo.searchLexical({
        exactHostnames: ["https://api.eia.gov/v2/electricity/rto/"],
        entityTypes: ["Distribution"]
      });
      expect(exactHostnameHits.map((hit) => hit.matchKind)).toEqual([
        "exact-hostname"
      ]);
      expect(exactHostnameHits[0]?.document.entityId).toBe(
        distributionDoc!.entityId
      );

      const lexicalHits = yield* repo.searchLexical({
        query: "ERCOT wind generation",
        entityTypes: ["Series"]
      });
      expect(lexicalHits[0]?.document.entityId).toBe(seriesDoc!.entityId);
      expect(lexicalHits[0]?.matchKind).toBe("lexical");
      expect(lexicalHits[0]?.snippet).toContain("wind");

      const scopedHits = yield* repo.searchLexical({
        query: "wind output",
        entityTypes: ["Variable"],
        scope: {
          datasetId: datasetScopeId
        }
      });
      expect(scopedHits[0]?.document.entityId).toBe(variableDoc!.entityId);
    }).pipe(Effect.provide(makeEntitySearchRepoLayer()))
  );

  it.effect("replaces the corpus without leaving stale rows in docs or FTS", () =>
    Effect.gen(function* () {
      yield* runEntitySearchMigrations;
      const repo = yield* EntitySearchRepo;
      const docs = makeProjectedDocs();
      const seriesDoc = docs.find((doc) => doc.entityType === "Series");

      expect(seriesDoc).toBeDefined();

      yield* repo.replaceAllDocuments(docs);
      yield* repo.replaceAllDocuments(
        docs.filter((doc) => doc.entityType !== "Series")
      );

      const storedSeries = yield* repo.getByEntityId(seriesDoc!.entityId);
      expect(storedSeries).toBeNull();

      const lexicalHits = yield* repo.searchLexical({
        query: "ERCOT wind generation",
        entityTypes: ["Series"]
      });
      expect(lexicalHits).toHaveLength(0);
    }).pipe(Effect.provide(makeEntitySearchRepoLayer()))
  );

  it.effect("hydrates multiple entity IDs in one repo call", () =>
    Effect.gen(function* () {
      yield* runEntitySearchMigrations;
      const repo = yield* EntitySearchRepo;
      const docs = makeProjectedDocs();
      const datasetDoc = docs.find((doc) => doc.entityType === "Dataset");
      const distributionDoc = docs.find((doc) => doc.entityType === "Distribution");

      expect(datasetDoc).toBeDefined();
      expect(distributionDoc).toBeDefined();

      yield* repo.replaceAllDocuments(docs);

      const hydrated = yield* repo.getManyByEntityId([
        datasetDoc!.entityId,
        distributionDoc!.entityId
      ]);

      expect(new Set(hydrated.map((doc) => doc.entityId))).toEqual(
        new Set([datasetDoc!.entityId, distributionDoc!.entityId])
      );
    }).pipe(Effect.provide(makeEntitySearchRepoLayer()))
  );
});
