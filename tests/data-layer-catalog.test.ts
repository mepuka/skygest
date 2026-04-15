import { describe, expect, it } from "@effect/vitest";
import { Schema } from "effect";
import {
  Agent,
  Catalog,
  CatalogRecord,
  Dataset,
  Distribution,
  DataService,
  DatasetSeries,
  DcatClass,
  DcatProperty,
  DesignDecision,
  SchemaOrgType
} from "../src/domain/data-layer";

const TS = "2026-04-08T00:00:00.000Z";

const AGENT_ID = "https://id.skygest.io/agent/ag_01JR8X5P8ABCDEFGH";
const CATALOG_ID = "https://id.skygest.io/catalog/cat_01JR8X6Q3ABCDEFGH";
const CR_ID = "https://id.skygest.io/catalog-record/cr_01JR8X7R6ABCDEFGH";
const DS_ID = "https://id.skygest.io/dataset/ds_01JR8X8S9ABCDEFGH";
const DIST_ID = "https://id.skygest.io/distribution/dist_01JR8X9T2CSVTEST01";
const SVC_ID = "https://id.skygest.io/data-service/svc_01JR8XAU5ABCDEFGH";
const DSER_ID = "https://id.skygest.io/dataset-series/dser_01JR8XBV8ABCDEFGH";
const DIST_ID_2 = "https://id.skygest.io/distribution/dist_01JR8X9T2CSVTEST02";

describe("Agent", () => {
  it("decodes with _tag and aliases", () => {
    const input = {
      _tag: "Agent" as const,
      id: AGENT_ID,
      kind: "organization",
      name: "Canada Energy Regulator",
      alternateNames: ["CER", "NEB"],
      aliases: [
        { scheme: "ror", value: "https://ror.org/01234", relation: "exactMatch" },
        { scheme: "wikidata", value: "Q12345", relation: "exactMatch" }
      ],
      createdAt: TS,
      updatedAt: TS
    };
    const decoded = Schema.decodeUnknownSync(Agent)(input);
    expect(decoded._tag).toBe("Agent");
    expect(decoded.kind).toBe("organization");
    expect(decoded.aliases).toHaveLength(2);
    expect(decoded.alternateNames).toEqual(["CER", "NEB"]);
  });

  it("carries DCAT annotation", () => {
    const a = Agent.ast.annotations as Record<symbol, unknown>;
    expect(a[DcatClass]).toBe("http://xmlns.com/foaf/0.1/Agent");
    expect(a[DesignDecision]).toBe("D5");
  });

  it("rejects Agent with invalid kind", () => {
    const input = {
      _tag: "Agent" as const,
      id: AGENT_ID,
      kind: "robot",
      name: "Bad Agent",
      aliases: [],
      createdAt: TS,
      updatedAt: TS
    };
    expect(() => Schema.decodeUnknownSync(Agent)(input)).toThrow();
  });
});

describe("Dataset", () => {
  it("decodes with distribution refs", () => {
    const input = {
      _tag: "Dataset" as const,
      id: DS_ID,
      title: "Alberta Electricity Generation",
      publisherAgentId: AGENT_ID,
      accessRights: "public",
      keywords: ["electricity", "alberta"],
      distributionIds: [DIST_ID, DIST_ID_2],
      aliases: [
        { scheme: "doi", value: "10.1234/test", relation: "exactMatch" }
      ],
      createdAt: TS,
      updatedAt: TS
    };
    const decoded = Schema.decodeUnknownSync(Dataset)(input);
    expect(decoded._tag).toBe("Dataset");
    expect(decoded.distributionIds).toHaveLength(2);
    expect(decoded.keywords).toEqual(["electricity", "alberta"]);
  });

  it("carries DCAT annotation", () => {
    const a = Dataset.ast.annotations as Record<symbol, unknown>;
    expect(a[DcatClass]).toBe("http://www.w3.org/ns/dcat#Dataset");
    expect(a[SchemaOrgType]).toBe("https://schema.org/Dataset");
    expect(a[DesignDecision]).toBe("D5");
  });
});

describe("Distribution", () => {
  it("decodes a download distribution", () => {
    const input = {
      _tag: "Distribution" as const,
      id: DIST_ID,
      datasetId: DS_ID,
      kind: "download",
      title: "CSV export",
      downloadURL: "https://example.com/data.csv",
      mediaType: "text/csv",
      byteSize: 102400,
      aliases: [],
      createdAt: TS,
      updatedAt: TS
    };
    const decoded = Schema.decodeUnknownSync(Distribution)(input);
    expect(decoded._tag).toBe("Distribution");
    expect(decoded.kind).toBe("download");
    expect(decoded.mediaType).toBe("text/csv");
    expect(decoded.byteSize).toBe(102400);
  });
});

describe("CatalogRecord", () => {
  it("decodes with no aliases and no timestamps, has firstSeen", () => {
    const input = {
      _tag: "CatalogRecord" as const,
      id: CR_ID,
      catalogId: CATALOG_ID,
      primaryTopicType: "dataset",
      primaryTopicId: DS_ID,
      firstSeen: "2026-04-01T12:00:00.000Z",
      lastSeen: "2026-04-08T00:00:00.000Z",
      isAuthoritative: true
    };
    const decoded = Schema.decodeUnknownSync(CatalogRecord)(input);
    expect(decoded._tag).toBe("CatalogRecord");
    expect(decoded.firstSeen).toBe("2026-04-01T12:00:00.000Z");
    // No aliases field
    expect("aliases" in decoded).toBe(false);
    // No createdAt/updatedAt
    expect("createdAt" in decoded).toBe(false);
    expect("updatedAt" in decoded).toBe(false);
  });

  it("rejects mismatched primaryTopicType and primaryTopicId", () => {
    const input = {
      _tag: "CatalogRecord" as const,
      id: CR_ID,
      catalogId: CATALOG_ID,
      primaryTopicType: "dataset",
      primaryTopicId: SVC_ID // DataServiceId, but says "dataset"
    };
    expect(() => Schema.decodeUnknownSync(CatalogRecord)(input)).toThrow();
  });

  it("accepts dataService topic type with DataServiceId", () => {
    const input = {
      _tag: "CatalogRecord" as const,
      id: CR_ID,
      catalogId: CATALOG_ID,
      primaryTopicType: "dataService",
      primaryTopicId: SVC_ID
    };
    expect(Schema.decodeUnknownSync(CatalogRecord)(input).primaryTopicType).toBe("dataService");
  });

  it("annotates foaf:primaryTopic on primaryTopicId, not primaryTopicType", () => {
    // Regression lock: the DcatProperty annotation must live on the IRI-valued
    // field (primaryTopicId), not on the string discriminant (primaryTopicType).
    // Otherwise any RDF emitter reading DcatProperty annotations would push the
    // literal string "dataset" as the predicate value instead of the target IRI.
    const ast = CatalogRecord.ast;
    if (ast._tag !== "Objects") {
      throw new Error(`expected Objects, got ${ast._tag}`);
    }
    const byName = new Map(
      ast.propertySignatures.map((p) => [String(p.name), p])
    );
    const topicIdSig = byName.get("primaryTopicId");
    const topicTypeSig = byName.get("primaryTopicType");
    if (!topicIdSig || !topicTypeSig) {
      throw new Error("primaryTopicId or primaryTopicType missing from CatalogRecord AST");
    }

    const idAnnotations = topicIdSig.type.annotations as
      | Record<symbol, unknown>
      | undefined;
    const typeAnnotations = topicTypeSig.type.annotations as
      | Record<symbol, unknown>
      | undefined;

    expect(idAnnotations?.[DcatProperty]).toBe("http://xmlns.com/foaf/0.1/primaryTopic");
    expect(typeAnnotations?.[DcatProperty]).toBeUndefined();
  });
});

describe("Catalog", () => {
  it("decodes a catalog", () => {
    const input = {
      _tag: "Catalog" as const,
      id: CATALOG_ID,
      title: "CER Open Data Catalog",
      publisherAgentId: AGENT_ID,
      homepage: "https://open.canada.ca/data/en",
      aliases: [],
      createdAt: TS,
      updatedAt: TS
    };
    const decoded = Schema.decodeUnknownSync(Catalog)(input);
    expect(decoded._tag).toBe("Catalog");
    expect(decoded.title).toBe("CER Open Data Catalog");
  });
});

describe("DataService", () => {
  it("decodes a data service", () => {
    const input = {
      _tag: "DataService" as const,
      id: SVC_ID,
      title: "CER CKAN API",
      endpointURLs: ["https://open.canada.ca/data/api/3"],
      servesDatasetIds: [DS_ID],
      aliases: [],
      createdAt: TS,
      updatedAt: TS
    };
    const decoded = Schema.decodeUnknownSync(DataService)(input);
    expect(decoded._tag).toBe("DataService");
    expect(decoded.endpointURLs).toHaveLength(1);
    expect(decoded.servesDatasetIds).toHaveLength(1);
  });
});

describe("DatasetSeries", () => {
  it("decodes a dataset series", () => {
    const input = {
      _tag: "DatasetSeries" as const,
      id: DSER_ID,
      title: "Monthly Electricity Generation",
      cadence: "monthly",
      aliases: [],
      createdAt: TS,
      updatedAt: TS
    };
    const decoded = Schema.decodeUnknownSync(DatasetSeries)(input);
    expect(decoded._tag).toBe("DatasetSeries");
    expect(decoded.cadence).toBe("monthly");
  });
});
