import { describe, expect, it } from "@effect/vitest";
import { Schema } from "effect";
import {
  Variable,
  Series,
  Observation,
  Agent,
  Dataset,
  Distribution,
  DataService,
  DatasetSeries,
  variableToSchemaOrg,
  seriesToSchemaOrg,
  observationToSchemaOrg,
  agentToSchemaOrg,
  datasetToSchemaOrg,
  distributionToSchemaOrg,
  dataServiceToSchemaOrg,
  datasetSeriesToSchemaOrg
} from "../src/domain/data-layer";

const TS = "2026-04-08T00:00:00.000Z";

const VAR_ID = "https://id.skygest.io/variable/var_01JR8X2K9ABCDEFGH";
const SER_ID = "https://id.skygest.io/series/ser_01JR8X3M2ABCDEFGH";
const OBS_ID = "https://id.skygest.io/observation/obs_01JR8X4N5ABCDEFGH";
const AGENT_ID = "https://id.skygest.io/agent/ag_01JR8X5P8ABCDEFGH";
const DS_ID = "https://id.skygest.io/dataset/ds_01JR8X8S9ABCDEFGH";
const DIST_ID = "https://id.skygest.io/distribution/dist_01JR8X9T2CSVTEST01";
const SVC_ID = "https://id.skygest.io/data-service/svc_01JR8XAU5ABCDEFGH";
const DSER_ID = "https://id.skygest.io/dataset-series/dser_01JR8XBV8ABCDEFGH";

describe("variableToSchemaOrg", () => {
  it("emits StatisticalVariable with sameAs from alias URIs", () => {
    const v = Schema.decodeUnknownSync(Variable)({
      _tag: "Variable" as const,
      id: VAR_ID,
      label: "Wind installed capacity",
      definition: "Nameplate capacity of grid-connected wind turbines",
      measuredProperty: "capacity",
      statisticType: "stock",
      aliases: [
        {
          scheme: "oeo",
          value: "OEO_00010257",
          uri: "https://openenergy-platform.org/ontology/oeo/OEO_00010257",
          relation: "exactMatch"
        },
        { scheme: "wikidata", value: "Q12345", relation: "closeMatch" }
      ],
      createdAt: TS,
      updatedAt: TS
    });
    const ld = variableToSchemaOrg(v);
    expect(ld["@context"]).toBe("https://schema.org");
    expect(ld["@type"]).toBe("StatisticalVariable");
    expect(ld["@id"]).toBe(VAR_ID);
    expect(ld.name).toBe("Wind installed capacity");
    expect(ld.description).toBe("Nameplate capacity of grid-connected wind turbines");
    expect(ld.measuredProperty).toBe("capacity");
    expect(ld.statType).toBe("stock");
    expect(ld.sameAs).toEqual([
      "https://openenergy-platform.org/ontology/oeo/OEO_00010257"
    ]);
  });

  it("omits sameAs when no aliases have URIs", () => {
    const v = Schema.decodeUnknownSync(Variable)({
      _tag: "Variable" as const,
      id: VAR_ID,
      label: "Minimal variable",
      aliases: [],
      createdAt: TS,
      updatedAt: TS
    });
    const ld = variableToSchemaOrg(v);
    expect(ld.sameAs).toBeUndefined();
  });
});

describe("seriesToSchemaOrg", () => {
  it("emits Dataset with variableMeasured and spatialCoverage", () => {
    const s = Schema.decodeUnknownSync(Series)({
      _tag: "Series" as const,
      id: SER_ID,
      label: "ERCOT wind capacity (monthly)",
      variableId: VAR_ID,
      fixedDims: {
        place: "US-TX-ERCOT",
        frequency: "monthly"
      },
      aliases: [],
      createdAt: TS,
      updatedAt: TS
    });
    const ld = seriesToSchemaOrg(s);
    expect(ld["@context"]).toBe("https://schema.org");
    expect(ld["@type"]).toBe("Dataset");
    expect(ld["@id"]).toBe(SER_ID);
    expect(ld.name).toBe("ERCOT wind capacity (monthly)");
    expect(ld.variableMeasured).toEqual({ "@id": VAR_ID });
    expect(ld.spatialCoverage).toEqual({
      "@type": "Place",
      name: "US-TX-ERCOT"
    });
  });

  it("omits spatialCoverage when fixedDims.place is absent", () => {
    const s = Schema.decodeUnknownSync(Series)({
      _tag: "Series" as const,
      id: SER_ID,
      label: "Global wind capacity",
      variableId: VAR_ID,
      fixedDims: {},
      aliases: [],
      createdAt: TS,
      updatedAt: TS
    });
    const ld = seriesToSchemaOrg(s);
    expect(ld.spatialCoverage).toBeUndefined();
  });
});

describe("observationToSchemaOrg", () => {
  it("emits Observation with value and unitCode", () => {
    const o = Schema.decodeUnknownSync(Observation)({
      _tag: "Observation" as const,
      id: OBS_ID,
      seriesId: SER_ID,
      time: { start: "2026-03-01" },
      value: 4321.5,
      unit: "MW",
      sourceDistributionId: DIST_ID
    });
    const ld = observationToSchemaOrg(o);
    expect(ld["@context"]).toBe("https://schema.org");
    expect(ld["@type"]).toBe("Observation");
    expect(ld["@id"]).toBe(OBS_ID);
    expect(ld.observationDate).toBe("2026-03-01");
    expect(ld.value).toBe(4321.5);
    expect(ld.unitCode).toBe("MW");
  });
});

describe("agentToSchemaOrg", () => {
  it("maps organization kind to Organization", () => {
    const a = Schema.decodeUnknownSync(Agent)({
      _tag: "Agent" as const,
      id: AGENT_ID,
      kind: "organization",
      name: "Canada Energy Regulator",
      homepage: "https://www.cer-rec.gc.ca",
      alternateNames: ["CER", "NEB"],
      aliases: [
        {
          scheme: "ror",
          value: "https://ror.org/01234",
          uri: "https://ror.org/01234",
          relation: "exactMatch"
        }
      ],
      createdAt: TS,
      updatedAt: TS
    });
    const ld = agentToSchemaOrg(a);
    expect(ld["@context"]).toBe("https://schema.org");
    expect(ld["@type"]).toBe("Organization");
    expect(ld["@id"]).toBe(AGENT_ID);
    expect(ld.name).toBe("Canada Energy Regulator");
    expect(ld.url).toBe("https://www.cer-rec.gc.ca");
    expect(ld.alternateName).toEqual(["CER", "NEB"]);
    expect(ld.sameAs).toEqual(["https://ror.org/01234"]);
  });

  it("maps person kind to Person", () => {
    const a = Schema.decodeUnknownSync(Agent)({
      _tag: "Agent" as const,
      id: AGENT_ID,
      kind: "person",
      name: "Blake Shaffer",
      aliases: [],
      createdAt: TS,
      updatedAt: TS
    });
    const ld = agentToSchemaOrg(a);
    expect(ld["@type"]).toBe("Person");
    expect(ld.name).toBe("Blake Shaffer");
  });

  it("maps consortium kind to Organization", () => {
    const a = Schema.decodeUnknownSync(Agent)({
      _tag: "Agent" as const,
      id: AGENT_ID,
      kind: "consortium",
      name: "ENTSO-E",
      aliases: [],
      createdAt: TS,
      updatedAt: TS
    });
    const ld = agentToSchemaOrg(a);
    expect(ld["@type"]).toBe("Organization");
  });
});

describe("datasetToSchemaOrg", () => {
  it("emits Dataset with url from landingPage", () => {
    const d = Schema.decodeUnknownSync(Dataset)({
      _tag: "Dataset" as const,
      id: DS_ID,
      title: "Alberta Electricity Generation",
      description: "Monthly electricity generation data for Alberta",
      landingPage: "https://open.canada.ca/data/en/dataset/electricity",
      license: "https://creativecommons.org/licenses/by/4.0/",
      keywords: ["electricity", "alberta", "generation"],
      aliases: [
        {
          scheme: "doi",
          value: "10.1234/test",
          uri: "https://doi.org/10.1234/test",
          relation: "exactMatch"
        }
      ],
      createdAt: TS,
      updatedAt: TS
    });
    const ld = datasetToSchemaOrg(d);
    expect(ld["@context"]).toBe("https://schema.org");
    expect(ld["@type"]).toBe("Dataset");
    expect(ld["@id"]).toBe(DS_ID);
    expect(ld.name).toBe("Alberta Electricity Generation");
    expect(ld.description).toBe("Monthly electricity generation data for Alberta");
    expect(ld.url).toBe("https://open.canada.ca/data/en/dataset/electricity");
    expect(ld.license).toBe("https://creativecommons.org/licenses/by/4.0/");
    expect(ld.keywords).toEqual(["electricity", "alberta", "generation"]);
    expect(ld.sameAs).toEqual(["https://doi.org/10.1234/test"]);
  });

  it("omits optional fields when absent", () => {
    const d = Schema.decodeUnknownSync(Dataset)({
      _tag: "Dataset" as const,
      id: DS_ID,
      title: "Minimal dataset",
      aliases: [],
      createdAt: TS,
      updatedAt: TS
    });
    const ld = datasetToSchemaOrg(d);
    expect(ld.description).toBeUndefined();
    expect(ld.url).toBeUndefined();
    expect(ld.license).toBeUndefined();
    expect(ld.keywords).toBeUndefined();
    expect(ld.sameAs).toBeUndefined();
  });
});

describe("distributionToSchemaOrg", () => {
  it("emits DataDownload with encodingFormat from mediaType", () => {
    const dist = Schema.decodeUnknownSync(Distribution)({
      _tag: "Distribution" as const,
      id: DIST_ID,
      datasetId: DS_ID,
      kind: "download",
      title: "CSV export",
      downloadURL: "https://example.com/data.csv",
      mediaType: "text/csv",
      format: "CSV",
      aliases: [],
      createdAt: TS,
      updatedAt: TS
    });
    const ld = distributionToSchemaOrg(dist);
    expect(ld["@context"]).toBe("https://schema.org");
    expect(ld["@type"]).toBe("DataDownload");
    expect(ld["@id"]).toBe(DIST_ID);
    expect(ld.name).toBe("CSV export");
    expect(ld.contentUrl).toBe("https://example.com/data.csv");
    expect(ld.encodingFormat).toBe("text/csv");
    expect(ld.fileFormat).toBe("CSV");
  });

  it("uses accessURL when downloadURL is absent", () => {
    const dist = Schema.decodeUnknownSync(Distribution)({
      _tag: "Distribution" as const,
      id: DIST_ID,
      datasetId: DS_ID,
      kind: "api-access",
      accessURL: "https://api.example.com/v1/data",
      aliases: [],
      createdAt: TS,
      updatedAt: TS
    });
    const ld = distributionToSchemaOrg(dist);
    expect(ld.contentUrl).toBe("https://api.example.com/v1/data");
  });
});

describe("dataServiceToSchemaOrg", () => {
  it("emits Dataset (lossy) with url from first endpointURL", () => {
    const svc = Schema.decodeUnknownSync(DataService)({
      _tag: "DataService" as const,
      id: SVC_ID,
      title: "CER CKAN API",
      description: "Open data API for Canada Energy Regulator",
      endpointURLs: [
        "https://open.canada.ca/data/api/3",
        "https://open.canada.ca/data/api/2"
      ],
      servesDatasetIds: [DS_ID],
      aliases: [],
      createdAt: TS,
      updatedAt: TS
    });
    const ld = dataServiceToSchemaOrg(svc);
    expect(ld["@context"]).toBe("https://schema.org");
    expect(ld["@type"]).toBe("Dataset");
    expect(ld["@id"]).toBe(SVC_ID);
    expect(ld.name).toBe("CER CKAN API");
    expect(ld.description).toBe("Open data API for Canada Energy Regulator");
    expect(ld.url).toBe("https://open.canada.ca/data/api/3");
    // No internal metadata leaks
    expect(ld._lossiness).toBeUndefined();
    expect(ld._tag).toBeUndefined();
    expect(ld.endpointURLs).toBeUndefined();
    expect(ld.servesDatasetIds).toBeUndefined();
  });
});

describe("datasetSeriesToSchemaOrg", () => {
  it("emits Dataset (lossy) with name from title", () => {
    const dser = Schema.decodeUnknownSync(DatasetSeries)({
      _tag: "DatasetSeries" as const,
      id: DSER_ID,
      title: "Monthly Electricity Generation",
      description: "Recurring monthly generation reports",
      cadence: "monthly",
      aliases: [
        {
          scheme: "url",
          value: "https://example.com/series",
          uri: "https://example.com/series",
          relation: "exactMatch"
        }
      ],
      createdAt: TS,
      updatedAt: TS
    });
    const ld = datasetSeriesToSchemaOrg(dser);
    expect(ld["@context"]).toBe("https://schema.org");
    expect(ld["@type"]).toBe("Dataset");
    expect(ld["@id"]).toBe(DSER_ID);
    expect(ld.name).toBe("Monthly Electricity Generation");
    expect(ld.description).toBe("Recurring monthly generation reports");
    expect(ld.sameAs).toEqual(["https://example.com/series"]);
    // No internal metadata leaks
    expect(ld._lossiness).toBeUndefined();
    expect(ld._tag).toBeUndefined();
    expect(ld.cadence).toBeUndefined();
  });
});
