/**
 * European energy data sources — RTE ODRÉ + Eurostat deepening
 *
 * Adds key French/European datasets from the ODRÉ DCAT-AP catalog
 * (202 datasets confirmed live via JSON API probe) and additional
 * Eurostat energy datasets.
 *
 * RTE ODRÉ endpoint: https://odre.opendatasoft.com/api/explore/v2.1/catalog/exports/dcat
 * Status: LIVE, returns DCAT-AP RDF/XML, Licence Ouverte v2.0
 *
 * Eurostat DCAT-AP: https://ec.europa.eu/eurostat/api/dissemination/catalogue/dcat/ESTAT/FULL
 * Status: 404 as of 2026-04-09, needs SPARQL or alternative URL — deferred
 *
 * Usage: bun scripts/catalog-harvest/harvest-european.ts
 *
 * SKY-216: Phase 1 — European catalog probe
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ulid } from "ulid";

const ROOT = join(import.meta.dirname, "..", "..", "references", "cold-start");
const DATASETS_DIR = join(ROOT, "catalog", "datasets");
const DISTS_DIR = join(ROOT, "catalog", "distributions");
const RECORDS_DIR = join(ROOT, "catalog", "catalog-records");
const TS = "2026-04-08T00:00:00.000Z";

const entityIds: Record<string, string> = JSON.parse(
  readFileSync(join(ROOT, ".entity-ids.json"), "utf-8"),
);

function mintId(kind: string, prefix: string): string {
  return `https://id.skygest.io/${kind}/${prefix}_${ulid()}`;
}

function agentId(slug: string): string {
  const id = entityIds[`Agent:${slug}`];
  if (!id) throw new Error(`Agent:${slug} not found in entity-ids`);
  return id;
}

function catalogId(slug: string): string {
  const id = entityIds[`Catalog:${slug}`];
  if (!id) throw new Error(`Catalog:${slug} not found in entity-ids`);
  return id;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface DistDef {
  slug: string;
  title: string;
  kind: "download" | "api-access" | "landing-page" | "interactive-web-app" | "documentation" | "other";
  accessURL: string;
  downloadURL?: string;
  format?: string;
  mediaType?: string;
}

interface DatasetDef {
  publisherSlug: string;
  slug: string;
  title: string;
  description: string;
  landingPage?: string;
  keywords: string[];
  themes: string[];
  distributions: DistDef[];
  accessRights?: "public" | "restricted";
  license?: string;
}

// ---------------------------------------------------------------------------
// Curated European datasets
// ---------------------------------------------------------------------------
const DATASETS: DatasetDef[] = [
  // =================================================================
  // RTE ODRÉ datasets (confirmed in DCAT-AP catalog, 202 total)
  // =================================================================
  {
    publisherSlug: "rte",
    slug: "rte-bilan-previsionnel",
    title: "RTE Bilan Prévisionnel (Forecast Report)",
    description: "RTE's annual long-term electricity supply-demand adequacy report for France, including energy balance scenarios, peak demand forecasts, and capacity adequacy assessments.",
    landingPage: "https://www.rte-france.com/analyses-tendances-et-prospectives/bilan-previsionnel-2050",
    keywords: ["forecast", "adequacy", "France", "supply-demand", "scenarios", "RTE"],
    themes: ["electricity", "planning", "scenarios"],
    accessRights: "public",
    license: "https://www.etalab.gouv.fr/wp-content/uploads/2017/04/ETALAB-Licence-Ouverte-v2.0.pdf",
    distributions: [
      { slug: "rte-bilan-web", title: "Bilan Prévisionnel Portal", kind: "interactive-web-app", accessURL: "https://www.rte-france.com/analyses-tendances-et-prospectives/bilan-previsionnel-2050" },
      { slug: "rte-bilan-data", title: "Bilan Prévisionnel Data (ODRÉ)", kind: "download", accessURL: "https://odre.opendatasoft.com/explore/dataset/bilan-previsionnel-electrique-2019/", format: "CSV" },
    ],
  },
  {
    publisherSlug: "rte",
    slug: "rte-production-regionale",
    title: "RTE Production Régionale Mensuelle par Filière",
    description: "Monthly regional electricity production by generation type (nuclear, wind, solar, hydro, gas, etc.) across all French metropolitan regions.",
    landingPage: "https://odre.opendatasoft.com/explore/dataset/production-regionale-mensuelle-filiere/",
    keywords: ["production", "regional", "monthly", "generation mix", "nuclear", "renewables", "France"],
    themes: ["electricity", "grid operations"],
    accessRights: "public",
    license: "https://www.etalab.gouv.fr/wp-content/uploads/2017/04/ETALAB-Licence-Ouverte-v2.0.pdf",
    distributions: [
      { slug: "rte-prod-reg-web", title: "Production Régionale Dashboard", kind: "interactive-web-app", accessURL: "https://odre.opendatasoft.com/explore/dataset/production-regionale-mensuelle-filiere/" },
      { slug: "rte-prod-reg-csv", title: "Production Régionale CSV", kind: "download", accessURL: "https://odre.opendatasoft.com/api/explore/v2.1/catalog/datasets/production-regionale-mensuelle-filiere/exports/csv", format: "CSV", mediaType: "text/csv" },
    ],
  },
  {
    publisherSlug: "rte",
    slug: "rte-registre-installations",
    title: "RTE Registre National des Installations de Production et Stockage",
    description: "National registry of electricity production and storage installations in France, including capacity, technology type, location, and commissioning date.",
    landingPage: "https://odre.opendatasoft.com/explore/dataset/registre-national-installation-production-stockage-electricite-agrege/",
    keywords: ["power plants", "registry", "capacity", "storage", "France", "installations"],
    themes: ["electricity", "infrastructure"],
    accessRights: "public",
    license: "https://www.etalab.gouv.fr/wp-content/uploads/2017/04/ETALAB-Licence-Ouverte-v2.0.pdf",
    distributions: [
      { slug: "rte-registre-web", title: "Installation Registry Dashboard", kind: "interactive-web-app", accessURL: "https://odre.opendatasoft.com/explore/dataset/registre-national-installation-production-stockage-electricite-agrege/" },
      { slug: "rte-registre-csv", title: "Installation Registry CSV", kind: "download", accessURL: "https://odre.opendatasoft.com/api/explore/v2.1/catalog/datasets/registre-national-installation-production-stockage-electricite-agrege/exports/csv", format: "CSV", mediaType: "text/csv" },
    ],
  },
  {
    publisherSlug: "rte",
    slug: "rte-cross-border-exchanges",
    title: "RTE Imports et Exports Commerciaux (Cross-Border Exchanges)",
    description: "Commercial electricity imports and exports at French borders from 2005 to present, by interconnection and direction.",
    landingPage: "https://odre.opendatasoft.com/explore/dataset/imports-exports-commerciaux/",
    keywords: ["cross-border", "imports", "exports", "interconnection", "France", "exchanges"],
    themes: ["electricity", "market data"],
    accessRights: "public",
    license: "https://www.etalab.gouv.fr/wp-content/uploads/2017/04/ETALAB-Licence-Ouverte-v2.0.pdf",
    distributions: [
      { slug: "rte-exchanges-web", title: "Cross-Border Exchanges Dashboard", kind: "interactive-web-app", accessURL: "https://odre.opendatasoft.com/explore/dataset/imports-exports-commerciaux/" },
      { slug: "rte-exchanges-csv", title: "Cross-Border Exchanges CSV", kind: "download", accessURL: "https://odre.opendatasoft.com/api/explore/v2.1/catalog/datasets/imports-exports-commerciaux/exports/csv", format: "CSV", mediaType: "text/csv" },
    ],
  },
  {
    publisherSlug: "rte",
    slug: "rte-ev-charging",
    title: "Bornes de Recharge pour Véhicules Électriques (EV Charging Registry)",
    description: "National registry of public EV charging stations in France, including location, power rating, connector types, and operator.",
    landingPage: "https://odre.opendatasoft.com/explore/dataset/bornes-irve/",
    keywords: ["EV charging", "electric vehicles", "infrastructure", "France", "IRVE"],
    themes: ["transportation", "infrastructure"],
    accessRights: "public",
    license: "https://www.etalab.gouv.fr/wp-content/uploads/2017/04/ETALAB-Licence-Ouverte-v2.0.pdf",
    distributions: [
      { slug: "rte-ev-web", title: "EV Charging Map", kind: "interactive-web-app", accessURL: "https://odre.opendatasoft.com/explore/dataset/bornes-irve/" },
      { slug: "rte-ev-csv", title: "EV Charging Data CSV", kind: "download", accessURL: "https://odre.opendatasoft.com/api/explore/v2.1/catalog/datasets/bornes-irve/exports/csv", format: "CSV", mediaType: "text/csv" },
    ],
  },

  // =================================================================
  // Additional Eurostat energy datasets (manually curated since
  // DCAT-AP endpoint returned 404 — using known dataset IDs)
  // =================================================================
  {
    publisherSlug: "eurostat",
    slug: "eurostat-energy-balances",
    title: "Eurostat Complete Energy Balances",
    description: "Annual and monthly complete energy balances for EU member states: supply, transformation, final consumption by fuel and sector. The definitive EU-wide energy statistics.",
    landingPage: "https://ec.europa.eu/eurostat/databrowser/view/nrg_bal_c/default/table",
    keywords: ["energy balance", "EU", "supply", "consumption", "transformation", "annual"],
    themes: ["energy", "European", "statistics"],
    accessRights: "public",
    distributions: [
      { slug: "eurostat-balances-web", title: "Eurostat Data Browser", kind: "interactive-web-app", accessURL: "https://ec.europa.eu/eurostat/databrowser/view/nrg_bal_c/default/table" },
      { slug: "eurostat-balances-api", title: "Eurostat API (JSON-stat)", kind: "api-access", accessURL: "https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/nrg_bal_c" },
    ],
  },
  {
    publisherSlug: "eurostat",
    slug: "eurostat-electricity-prices",
    title: "Eurostat Electricity Prices for Household and Non-Household Consumers",
    description: "Bi-annual electricity prices across EU member states, including all taxes and levies, network costs, and energy component breakdowns.",
    landingPage: "https://ec.europa.eu/eurostat/databrowser/view/nrg_pc_204/default/table",
    keywords: ["electricity prices", "EU", "households", "industry", "taxes", "levies"],
    themes: ["electricity", "prices", "European"],
    accessRights: "public",
    distributions: [
      { slug: "eurostat-elecprices-web", title: "Eurostat Electricity Prices Browser", kind: "interactive-web-app", accessURL: "https://ec.europa.eu/eurostat/databrowser/view/nrg_pc_204/default/table" },
      { slug: "eurostat-elecprices-api", title: "Eurostat API", kind: "api-access", accessURL: "https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/nrg_pc_204" },
    ],
  },
  {
    publisherSlug: "eurostat",
    slug: "eurostat-renewables-share",
    title: "Eurostat Share of Renewable Energy",
    description: "Annual share of energy from renewable sources across EU member states, including overall, electricity, heating/cooling, and transport sectors.",
    landingPage: "https://ec.europa.eu/eurostat/databrowser/view/nrg_ind_ren/default/table",
    keywords: ["renewables", "share", "EU", "targets", "RED", "directive"],
    themes: ["renewables", "European", "statistics"],
    accessRights: "public",
    distributions: [
      { slug: "eurostat-renewables-web", title: "Eurostat Renewables Browser", kind: "interactive-web-app", accessURL: "https://ec.europa.eu/eurostat/databrowser/view/nrg_ind_ren/default/table" },
      { slug: "eurostat-renewables-api", title: "Eurostat API", kind: "api-access", accessURL: "https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/nrg_ind_ren" },
    ],
  },
  {
    publisherSlug: "eurostat",
    slug: "eurostat-ghg-emissions",
    title: "Eurostat Greenhouse Gas Emissions by Source Sector",
    description: "Annual GHG emissions inventory for EU member states by IPCC source sector, including energy, industrial processes, agriculture, and waste.",
    landingPage: "https://ec.europa.eu/eurostat/databrowser/view/env_air_gge/default/table",
    keywords: ["emissions", "greenhouse gas", "EU", "IPCC", "inventory", "sectoral"],
    themes: ["emissions", "European"],
    accessRights: "public",
    distributions: [
      { slug: "eurostat-ghg-web", title: "Eurostat GHG Browser", kind: "interactive-web-app", accessURL: "https://ec.europa.eu/eurostat/databrowser/view/env_air_gge/default/table" },
      { slug: "eurostat-ghg-api", title: "Eurostat API", kind: "api-access", accessURL: "https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/env_air_gge" },
    ],
  },
];

// ---------------------------------------------------------------------------
// Write entities
// ---------------------------------------------------------------------------
mkdirSync(DATASETS_DIR, { recursive: true });
mkdirSync(DISTS_DIR, { recursive: true });
mkdirSync(RECORDS_DIR, { recursive: true });

let dsCount = 0, distCount = 0, crCount = 0;

for (const ds of DATASETS) {
  if (existsSync(join(DATASETS_DIR, `${ds.slug}.json`))) {
    console.log(`  skip: ${ds.slug} (exists)`);
    continue;
  }

  const datasetId = mintId("dataset", "ds");
  entityIds[`Dataset:${ds.slug}`] = datasetId;

  // Create distributions
  const distIds: string[] = [];

  for (const dist of ds.distributions) {
    const distId = mintId("distribution", "dist");
    entityIds[`Distribution:${dist.slug}`] = distId;
    distIds.push(distId);

    const distEntity: Record<string, any> = {
      _tag: "Distribution",
      id: distId,
      datasetId,
      kind: dist.kind,
      aliases: [],
      createdAt: TS,
      updatedAt: TS,
      title: dist.title,
      accessURL: dist.accessURL,
    };
    if (dist.downloadURL) distEntity.downloadURL = dist.downloadURL;
    if (dist.format) distEntity.format = dist.format;
    if (dist.mediaType) distEntity.mediaType = dist.mediaType;

    writeFileSync(
      join(DISTS_DIR, `${dist.slug}.json`),
      JSON.stringify(distEntity, null, 2) + "\n",
    );
    distCount++;
  }

  // Create dataset
  const datasetEntity: Record<string, any> = {
    _tag: "Dataset",
    id: datasetId,
    title: ds.title,
    publisherAgentId: agentId(ds.publisherSlug),
    aliases: [],
    createdAt: TS,
    updatedAt: TS,
    description: ds.description,
    distributionIds: distIds,
    keywords: ds.keywords,
    themes: ds.themes,
  };
  if (ds.landingPage) datasetEntity.landingPage = ds.landingPage;
  if (ds.accessRights) datasetEntity.accessRights = ds.accessRights;
  if (ds.license) datasetEntity.license = ds.license;

  writeFileSync(
    join(DATASETS_DIR, `${ds.slug}.json`),
    JSON.stringify(datasetEntity, null, 2) + "\n",
  );
  dsCount++;

  // Create catalog record
  const crId = mintId("catalog-record", "cr");
  entityIds[`CatalogRecord:${ds.slug}-cr`] = crId;

  const crEntity: Record<string, any> = {
    _tag: "CatalogRecord",
    id: crId,
    catalogId: catalogId(ds.publisherSlug),
    primaryTopicType: "dataset",
    primaryTopicId: datasetId,
  };
  // Mark ODRÉ-sourced records with provenance
  if (ds.publisherSlug === "rte") {
    crEntity.harvestedFrom = "https://odre.opendatasoft.com/api/explore/v2.1/catalog/exports/dcat";
    crEntity.isAuthoritative = true;
  }

  writeFileSync(
    join(RECORDS_DIR, `${ds.slug}-cr.json`),
    JSON.stringify(crEntity, null, 2) + "\n",
  );
  crCount++;

  console.log(`  ${ds.slug}: dataset + ${ds.distributions.length} dist + CR`);
}

// Save entity IDs
writeFileSync(
  join(ROOT, ".entity-ids.json"),
  JSON.stringify(entityIds, null, 2) + "\n",
);

console.log(`\n=== European Harvest Results ===`);
console.log(`Datasets: ${dsCount}`);
console.log(`Distributions: ${distCount}`);
console.log(`CatalogRecords: ${crCount}`);
console.log(`\nNote: Eurostat DCAT-AP endpoint returned 404 — datasets curated manually.`);
console.log(`RTE ODRÉ endpoint confirmed live (202 datasets). Full SPARQL harvest deferred.`);
