import { describe, expect, it } from "@effect/vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import aggregationJson from "../references/vocabulary/aggregation.json";
import domainObjectJson from "../references/vocabulary/domain-object.json";
import measuredPropertyJson from "../references/vocabulary/measured-property.json";
import policyInstrumentJson from "../references/vocabulary/policy-instrument.json";
import statisticTypeJson from "../references/vocabulary/statistic-type.json";
import technologyOrFuelJson from "../references/vocabulary/technology-or-fuel.json";
import unitFamilyJson from "../references/vocabulary/unit-family.json";
import {
  AggregationMembers,
  AggregationCanonicals,
  DomainObjectCanonicals,
  FACET_KEYS,
  MeasuredPropertyCanonicals,
  PolicyInstrumentCanonicals,
  REQUIRED_FACET_KEYS,
  StatisticTypeMembers,
  TechnologyOrFuelCanonicals,
  UnitFamilyCanonicals,
  UnitFamilyMembers
} from "../src/domain/generated/energyVariableProfile";

type VocabularyEntry = {
  readonly canonical: string;
};

const uniqueCanonicals = (entries: ReadonlyArray<VocabularyEntry>) =>
  [...new Set(entries.map((entry) => entry.canonical))].sort();

const sorted = (values: ReadonlyArray<string>) => [...values].sort();

const maybeLoadOntologyCanonicals = (
  filename: string
): ReadonlyArray<string> | null => {
  const ontologyVocabularyRoot = path.resolve(
    process.cwd(),
    "../ontology_skill/ontologies/skygest-energy-vocab/data/vocabulary"
  );

  if (!existsSync(ontologyVocabularyRoot)) {
    return null;
  }

  return uniqueCanonicals(
    JSON.parse(
      readFileSync(path.join(ontologyVocabularyRoot, filename), "utf8")
    ) as ReadonlyArray<VocabularyEntry>
  );
};

describe("energy variable profile", () => {
  it("locks the active semantic facets and required pair", () => {
    expect(FACET_KEYS).toEqual([
      "measuredProperty",
      "domainObject",
      "technologyOrFuel",
      "statisticType",
      "aggregation",
      "unitFamily",
      "policyInstrument"
    ]);
    expect(REQUIRED_FACET_KEYS).toEqual([
      "measuredProperty",
      "statisticType"
    ]);
  });

  it("matches the checked-in profile against the vocabulary exports", () => {
    expect(sorted(StatisticTypeMembers)).toEqual(
      uniqueCanonicals(statisticTypeJson as ReadonlyArray<VocabularyEntry>)
    );
    expect(sorted(AggregationMembers)).toEqual(
      uniqueCanonicals(aggregationJson as ReadonlyArray<VocabularyEntry>)
    );
    expect(sorted(UnitFamilyMembers)).toEqual(
      uniqueCanonicals(unitFamilyJson as ReadonlyArray<VocabularyEntry>)
    );
    expect(MeasuredPropertyCanonicals).toEqual(
      uniqueCanonicals(measuredPropertyJson as ReadonlyArray<VocabularyEntry>)
    );
    expect(DomainObjectCanonicals).toEqual(
      uniqueCanonicals(domainObjectJson as ReadonlyArray<VocabularyEntry>)
    );
    expect(TechnologyOrFuelCanonicals).toEqual(
      uniqueCanonicals(technologyOrFuelJson as ReadonlyArray<VocabularyEntry>)
    );
    expect(PolicyInstrumentCanonicals).toEqual(
      uniqueCanonicals(policyInstrumentJson as ReadonlyArray<VocabularyEntry>)
    );
    expect(AggregationCanonicals).toEqual(
      uniqueCanonicals(aggregationJson as ReadonlyArray<VocabularyEntry>)
    );
    expect(UnitFamilyCanonicals).toEqual(
      uniqueCanonicals(unitFamilyJson as ReadonlyArray<VocabularyEntry>)
    );
  });

  it("keeps canonical arrays sorted for stable generation output", () => {
    expect(MeasuredPropertyCanonicals).toEqual(sorted(MeasuredPropertyCanonicals));
    expect(DomainObjectCanonicals).toEqual(sorted(DomainObjectCanonicals));
    expect(TechnologyOrFuelCanonicals).toEqual(
      sorted(TechnologyOrFuelCanonicals)
    );
    expect(PolicyInstrumentCanonicals).toEqual(
      sorted(PolicyInstrumentCanonicals)
    );
    expect(AggregationCanonicals).toEqual(sorted(AggregationCanonicals));
    expect(UnitFamilyCanonicals).toEqual(sorted(UnitFamilyCanonicals));
  });

  it("matches the sibling ontology vocabulary canonicals when that repo is present", () => {
    const ontologyMeasuredProperty = maybeLoadOntologyCanonicals(
      "measured-property.json"
    );
    if (ontologyMeasuredProperty === null) {
      expect(true).toBe(true);
      return;
    }

    expect(ontologyMeasuredProperty).toEqual(MeasuredPropertyCanonicals);
    expect(maybeLoadOntologyCanonicals("domain-object.json")).toEqual(
      DomainObjectCanonicals
    );
    expect(maybeLoadOntologyCanonicals("technology-or-fuel.json")).toEqual(
      TechnologyOrFuelCanonicals
    );
    expect(maybeLoadOntologyCanonicals("statistic-type.json")).toEqual(
      sorted(StatisticTypeMembers)
    );
    expect(maybeLoadOntologyCanonicals("aggregation.json")).toEqual(
      AggregationCanonicals
    );
    expect(maybeLoadOntologyCanonicals("unit-family.json")).toEqual(
      UnitFamilyCanonicals
    );
    expect(maybeLoadOntologyCanonicals("policy-instrument.json")).toEqual(
      PolicyInstrumentCanonicals
    );
  });
});
