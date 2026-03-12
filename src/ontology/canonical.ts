export const canonicalTopicOrder = [
  "solar",
  "wind",
  "offshore-wind",
  "geothermal",
  "hydro",
  "biomass",
  "nuclear",
  "hydrogen",
  "natural-gas",
  "coal",
  "oil",
  "energy-storage",
  "distributed-energy",
  "grid-and-infrastructure",
  "electrification",
  "energy-efficiency",
  "data-center-demand",
  "energy-policy",
  "energy-markets",
  "energy-finance",
  "energy-geopolitics",
  "critical-minerals",
  "climate-and-emissions",
  "carbon-capture",
  "carbon-markets",
  "environment-and-land-use",
  "energy-justice",
  "sectoral-decarbonization",
  "workforce-and-manufacturing",
  "research-and-innovation"
] as const;

export type CanonicalTopicSlug = (typeof canonicalTopicOrder)[number];

export type CanonicalTopicDefinition = {
  readonly slug: CanonicalTopicSlug;
  readonly label: string;
  readonly description: string;
  readonly rootConceptSlugs: ReadonlyArray<string>;
  readonly matcherConceptSlugs?: ReadonlyArray<string>;
  readonly termOverrides?: ReadonlyArray<string>;
  readonly hashtags?: ReadonlyArray<string>;
  readonly domains?: ReadonlyArray<string>;
};

export const ambiguityTerms = [
  "battery",
  "bess",
  "coal",
  "der",
  "ev",
  "ferc",
  "gas",
  "grid",
  "h2",
  "ira",
  "lng",
  "oil",
  "ppa",
  "pv",
  "smr",
  "storage"
] as const;

export const matcherSignalExclusionConceptSlugs = new Set<string>([
  "EnergyTopicScheme",
  "Renewable",
  "Fossil",
  "EnergyTradeAndSupplyChains"
]);

export const conceptToCanonicalTopicSlug = {
  AIAndDataCenterDemand: "data-center-demand",
  Affordability: "energy-justice",
  Agrivoltaics: "environment-and-land-use",
  AviationDecarbonization: "sectoral-decarbonization",
  BatteryRecycling: "energy-storage",
  BiomassAndBioenergy: "biomass",
  BuildingElectrification: "electrification",
  BuildingsAndEfficiency: "energy-efficiency",
  COPClimateConference: "climate-and-emissions",
  CarbonCapture: "carbon-capture",
  CarbonMarkets: "carbon-markets",
  ClimateAndEmissions: "climate-and-emissions",
  Coal: "coal",
  Commodity: "energy-markets",
  CommunityEnergy: "energy-justice",
  CorporateDeals: "energy-finance",
  CriticalMinerals: "critical-minerals",
  DataCenterDemand: "data-center-demand",
  Decarbonization: "climate-and-emissions",
  DemandResponse: "distributed-energy",
  DirectAirCapture: "carbon-capture",
  DistributedEnergyAndFlexibility: "distributed-energy",
  Distribution: "grid-and-infrastructure",
  ElectricTransport: "electrification",
  ElectricVehicles: "electrification",
  Electrification: "electrification",
  EmissionsTracking: "climate-and-emissions",
  EnergyAccess: "energy-justice",
  EnergyFinance: "energy-finance",
  EnergyGeopolitics: "energy-geopolitics",
  EnergyJobs: "workforce-and-manufacturing",
  EnergyJustice: "energy-justice",
  EnergyMarkets: "energy-markets",
  EnergyPolicy: "energy-policy",
  EnergySecurityAndResilience: "energy-geopolitics",
  EnergyStorage: "energy-storage",
  EnvironmentAndLandUse: "environment-and-land-use",
  EVCharging: "electrification",
  EfficiencyRecords: "research-and-innovation",
  Energiewende: "energy-policy",
  FuelCell: "hydrogen",
  Fusion: "nuclear",
  Geothermal: "geothermal",
  GreenHydrogen: "hydrogen",
  GridAndInfrastructure: "grid-and-infrastructure",
  GridModernization: "grid-and-infrastructure",
  GridOperator: "grid-and-infrastructure",
  HeatPumps: "electrification",
  Hydro: "hydro",
  Hydrogen: "hydrogen",
  IRAPolicy: "energy-policy",
  IndustrialDecarbonization: "sectoral-decarbonization",
  Interconnection: "grid-and-infrastructure",
  LaborRelations: "workforce-and-manufacturing",
  Legislation: "energy-policy",
  LNGTradeAndInfrastructure: "natural-gas",
  LongDurationStorage: "energy-storage",
  Manufacturing: "workforce-and-manufacturing",
  MaritimeDecarbonization: "sectoral-decarbonization",
  Microgrid: "distributed-energy",
  NaturalGas: "natural-gas",
  NetZero: "climate-and-emissions",
  Nuclear: "nuclear",
  OffshoreWind: "offshore-wind",
  Oil: "oil",
  Patent: "research-and-innovation",
  Perovskite: "research-and-innovation",
  Permitting: "energy-policy",
  PowerPurchaseAgreement: "energy-markets",
  ProjectFinance: "energy-finance",
  PublicFunding: "energy-finance",
  PumpedHydroStorage: "energy-storage",
  Regulation: "energy-policy",
  Renewable: null,
  ResearchAndInnovation: "research-and-innovation",
  Retrofits: "energy-efficiency",
  RooftopSolar: "solar",
  SMR: "nuclear",
  SectoralDecarbonization: "sectoral-decarbonization",
  Solar: "solar",
  SupplyChain: "energy-geopolitics",
  Tariff: "energy-policy",
  TradeAndSanctions: "energy-geopolitics",
  Transmission: "grid-and-infrastructure",
  VirtualPowerPlant: "distributed-energy",
  WasteAndPollution: "environment-and-land-use",
  WaterUse: "environment-and-land-use",
  WholesaleMarkets: "energy-markets",
  Wind: "wind",
  WorkforceAndManufacturing: "workforce-and-manufacturing",
  Fossil: null,
  EnergyTradeAndSupplyChains: null
} as const satisfies Record<string, CanonicalTopicSlug | null>;

export const canonicalTopics = [
  {
    slug: "solar",
    label: "Solar",
    description: "Utility-scale and distributed solar power generation.",
    rootConceptSlugs: ["Solar"],
    matcherConceptSlugs: ["Solar", "RooftopSolar"],
    termOverrides: ["photovoltaic", "pv", "solar energy", "solar farm", "solar panel"],
    hashtags: ["solar", "solarenergy", "solarpower", "rooftopsolar"],
    domains: ["pv-magazine.com"]
  },
  {
    slug: "wind",
    label: "Wind",
    description: "Onshore wind generation and wind-power development.",
    rootConceptSlugs: ["Wind"],
    termOverrides: ["wind energy", "wind power", "wind farm", "wind turbine", "onshore wind"],
    hashtags: ["wind", "windenergy", "windpower", "onshorewind"],
    domains: ["windpowermonthly.com"]
  },
  {
    slug: "offshore-wind",
    label: "Offshore Wind",
    description: "Offshore wind generation, leasing, and supply chains.",
    rootConceptSlugs: ["OffshoreWind"],
    termOverrides: ["offshore wind", "offshore turbine"],
    hashtags: ["offshorewind", "offshore"],
    domains: ["windpowermonthly.com", "rechargenews.com"]
  },
  {
    slug: "geothermal",
    label: "Geothermal",
    description: "Geothermal power generation and geothermal heat systems.",
    rootConceptSlugs: ["Geothermal"],
    hashtags: ["geothermal"],
    domains: ["utilitydive.com"]
  },
  {
    slug: "hydro",
    label: "Hydro",
    description: "Hydropower generation and pumped hydro infrastructure.",
    rootConceptSlugs: ["Hydro"],
    termOverrides: ["hydropower", "hydroelectric"],
    hashtags: [],
    domains: ["powermag.com"]
  },
  {
    slug: "biomass",
    label: "Biomass",
    description: "Biomass and bioenergy production and policy.",
    rootConceptSlugs: ["BiomassAndBioenergy"],
    termOverrides: ["bioenergy", "biomass", "biofuel"],
    hashtags: ["biomass", "bioenergy"],
    domains: []
  },
  {
    slug: "nuclear",
    label: "Nuclear",
    description: "Nuclear generation, reactors, and fusion research.",
    rootConceptSlugs: ["Nuclear"],
    matcherConceptSlugs: ["Nuclear", "Fusion", "SMR"],
    termOverrides: ["nuclear power", "nuclear energy", "small modular reactor"],
    hashtags: ["nuclear", "smr", "fusion", "nuclearenergy", "nuclearpower"],
    domains: []
  },
  {
    slug: "hydrogen",
    label: "Hydrogen",
    description: "Hydrogen production, infrastructure, and fuel-cell deployment.",
    rootConceptSlugs: ["Hydrogen"],
    matcherConceptSlugs: ["Hydrogen", "FuelCell", "GreenHydrogen"],
    termOverrides: ["hydrogen", "green hydrogen", "electrolyzer"],
    hashtags: ["hydrogen", "greenhydrogen"],
    domains: ["rechargenews.com"]
  },
  {
    slug: "natural-gas",
    label: "Natural Gas",
    description: "Natural gas production, LNG, and gas-system development.",
    rootConceptSlugs: ["NaturalGas"],
    matcherConceptSlugs: ["NaturalGas", "LNGTradeAndInfrastructure"],
    termOverrides: ["natural gas", "gas pipeline", "gas prices", "lng", "methane"],
    hashtags: ["naturalgas", "lng", "gas", "methane"],
    domains: ["oilprice.com", "platts.com", "energyintel.com"]
  },
  {
    slug: "coal",
    label: "Coal",
    description: "Coal production and coal-fired generation.",
    rootConceptSlugs: ["Coal"],
    termOverrides: ["coal power", "coal-fired"],
    hashtags: ["coal"],
    domains: ["oilprice.com"]
  },
  {
    slug: "oil",
    label: "Oil",
    description: "Oil markets, production, and petroleum infrastructure.",
    rootConceptSlugs: ["Oil"],
    termOverrides: ["oil prices", "oil market", "crude"],
    hashtags: ["oil", "opec", "oilandgas"],
    domains: ["oilprice.com", "platts.com", "energyintel.com"]
  },
  {
    slug: "energy-storage",
    label: "Energy Storage",
    description: "Battery storage and long-duration storage systems.",
    rootConceptSlugs: ["EnergyStorage"],
    matcherConceptSlugs: ["EnergyStorage", "BatteryRecycling", "LongDurationStorage", "PumpedHydroStorage"],
    termOverrides: ["battery storage", "bess", "long duration storage", "battery recycling", "pumped hydro"],
    hashtags: ["energystorage", "bess", "battery"],
    domains: ["utilitydive.com", "powermag.com"]
  },
  {
    slug: "distributed-energy",
    label: "Distributed Energy",
    description: "DERs, demand response, microgrids, and virtual power plants.",
    rootConceptSlugs: ["DistributedEnergyAndFlexibility"],
    matcherConceptSlugs: ["DistributedEnergyAndFlexibility", "DemandResponse", "Microgrid", "VirtualPowerPlant"],
    termOverrides: ["distributed energy", "demand response", "demand flexibility", "virtual power plant"],
    hashtags: ["microgrid", "der"],
    domains: ["utilitydive.com"]
  },
  {
    slug: "grid-and-infrastructure",
    label: "Grid and Infrastructure",
    description: "Transmission, distribution, interconnection, and grid operations.",
    rootConceptSlugs: ["GridAndInfrastructure"],
    matcherConceptSlugs: ["GridAndInfrastructure", "Distribution", "GridModernization", "GridOperator", "Interconnection", "Transmission"],
    termOverrides: ["power grid", "electric grid", "grid modernization", "transmission planning"],
    hashtags: ["gridmodernization", "powergrid", "electricgrid", "grid", "interconnection", "transmission"],
    domains: ["rtoinsider.com", "utilitydive.com", "powermag.com"]
  },
  {
    slug: "electrification",
    label: "Electrification",
    description: "Transport, building, and end-use electrification.",
    rootConceptSlugs: ["Electrification"],
    matcherConceptSlugs: ["Electrification", "ElectricTransport", "ElectricVehicles", "EVCharging", "HeatPumps", "BuildingElectrification"],
    termOverrides: ["electric vehicle", "ev charging", "heat pump", "building electrification"],
    hashtags: ["ev", "evs", "electricvehicles", "heatpump", "heatpumps", "electrification", "evcharging"],
    domains: ["insideevs.com", "electrek.co"]
  },
  {
    slug: "energy-efficiency",
    label: "Energy Efficiency",
    description: "Efficiency retrofits, demand reduction, and performance gains.",
    rootConceptSlugs: ["BuildingsAndEfficiency"],
    matcherConceptSlugs: ["BuildingsAndEfficiency", "Retrofits", "EfficiencyRecords"],
    termOverrides: ["energy efficiency", "retrofit", "retrofits", "efficiency gains"],
    hashtags: ["energyefficiency"],
    domains: ["nrel.gov"]
  },
  {
    slug: "data-center-demand",
    label: "Data Center Demand",
    description: "Electricity demand from data centers and AI workloads.",
    rootConceptSlugs: ["AIAndDataCenterDemand", "DataCenterDemand"],
    matcherConceptSlugs: ["AIAndDataCenterDemand", "DataCenterDemand"],
    termOverrides: ["data center", "data centre", "ai energy demand", "data center energy", "data center power"],
    hashtags: [],
    domains: []
  },
  {
    slug: "energy-policy",
    label: "Energy Policy",
    description: "Policy, regulation, permitting, and government energy strategy.",
    rootConceptSlugs: ["EnergyPolicy"],
    matcherConceptSlugs: ["EnergyPolicy", "Energiewende", "IRAPolicy", "Legislation", "Permitting", "Regulation", "Tariff"],
    termOverrides: ["energy policy", "inflation reduction act", "regulatory filing"],
    hashtags: ["energypolicy", "ira", "ferc"],
    domains: ["ferc.gov", "energy.gov", "eia.gov"]
  },
  {
    slug: "energy-markets",
    label: "Energy Markets",
    description: "Power, fuel, and wholesale market structure and pricing.",
    rootConceptSlugs: ["EnergyMarkets"],
    matcherConceptSlugs: ["EnergyMarkets", "Commodity", "PowerPurchaseAgreement", "WholesaleMarkets"],
    termOverrides: ["energy market", "power market", "wholesale market", "power purchase agreement", "ppa"],
    hashtags: ["energyfinance"],
    domains: ["platts.com", "bnef.com", "energyintel.com"]
  },
  {
    slug: "energy-finance",
    label: "Energy Finance",
    description: "Project finance, M&A, public funding, and clean-tech capital.",
    rootConceptSlugs: ["EnergyFinance"],
    matcherConceptSlugs: ["EnergyFinance", "CorporateDeals", "ProjectFinance", "PublicFunding"],
    termOverrides: ["project finance", "tax credit transfer", "public funding"],
    hashtags: ["projectfinance", "energyfinance", "cleantech"],
    domains: ["bnef.com", "latitudemedia.com"]
  },
  {
    slug: "energy-geopolitics",
    label: "Energy Geopolitics",
    description: "Energy security, sanctions, trade, and supply-chain strategy.",
    rootConceptSlugs: ["EnergyGeopolitics"],
    matcherConceptSlugs: ["EnergyGeopolitics", "EnergySecurityAndResilience", "SupplyChain", "TradeAndSanctions"],
    termOverrides: ["energy security", "energy resilience", "trade sanctions", "supply chain"],
    hashtags: ["energysecurity"],
    domains: ["energyintel.com", "platts.com"]
  },
  {
    slug: "critical-minerals",
    label: "Critical Minerals",
    description: "Critical-mineral extraction, processing, and market competition.",
    rootConceptSlugs: ["CriticalMinerals"],
    termOverrides: ["critical minerals", "rare earth", "lithium", "cobalt", "silicon"],
    hashtags: ["criticalminerals", "lithium"],
    domains: []
  },
  {
    slug: "climate-and-emissions",
    label: "Climate and Emissions",
    description: "Climate policy outcomes, emissions tracking, and net-zero commitments.",
    rootConceptSlugs: ["ClimateAndEmissions"],
    matcherConceptSlugs: ["ClimateAndEmissions", "COPClimateConference", "Decarbonization", "EmissionsTracking", "NetZero"],
    termOverrides: ["climate change", "greenhouse gas", "ghg", "net zero", "net-zero", "emissions tracking"],
    hashtags: ["netzero", "decarbonization", "climatechange", "carbonemissions", "climate", "emissions", "carbon"],
    domains: ["carbonbrief.org", "insideclimatenews.org", "grist.org"]
  },
  {
    slug: "carbon-capture",
    label: "Carbon Capture",
    description: "Carbon capture, removal, and direct-air-capture systems.",
    rootConceptSlugs: ["CarbonCapture"],
    matcherConceptSlugs: ["CarbonCapture", "DirectAirCapture"],
    termOverrides: ["carbon capture", "ccs", "ccus", "direct air capture", "dac", "carbon removal"],
    hashtags: ["carboncapture", "ccs", "dac"],
    domains: []
  },
  {
    slug: "carbon-markets",
    label: "Carbon Markets",
    description: "Carbon-credit and emissions-trading markets.",
    rootConceptSlugs: ["CarbonMarkets"],
    termOverrides: ["carbon market", "carbon markets", "carbon credits", "emissions trading", "ets", "cap-and-trade"],
    hashtags: ["carbonmarkets"],
    domains: ["carbonbrief.org"]
  },
  {
    slug: "environment-and-land-use",
    label: "Environment and Land Use",
    description: "Land use, environmental review, water, and pollution impacts.",
    rootConceptSlugs: ["EnvironmentAndLandUse"],
    matcherConceptSlugs: ["EnvironmentAndLandUse", "Agrivoltaics", "WasteAndPollution", "WaterUse"],
    termOverrides: ["environmental review", "land use", "water use", "waste and pollution"],
    hashtags: ["agrivoltaics"],
    domains: ["insideclimatenews.org"]
  },
  {
    slug: "energy-justice",
    label: "Energy Justice",
    description: "Affordability, access, community energy, and just-transition concerns.",
    rootConceptSlugs: ["EnergyJustice"],
    matcherConceptSlugs: ["EnergyJustice", "Affordability", "CommunityEnergy", "EnergyAccess"],
    termOverrides: ["energy justice", "energy access", "community energy", "energy poverty", "energy bills", "rate hike"],
    hashtags: ["energyaccess", "energyjustice", "energypoverty"],
    domains: []
  },
  {
    slug: "sectoral-decarbonization",
    label: "Sectoral Decarbonization",
    description: "Industrial, aviation, maritime, and cross-sector decarbonization pathways.",
    rootConceptSlugs: ["SectoralDecarbonization"],
    matcherConceptSlugs: ["SectoralDecarbonization", "AviationDecarbonization", "IndustrialDecarbonization", "MaritimeDecarbonization"],
    termOverrides: ["sectoral decarbonization", "industrial decarbonization", "maritime decarbonization", "aviation decarbonization", "sustainable aviation fuel", "saf"],
    hashtags: [],
    domains: []
  },
  {
    slug: "workforce-and-manufacturing",
    label: "Workforce and Manufacturing",
    description: "Energy jobs, industrial buildout, and manufacturing capacity.",
    rootConceptSlugs: ["WorkforceAndManufacturing"],
    matcherConceptSlugs: ["WorkforceAndManufacturing", "EnergyJobs", "LaborRelations", "Manufacturing"],
    termOverrides: ["energy jobs", "manufacturing", "labor relations", "domestic manufacturing"],
    hashtags: [],
    domains: []
  },
  {
    slug: "research-and-innovation",
    label: "Research and Innovation",
    description: "R&D, patents, and early-stage energy technology breakthroughs.",
    rootConceptSlugs: ["ResearchAndInnovation"],
    matcherConceptSlugs: ["ResearchAndInnovation", "EfficiencyRecords", "Patent", "Perovskite"],
    termOverrides: ["research and innovation", "patent", "perovskite", "energy research", "technology breakthrough"],
    hashtags: ["perovskite"],
    domains: ["nrel.gov", "iea.org", "irena.org"]
  }
] as const satisfies ReadonlyArray<CanonicalTopicDefinition>;

export const legacyTopicCompatibility = {
  solar: ["photovoltaic", "pv", "solar panel", "solar farm"],
  wind: ["wind energy", "wind power", "wind farm", "wind turbine", "offshore wind", "onshore wind"],
  nuclear: ["nuclear energy", "nuclear power", "small modular reactor", "smr", "fusion", "fusion energy"],
  "natural-gas": ["lng", "gas pipeline", "gas price", "methane"],
  "energy-storage": ["battery storage", "bess", "battery", "storage"],
  "grid-and-infrastructure": ["grid", "power grid", "electric grid", "transmission", "distribution", "interconnection", "microgrid", "der"],
  "energy-policy": ["energy policy", "ferc", "nerc", "ira", "inflation reduction act", "permitting", "energy regulation"],
  "energy-markets": ["energy market", "power market", "wholesale electricity", "capacity market", "auction", "ppa", "power purchase agreement"],
  hydrogen: ["green hydrogen", "blue hydrogen", "h2", "electrolyzer", "fuel cell"],
  "carbon-capture": ["carbon capture", "ccs", "ccus", "dac", "direct air capture"],
  "climate-and-emissions": ["climate", "climate change", "emissions", "greenhouse gas", "ghg", "net zero", "net-zero", "decarbonization", "decarbonisation"],
  electrification: ["electric vehicle", "ev", "ev charging", "charging station", "heat pump", "building electrification"],
  "data-center-demand": ["data center", "data centre", "ai energy", "data center power", "data center energy", "energy demand"],
  "critical-minerals": ["critical minerals", "lithium", "cobalt", "rare earth", "silicon"],
  affordability: ["affordability", "energy bills", "utility bills", "rate hike", "energy poverty"]
} as const;
