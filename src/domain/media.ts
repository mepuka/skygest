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

import { Schema } from "effect";

// ---------------------------------------------------------------------------
// Media classification (what the content actually depicts)
// ---------------------------------------------------------------------------

export const MediaType = Schema.Literals([
  "chart",
  "document-excerpt",
  "photo",
  "infographic",
  "video"
]);
export type MediaType = Schema.Schema.Type<typeof MediaType>;

/** Normalize a Gemini mediaType to canonical form before storage/enrichment.
 *  Maps "image" → "photo" for downstream consistency. Case-insensitive. */
export const normalizeMediaType = (raw: string): string => {
  const lower = raw.toLowerCase().trim();
  const aliases: Record<string, string> = {
    image: "photo",
    screenshot: "photo",
    photograph: "photo",
    diagram: "infographic",
    graph: "chart",
    table: "chart"
  };
  return aliases[lower] ?? lower;
};

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
