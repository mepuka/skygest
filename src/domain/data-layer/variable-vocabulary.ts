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
  "trade"
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
  "wind turbine"
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
  "wind"
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
  "subsidy"
] as const;
