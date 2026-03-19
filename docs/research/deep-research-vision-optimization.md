# Deep Research Prompt: Vision Extraction Prompt Optimization

Use this prompt with Gemini Deep Research, ChatGPT Deep Research, or Claude extended thinking.

---

## Research Question

What is the most effective approach to systematically optimize structured vision extraction prompts for chart/data visualization understanding, given a small golden dataset (~16-50 annotated examples) and a production pipeline using Gemini 2.5 Flash with JSON schema-constrained output?

## Context

We have a production pipeline that:

1. Takes energy-sector chart images (bar charts, line charts, stacked bars, area charts) from expert social media threads
2. Sends them to Gemini 2.5 Flash with a structured JSON schema constraint
3. Extracts: chart type, axis labels/units, data series, source attribution text, temporal coverage, key findings, and synthetic alt text
4. Stores the structured output for downstream use (reader feed, source attribution matching, data grounding)

Our current approach uses a hand-written "Charts-of-Thought" prompt (extract → sort → verify → analyze) with structured output via `responseJsonSchema`. Initial results on 16 golden images show 100% success rate on classification and reasonable extraction quality, but we have no systematic way to measure or improve extraction accuracy.

## Specific Questions to Research

### 1. Dataset Requirements for Prompt Optimization

- What is the minimum viable dataset size for effective prompt optimization with DSPy BootstrapFewShot vs MIPROv2 vs other optimizers?
- How should ground-truth annotations be structured for multi-field structured extraction (not just QA accuracy)?
- What annotation strategy works best: full golden output annotation vs field-level annotation vs pairwise preference ranking?
- How do you handle subjective fields (key findings, alt text quality) vs objective fields (chart type, axis labels) in the same optimization loop?
- Are there established benchmarks or datasets for energy/financial chart extraction that could augment a small proprietary golden set?

### 2. DSPy for Vision Extraction Specifically

- What is the current state of DSPy's multimodal/vision support (as of early 2026)?
- How do DSPy signatures work with image inputs and complex structured outputs (nested objects, arrays of objects)?
- Which DSPy optimizer is most effective for structured extraction tasks with small datasets?
- How does DSPy handle JSON schema-constrained output from Gemini — does it compose well with `responseJsonSchema`, or does it generate its own prompting strategy?
- Are there published case studies of DSPy being used for document/chart/visual extraction (not just text QA)?
- How does DSPy's optimization interact with few-shot example selection for vision tasks?

### 3. Alternative Optimization Approaches

- How does Ax (axllm, TypeScript DSPy) compare to Python DSPy for vision extraction optimization? Is AxGEPA viable with <50 examples?
- What about TextGrad or OPRO for prompt optimization in this context?
- Is there value in using LLM-as-judge (Gemini Pro or Claude as evaluator) to score extraction quality, rather than hand-annotating every field?
- How effective is automatic metric learning for structured extraction — can the optimizer learn what "good" chart extraction looks like from a few examples?

### 4. Evaluation Metrics for Structured Chart Extraction

- What field-level metrics are most informative? (exact match, set overlap, Levenshtein distance, embedding similarity)
- How should composite scores be weighted across fields of different importance (chart type identification vs key findings quality)?
- How do production teams measure regression when prompts change?
- What is the relationship between extraction accuracy and downstream utility (does 90% axis accuracy matter if key findings are wrong)?

### 5. Production Considerations

- What does a practical optimization loop look like for a small team (1-2 people) with a small golden set?
- How do teams handle prompt versioning and rollback when optimization produces regressions on edge cases?
- What is the cost profile of running DSPy optimization with Gemini Flash on ~16-50 image examples?
- How do you prevent overfitting to the golden set while still improving on it?
- Are there lightweight approaches that give 80% of the benefit of full DSPy optimization?

### 6. Chart-Specific Vision Challenges

- What are the known failure modes for chart extraction with current vision LLMs (Gemini 2.5, Claude 3.7, GPT-4o)?
- How do teams handle the bar chart accuracy problem (consistently worst-performing chart type across models)?
- Is there evidence that region-targeted prompting (extract axes separately from data, then combine) outperforms holistic extraction?
- How effective is image preprocessing (cropping, resolution adjustment, legend isolation) vs prompt engineering for improving accuracy?
- What role does the JSON schema itself play in extraction quality — does schema design (field descriptions, enum constraints, nullable patterns) affect model output quality?

## Desired Output Format

Please provide:

1. **Executive summary** — top 3-5 actionable recommendations for our specific situation (16 golden images, Gemini Flash, structured JSON output, small team)
2. **Dataset strategy** — how many examples we actually need, how to annotate them, and whether augmentation from public datasets is viable
3. **Tool comparison** — DSPy vs Ax vs Promptfoo vs manual iteration, with honest assessment of effort-to-value ratio at our scale
4. **Practical optimization workflow** — step-by-step process we could follow this week
5. **Risks and limitations** — what won't work at our scale, what to defer until we have more data
6. **Sources** — academic papers, production case studies, framework documentation

## Our Tech Stack (for context)

- **Runtime**: Cloudflare Workers (TypeScript, Effect TS)
- **Vision model**: Gemini 2.5 Flash via `@google/genai` SDK
- **Structured output**: `responseJsonSchema` with JSON Schema derived from Effect schemas
- **Python tooling**: `uv` for Python project management
- **Existing eval**: 16 golden images from 4 canonical energy expert threads, `run-eval.ts` script producing per-image JSON outputs
- **Prompt location**: `src/enrichment/prompts.ts` (versioned, externalized)
