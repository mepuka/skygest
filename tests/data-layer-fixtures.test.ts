/**
 * Comprehensive fixture suite for the data intelligence layer (SKY-214).
 *
 * Exercises the full entity graph — all types working together — plus
 * edge cases that the per-module tests don't cover.
 */
import { describe, expect, it } from "@effect/vitest";
import { Schema } from "effect";
import {
  Variable, Series, Observation, Candidate, DataLayerRecord,
  Agent, Catalog, CatalogRecord, Dataset, Distribution, DataService, DatasetSeries,
  Aliases,
  DcatClass, SchemaOrgType, SdmxConcept, DesignDecision
} from "../src/domain/data-layer";

// ---------------------------------------------------------------------------
// Shared constants
// ---------------------------------------------------------------------------

const TS = "2026-04-08T00:00:00.000Z";

// Variable/Series/Observation IDs — wind capacity tier
const WIND_VAR_ID = "https://id.skygest.io/variable/var_01JR9A1WINDCAP001";
const ERCOT_SER_ID = "https://id.skygest.io/series/ser_01JR9A2ERCOTWIND01";
const ERCOT_OBS_ID = "https://id.skygest.io/observation/obs_01JR9A3ERCOTOBS01";

// Variable/Series IDs — wholesale price tier
const PRICE_VAR_ID = "https://id.skygest.io/variable/var_01JR9B1WSPRICE001";
const DELU_SER_ID = "https://id.skygest.io/series/ser_01JR9B2DELUPRICE01";

// Dataset / Distribution / DataService / DatasetSeries IDs
const DS_ID = "https://id.skygest.io/dataset/ds_01JR9C1MULTIDIST01";
const DIST_CSV_ID = "https://id.skygest.io/distribution/dist_01JR9C2CSVDIST001";
const DIST_API_ID = "https://id.skygest.io/distribution/dist_01JR9C3APIDIST001";
const DIST_PDF_ID = "https://id.skygest.io/distribution/dist_01JR9C4PDFDIST001";
const SVC_ID = "https://id.skygest.io/data-service/svc_01JR9C5DATASVC001";
const DSER_ID = "https://id.skygest.io/dataset-series/dser_01JR9C6DSERIES001";

// Agent / Catalog / CatalogRecord IDs
const AGENT_ID = "https://id.skygest.io/agent/ag_01JR9D1AGENTMULTI01";
const CATALOG_A_ID = "https://id.skygest.io/catalog/cat_01JR9D2CATALOGAUTH";
const CATALOG_H_ID = "https://id.skygest.io/catalog/cat_01JR9D3CATALOGHARV";
const CR_AUTH_ID = "https://id.skygest.io/catalog-record/cr_01JR9D4CRAUTHORIT";
const CR_HARV_ID = "https://id.skygest.io/catalog-record/cr_01JR9D5CRHARVEST1";

// Candidate IDs
const CAND_SOURCE_ID = "https://id.skygest.io/candidate/cand_01JR9E1SRCONLY001";
const CAND_FULL_ID = "https://id.skygest.io/candidate/cand_01JR9E2FULLRESOL1";

// ---------------------------------------------------------------------------
// 1. Wind-capacity Variable + ERCOT Series + Observation — three tiers
// ---------------------------------------------------------------------------

describe("Fixture 1: Wind-capacity Variable + ERCOT Series + Observation", () => {
  const variable = {
    _tag: "Variable" as const,
    id: WIND_VAR_ID,
    label: "Wind installed capacity",
    definition: "Nameplate capacity of grid-connected wind turbines",
    measuredProperty: "capacity",
    domainObject: "wind turbine",
    technologyOrFuel: "wind",
    statisticType: "stock" as const,
    aggregation: "end_of_period" as const,
    basis: ["gross", "onshore"],
    unitFamily: "power" as const,
    aliases: [
      { scheme: "oeo" as const, value: "OEO_00010257", relation: "exactMatch" as const }
    ],
    createdAt: TS,
    updatedAt: TS
  };

  const series = {
    _tag: "Series" as const,
    id: ERCOT_SER_ID,
    label: "ERCOT wind installed capacity (monthly)",
    variableId: WIND_VAR_ID,
    fixedDims: {
      place: "US-TX",
      market: "ERCOT",
      frequency: "monthly"
    },
    aliases: [
      { scheme: "eia-series" as const, value: "ELEC.CAP.WND-TX.M", relation: "closeMatch" as const }
    ],
    createdAt: TS,
    updatedAt: TS
  };

  const observation = {
    _tag: "Observation" as const,
    id: ERCOT_OBS_ID,
    seriesId: ERCOT_SER_ID,
    time: { start: "2026-03-01" },
    value: 41250.5,
    unit: "MW",
    sourceDistributionId: DIST_CSV_ID
  };

  it("Variable decodes with all seven facets", () => {
    const decoded = Schema.decodeUnknownSync(Variable)(variable);
    expect(decoded._tag).toBe("Variable");
    expect(decoded.id).toBe(WIND_VAR_ID);
    expect(decoded.statisticType).toBe("stock");
    expect(decoded.unitFamily).toBe("power");
    expect(decoded.technologyOrFuel).toBe("wind");
  });

  it("Series decodes and variableId chains to Variable", () => {
    const decoded = Schema.decodeUnknownSync(Series)(series);
    expect(decoded._tag).toBe("Series");
    expect(decoded.variableId).toBe(WIND_VAR_ID);
    expect(decoded.fixedDims.market).toBe("ERCOT");
  });

  it("Observation decodes and seriesId chains to Series", () => {
    const decoded = Schema.decodeUnknownSync(Observation)(observation);
    expect(decoded._tag).toBe("Observation");
    expect(decoded.seriesId).toBe(ERCOT_SER_ID);
    expect(decoded.value).toBe(41250.5);
  });

  it("IDs chain correctly: Observation -> Series -> Variable", () => {
    const v = Schema.decodeUnknownSync(Variable)(variable);
    const s = Schema.decodeUnknownSync(Series)(series);
    const o = Schema.decodeUnknownSync(Observation)(observation);
    expect(o.seriesId).toBe(s.id);
    expect(s.variableId).toBe(v.id);
  });
});

// ---------------------------------------------------------------------------
// 2. Wholesale-price Variable + DE-LU Series — different facet composition
// ---------------------------------------------------------------------------

describe("Fixture 2: Wholesale-price Variable + DE-LU Series", () => {
  const priceVar = {
    _tag: "Variable" as const,
    id: PRICE_VAR_ID,
    label: "Wholesale electricity price",
    measuredProperty: "price",
    statisticType: "price" as const,
    aggregation: "settlement" as const,
    unitFamily: "currency_per_energy" as const,
    aliases: [
      { scheme: "oeo" as const, value: "OEO_00020118", relation: "exactMatch" as const }
    ],
    createdAt: TS,
    updatedAt: TS
  };

  const deluSeries = {
    _tag: "Series" as const,
    id: DELU_SER_ID,
    label: "DE-LU day-ahead wholesale price (hourly)",
    variableId: PRICE_VAR_ID,
    fixedDims: {
      place: "DE-LU",
      market: "EPEX SPOT",
      frequency: "hourly",
      extra: { biddingZone: "DE-LU" }
    },
    aliases: [
      { scheme: "entsoe-eic" as const, value: "10Y1001A1001A82H", relation: "exactMatch" as const }
    ],
    createdAt: TS,
    updatedAt: TS
  };

  it("Price Variable decodes with price/settlement/currency_per_energy facets", () => {
    const decoded = Schema.decodeUnknownSync(Variable)(priceVar);
    expect(decoded.statisticType).toBe("price");
    expect(decoded.aggregation).toBe("settlement");
    expect(decoded.unitFamily).toBe("currency_per_energy");
  });

  it("DE-LU Series chains to price Variable", () => {
    const decoded = Schema.decodeUnknownSync(Series)(deluSeries);
    expect(decoded.variableId).toBe(PRICE_VAR_ID);
    expect(decoded.fixedDims.place).toBe("DE-LU");
    expect(decoded.fixedDims.extra).toEqual({ biddingZone: "DE-LU" });
  });
});

// ---------------------------------------------------------------------------
// 3. Multi-Distribution Dataset (CSV + API + PDF) with DataService link
// ---------------------------------------------------------------------------

describe("Fixture 3: Multi-Distribution Dataset with DataService", () => {
  const dataset = {
    _tag: "Dataset" as const,
    id: DS_ID,
    title: "Alberta Electricity Statistics",
    description: "Historical generation, capacity, and price data for Alberta",
    publisherAgentId: AGENT_ID,
    accessRights: "public" as const,
    keywords: ["electricity", "alberta", "generation"],
    distributionIds: [DIST_CSV_ID, DIST_API_ID, DIST_PDF_ID],
    dataServiceIds: [SVC_ID],
    inSeries: DSER_ID,
    aliases: [
      { scheme: "doi" as const, value: "10.5281/zenodo.9999999", relation: "exactMatch" as const }
    ],
    createdAt: TS,
    updatedAt: TS
  };

  const csvDist = {
    _tag: "Distribution" as const,
    id: DIST_CSV_ID,
    datasetId: DS_ID,
    kind: "download" as const,
    title: "CSV bulk download",
    downloadURL: "https://opendata.alberta.ca/electricity.csv",
    mediaType: "text/csv",
    format: "CSV",
    byteSize: 5242880,
    aliases: [],
    createdAt: TS,
    updatedAt: TS
  };

  const apiDist = {
    _tag: "Distribution" as const,
    id: DIST_API_ID,
    datasetId: DS_ID,
    kind: "api-access" as const,
    title: "REST API endpoint",
    accessURL: "https://api.alberta.ca/electricity/v2",
    accessServiceId: SVC_ID,
    aliases: [],
    createdAt: TS,
    updatedAt: TS
  };

  const pdfDist = {
    _tag: "Distribution" as const,
    id: DIST_PDF_ID,
    datasetId: DS_ID,
    kind: "documentation" as const,
    title: "Methodology PDF",
    downloadURL: "https://opendata.alberta.ca/electricity-methodology.pdf",
    mediaType: "application/pdf",
    format: "PDF",
    aliases: [],
    createdAt: TS,
    updatedAt: TS
  };

  const dataService = {
    _tag: "DataService" as const,
    id: SVC_ID,
    title: "Alberta Open Data CKAN API",
    endpointURLs: ["https://api.alberta.ca/ckan/3"],
    servesDatasetIds: [DS_ID],
    conformsTo: "https://docs.ckan.org/en/latest/api/",
    aliases: [],
    createdAt: TS,
    updatedAt: TS
  };

  it("Dataset decodes with three distribution refs", () => {
    const decoded = Schema.decodeUnknownSync(Dataset)(dataset);
    expect(decoded.distributionIds).toHaveLength(3);
    expect(decoded.distributionIds).toContain(DIST_CSV_ID);
    expect(decoded.distributionIds).toContain(DIST_API_ID);
    expect(decoded.distributionIds).toContain(DIST_PDF_ID);
  });

  it("three Distribution records decode with different kinds", () => {
    const csv = Schema.decodeUnknownSync(Distribution)(csvDist);
    const api = Schema.decodeUnknownSync(Distribution)(apiDist);
    const pdf = Schema.decodeUnknownSync(Distribution)(pdfDist);
    expect(csv.kind).toBe("download");
    expect(api.kind).toBe("api-access");
    expect(pdf.kind).toBe("documentation");
  });

  it("API Distribution links to DataService via accessServiceId", () => {
    const api = Schema.decodeUnknownSync(Distribution)(apiDist);
    const svc = Schema.decodeUnknownSync(DataService)(dataService);
    expect(api.accessServiceId).toBe(svc.id);
    expect(svc.servesDatasetIds).toContain(DS_ID);
  });

  it("all Distributions share the same datasetId", () => {
    const csv = Schema.decodeUnknownSync(Distribution)(csvDist);
    const api = Schema.decodeUnknownSync(Distribution)(apiDist);
    const pdf = Schema.decodeUnknownSync(Distribution)(pdfDist);
    expect(csv.datasetId).toBe(DS_ID);
    expect(api.datasetId).toBe(DS_ID);
    expect(pdf.datasetId).toBe(DS_ID);
  });
});

// ---------------------------------------------------------------------------
// 4. CatalogRecord: same Dataset in two Catalogs
// ---------------------------------------------------------------------------

describe("Fixture 4: Same Dataset in two Catalogs", () => {
  const catalogAuth = {
    _tag: "Catalog" as const,
    id: CATALOG_A_ID,
    title: "Alberta Open Data Portal",
    publisherAgentId: AGENT_ID,
    homepage: "https://opendata.alberta.ca",
    aliases: [],
    createdAt: TS,
    updatedAt: TS
  };

  const catalogHarv = {
    _tag: "Catalog" as const,
    id: CATALOG_H_ID,
    title: "Skygest Harvested Catalog",
    publisherAgentId: AGENT_ID,
    aliases: [],
    createdAt: TS,
    updatedAt: TS
  };

  const crAuthoritative = {
    _tag: "CatalogRecord" as const,
    id: CR_AUTH_ID,
    catalogId: CATALOG_A_ID,
    primaryTopicType: "dataset" as const,
    primaryTopicId: DS_ID,
    firstSeen: "2025-01-15T10:00:00.000Z",
    lastSeen: TS,
    isAuthoritative: true
  };

  const crHarvested = {
    _tag: "CatalogRecord" as const,
    id: CR_HARV_ID,
    catalogId: CATALOG_H_ID,
    primaryTopicType: "dataset" as const,
    primaryTopicId: DS_ID,
    firstSeen: "2026-03-01T08:00:00.000Z",
    lastSeen: TS,
    harvestedFrom: "https://opendata.alberta.ca/api/3/action/package_show?id=elec-stats",
    isAuthoritative: false,
    duplicateOf: CR_AUTH_ID
  };

  it("both CatalogRecords decode and point at the same Dataset", () => {
    const auth = Schema.decodeUnknownSync(CatalogRecord)(crAuthoritative);
    const harv = Schema.decodeUnknownSync(CatalogRecord)(crHarvested);
    expect(auth.primaryTopicId).toBe(DS_ID);
    expect(harv.primaryTopicId).toBe(DS_ID);
  });

  it("authoritative record is flagged, harvested is not", () => {
    const auth = Schema.decodeUnknownSync(CatalogRecord)(crAuthoritative);
    const harv = Schema.decodeUnknownSync(CatalogRecord)(crHarvested);
    expect(auth.isAuthoritative).toBe(true);
    expect(harv.isAuthoritative).toBe(false);
  });

  it("harvested record links back to authoritative via duplicateOf", () => {
    const harv = Schema.decodeUnknownSync(CatalogRecord)(crHarvested);
    expect(harv.duplicateOf).toBe(CR_AUTH_ID);
  });

  it("records live in different Catalogs", () => {
    const catA = Schema.decodeUnknownSync(Catalog)(catalogAuth);
    const catH = Schema.decodeUnknownSync(Catalog)(catalogHarv);
    const auth = Schema.decodeUnknownSync(CatalogRecord)(crAuthoritative);
    const harv = Schema.decodeUnknownSync(CatalogRecord)(crHarvested);
    expect(auth.catalogId).toBe(catA.id);
    expect(harv.catalogId).toBe(catH.id);
    expect(catA.id).not.toBe(catH.id);
  });
});

// ---------------------------------------------------------------------------
// 5. Partially-resolved Candidate (source_only)
// ---------------------------------------------------------------------------

describe("Fixture 5: Partially-resolved Candidate (source_only)", () => {
  const sourceOnly = {
    _tag: "Candidate" as const,
    id: CAND_SOURCE_ID,
    sourceRef: {
      contentId: "at://did:plc:j7ee6oemj2otwkye7uhv7q/app.bsky.feed.post/3lq7abc123"
    },
    referencedDistributionId: DIST_CSV_ID,
    rawLabel: "Alberta wind generation hit 4.1 GW last month",
    resolutionState: "source_only" as const,
    createdAt: TS
  };

  it("decodes with only referencedDistributionId set", () => {
    const decoded = Schema.decodeUnknownSync(Candidate)(sourceOnly);
    expect(decoded.resolutionState).toBe("source_only");
    expect(decoded.referencedDistributionId).toBe(DIST_CSV_ID);
  });

  it("other reference fields are absent", () => {
    const decoded = Schema.decodeUnknownSync(Candidate)(sourceOnly);
    expect("referencedDatasetId" in decoded).toBe(false);
    expect("referencedAgentId" in decoded).toBe(false);
    expect("referencedVariableId" in decoded).toBe(false);
    expect("referencedSeriesId" in decoded).toBe(false);
  });

  it("assertedValue, assertedUnit, assertedTime are absent", () => {
    const decoded = Schema.decodeUnknownSync(Candidate)(sourceOnly);
    expect("assertedValue" in decoded).toBe(false);
    expect("assertedUnit" in decoded).toBe(false);
    expect("assertedTime" in decoded).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 6. Fully-resolved Candidate with asserted value
// ---------------------------------------------------------------------------

describe("Fixture 6: Fully-resolved Candidate with asserted value", () => {
  const fullyResolved = {
    _tag: "Candidate" as const,
    id: CAND_FULL_ID,
    sourceRef: {
      contentId: "at://did:plc:j7ee6oemj2otwkye7uhv7q/app.bsky.feed.post/3lq7def456",
      segment: "chart-1"
    },
    referencedDistributionId: DIST_CSV_ID,
    referencedDatasetId: DS_ID,
    referencedAgentId: AGENT_ID,
    referencedVariableId: WIND_VAR_ID,
    referencedSeriesId: ERCOT_SER_ID,
    assertedValue: 41250,
    assertedUnit: "MW",
    assertedTime: {
      start: "2026-03-01",
      end: "2026-03-31",
      label: "March 2026"
    },
    rawLabel: "ERCOT wind capacity reached 41,250 MW in March 2026",
    rawDims: { region: "ERCOT", fuel: "wind" },
    resolutionState: "resolved" as const,
    createdAt: TS
  };

  it("decodes with all reference fields populated", () => {
    const decoded = Schema.decodeUnknownSync(Candidate)(fullyResolved);
    expect(decoded.resolutionState).toBe("resolved");
    expect(decoded.referencedDistributionId).toBe(DIST_CSV_ID);
    expect(decoded.referencedDatasetId).toBe(DS_ID);
    expect(decoded.referencedAgentId).toBe(AGENT_ID);
    expect(decoded.referencedVariableId).toBe(WIND_VAR_ID);
    expect(decoded.referencedSeriesId).toBe(ERCOT_SER_ID);
  });

  it("assertedValue, assertedUnit, and assertedTime are present", () => {
    const decoded = Schema.decodeUnknownSync(Candidate)(fullyResolved);
    expect(decoded.assertedValue).toBe(41250);
    expect(decoded.assertedUnit).toBe("MW");
    expect(decoded.assertedTime).toEqual({
      start: "2026-03-01",
      end: "2026-03-31",
      label: "March 2026"
    });
  });

  it("sourceRef includes segment locator", () => {
    const decoded = Schema.decodeUnknownSync(Candidate)(fullyResolved);
    expect(decoded.sourceRef.segment).toBe("chart-1");
  });

  it("rawDims carries extraction context", () => {
    const decoded = Schema.decodeUnknownSync(Candidate)(fullyResolved);
    expect(decoded.rawDims).toEqual({ region: "ERCOT", fuel: "wind" });
  });
});

// ---------------------------------------------------------------------------
// 7. Observation backed by a real Distribution (from fixture 3)
// ---------------------------------------------------------------------------

describe("Fixture 7: Observation backed by a real Distribution", () => {
  const observation = {
    _tag: "Observation" as const,
    id: ERCOT_OBS_ID,
    seriesId: ERCOT_SER_ID,
    time: { start: "2026-03-01", end: "2026-03-31" },
    value: 12345.67,
    unit: "GWh",
    sourceDistributionId: DIST_CSV_ID,
    qualification: "preliminary"
  };

  const csvDist = {
    _tag: "Distribution" as const,
    id: DIST_CSV_ID,
    datasetId: DS_ID,
    kind: "download" as const,
    title: "CSV bulk download",
    downloadURL: "https://opendata.alberta.ca/electricity.csv",
    mediaType: "text/csv",
    aliases: [],
    createdAt: TS,
    updatedAt: TS
  };

  it("Observation.sourceDistributionId matches Distribution.id", () => {
    const obs = Schema.decodeUnknownSync(Observation)(observation);
    const dist = Schema.decodeUnknownSync(Distribution)(csvDist);
    expect(obs.sourceDistributionId).toBe(dist.id);
  });

  it("Observation decodes with qualification", () => {
    const obs = Schema.decodeUnknownSync(Observation)(observation);
    expect(obs.qualification).toBe("preliminary");
  });

  it("Observation discriminates via DataLayerRecord union", () => {
    const record = Schema.decodeUnknownSync(DataLayerRecord)(observation);
    expect(record._tag).toBe("Observation");
  });
});

// ---------------------------------------------------------------------------
// 8. Agent with multiple alias relation strengths
// ---------------------------------------------------------------------------

describe("Fixture 8: Agent with multiple alias relation strengths", () => {
  const agent = {
    _tag: "Agent" as const,
    id: AGENT_ID,
    kind: "organization" as const,
    name: "Alberta Utilities Commission",
    alternateNames: ["AUC"],
    homepage: "https://www.auc.ab.ca",
    aliases: [
      { scheme: "ror" as const, value: "https://ror.org/04xfq0j82", relation: "exactMatch" as const },
      { scheme: "wikidata" as const, value: "Q4712345", relation: "closeMatch" as const },
      { scheme: "oeo" as const, value: "OEO_00140087", relation: "broadMatch" as const },
      { scheme: "eia-route" as const, value: "state-electricity-profiles/alberta", relation: "methodologyVariant" as const }
    ],
    createdAt: TS,
    updatedAt: TS
  };

  it("decodes with all four relation strengths", () => {
    const decoded = Schema.decodeUnknownSync(Agent)(agent);
    expect(decoded.aliases).toHaveLength(4);
    const relations = decoded.aliases.map((a) => a.relation);
    expect(relations).toContain("exactMatch");
    expect(relations).toContain("closeMatch");
    expect(relations).toContain("broadMatch");
    expect(relations).toContain("methodologyVariant");
  });

  it("each alias has a distinct (scheme, value) pair", () => {
    const decoded = Schema.decodeUnknownSync(Agent)(agent);
    const keys = decoded.aliases.map((a) => `${a.scheme}\0${a.value}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

// ---------------------------------------------------------------------------
// 9. Duplicate (scheme, value) alias must fail decode
// ---------------------------------------------------------------------------

describe("Fixture 9: Duplicate (scheme, value) alias must fail decode", () => {
  it("Agent with two aliases sharing (oeo, OEO_001) but different relations throws", () => {
    const agentWithDuplicateAliases = {
      _tag: "Agent" as const,
      id: AGENT_ID,
      kind: "organization" as const,
      name: "Duplicate Alias Org",
      aliases: [
        { scheme: "oeo" as const, value: "OEO_001", relation: "exactMatch" as const },
        { scheme: "oeo" as const, value: "OEO_001", relation: "broadMatch" as const }
      ],
      createdAt: TS,
      updatedAt: TS
    };
    expect(() => Schema.decodeUnknownSync(Agent)(agentWithDuplicateAliases)).toThrow();
  });

  it("Variable with duplicate (scheme, value) alias throws", () => {
    const variableWithDuplicateAliases = {
      _tag: "Variable" as const,
      id: WIND_VAR_ID,
      label: "Bad variable",
      aliases: [
        { scheme: "oeo" as const, value: "OEO_001", relation: "exactMatch" as const },
        { scheme: "oeo" as const, value: "OEO_001", relation: "methodologyVariant" as const }
      ],
      createdAt: TS,
      updatedAt: TS
    };
    expect(() => Schema.decodeUnknownSync(Variable)(variableWithDuplicateAliases)).toThrow();
  });

  it("Dataset with duplicate (scheme, value) alias throws", () => {
    const datasetWithDuplicateAliases = {
      _tag: "Dataset" as const,
      id: DS_ID,
      title: "Bad dataset",
      aliases: [
        { scheme: "oeo" as const, value: "OEO_001", relation: "exactMatch" as const },
        { scheme: "oeo" as const, value: "OEO_001", relation: "closeMatch" as const }
      ],
      createdAt: TS,
      updatedAt: TS
    };
    expect(() => Schema.decodeUnknownSync(Dataset)(datasetWithDuplicateAliases)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// 10. Annotation presence check
// ---------------------------------------------------------------------------

describe("Fixture 10: Annotation presence check", () => {
  const ann = (schema: { readonly ast: { readonly annotations: object } }) =>
    schema.ast.annotations as Record<symbol, unknown>;

  it("Variable carries SchemaOrgType, SdmxConcept, and DesignDecision", () => {
    expect(ann(Variable)[SchemaOrgType]).toBe("https://schema.org/StatisticalVariable");
    expect(ann(Variable)[SdmxConcept]).toBe("Concept");
    expect(ann(Variable)[DesignDecision]).toBe("D1, D2");
  });

  it("Dataset carries DcatClass, SchemaOrgType, and DesignDecision", () => {
    expect(ann(Dataset)[DcatClass]).toBe("http://www.w3.org/ns/dcat#Dataset");
    expect(ann(Dataset)[SchemaOrgType]).toBe("https://schema.org/Dataset");
    expect(ann(Dataset)[DesignDecision]).toBe("D5");
  });

  it("Agent carries DcatClass and DesignDecision", () => {
    expect(ann(Agent)[DcatClass]).toBe("http://xmlns.com/foaf/0.1/Agent");
    expect(ann(Agent)[DesignDecision]).toBe("D5");
  });

  it("Observation carries SchemaOrgType, SdmxConcept, and DesignDecision", () => {
    expect(ann(Observation)[SchemaOrgType]).toBe("https://schema.org/Observation");
    expect(ann(Observation)[SdmxConcept]).toBe("Observation");
    expect(ann(Observation)[DesignDecision]).toBe("D1, D7");
  });

  it("Series carries SdmxConcept and DesignDecision", () => {
    expect(ann(Series)[SdmxConcept]).toBe("SeriesKey");
    expect(ann(Series)[DesignDecision]).toBe("D1");
  });

  it("Distribution carries DcatClass and SchemaOrgType", () => {
    expect(ann(Distribution)[DcatClass]).toBe("http://www.w3.org/ns/dcat#Distribution");
    expect(ann(Distribution)[SchemaOrgType]).toBe("https://schema.org/DataDownload");
    expect(ann(Distribution)[DesignDecision]).toBe("D5");
  });

  it("Catalog carries DcatClass and DesignDecision", () => {
    expect(ann(Catalog)[DcatClass]).toBe("http://www.w3.org/ns/dcat#Catalog");
    expect(ann(Catalog)[DesignDecision]).toBe("D5");
  });

  it("CatalogRecord carries DcatClass and DesignDecision", () => {
    expect(ann(CatalogRecord)[DcatClass]).toBe("http://www.w3.org/ns/dcat#CatalogRecord");
    expect(ann(CatalogRecord)[DesignDecision]).toBe("D5");
  });

  it("DataService carries DcatClass and DesignDecision", () => {
    expect(ann(DataService)[DcatClass]).toBe("http://www.w3.org/ns/dcat#DataService");
    expect(ann(DataService)[DesignDecision]).toBe("D5");
  });

  it("DatasetSeries carries DcatClass and DesignDecision", () => {
    expect(ann(DatasetSeries)[DcatClass]).toBe("http://www.w3.org/ns/dcat#DatasetSeries");
    expect(ann(DatasetSeries)[DesignDecision]).toBe("D5");
  });
});
