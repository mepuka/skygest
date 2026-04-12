/**
 * Hand-maintained runtime variable profile for the resolution kernel and data layer.
 *
 * This file is intentionally explicit, not generated in-repo yet. It centralizes the
 * facet contract that must stay aligned with the ontology's EnergyVariable structure,
 * the EnergyVariable SHACL shape, and the checked-in vocabulary JSON files.
 */
import aggregationJson from "../../../references/vocabulary/aggregation.json";
import domainObjectJson from "../../../references/vocabulary/domain-object.json";
import measuredPropertyJson from "../../../references/vocabulary/measured-property.json";
import policyInstrumentJson from "../../../references/vocabulary/policy-instrument.json";
import technologyOrFuelJson from "../../../references/vocabulary/technology-or-fuel.json";
import unitFamilyJson from "../../../references/vocabulary/unit-family.json";

type VocabularyEntry = {
  readonly canonical: string;
};

const uniqueCanonicals = (entries: ReadonlyArray<VocabularyEntry>) =>
  [...new Set(entries.map((entry) => entry.canonical))].sort();

export const FACET_KEYS = [
  "measuredProperty",
  "domainObject",
  "technologyOrFuel",
  "statisticType",
  "aggregation",
  "unitFamily",
  "policyInstrument"
] as const;

export const REQUIRED_FACET_KEYS = [
  "measuredProperty",
  "statisticType"
] as const;

export const StatisticTypeMembers = [
  "stock",
  "flow",
  "price",
  "share",
  "count"
] as const;

export const AggregationMembers = [
  "point",
  "end_of_period",
  "sum",
  "average",
  "max",
  "min",
  "settlement"
] as const;

export const UnitFamilyMembers = [
  "power",
  "energy",
  "currency",
  "currency_per_energy",
  "mass_co2e",
  "intensity",
  "dimensionless",
  "other"
] as const;

export const MeasuredPropertyCanonicals = uniqueCanonicals(
  measuredPropertyJson as ReadonlyArray<VocabularyEntry>
);

export const DomainObjectCanonicals = uniqueCanonicals(
  domainObjectJson as ReadonlyArray<VocabularyEntry>
);

export const TechnologyOrFuelCanonicals = uniqueCanonicals(
  technologyOrFuelJson as ReadonlyArray<VocabularyEntry>
);

export const PolicyInstrumentCanonicals = uniqueCanonicals(
  policyInstrumentJson as ReadonlyArray<VocabularyEntry>
);

export const AggregationCanonicals = uniqueCanonicals(
  aggregationJson as ReadonlyArray<VocabularyEntry>
);

export const UnitFamilyCanonicals = uniqueCanonicals(
  unitFamilyJson as ReadonlyArray<VocabularyEntry>
);
