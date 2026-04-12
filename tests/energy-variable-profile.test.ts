import { describe, expect, it } from "@effect/vitest";
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
} from "../src/domain/profile/energyVariableProfile";
import * as GeneratedProfile from "../src/domain/generated/energyVariableProfile";

type VocabularyEntry = {
  readonly canonical: string;
};

const uniqueCanonicals = (entries: ReadonlyArray<VocabularyEntry>) =>
  [...new Set(entries.map((entry) => entry.canonical))].sort();

const sorted = (values: ReadonlyArray<string>) => [...values].sort();

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

  it("matches the generated shadow profile", () => {
    expect(GeneratedProfile.FACET_KEYS).toEqual(FACET_KEYS);
    expect(GeneratedProfile.REQUIRED_FACET_KEYS).toEqual(REQUIRED_FACET_KEYS);
    expect(GeneratedProfile.StatisticTypeMembers).toEqual(StatisticTypeMembers);
    expect(GeneratedProfile.AggregationMembers).toEqual(AggregationMembers);
    expect(GeneratedProfile.UnitFamilyMembers).toEqual(UnitFamilyMembers);
    expect(GeneratedProfile.MeasuredPropertyCanonicals).toEqual(
      MeasuredPropertyCanonicals
    );
    expect(GeneratedProfile.DomainObjectCanonicals).toEqual(
      DomainObjectCanonicals
    );
    expect(GeneratedProfile.TechnologyOrFuelCanonicals).toEqual(
      TechnologyOrFuelCanonicals
    );
    expect(GeneratedProfile.PolicyInstrumentCanonicals).toEqual(
      PolicyInstrumentCanonicals
    );
    expect(GeneratedProfile.AggregationCanonicals).toEqual(
      AggregationCanonicals
    );
    expect(GeneratedProfile.UnitFamilyCanonicals).toEqual(
      UnitFamilyCanonicals
    );
  });
});
