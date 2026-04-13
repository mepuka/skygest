/**
 * Static dataset manifest for ENTSO-E Transparency Platform.
 *
 * ENTSO-E has no catalog/discovery endpoint. Dataset types are defined by
 * EU Regulation 543/2013 and are stable. Each entry maps a documentType
 * (and optional processType) code pair to a human-readable dataset
 * description used during DCAT graph construction.
 */

// ---------------------------------------------------------------------------
// Category type
// ---------------------------------------------------------------------------

export type EntsoeCategory =
  | "load"
  | "generation"
  | "transmission"
  | "balancing"
  | "outages"
  | "market";

// ---------------------------------------------------------------------------
// Manifest entry
// ---------------------------------------------------------------------------

export interface EntsoeManifestEntry {
  /** ENTSO-E document type code (e.g. A65, A68). */
  readonly documentType: string;
  /** ENTSO-E process type code, if applicable (e.g. A01 = day-ahead). */
  readonly processType?: string | undefined;
  /** Human-readable dataset title. */
  readonly title: string;
  /** Brief description. */
  readonly description: string;
  /** Thematic category. */
  readonly category: EntsoeCategory;
  /** EU 543/2013 regulation article reference. */
  readonly regulationArticle: string;
}

export interface EntsoeDatasetSeriesSpec {
  readonly documentType: string;
  readonly title: string;
  readonly description: string;
}

// ---------------------------------------------------------------------------
// Merge key helper
// ---------------------------------------------------------------------------

/**
 * Build the alias value used as merge key for a manifest entry.
 * Format: `{documentType}:{processType}` or just `{documentType}`.
 */
export const manifestMergeKey = (entry: EntsoeManifestEntry): string =>
  entry.processType !== undefined
    ? `${entry.documentType}:${entry.processType}`
    : entry.documentType;

// ---------------------------------------------------------------------------
// Slug helpers
// ---------------------------------------------------------------------------

export const entsoeDatasetSlug = (entry: EntsoeManifestEntry): string => {
  const base = `entsoe-${entry.documentType.toLowerCase()}`;
  return entry.processType !== undefined
    ? `${base}-${entry.processType.toLowerCase()}`
    : base;
};

export const entsoeDistributionSlug = (entry: EntsoeManifestEntry): string =>
  `${entsoeDatasetSlug(entry)}-api`;

export const entsoeCatalogRecordSlug = (entry: EntsoeManifestEntry): string =>
  `${entsoeDatasetSlug(entry)}-cr`;

export const entsoeDatasetSeriesSlug = (documentType: string): string =>
  `entsoe-${documentType.toLowerCase()}-series`;

const ENTSOE_DATASET_SERIES_SPECS: ReadonlyArray<EntsoeDatasetSeriesSpec> = [
  {
    documentType: "A09",
    title: "ENTSO-E Scheduled Exchanges",
    description:
      "Day-ahead and realised scheduled exchange datasets on the ENTSO-E Transparency Platform."
  },
  {
    documentType: "A61",
    title: "ENTSO-E Net Transfer Capacity",
    description:
      "Day-ahead, week-ahead, month-ahead, and year-ahead net transfer capacity datasets on the ENTSO-E Transparency Platform."
  },
  {
    documentType: "A65",
    title: "ENTSO-E Total Load",
    description:
      "Actual and forecast total load datasets on the ENTSO-E Transparency Platform."
  },
  {
    documentType: "A69",
    title: "ENTSO-E Wind and Solar Forecast",
    description:
      "Day-ahead and intraday wind and solar forecast datasets on the ENTSO-E Transparency Platform."
  }
];

export const entsoeDatasetSeriesSpecFor = (
  documentType: string
): EntsoeDatasetSeriesSpec | undefined =>
  ENTSOE_DATASET_SERIES_SPECS.find((spec) => spec.documentType === documentType);

// ---------------------------------------------------------------------------
// Static manifest (~30 core datasets)
// ---------------------------------------------------------------------------

export const ENTSOE_MANIFEST: ReadonlyArray<EntsoeManifestEntry> = [
  // ── Load (Art. 6-7) ─────────────────────────────────────────────────
  {
    documentType: "A65",
    processType: "A16",
    title: "Actual Total Load",
    description:
      "Total electricity load actually measured on the transmission grid, per bidding zone.",
    category: "load",
    regulationArticle: "Art. 6.1(a)"
  },
  {
    documentType: "A65",
    processType: "A01",
    title: "Day-Ahead Total Load Forecast",
    description:
      "Day-ahead forecast of total electricity load per bidding zone.",
    category: "load",
    regulationArticle: "Art. 6.1(b)"
  },
  {
    documentType: "A65",
    processType: "A31",
    title: "Week-Ahead Total Load Forecast",
    description:
      "Week-ahead forecast of total electricity load per bidding zone.",
    category: "load",
    regulationArticle: "Art. 6.1(c)"
  },
  {
    documentType: "A70",
    title: "Load Forecast Margin",
    description:
      "Year-ahead forecast margin (difference between expected available generation capacity and forecasted peak demand).",
    category: "load",
    regulationArticle: "Art. 7.1"
  },

  // ── Generation (Art. 14-16) ─────────────────────────────────────────
  {
    documentType: "A68",
    title: "Installed Generation Capacity per Type",
    description:
      "Aggregated installed net generation capacity per production type in each bidding zone.",
    category: "generation",
    regulationArticle: "Art. 14.1(a)"
  },
  {
    documentType: "A69",
    processType: "A01",
    title: "Day-Ahead Wind and Solar Forecast",
    description:
      "Day-ahead forecasts for aggregated wind and solar power generation per bidding zone.",
    category: "generation",
    regulationArticle: "Art. 14.1(b)"
  },
  {
    documentType: "A69",
    processType: "A18",
    title: "Intraday Wind and Solar Forecast",
    description:
      "Current-day (intraday) forecasts for aggregated wind and solar power generation per bidding zone.",
    category: "generation",
    regulationArticle: "Art. 14.1(c)"
  },
  {
    documentType: "A71",
    processType: "A01",
    title: "Day-Ahead Generation Forecast",
    description:
      "Day-ahead scheduled generation per production type in each bidding zone.",
    category: "generation",
    regulationArticle: "Art. 14.1(d)"
  },
  {
    documentType: "A73",
    title: "Actual Generation Output per Generation Unit",
    description:
      "Actual power output per generation unit (>= 100 MW) reported in near real-time.",
    category: "generation",
    regulationArticle: "Art. 16.1(a)"
  },
  {
    documentType: "A74",
    title: "Actual Wind and Solar Generation",
    description:
      "Aggregated actual generation from wind and solar sources per bidding zone.",
    category: "generation",
    regulationArticle: "Art. 16.1(b)"
  },
  {
    documentType: "A75",
    title: "Actual Generation per Type",
    description:
      "Aggregated actual generation per production type in each bidding zone.",
    category: "generation",
    regulationArticle: "Art. 16.1(b)"
  },
  {
    documentType: "A72",
    title: "Reservoir Filling Information",
    description:
      "Weekly water reservoir filling level as share of usable capacity in each bidding zone.",
    category: "generation",
    regulationArticle: "Art. 16.1(c)"
  },

  // ── Transmission (Art. 9-12) ────────────────────────────────────────
  {
    documentType: "A11",
    processType: "A16",
    title: "Physical Cross-Border Flows (Realised)",
    description:
      "Measured physical electricity flows on cross-border interconnectors.",
    category: "transmission",
    regulationArticle: "Art. 12.1(a)"
  },
  {
    documentType: "A61",
    processType: "A01",
    title: "Day-Ahead Net Transfer Capacity",
    description:
      "Day-ahead net transfer capacity on cross-border interconnectors.",
    category: "transmission",
    regulationArticle: "Art. 11.1(a)"
  },
  {
    documentType: "A61",
    processType: "A31",
    title: "Week-Ahead Net Transfer Capacity",
    description:
      "Week-ahead net transfer capacity on cross-border interconnectors.",
    category: "transmission",
    regulationArticle: "Art. 11.1(a)"
  },
  {
    documentType: "A61",
    processType: "A32",
    title: "Month-Ahead Net Transfer Capacity",
    description:
      "Month-ahead net transfer capacity on cross-border interconnectors.",
    category: "transmission",
    regulationArticle: "Art. 11.1(a)"
  },
  {
    documentType: "A61",
    processType: "A33",
    title: "Year-Ahead Net Transfer Capacity",
    description:
      "Year-ahead net transfer capacity on cross-border interconnectors.",
    category: "transmission",
    regulationArticle: "Art. 11.1(a)"
  },
  {
    documentType: "A25",
    processType: "A01",
    title: "Day-Ahead Capacity Allocation Results",
    description:
      "Results of day-ahead cross-border capacity allocation (explicit auctions).",
    category: "transmission",
    regulationArticle: "Art. 11.1(b)"
  },
  {
    documentType: "A26",
    title: "Offered Capacity",
    description:
      "Capacity offered for explicit cross-border allocation (auction or continuous).",
    category: "transmission",
    regulationArticle: "Art. 11.1(b)"
  },
  {
    documentType: "A09",
    processType: "A01",
    title: "Day-Ahead Scheduled Exchanges",
    description:
      "Day-ahead commercial schedules for cross-border exchanges between bidding zones.",
    category: "transmission",
    regulationArticle: "Art. 12.1(b)"
  },
  {
    documentType: "A09",
    processType: "A16",
    title: "Realised Scheduled Exchanges",
    description:
      "Realised (final) commercial schedules for cross-border exchanges.",
    category: "transmission",
    regulationArticle: "Art. 12.1(c)"
  },

  // ── Balancing (Art. 17) ─────────────────────────────────────────────
  {
    documentType: "A81",
    title: "Contracted Reserves",
    description:
      "Volume and price of contracted balancing reserves (FCR, aFRR, mFRR) per control area.",
    category: "balancing",
    regulationArticle: "Art. 17.1(a)"
  },
  {
    documentType: "A82",
    title: "Accepted Offers (Balancing)",
    description:
      "Accepted offers for manual and automatic frequency restoration reserves.",
    category: "balancing",
    regulationArticle: "Art. 17.1(b)"
  },
  {
    documentType: "A83",
    title: "Activated Balancing Quantities",
    description:
      "Volumes of balancing energy activated per direction and reserve type.",
    category: "balancing",
    regulationArticle: "Art. 17.1(c)"
  },
  {
    documentType: "A84",
    title: "Activated Balancing Prices",
    description:
      "Prices of activated balancing energy per direction and reserve type.",
    category: "balancing",
    regulationArticle: "Art. 17.1(d)"
  },
  {
    documentType: "A85",
    title: "Imbalance Prices",
    description:
      "Settlement imbalance prices per bidding zone or control area.",
    category: "balancing",
    regulationArticle: "Art. 17.1(e)"
  },
  {
    documentType: "A86",
    title: "Imbalance Volumes",
    description:
      "Total imbalance volumes per control area, positive and negative.",
    category: "balancing",
    regulationArticle: "Art. 17.1(f)"
  },

  // ── Market ──────────────────────────────────────────────────────────
  {
    documentType: "A44",
    processType: "A01",
    title: "Day-Ahead Electricity Prices",
    description:
      "Day-ahead market clearing prices per bidding zone and market time unit.",
    category: "market",
    regulationArticle: "Art. 12.1(d)"
  },

  // ── Outages (Art. 10, 15) ──────────────────────────────────────────
  {
    documentType: "A77",
    title: "Generation Unavailability (Planned)",
    description:
      "Planned unavailability of generation units >= 100 MW, including maintenance schedules.",
    category: "outages",
    regulationArticle: "Art. 15.1(a)"
  },
  {
    documentType: "A80",
    title: "Generation Unavailability (Forced)",
    description:
      "Forced (unplanned) outages of generation units >= 100 MW.",
    category: "outages",
    regulationArticle: "Art. 15.1(b)"
  },
  {
    documentType: "A78",
    title: "Transmission Infrastructure Unavailability",
    description:
      "Planned and forced unavailability of cross-border transmission infrastructure.",
    category: "outages",
    regulationArticle: "Art. 10.1(a)"
  },
  {
    documentType: "A76",
    title: "Consumption Unavailability",
    description:
      "Planned and forced consumption unit unavailability (large demand units).",
    category: "outages",
    regulationArticle: "Art. 7.2"
  }
];
