/**
 * Media domain types derived from the energy-media ontology.
 *
 * ChartType values correspond 1:1 to ChartTypeScheme concepts in
 * energy-media-summary.json (PascalCase → kebab-case).
 *
 * AltTextProvenance values correspond to AltTextProvenanceScheme
 * (AltTextOriginal → "original", AltTextSynthetic → "synthetic",
 * AltTextAbsent → "absent").
 */

import { Schema, SchemaGetter } from "effect";

// ---------------------------------------------------------------------------
// Media classification (what the content actually depicts)
// ---------------------------------------------------------------------------

const mediaTypeCanonical = ["chart", "document-excerpt", "photo", "infographic", "video"] as const;

const mediaTypeAliases: Record<string, (typeof mediaTypeCanonical)[number]> = {
  image: "photo",
  screenshot: "photo",
  photograph: "photo",
  diagram: "infographic",
  graph: "chart",
  table: "chart"
};

/** MediaType with case-insensitive + alias normalization.
 *  Accepts "Image", "Chart", "image" etc. and maps to canonical lowercase. */
export const MediaType = Schema.String.pipe(
  Schema.decode({
    decode: SchemaGetter.transform((raw: string): string => {
      const lower = raw.toLowerCase().trim();
      return mediaTypeAliases[lower] ?? lower;
    }),
    encode: SchemaGetter.passthrough()
  }),
  Schema.decodeTo(Schema.Literals(mediaTypeCanonical))
);
export type MediaType = Schema.Schema.Type<typeof MediaType>;

// ---------------------------------------------------------------------------
// Chart type taxonomy (from ChartTypeScheme, 14 concepts)
// ---------------------------------------------------------------------------

export const ChartType = Schema.Literals([
  "area-chart",
  "bar-chart",
  "candlestick-chart",
  "choropleth-map",
  "data-table",
  "dual-axis-chart",
  "heatmap",
  "line-chart",
  "pie-chart",
  "point-map",
  "sankey-diagram",
  "scatter-plot",
  "stacked-bar-chart",
  "treemap"
]);
export type ChartType = Schema.Schema.Type<typeof ChartType>;

// ---------------------------------------------------------------------------
// Alt text provenance (from AltTextProvenanceScheme)
// ---------------------------------------------------------------------------

export const AltTextProvenance = Schema.Literals([
  "original",
  "synthetic",
  "absent"
]);
export type AltTextProvenance = Schema.Schema.Type<typeof AltTextProvenance>;

// ---------------------------------------------------------------------------
// Chart description structs (from ontology properties)
// ---------------------------------------------------------------------------

export const ChartAxis = Schema.Struct({
  label: Schema.NullOr(Schema.String),
  unit: Schema.NullOr(Schema.String)
});
export type ChartAxis = Schema.Schema.Type<typeof ChartAxis>;

export const ChartSeries = Schema.Struct({
  legendLabel: Schema.String,
  unit: Schema.NullOr(Schema.String)
});
export type ChartSeries = Schema.Schema.Type<typeof ChartSeries>;

export const ChartSourceLine = Schema.Struct({
  sourceText: Schema.String
});
export type ChartSourceLine = Schema.Schema.Type<typeof ChartSourceLine>;

export const TemporalCoverage = Schema.Struct({
  startDate: Schema.NullOr(Schema.String),
  endDate: Schema.NullOr(Schema.String)
});
export type TemporalCoverage = Schema.Schema.Type<typeof TemporalCoverage>;

export const ChartDescription = Schema.Struct({
  chartTypes: Schema.Array(ChartType),
  title: Schema.NullOr(Schema.String),
  xAxis: Schema.NullOr(ChartAxis),
  yAxis: Schema.NullOr(ChartAxis),
  series: Schema.Array(ChartSeries),
  sourceLines: Schema.Array(ChartSourceLine),
  temporalCoverage: Schema.NullOr(TemporalCoverage),
  keyFindings: Schema.Array(Schema.String)
});
export type ChartDescription = Schema.Schema.Type<typeof ChartDescription>;
