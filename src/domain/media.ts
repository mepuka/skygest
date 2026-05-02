/**
 * Media domain types derived from the energy-media ontology.
 *
 * These enums are the app-facing media classification vocabulary used by the
 * enrichment pipeline. The ontology-native media entity classes now live in
 * `@skygest/ontology-store`.
 */

import { Schema } from "effect";

// ---------------------------------------------------------------------------
// Media classification (what the content actually depicts)
// ---------------------------------------------------------------------------

export const MediaTypeMembers = [
  "chart",
  "document-excerpt",
  "photo",
  "infographic",
  "video"
] as const;

export const MediaType = Schema.Literals([...MediaTypeMembers]);
export type MediaType = Schema.Schema.Type<typeof MediaType>;

export const isKnownMediaType = (
  value: string
): value is (typeof MediaTypeMembers)[number] =>
  MediaTypeMembers.includes(value as (typeof MediaTypeMembers)[number]);

/** Normalize a Gemini mediaType to canonical form before storage/enrichment.
 *  Maps aliases to enum values and falls back to "photo" for unknown types
 *  so decoding never fails on unexpected Gemini responses. Case-insensitive. */
export const normalizeMediaType = (raw: string): string => {
  const lower = raw.toLowerCase().trim();
  const aliases: Record<string, string> = {
    image: "photo",
    screenshot: "photo",
    photograph: "photo",
    diagram: "infographic",
    graph: "chart",
    table: "chart",
    document: "document-excerpt",
    article: "document-excerpt",
    "news article": "document-excerpt",
    "text document": "document-excerpt",
    "web page": "document-excerpt",
    webpage: "document-excerpt"
  };
  const normalized = aliases[lower] ?? lower;
  return isKnownMediaType(normalized) ? normalized : "photo";
};

// ---------------------------------------------------------------------------
// Chart type taxonomy (from ChartTypeScheme, 14 concepts)
// ---------------------------------------------------------------------------

export const ChartTypeMembers = [
  "area-chart",
  "bar-chart",
  "candlestick-chart",
  "choropleth-map",
  "contour-map",
  "data-table",
  "dual-axis-chart",
  "flow-chart",
  "gauge-chart",
  "heatmap",
  "line-chart",
  "pie-chart",
  "point-map",
  "radar-chart",
  "sankey-diagram",
  "scatter-plot",
  "stacked-bar-chart",
  "timeline-chart",
  "treemap",
  "waterfall-chart"
] as const;

export const ChartType = Schema.Literals(ChartTypeMembers);
export type ChartType = Schema.Schema.Type<typeof ChartType>;

/** Normalize a Gemini chartType to canonical kebab-case form.
 *  Handles PascalCase, spaces, and common aliases. */
export const normalizeChartType = (raw: string): string => {
  // Lowercase, trim, replace spaces with hyphens
  const kebab = raw.toLowerCase().trim().replace(/\s+/g, "-");
  const aliases: Record<string, string> = {
    "contour": "contour-map",
    "heat-map": "heatmap",
    "donut-chart": "pie-chart",
    "doughnut-chart": "pie-chart",
    "column-chart": "bar-chart",
    "histogram": "bar-chart",
    "bubble-chart": "scatter-plot",
    "map": "choropleth-map",
    "table": "data-table",
    "gantt-chart": "timeline-chart",
    "funnel-chart": "flow-chart"
  };
  return aliases[kebab] ?? kebab;
};

// ---------------------------------------------------------------------------
// Image classification (lightweight classify-step output)
// ---------------------------------------------------------------------------

export const ImageClassification = Schema.Struct({
  mediaType: MediaType,
  chartTypes: Schema.Array(ChartType),
  hasDataPoints: Schema.Boolean,
  isCompound: Schema.Boolean
});
export type ImageClassification = Schema.Schema.Type<typeof ImageClassification>;

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
