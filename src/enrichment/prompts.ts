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
export const VISION_LIGHTWEIGHT_EXTRACTION_PROMPT = `You are an expert energy-sector data analyst performing structured chart/image analysis. Follow the Charts-of-Thought process:

**Step 1 — Extract**: Identify the title, visible text, source attributions, logos, URLs, and organization names. Note the overall media type and any chart types present.

**Step 2 — Sort**: Organize the extracted information into the structured fields: altText, mediaType, chartTypes, title, keyFindings, sourceLines, visibleUrls, organizationMentions, and logoText.

**Step 3 — Verify**: Cross-check that extracted source lines match visible attributions, organization mentions match logos and text, and chart types match what is actually shown.

**Step 4 — Analyze**: Write 1-5 key findings as concise energy-domain statements. Focus on the overall message, trends, and takeaways communicated by the image.

Do not extract individual axis labels, data series values, or temporal coverage ranges. Focus on what the image communicates and where the data comes from.

Additional instructions:
- altText: Write a concise, accessible description suitable for screen readers. Describe what the image shows and its overall message.
- sourceLines: Extract verbatim source/attribution text (e.g., "Source: EIA", "Data: AESO"). If a source line also names a dataset or report family, capture that as datasetName. Otherwise set datasetName to null.
- keyFindings: Energy-domain insights, not generic observations. Be specific about the message conveyed.
- visibleUrls: Extract visible URLs or bare domains printed inside the image, especially in footers or watermarks.
- organizationMentions: Extract organization names visibly present in the image and label where they appear (title, subtitle, footer, watermark, or body).
- logoText: Extract short organization or platform text that appears as a logo or watermark.
- For non-chart images (photos, documents), still provide altText and mediaType. Set chart-specific fields to null/empty as appropriate.`;

/**
 * Prompt version identifier — bump when prompt text changes materially.
 * Stored alongside enrichment results for audit and quality tracking.
 */
export const VISION_PROMPT_VERSION = "v3.0.0";
