import { describe, expect, it } from "@effect/vitest";
import { Schema } from "effect";
import ligniteProductionJson from "../references/cold-start/variables/lignite-production.json";
import {
  Variable,
  Series,
  Observation,
  SchemaOrgType,
  SdmxConcept,
  DesignDecision
} from "../src/domain/data-layer";

const TS = "2026-04-08T00:00:00.000Z";

const VAR_ID = "https://id.skygest.io/variable/var_01JR8X2K9ABCDEFGH";
const SER_ID = "https://id.skygest.io/series/ser_01JR8X3M2ABCDEFGH";
const OBS_ID = "https://id.skygest.io/observation/obs_01JR8X4N5ABCDEFGH";
const DIST_ID = "https://id.skygest.io/distribution/dist_01JR8X9T2ABCDEFGH";

describe("Variable", () => {
  it("decodes a fully-faceted wind-capacity Variable", () => {
    const input = {
      _tag: "Variable" as const,
      id: VAR_ID,
      label: "Wind installed capacity",
      definition: "Nameplate capacity of grid-connected wind turbines",
      measuredProperty: "capacity",
      domainObject: "wind turbine",
      technologyOrFuel: "wind",
      statisticType: "stock",
      aggregation: "end_of_period",
      unitFamily: "power",
      policyInstrument: "auction",
      aliases: [
        { scheme: "oeo", value: "OEO_00010257", relation: "exactMatch" }
      ],
      createdAt: TS,
      updatedAt: TS
    };
    const decoded = Schema.decodeUnknownSync(Variable)(input);
    expect(decoded._tag).toBe("Variable");
    expect(decoded.label).toBe("Wind installed capacity");
    expect(decoded.statisticType).toBe("stock");
    expect(decoded.aggregation).toBe("end_of_period");
    expect(decoded.unitFamily).toBe("power");
    expect(decoded.technologyOrFuel).toBe("wind");
    expect(decoded.policyInstrument).toBe("auction");
  });

  it("decodes a minimal Variable (only required fields)", () => {
    const input = {
      _tag: "Variable" as const,
      id: VAR_ID,
      label: "Generic variable",
      aliases: [],
      createdAt: TS,
      updatedAt: TS
    };
    const decoded = Schema.decodeUnknownSync(Variable)(input);
    expect(decoded._tag).toBe("Variable");
    expect(decoded.label).toBe("Generic variable");
    expect(decoded.aliases).toEqual([]);
    // optional facets should be absent
    expect("statisticType" in decoded).toBe(false);
    expect("aggregation" in decoded).toBe(false);
    expect("unitFamily" in decoded).toBe(false);
  });

  it("carries ontology annotations on ast", () => {
    const a = Variable.ast.annotations as Record<symbol, unknown>;
    expect(a[SchemaOrgType]).toBe(
      "https://schema.org/StatisticalVariable"
    );
    expect(a[SdmxConcept]).toBe("Concept");
    expect(a[DesignDecision]).toBe("D1, D2");
  });

  it("locks the lignite fixture to the brown-coal supply interpretation", () => {
    const decoded = Schema.decodeUnknownSync(Variable)(ligniteProductionJson);
    expect(decoded.label).toBe("Lignite production");
    expect(decoded.measuredProperty).toBe("supply");
    expect(decoded.technologyOrFuel).toBe("brown coal");
    expect("domainObject" in decoded).toBe(false);
  });
});

describe("Series", () => {
  it("decodes a Series with fixedDims including extra dims", () => {
    const input = {
      _tag: "Series" as const,
      id: SER_ID,
      label: "Alberta wind capacity (monthly)",
      variableId: VAR_ID,
      fixedDims: {
        place: "CA-AB",
        frequency: "monthly",
        extra: { balancingAuthority: "AESO" }
      },
      aliases: [
        { scheme: "eia-series", value: "ELEC.GEN.WND-AB.M", relation: "closeMatch" }
      ],
      createdAt: TS,
      updatedAt: TS
    };
    const decoded = Schema.decodeUnknownSync(Series)(input);
    expect(decoded._tag).toBe("Series");
    expect(decoded.variableId).toBe(VAR_ID);
    expect(decoded.fixedDims.place).toBe("CA-AB");
    expect(decoded.fixedDims.extra).toEqual({ balancingAuthority: "AESO" });
  });

  it("carries SDMX annotation on ast", () => {
    const a = Series.ast.annotations as Record<symbol, unknown>;
    expect(a[SdmxConcept]).toBe("SeriesKey");
    expect(a[DesignDecision]).toBe("D1");
  });
});

describe("Observation", () => {
  it("decodes an Observation with all required fields", () => {
    const input = {
      _tag: "Observation" as const,
      id: OBS_ID,
      seriesId: SER_ID,
      time: { start: "2026-03-01" },
      value: 4321.5,
      unit: "MW",
      sourceDistributionId: DIST_ID
    };
    const decoded = Schema.decodeUnknownSync(Observation)(input);
    expect(decoded._tag).toBe("Observation");
    expect(decoded.value).toBe(4321.5);
    expect(decoded.unit).toBe("MW");
    expect(decoded.seriesId).toBe(SER_ID);
    expect(decoded.sourceDistributionId).toBe(DIST_ID);
    expect("qualification" in decoded).toBe(false);
  });

  it("rejects an Observation missing required field (value)", () => {
    const input = {
      _tag: "Observation" as const,
      id: OBS_ID,
      seriesId: SER_ID,
      time: { start: "2026-03-01" },
      // value is missing
      unit: "MW",
      sourceDistributionId: DIST_ID
    };
    expect(() => Schema.decodeUnknownSync(Observation)(input)).toThrow();
  });

  it("carries ontology annotations on ast", () => {
    const a = Observation.ast.annotations as Record<symbol, unknown>;
    expect(a[SchemaOrgType]).toBe("https://schema.org/Observation");
    expect(a[SdmxConcept]).toBe("Observation");
    expect(a[DesignDecision]).toBe("D1, D7");
  });
});
