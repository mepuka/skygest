import { AliasSchemeValues, type DistributionKind, type ExternalIdentifier } from "../../../domain/data-layer";

export const ENERGY_INSTITUTE_AGENT_FILE_SLUG = "energy-institute";
export const ENERGY_INSTITUTE_CATALOG_SLUG = "energy-institute";

export const ENERGY_INSTITUTE_SITE_URL = "https://www.energyinst.org";
export const ENERGY_INSTITUTE_REVIEW_HOME_URL =
  "https://www.energyinst.org/statistical-review";
export const ENERGY_INSTITUTE_REVIEW_RESOURCES_URL =
  "https://www.energyinst.org/statistical-review/resources-and-data-downloads";
export const ENERGY_INSTITUTE_REVIEW_CHARTING_PAGE_URL =
  "https://www.energyinst.org/statistical-review/energy-charting-tool";
export const ENERGY_INSTITUTE_REVIEW_CHARTING_APP_URL =
  "https://www.energyinst.org/statistical-review/energy-charting-tool/energy-charting-tool";
export const ENERGY_INSTITUTE_TRACKER_PAGE_URL =
  "https://www.energyinst.org/statistical-review/energy-transition-tracker";
export const ENERGY_INSTITUTE_TRACKER_APP_URL =
  "https://www.energyinst.org/statistical-review/energy-transition-tracker/energy-transition-tracker";

export const ENERGY_INSTITUTE_CATALOG_TITLE = "Energy Institute Data Catalog";

export interface EnergyInstituteDistributionSpec {
  readonly slug: string;
  readonly kind: DistributionKind;
  readonly title: string;
  readonly description?: string | undefined;
  readonly accessURL: string;
  readonly format?: string | undefined;
  readonly mediaType?: string | undefined;
}

export interface EnergyInstituteSeriesSpec {
  readonly key: string;
  readonly slug: string;
  readonly title: string;
  readonly description: string;
  readonly cadence: "annual" | "irregular";
  readonly seriesUrl: string;
}

export interface EnergyInstituteDatasetManifestEntry {
  readonly key: string;
  readonly slug: string;
  readonly mergeKey: string;
  readonly title: string;
  readonly description: string;
  readonly landingPage: string;
  readonly keywords: ReadonlyArray<string>;
  readonly themes: ReadonlyArray<string>;
  readonly series: EnergyInstituteSeriesSpec;
  readonly distributions: ReadonlyArray<EnergyInstituteDistributionSpec>;
}

const STATISTICAL_REVIEW_SERIES: EnergyInstituteSeriesSpec = {
  key: "statistical-review",
  slug: "ei-statistical-review",
  title: "Energy Institute Statistical Review of World Energy",
  description:
    "Annual global energy statistics published by the Energy Institute, continuing the long-running Statistical Review series.",
  cadence: "annual",
  seriesUrl: ENERGY_INSTITUTE_REVIEW_HOME_URL
};

const COUNTRY_TRANSITION_TRACKER_SERIES: EnergyInstituteSeriesSpec = {
  key: "country-transition-tracker",
  slug: "ei-country-transition-tracker",
  title: "Energy Institute Country Transition Tracker",
  description:
    "Annual country-level transition tracker published by the Energy Institute alongside the Statistical Review of World Energy.",
  cadence: "annual",
  seriesUrl: ENERGY_INSTITUTE_TRACKER_PAGE_URL
};

export const ENERGY_INSTITUTE_MANIFEST: ReadonlyArray<EnergyInstituteDatasetManifestEntry> =
  [
    {
      key: "statistical-review",
      slug: "ei-statistical-review-dataset",
      mergeKey: ENERGY_INSTITUTE_REVIEW_HOME_URL,
      title: "Energy Institute Statistical Review of World Energy",
      description:
        "Comprehensive global energy dataset covering production, consumption, reserves, trade, prices, and emissions, published annually by the Energy Institute.",
      landingPage: ENERGY_INSTITUTE_REVIEW_HOME_URL,
      keywords: [
        "world energy",
        "statistics",
        "consumption",
        "production",
        "reserves",
        "historical"
      ],
      themes: ["energy", "global", "statistics"],
      series: STATISTICAL_REVIEW_SERIES,
      distributions: [
        {
          slug: "ei-review-download",
          kind: "download",
          title: "Statistical Review data downloads",
          description:
            "Download hub for the Statistical Review workbook and consolidated data files.",
          accessURL: ENERGY_INSTITUTE_REVIEW_RESOURCES_URL,
          format: "multiple"
        },
        {
          slug: "ei-review-web",
          kind: "interactive-web-app",
          title: "Energy charting tool",
          description:
            "Interactive Energy Institute charting tool for exploring Statistical Review data.",
          accessURL: ENERGY_INSTITUTE_REVIEW_CHARTING_APP_URL,
          format: "html",
          mediaType: "text/html"
        },
        {
          slug: "ei-review-resources",
          kind: "landing-page",
          title: "Resources and data downloads",
          description:
            "Overview page for Statistical Review downloads, citations, and supporting materials.",
          accessURL: ENERGY_INSTITUTE_REVIEW_RESOURCES_URL,
          format: "html",
          mediaType: "text/html"
        },
        {
          slug: "ei-review-docs",
          kind: "documentation",
          title: "Statistical Review report and methodology downloads",
          description:
            "Report, methodology, and definitions downloads published with the Statistical Review.",
          accessURL: ENERGY_INSTITUTE_REVIEW_RESOURCES_URL,
          format: "pdf"
        }
      ]
    },
    {
      key: "country-transition-tracker",
      slug: "ei-country-transition-tracker-dataset",
      mergeKey: ENERGY_INSTITUTE_TRACKER_PAGE_URL,
      title: "Energy Institute Country Transition Tracker",
      description:
        "Country-level transition tracker published by the Energy Institute with annual headline and consolidated data downloads.",
      landingPage: ENERGY_INSTITUTE_TRACKER_PAGE_URL,
      keywords: [
        "country transition tracker",
        "energy transition",
        "countries",
        "comparative indicators"
      ],
      themes: ["energy", "transition", "statistics"],
      series: COUNTRY_TRANSITION_TRACKER_SERIES,
      distributions: [
        {
          slug: "ei-tracker-download",
          kind: "download",
          title: "Country Transition Tracker data downloads",
          description:
            "Download hub for the annual Country Transition Tracker workbook and consolidated files.",
          accessURL: ENERGY_INSTITUTE_REVIEW_RESOURCES_URL,
          format: "multiple"
        },
        {
          slug: "ei-tracker-web",
          kind: "interactive-web-app",
          title: "Country Transition Tracker tool",
          description:
            "Interactive Country Transition Tracker application published by the Energy Institute.",
          accessURL: ENERGY_INSTITUTE_TRACKER_APP_URL,
          format: "html",
          mediaType: "text/html"
        },
        {
          slug: "ei-tracker-page",
          kind: "landing-page",
          title: "Country Transition Tracker landing page",
          description:
            "Overview page for the Country Transition Tracker publication and downloads.",
          accessURL: ENERGY_INSTITUTE_TRACKER_PAGE_URL,
          format: "html",
          mediaType: "text/html"
        }
      ]
    }
  ];

export const energyInstituteCatalogAliases = (): ReadonlyArray<ExternalIdentifier> => [
  {
    scheme: AliasSchemeValues.url,
    value: ENERGY_INSTITUTE_SITE_URL,
    relation: "exactMatch"
  },
  {
    scheme: AliasSchemeValues.url,
    value: ENERGY_INSTITUTE_REVIEW_HOME_URL,
    relation: "exactMatch"
  }
];

const DATASET_MERGE_KEYS = new Set(
  ENERGY_INSTITUTE_MANIFEST.map((entry) => entry.mergeKey)
);

export const isEnergyInstituteDatasetMergeUrl = (value: string): boolean =>
  DATASET_MERGE_KEYS.has(value);

export const isEnergyInstituteDatasetAlias = (
  alias: ExternalIdentifier
): boolean =>
  alias.scheme === AliasSchemeValues.url &&
  isEnergyInstituteDatasetMergeUrl(alias.value);

export const energyInstituteCatalogRecordSlug = (
  entry: EnergyInstituteDatasetManifestEntry
): string => `${entry.slug}-cr`;

export const energyInstituteDistributionKinds = (
  entry: EnergyInstituteDatasetManifestEntry
): ReadonlySet<DistributionKind> =>
  new Set(entry.distributions.map((distribution) => distribution.kind));
