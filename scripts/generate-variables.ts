/**
 * Generate Variable JSON files for SKY-215 cold-start.
 * Usage: bun scripts/generate-variables.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ulid } from "ulid";

const ROOT = join(import.meta.dirname, "..", "references", "cold-start", "variables");
const TS = "2026-04-08T00:00:00.000Z";

function mintId(): string {
  return `https://id.skygest.io/variable/var_${ulid()}`;
}

interface VariableDef {
  slug: string;
  label: string;
  definition: string;
  measuredProperty: string;
  domainObject: string;
  technologyOrFuel?: string;
  statisticType: string;
  aggregation?: string;
  basis?: string[];
  unitFamily: string;
  aliases?: Array<{ scheme: string; value: string; relation: string }>;
}

const VARIABLES: VariableDef[] = [
  { slug: "installed-renewable-capacity", label: "Installed renewable capacity", definition: "Nameplate capacity of grid-connected renewable electricity generators", measuredProperty: "capacity", domainObject: "renewable power", statisticType: "stock", aggregation: "end_of_period", unitFamily: "power" },
  { slug: "installed-solar-pv-capacity", label: "Installed solar PV capacity", definition: "Nameplate capacity of grid-connected solar photovoltaic systems", measuredProperty: "capacity", domainObject: "solar photovoltaic", technologyOrFuel: "solar PV", statisticType: "stock", aggregation: "end_of_period", unitFamily: "power", aliases: [{ scheme: "oeo", value: "OEO_00010403", relation: "closeMatch" }] },
  { slug: "installed-wind-capacity", label: "Installed wind capacity", definition: "Nameplate capacity of grid-connected wind turbines", measuredProperty: "capacity", domainObject: "wind turbine", technologyOrFuel: "wind", statisticType: "stock", aggregation: "end_of_period", unitFamily: "power", aliases: [{ scheme: "oeo", value: "OEO_00010257", relation: "closeMatch" }] },
  { slug: "installed-offshore-wind-capacity", label: "Installed offshore wind capacity", definition: "Nameplate capacity of grid-connected offshore wind turbines", measuredProperty: "capacity", domainObject: "offshore wind turbine", technologyOrFuel: "offshore wind", statisticType: "stock", aggregation: "end_of_period", unitFamily: "power" },
  { slug: "installed-battery-storage-capacity", label: "Installed battery storage capacity", definition: "Nameplate power capacity of grid-connected battery energy storage systems", measuredProperty: "capacity", domainObject: "battery storage", technologyOrFuel: "battery", statisticType: "stock", aggregation: "end_of_period", unitFamily: "power" },
  { slug: "battery-discharge", label: "Battery discharge", definition: "Electrical energy discharged from grid-connected battery storage systems", measuredProperty: "generation", domainObject: "battery storage", technologyOrFuel: "battery", statisticType: "flow", aggregation: "sum", unitFamily: "energy" },
  { slug: "installed-nuclear-capacity", label: "Installed nuclear capacity", definition: "Nameplate capacity of operational nuclear reactors", measuredProperty: "capacity", domainObject: "nuclear reactor", technologyOrFuel: "nuclear", statisticType: "stock", aggregation: "end_of_period", unitFamily: "power" },
  { slug: "installed-electrolyzer-capacity", label: "Installed electrolyzer capacity", definition: "Nameplate capacity of operational electrolyzers for hydrogen production", measuredProperty: "capacity", domainObject: "electrolyzer", technologyOrFuel: "hydrogen", statisticType: "stock", aggregation: "end_of_period", unitFamily: "power" },
  { slug: "electricity-generation", label: "Electricity generation", definition: "Total electrical energy produced by all sources", measuredProperty: "generation", domainObject: "electricity", statisticType: "flow", aggregation: "sum", unitFamily: "energy" },
  { slug: "solar-electricity-generation", label: "Solar electricity generation", definition: "Electrical energy produced by solar photovoltaic and concentrated solar power", measuredProperty: "generation", domainObject: "electricity", technologyOrFuel: "solar PV", statisticType: "flow", aggregation: "sum", unitFamily: "energy" },
  { slug: "wind-electricity-generation", label: "Wind electricity generation", definition: "Electrical energy produced by onshore and offshore wind turbines", measuredProperty: "generation", domainObject: "electricity", technologyOrFuel: "wind", statisticType: "flow", aggregation: "sum", unitFamily: "energy" },
  { slug: "coal-electricity-generation", label: "Coal electricity generation", definition: "Electrical energy produced by coal-fired power plants", measuredProperty: "generation", domainObject: "electricity", technologyOrFuel: "coal", statisticType: "flow", aggregation: "sum", unitFamily: "energy" },
  { slug: "clean-electricity-share", label: "Clean electricity share", definition: "Proportion of electricity generation from non-fossil sources", measuredProperty: "share", domainObject: "electricity", statisticType: "share", unitFamily: "dimensionless" },
  { slug: "wholesale-electricity-price", label: "Wholesale electricity price", definition: "Day-ahead or spot market price for bulk electricity", measuredProperty: "price", domainObject: "electricity", statisticType: "price", aggregation: "average", unitFamily: "currency_per_energy" },
  { slug: "battery-pack-price", label: "Battery pack price", definition: "Volume-weighted average price of lithium-ion battery packs", measuredProperty: "price", domainObject: "lithium-ion battery pack", technologyOrFuel: "battery", statisticType: "price", aggregation: "average", unitFamily: "currency_per_energy" },
  { slug: "offshore-wind-capital-cost", label: "Offshore wind capital cost", definition: "Capital expenditure per unit capacity for offshore wind farms", measuredProperty: "price", domainObject: "offshore wind farm", technologyOrFuel: "offshore wind", statisticType: "price", unitFamily: "currency" },
  { slug: "co2-emissions-from-energy", label: "CO2 emissions from energy", definition: "Carbon dioxide emissions from combustion of fossil fuels for energy", measuredProperty: "emissions", domainObject: "energy consumption", statisticType: "flow", aggregation: "sum", unitFamily: "mass_co2e" },
  { slug: "energy-transition-investment", label: "Energy transition investment", definition: "Total capital invested in energy transition sectors including renewables, storage, EVs, and hydrogen", measuredProperty: "investment", domainObject: "energy transition", statisticType: "flow", aggregation: "sum", unitFamily: "currency" },
  { slug: "clean-energy-investment", label: "Clean energy investment", definition: "Capital invested in clean energy supply including renewables, nuclear, and grids", measuredProperty: "investment", domainObject: "clean energy", statisticType: "flow", aggregation: "sum", unitFamily: "currency" },
  { slug: "data-center-power-demand", label: "Data center power demand", definition: "Peak or average electrical power consumed by data center facilities", measuredProperty: "demand", domainObject: "data center", statisticType: "stock", unitFamily: "power" },
  { slug: "electricity-demand", label: "Electricity demand", definition: "Total electrical energy consumed by end users", measuredProperty: "demand", domainObject: "electricity", statisticType: "flow", aggregation: "sum", unitFamily: "energy" },
  { slug: "interconnection-queue-backlog", label: "Interconnection queue backlog", definition: "Total nameplate capacity of generation projects awaiting grid interconnection", measuredProperty: "capacity", domainObject: "interconnection queue", statisticType: "stock", aggregation: "end_of_period", unitFamily: "power" },
  { slug: "heat-pump-installations", label: "Heat pump installations", definition: "Cumulative or annual number of heat pump units installed", measuredProperty: "count", domainObject: "heat pump", technologyOrFuel: "heat pump", statisticType: "stock", unitFamily: "dimensionless" },
];

mkdirSync(ROOT, { recursive: true });

const idMap: Record<string, string> = {};

for (const v of VARIABLES) {
  const id = mintId();
  idMap[v.slug] = id;

  const entity: Record<string, any> = {
    _tag: "Variable",
    id,
    label: v.label,
    definition: v.definition,
    measuredProperty: v.measuredProperty,
    domainObject: v.domainObject,
    statisticType: v.statisticType,
    unitFamily: v.unitFamily,
    aliases: v.aliases || [],
    createdAt: TS,
    updatedAt: TS,
  };
  if (v.technologyOrFuel) entity.technologyOrFuel = v.technologyOrFuel;
  if (v.aggregation) entity.aggregation = v.aggregation;
  if (v.basis) entity.basis = v.basis;

  writeFileSync(join(ROOT, `${v.slug}.json`), JSON.stringify(entity, null, 2) + "\n");
}

// Write ID map for Series generation to reference
writeFileSync(
  join(ROOT, ".variable-ids.json"),
  JSON.stringify(idMap, null, 2) + "\n"
);

console.log(`Generated ${VARIABLES.length} Variable records`);
console.log("ID map written to references/cold-start/variables/.variable-ids.json");
