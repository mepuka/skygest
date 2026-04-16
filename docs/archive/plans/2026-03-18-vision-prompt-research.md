# Vision Prompt Research — Chart Extraction Best Practices

Research findings from academic papers, Google documentation, and production retrospectives.

## Top Findings

### 1. Charts-of-Thought is the highest-impact technique (9-22% improvement)

Four-phase structured prompting: extract → sort → verify → analyze. Already adopted in our extraction prompt. Key detail from the paper:

- GPT-4.5: +21.8%, Claude-3.7: +13.5%, Gemini-2.0: +9.4%
- All models surpassed human baseline (28.82 VLAT score) with CoT
- **Bar charts are the weakest category** — 50% accuracy for Claude-3.7, even with CoT
- Color interpretation is a primary failure mode in stacked/grouped charts

### 2. Few-shot examples dramatically outperform zero-shot

PromptChart paper: 63.2% vs 40.96% accuracy with few-shot. Optimal count: **6 examples**. More examples paradoxically decreased factuality.

**Action:** Add 3-6 energy chart examples to our extraction prompt — line charts (price trends), bar charts (capacity), area charts (generation mix). Show positive examples only.

### 3. Self-verification improves accuracy ~2.3% even on strong models

SelfCheck regenerates independent verification steps. Our Task 3 ("Cross-check that extracted series match the legend...") is the minimum viable verification.

**Action:** Strengthen the verify step with explicit comparison language: "Compare each extracted value back to the chart image."

### 4. Target prompting beats "extract everything"

Directing the model to extract from specific regions outperforms generic extraction. Feed the same image multiple times with different region-focused questions.

**Action:** For complex multi-series charts, consider sub-prompts: "Extract y-axis values and units", "Identify all data series", "Read the x-axis time range".

### 5. Role prompting helps structure, not accuracy

Role-setting ("expert energy analyst") improves output formatting but NOT domain accuracy. Accuracy comes from context, reference data, and verification.

**Action:** Keep role-setting for output structure. Add domain context (energy terminology, common unit systems) as reference material rather than relying on the role.

### 6. Schema descriptions matter

Google docs: "Use the `description` field in your schema to provide clear instructions for each property." Schema compliance does NOT guarantee semantic correctness — always validate.

**Action:** Already doing this — our JSON schemas have description fields. Continue pattern.

### 7. Image placement matters

Google docs: "Place text prompts AFTER the image" when using a single image. Already doing this in our implementation.

### 8. Gemini 3 specific patterns

- Place behavioral constraints at top, core request as final line
- Use `media_resolution: "high"` for charts with fine gridlines
- Use `thinking_level` parameter for deeper reasoning
- Negative constraints at the end of the prompt

## Chart-Type Vulnerability Matrix

| Chart Type | Accuracy | Key Failure Mode |
|---|---|---|
| Line charts | High | Overlapping series |
| Area charts | High | Stacked series color confusion |
| Pie charts | High | Small segments |
| Scatter plots | Medium-High | Dense clusters |
| Bar charts | **Medium (50%)** | Dense bars, color-to-series mapping |
| Stacked bar | **Medium** | Color interpretation, segment values |
| Data tables | High | OCR-like extraction |

## Recommended Prompt Refinements

### Priority 1: Add few-shot examples (highest impact after CoT)

Add 3 example chart extractions in the prompt:
1. A line chart (energy price trend)
2. A bar chart (generation capacity comparison)
3. A stacked area chart (generation mix over time)

### Priority 2: Strengthen verification step

Change from "Cross-check that extracted series match the legend" to: "For each data series, verify the legend label matches a visible element. For each axis value, confirm it appears in the chart. Correct any discrepancies before proceeding."

### Priority 3: Add explicit color-mapping instruction

"When extracting data from charts with multiple colored series, explicitly describe the color of each series and map it to the corresponding legend entry. Do not guess — if the color mapping is ambiguous, note the uncertainty."

### Priority 4: Domain context reference block

Add a brief reference block of common energy units and abbreviations:
- Power: MW, GW, kW
- Energy: MWh, GWh, TWh, kWh
- Emissions: tCO2, MtCO2e
- Price: USD/MWh, CAD/MWh, EUR/MWh

### Priority 5: Temperature/determinism

Use low temperature (0.0-0.2) for extraction tasks. Consider `thinking_level` parameter on Gemini 3 for complex charts.

## Sources

### Academic
- Charts-of-Thought (2025): https://arxiv.org/html/2508.04842v1
- ChartQAPro (2025): https://arxiv.org/html/2504.05506v1
- PromptChart (2023): https://arxiv.org/html/2312.10610v1
- CHART-6 (2025): https://arxiv.org/html/2505.17202v1
- Target Prompting (2024): https://arxiv.org/html/2408.03834v1
- From Pixels to Insights (IEEE TKDE 2024): https://arxiv.org/html/2403.12027v2

### Google/Gemini
- Prompt Design Strategies: https://ai.google.dev/gemini-api/docs/prompting-strategies
- Image Understanding: https://ai.google.dev/gemini-api/docs/image-understanding
- Structured Outputs: https://ai.google.dev/gemini-api/docs/structured-output
- Gemini 3 Prompting Guide: https://docs.cloud.google.com/vertex-ai/generative-ai/docs/start/gemini-3-prompting-guide

### Industry
- Grab Vision LLM production pipeline: https://blog.bytebytego.com/p/how-grab-built-a-vision-llm-to-scan
- 1,200 production LLMOps deployments: https://www.zenml.io/blog/what-1200-production-deployments-reveal-about-llmops-in-2025
- Hallucination mitigation framework: https://www.mdpi.com/2073-431X/14/8/332
