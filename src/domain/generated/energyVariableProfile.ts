/**
 * AUTO-GENERATED. DO NOT EDIT.
 *
 * Source manifest: references/energy-profile/shacl-manifest.json
 * Manifest version: 1
 * Source commit: 82a18c7acd52b6b84aa2a69d8b99a084c4573259
 * Input hash: sha256:e307f251e0b40b04ff658af6e41b2b5303740307ed2ca83925c76d5e49e82016
 * Generation command: bun run gen:energy-profile
 */

export const FACET_KEYS = [
  "measuredProperty",
  "domainObject",
  "technologyOrFuel",
  "statisticType",
  "aggregation",
  "unitFamily",
  "policyInstrument",
] as const;

export const REQUIRED_FACET_KEYS = [
  "measuredProperty",
  "statisticType",
] as const;

export const StatisticTypeMembers = [
  "stock",
  "flow",
  "price",
  "share",
  "count",
] as const;

export const AggregationMembers = [
  "point",
  "end_of_period",
  "sum",
  "average",
  "max",
  "min",
  "settlement",
] as const;

export const UnitFamilyMembers = [
  "power",
  "energy",
  "currency",
  "currency_per_energy",
  "mass_co2e",
  "intensity",
  "dimensionless",
  "other",
] as const;

export const MeasuredPropertyCanonicals = [
  "capacity",
  "capacity factor",
  "consumption",
  "count",
  "curtailment",
  "decommissioning",
  "demand",
  "deployment",
  "discharge",
  "efficiency",
  "emissions",
  "generation",
  "investment",
  "price",
  "revenue",
  "share",
  "supply",
  "trade",
] as const;

export const DomainObjectCanonicals = [
  "EV charging",
  "battery storage",
  "buildings",
  "carbon market",
  "clean energy",
  "data center",
  "decarbonization",
  "electricity",
  "electrolyzer",
  "energy access",
  "energy consumption",
  "energy poverty",
  "energy transition",
  "grid",
  "grid reliability",
  "heat",
  "heat pump",
  "hydrogen",
  "industry",
  "interconnection queue",
  "lithium-ion battery pack",
  "natural gas",
  "nuclear reactor",
  "offshore wind farm",
  "offshore wind turbine",
  "oil",
  "renewable power",
  "solar photovoltaic",
  "transport",
  "virtual power plant",
  "wholesale market",
  "wind turbine",
] as const;

export const TechnologyOrFuelCanonicals = [
  "battery",
  "biomass",
  "brown coal",
  "carbon capture",
  "coal",
  "combined heat and power",
  "diesel",
  "fossil fuel",
  "fuel cell",
  "gas CCGT",
  "geothermal",
  "heat pump",
  "hydro",
  "hydrogen",
  "marine",
  "methane",
  "natural gas",
  "nuclear",
  "offshore wind",
  "oil",
  "onshore wind",
  "pumped hydro",
  "renewable",
  "solar PV",
  "solar thermal",
  "synthetic fuel",
  "waste",
  "wind",
] as const;

export const PolicyInstrumentCanonicals = [
  "auction",
  "capacity market",
  "carbon credit",
  "carbon tax",
  "emissions trading",
  "feed-in tariff",
  "net metering",
  "power purchase agreement",
  "renewable portfolio standard",
  "subsidy",
] as const;

export const AggregationCanonicals = [
  "average",
  "end_of_period",
  "max",
  "min",
  "point",
  "settlement",
  "sum",
] as const;

export const UnitFamilyCanonicals = [
  "currency",
  "currency_per_energy",
  "dimensionless",
  "energy",
  "intensity",
  "mass_co2e",
  "other",
  "power",
] as const;

