import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer, Result, Schema } from "effect";
import * as BunFileSystem from "@effect/platform-bun/BunFileSystem";
import * as BunPath from "@effect/platform-bun/BunPath";
import { loadCheckedInDataLayerRegistry } from "../src/bootstrap/CheckedInDataLayerRegistry";
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
  mintVariableId,
} from "../src/domain/data-layer";
import { prepareDataLayerRegistry } from "../src/resolution/dataLayerRegistry";
import { projectEntitySearchDocs } from "../src/search/projectEntitySearchDocs";

const bunFsLayer = Layer.mergeAll(BunFileSystem.layer, BunPath.layer);
const projectionTimeoutMs = 30_000;
const fixtureRegistryRoot = "tests/fixtures/entity-search-registry";

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
        relation: "exactMatch",
      },
    ],
    createdAt: "2026-04-08T00:00:00.000Z",
    updatedAt: "2026-04-08T00:00:00.000Z",
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
        relation: "closeMatch",
      },
    ],
    createdAt: "2026-04-08T00:00:00.000Z",
    updatedAt: "2026-04-08T00:00:00.000Z",
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
        relation: "closeMatch",
      },
    ],
    createdAt: "2026-04-08T00:00:00.000Z",
    updatedAt: "2026-04-08T00:00:00.000Z",
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
    updatedAt: "2026-04-08T00:00:00.000Z",
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
      frequency: "hourly",
    },
    aliases: [],
    createdAt: "2026-04-08T00:00:00.000Z",
    updatedAt: "2026-04-08T00:00:00.000Z",
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
    series: [series],
  };
};

describe("entity search projector", () => {
  it("projects one document per in-scope entity with denormalized lineage and URL fields", () => {
    const prepared = prepareDataLayerRegistry(makeSyntheticSeed());
    expect(Result.isSuccess(prepared)).toBe(true);
    if (Result.isFailure(prepared)) {
      throw new Error("synthetic registry should be valid");
    }

    const docs = projectEntitySearchDocs(prepared.success);
    const byTypeAndLabel = (entityType: string, primaryLabel: string) =>
      docs.find(
        (doc) =>
          doc.entityType === entityType && doc.primaryLabel === primaryLabel,
      );

    expect(docs).toHaveLength(5);
    expect(new Set(docs.map((doc) => doc.entityId)).size).toBe(5);

    const agentDoc = byTypeAndLabel(
      "Agent",
      "U.S. Energy Information Administration",
    );
    const datasetDoc = byTypeAndLabel(
      "Dataset",
      "EIA U.S. Electric System Operating Data",
    );
    const distributionDoc = byTypeAndLabel(
      "Distribution",
      "EIA Grid Monitor API",
    );
    const seriesDoc = byTypeAndLabel(
      "Series",
      "ERCOT wind generation (hourly)",
    );
    const variableDoc = byTypeAndLabel(
      "Variable",
      "Wind electricity generation",
    );

    expect(agentDoc?.homepageHostname).toBe("eia.gov");
    expect(agentDoc?.aliasText).toContain("EIA");

    expect(datasetDoc?.publisherAgentId).toBe(agentDoc?.entityId);
    expect(datasetDoc?.landingPageHostname).toBe("eia.gov");
    expect(datasetDoc?.canonicalUrls).toContain(
      "eia.gov/electricity/gridmonitor",
    );
    expect(datasetDoc?.lineageText).toContain(
      "U.S. Energy Information Administration",
    );
    expect(datasetDoc?.lineageText).toContain("Wind electricity generation");

    expect(distributionDoc?.accessHostname).toBe("api.eia.gov");
    expect(distributionDoc?.downloadHostname).toBe("api.eia.gov");
    expect(distributionDoc?.lineageText).toContain(
      "EIA U.S. Electric System Operating Data",
    );

    expect(seriesDoc?.variableId).toBe(variableDoc?.entityId);
    expect(seriesDoc?.datasetId).toBe(datasetDoc?.entityId);
    expect(seriesDoc?.place).toBe("US-TX");
    expect(seriesDoc?.market).toBe("ERCOT");
    expect(seriesDoc?.frequency).toBe("hourly");
    expect(seriesDoc?.landingPageHostname).toBe("eia.gov");
    expect(seriesDoc?.accessHostname).toBe("api.eia.gov");
    expect(seriesDoc?.downloadHostname).toBe("api.eia.gov");
    expect(seriesDoc?.canonicalUrls).toContain(
      "eia.gov/electricity/gridmonitor",
    );
    expect(seriesDoc?.canonicalUrls).toContain(
      "api.eia.gov/v2/electricity/rto",
    );
    expect(seriesDoc?.canonicalUrls).toContain("api.eia.gov/bulk/EBA.zip");
    expect(seriesDoc?.lineageText).toContain("EIA Grid Monitor API");
    expect(seriesDoc?.urlText).toContain("api.eia.gov");
    expect(seriesDoc?.ontologyText).toContain("generation");

    expect(variableDoc?.publisherAgentId).toBe(agentDoc?.entityId);
    expect(variableDoc?.datasetId).toBe(datasetDoc?.entityId);
    expect(variableDoc?.lineageText).toContain(
      "EIA U.S. Electric System Operating Data",
    );
    expect(variableDoc?.lineageText).toContain(
      "ERCOT wind generation (hourly)",
    );
    expect(variableDoc?.lineageText).toContain("api.eia.gov");
  });

  it("projects graph-backed lineage when dataset-variable linkage is only recovered from series", () => {
    const seed = makeSyntheticSeed();
    const { variableIds: _unusedVariableIds, ...datasetWithoutVariables } =
      seed.datasets[0]!;
    const prepared = prepareDataLayerRegistry({
      ...seed,
      datasets: [datasetWithoutVariables],
    });

    expect(Result.isSuccess(prepared)).toBe(true);
    if (Result.isFailure(prepared)) {
      throw new Error("synthetic registry should be valid");
    }

    const docs = projectEntitySearchDocs(prepared.success);
    const datasetDoc = docs.find((doc) => doc.entityType === "Dataset");
    const distributionDoc = docs.find(
      (doc) => doc.entityType === "Distribution",
    );
    const variableDoc = docs.find((doc) => doc.entityType === "Variable");

    expect(datasetDoc?.lineageText).toContain("Wind electricity generation");
    expect(datasetDoc?.ontologyText).toContain("generation");

    expect(distributionDoc?.lineageText).toContain(
      "Wind electricity generation",
    );
    expect(distributionDoc?.measuredProperty).toBe("generation");

    expect(variableDoc?.datasetId).toBe(datasetDoc?.entityId);
    expect(variableDoc?.publisherAgentId).toBe(datasetDoc?.publisherAgentId);
    expect(variableDoc?.lineageText).toContain(
      "EIA U.S. Electric System Operating Data",
    );
  });

  it.effect(
    "projects a file-backed registry fixture without duplicate entity ids",
    () =>
      Effect.gen(function* () {
        const prepared = yield* loadCheckedInDataLayerRegistry(
          fixtureRegistryRoot,
        ).pipe(Effect.provide(bunFsLayer));

        const docs = projectEntitySearchDocs(prepared);
        const expectedCount =
          prepared.seed.agents.length +
          prepared.seed.datasets.length +
          prepared.seed.distributions.length +
          prepared.seed.series.length +
          prepared.seed.variables.length;

        expect(docs).toHaveLength(expectedCount);
        expect(new Set(docs.map((doc) => doc.entityId)).size).toBe(
          expectedCount,
        );

        const eiaAgentDoc = docs.find(
          (doc) =>
            doc.entityType === "Agent" &&
            doc.primaryLabel === "U.S. Energy Information Administration",
        );
        const eiaDatasetDoc = docs.find(
          (doc) =>
            doc.entityType === "Dataset" &&
            doc.primaryLabel === "EIA U.S. Electric System Operating Data",
        );
        const ercotWindSeriesDoc = docs.find(
          (doc) =>
            doc.entityType === "Series" &&
            doc.primaryLabel === "ERCOT wind generation (daily)",
        );

        expect(eiaAgentDoc?.homepageHostname).toBe("eia.gov");
        expect(eiaAgentDoc?.aliasText).toContain("EIA");

        expect(eiaDatasetDoc?.landingPageHostname).toBe("eia.gov");
        expect(eiaDatasetDoc?.aliasText).toContain(
          "EIA Hourly Electric Grid Monitor",
        );
        expect(eiaDatasetDoc?.lineageText).toContain(
          "U.S. Energy Information Administration",
        );

        expect(ercotWindSeriesDoc?.market).toBe("ERCOT");
        expect(ercotWindSeriesDoc?.frequency).toBe("daily");
        expect(ercotWindSeriesDoc?.landingPageHostname).toBe("eia.gov");
        expect(
          ercotWindSeriesDoc?.canonicalUrls.some((url) =>
            url.includes("api.eia.gov"),
          ),
        ).toBe(true);
        expect(ercotWindSeriesDoc?.urlText).toContain("api.eia.gov");
        expect(ercotWindSeriesDoc?.lineageText).toContain(
          "Wind electricity generation",
        );
      }),
    projectionTimeoutMs,
  );
});
