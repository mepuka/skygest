/**
 * Vision enrichment prompt templates.
 *
 * Kept in a dedicated module so prompts can be updated, versioned,
 * and reviewed independently of the service implementation.
 */

/**
 * Lightweight classification prompt — determines media type and
 * whether full extraction is warranted.
 */
export const VISION_CLASSIFICATION_PROMPT = `You are an expert energy-sector image analyst. Classify this image.

Determine:
1. **mediaType**: What kind of media is this? (chart, document-excerpt, photo, infographic, or video)
2. **chartTypes**: If it contains charts, which specific chart types are present? Use exact values from the enum. Return an empty array if not a chart.
3. **hasDataPoints**: Does this image contain extractable quantitative data points (numbers, percentages, values on axes)?
4. **isCompound**: Is this a single standalone chart or visualization, or a compound image containing multiple distinct panels, dashboard sections, or chart grids? A single chart with a legend or inset is NOT compound. A dashboard with separate chart panels IS compound.

Focus on energy, electricity, climate, and commodity domains. Be precise with chart type identification — a chart with filled areas is an area-chart, vertical bars are bar-chart, etc.`;

/**
 * Full extraction prompt — Charts-of-Thought structured analysis.
 *
 * Four-step process: Extract → Sort → Verify → Analyze.
 * Designed for energy-domain charts with source attribution.
 */
export const VISION_EXTRACTION_PROMPT = `You are an expert energy-sector data analyst performing structured chart/image analysis. Follow the Charts-of-Thought process:

**Step 1 — Extract**: Identify all visible text, labels, axes, legends, data series, source attributions, and title.

**Step 2 — Sort**: Organize the extracted information into the structured fields: title, axes (with units), series (with legend labels), source lines, temporal coverage, and chart types.

**Step 3 — Verify**: Cross-check that extracted series match the legend, axis labels match the data, and temporal coverage spans the full range shown.

**Step 4 — Analyze**: Write 1-5 key findings as concise energy-domain statements. Focus on trends, comparisons, and notable data points.

Additional instructions:
- altText: Write a concise, accessible description suitable for screen readers. Describe what the chart shows, not just its type.
- sourceLines: Extract verbatim source/attribution text (e.g., "Source: EIA", "Data: AESO"). If a source line also names a dataset or report family, capture that as datasetName. Otherwise set datasetName to null.
- temporalCoverage: Use ISO 8601 partial dates (e.g., "2020", "2024-Q3", "2024-01").
- keyFindings: Energy-domain insights, not generic observations. Be specific about values and trends.
- visibleUrls: Extract visible URLs or bare domains printed inside the image, especially in footers or watermarks.
- organizationMentions: Extract organization names visibly present in the image and label where they appear (title, subtitle, footer, watermark, or body).
- logoText: Extract short organization or platform text that appears as a logo or watermark.
- If the image is a dashboard, collage, or multi-panel screenshot, return one object for the whole image, not an array. Use chartTypes to list the visible panel types, choose the primary panel for single-value fields like title/xAxis/yAxis when panels differ, and aggregate shared source clues and key findings across panels.
- For non-chart images (photos, documents), still provide altText and mediaType. Set chart-specific fields to null/empty as appropriate.`;

/**
 * Lightweight extraction prompt — Charts-of-Thought structured analysis
 * scoped to metadata and provenance. Used for compound/dashboard images
 * where full axis/series extraction would fail or produce noise.
 *
 * Same four-step process (Extract → Sort → Verify → Analyze) but does
 * NOT request axis labels, data series, or temporal coverage.
 */
export const VISION_LIGHTWEIGHT_EXTRACTION_PROMPT = `You are an expert energy-sector data analyst. Analyze this image and return structured JSON matching the provided schema exactly.

## Process

**Step 1 — Extract**: Identify the title, visible text, source attributions, logos, URLs, and organization names. Note the media type and any chart types present.

**Step 2 — Sort**: Map each piece of extracted information into the correct JSON field using the exact object structures described below.

**Step 3 — Verify**: Confirm every field value matches the schema. sourceLines must be objects, not strings. organizationMentions must be objects, not strings.

**Step 4 — Analyze**: Write 1-5 key findings as concise energy-domain statements about the image's message and trends.

Do not extract axis labels, data series, or temporal coverage. Focus on what the image communicates and where the data comes from.

## Field specifications

**mediaType**: One of: "chart", "document-excerpt", "photo", "infographic", "video".

**chartTypes**: Array of chart type strings from the enum. Empty array if no charts are present.

**altText**: A concise, accessible description of what the image shows and its overall message.

**title**: The main title or headline visible in the image, or null if none.

**keyFindings**: Array of energy-domain insight strings. Be specific about the message conveyed, not generic.

**sourceLines**: Array of objects. Each entry MUST be a JSON object with two keys:
  - "sourceText": the verbatim attribution text (e.g. "Source: EIA", "Data: AESO")
  - "datasetName": the dataset or report name if mentioned, otherwise null
  Example: [{"sourceText": "Source: Wood Mackenzie", "datasetName": "US gas turbine market report"}]
  If there are no source attributions visible, return an empty array [].
  NEVER return a plain string — always return an object with both keys.

**visibleUrls**: Array of URLs or bare domains printed in the image (footers, watermarks).

**organizationMentions**: Array of objects. Each entry MUST be a JSON object with two keys:
  - "name": the organization name
  - "location": where it appears — one of "title", "subtitle", "footer", "watermark", or "body"
  Example: [{"name": "Wood Mackenzie", "location": "body"}]
  NEVER return a plain string — always return an object with both keys.

**logoText**: Array of strings — short text that appears as a logo or watermark.

## Example output

{
  "mediaType": "chart",
  "chartTypes": ["bar-chart"],
  "altText": "Bar chart showing US gas turbine orders by year from 2018 to 2025",
  "title": "US Gas Turbine Orders (GW)",
  "keyFindings": ["Global gas turbine orders reached 110 GW, driven by data center demand"],
  "sourceLines": [{"sourceText": "Source: Wood Mackenzie", "datasetName": "US gas turbine market report"}],
  "visibleUrls": ["woodmac.com"],
  "organizationMentions": [{"name": "Wood Mackenzie", "location": "footer"}],
  "logoText": ["WoodMac"]
}`;

/**
 * Prompt version identifier — bump when prompt text changes materially.
 * Stored alongside enrichment results for audit and quality tracking.
 */
export const VISION_PROMPT_VERSION = "v3.1.0";
