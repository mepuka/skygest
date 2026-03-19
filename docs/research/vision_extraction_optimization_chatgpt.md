# Systematic Prompt Optimization for Structured Chart Extraction with Gemini Flash

## Executive summary

The most effective “small golden set” approach is to treat prompt optimization as an **evaluation + search** problem rather than a purely prompt-writing problem: design field-level metrics that reflect what you care about, then use those metrics to drive controlled iterations (manual or automated). DSPy’s optimizer stack is explicitly built around this loop—program + dataset + metric—with optimizers that can tune instructions and/or demonstrations against your chosen metric. citeturn16search0turn16search3turn0search5

First, invest immediately in an evaluation layer that scores **each extracted field** separately, with schema validity and required-field completion as “gates.” Gemini’s Structured Outputs (JSON Schema) is a strong foundation here because it guarantees syntactically valid JSON matching your schema when configured with `response_mime_type: application/json` plus `response_json_schema` (and it preserves key ordering from the schema, which reduces downstream parsing ambiguity). citeturn10search1turn3search3turn10search7

Second, for optimizer choice at your scale: DSPy’s own guidance is to start with **BootstrapFewShot** when you have ~10 examples, and move to **BootstrapFewShotWithRandomSearch** once you reach ~50 examples; MIPROv2 is positioned for instruction optimization (including 0-shot instruction search) and uses bootstrapped demo candidates plus Bayesian optimization over prompt/demos. citeturn5search11turn4view0turn0search5 Your current 16 images is a good “proof,” but it is *below* the comfort zone for robust automated search unless you’re very careful about holdouts and variance.

Third, treat “subjective” fields (key findings, alt text) as a **separate objective** from “objective” fields (chart type, axes, units, data points). The most practical pattern is a hybrid metric: hard-scored objective fields + rubric-graded subjective fields via an LLM-as-judge. This is now a mainstream evaluation paradigm with dedicated surveys, and there are even published “dual-LLM” loops where an LLM judge evaluates extraction quality while an LLM optimizer refines the evaluation prompts. citeturn28search2turn28search8turn4view2

Fourth, incorporate **chart-specific decomposition** (and optionally image preprocessing) into the prompt/program, especially for series mapping and value extraction. Chart extraction research repeatedly converges on multi-module pipelines: keypoint extraction + chart element detection/OCR + grouping/legend mapping + scaling. citeturn25view1turn25view0turn27view0 This aligns directly with a “Charts-of-Thought” staged approach, but you should evaluate whether splitting into two model calls (or two crops) produces measurable gains for bar/stacked-bar accuracy.

Fifth, bound cost and reduce risk by making optimization runs **small, repeatable, and revertible**: (a) cap trials/metric calls, (b) keep a frozen “challenge set,” (c) version prompts and schemas together, and (d) make rollback operationally trivial. Both DSPy and the TypeScript DSPy-like ecosystem emphasize saving/loading optimized artifacts and explicitly bounding evaluation calls. citeturn0search15turn15search0turn4view2turn7search0

## Dataset strategy for a 16–50 example golden set

A “small golden set” can support systematic improvement, but the key is to structure it so that you can (1) score field-level correctness and (2) avoid overfitting when you iterate.

### Minimum viable dataset size for optimization loops

DSPy’s published optimizer selection guidance is blunt: with **very few examples (~10)**, start with `BootstrapFewShot`; with **more data (50+ examples)**, try `BootstrapFewShotWithRandomSearch`. citeturn5search11 This guidance is grounded in how these optimizers work: BootstrapFewShot tries to “bootstrap” usable demonstrations by running your program on training examples and keeping successful traces/demos; random search over demo subsets becomes more meaningful with more examples. citeturn4view1turn5search11

For MIPROv2 specifically, the official documentation describes a three-stage process—bootstrap few-shot candidates, propose instruction candidates, and then choose combinations via Bayesian optimization evaluated on a validation set (often minibatched). citeturn4view0 That design can work with fewer than 50 images, but the risk is high variance: Bayesian optimization and minibatch evaluation can “chase noise” when the validation set is tiny. Practically, if you run MIPROv2/GEPA at 16–25 examples, you should treat the output as *candidate prompt generation*, then validate manually and on a frozen holdout.

### What “ground truth” should look like for multi-field extraction

Because you already rely on **JSON Schema-constrained output** in production, the best annotation format is: **a canonical JSON instance matching your production schema**, plus optional per-field metadata for scoring (normalization hints, tolerance rules). Gemini Structured Outputs is designed for “predictable, type-safe results” for data extraction when you provide a schema. citeturn3search3turn8search3

ChartAB is a useful conceptual reference here: it explicitly uses a **JSON template** designed to make evaluation metrics computable and task-specific (data grounding vs legend grounding vs alignment). citeturn27view0 For your use case, that suggests a two-layer annotation design:

- **Layer A: strict fields** (objective): chart type, x/y axis labels, units, legend/series names, temporal coverage, source attribution text, extracted datapoints (with numeric tolerances).
- **Layer B: generative fields** (subjective): key findings, synthetic alt text.

You want Layer A to be “scoreable without judgment,” and Layer B to be “scoreable with a rubric.”

### Annotation strategy tradeoffs at your scale

Full “golden JSON” annotation is ideal but expensive. With 16–50 images, the best cost/quality compromise is usually:

- Fully annotate **Layer A for all images** (because those are the fields most likely to break downstream grounding and search).
- For Layer B, annotate **(a) a short human reference** for maybe 10–15 images and **(b) a rubric** that can be judge-scored for all images.

This approach matches what LLM-as-judge is designed for: evaluating subjective quality with a scoring rubric. citeturn28search2turn28search17 It also matches DSPy GEPA’s interface, which can incorporate **textual feedback** in addition to scalar scores—useful when your evaluation wants to say “the alt text is fluent but missed the key trend.” citeturn4view2

### Mixing subjective and objective fields in one loop

If you combine them naively into a single score, you’ll often get pathological behavior: the optimizer improves “wordy” key findings while degrading numeric fidelity. Chart-focused benchmarks show that **visual perception and multi-step reasoning** (especially with color/spatial constraints) remain failure points; evaluation needs to isolate those capabilities. citeturn23view0turn27view0

A practical pattern is a **multi-objective score**:
- Objective score gates release (must exceed threshold).
- Subjective score is optimized once the objective gate is met.

This is aligned with GEPA’s “Pareto” framing: it is explicitly designed as a genetic/evolutionary optimizer and supports multi-objective selection strategies. citeturn4view2turn15search3

### Augmenting beyond your proprietary set

You asked whether there are benchmarks/datasets that could help at small scale. There are many chart understanding datasets, but only some are useful for *your* extraction schema (not QA-only).

Useful augmentation sources:

- **ChartQAPro**: explicitly introduced to address the lack of real-world diversity in ChartQA; it includes charts from many sources and shows substantial performance drops for strong LVLMs when moving from ChartQA to ChartQAPro, indicating it’s closer to “in the wild” difficulty. citeturn22search2turn22search15
- **MultiChartQA**: collects real-world charts from sources including OWID and others, and its error analysis highlights persistent failure modes under color/spatial constraints—highly relevant to legends and stacked elements. citeturn23view0turn6search8
- **DVQA**: bar-chart-focused and built around the idea that minor appearance variations break existing methods—useful as “stress tests” for bar chart extraction logic. citeturn24search0
- **DePlot**: not a dataset, but a method that converts plot images to a linearized table as an intermediate representation for reasoning; it’s a strong precedent for “extract table first, then analyze.” citeturn2search0turn2search12

Energy-specific augmentation (without relying on proprietary threads):

- Public energy visualization sources like **Our World in Data (energy)** provide openly reusable visualizations/data under CC BY, which can be used to generate chart images with known underlying data tables—useful for objective scoring on axes/values. citeturn6search8
- **IEA** provides a large library of charts (with search/filter/download), which could serve as “in-domain style augmentation,” though licensing/terms should be reviewed for your intended use. citeturn6search1

The key warning: public datasets often differ stylistically from “expert social media charts,” so treat them as **robustness tests** (fonts, layouts, legend complexity), not as direct substitutes for your golden set.

## Metrics and evaluation design for structured chart extraction

A systematic optimization loop requires metrics that correlate with downstream utility, and chart work suggests that “lenient” evaluation can hide real failures (e.g., OCR shortcuts, lucky guesses). ChartBench explicitly critiques prior evaluation metrics as potentially inflating performance when they rely on lenient error ranges and don’t reflect true chart reasoning. citeturn18view0

### Field-level metrics that are informative in practice

A high-signal metrics suite for your schema typically includes:

- **Schema validity / parse success (gate)**: did the model produce JSON conforming to schema with required keys present? Gemini Structured Outputs is meant to reduce failures here, but you still want to track “null floods,” empty arrays, and mis-typed values. citeturn3search3turn10search1turn8search3
- **Chart type**: exact match over a small enum (accuracy).
- **Axis labels and units**: normalized string match (casefolding, whitespace collapse) plus soft match for minor OCR noise (edit distance threshold). (ChartQA-style evaluation often uses variants of exact match and relaxed numeric tolerance for chart QA; the broader point is that strict EM alone is brittle to minor lexical variation.) citeturn16search2turn16search6
- **Legend/series mapping**: set overlap (precision/recall/F1) on series names + correctness of series-to-color/marker mapping (this is where many systems fail).
- **Data values**:
  - For numeric arrays: per-point absolute/relative error with tolerance.
  - For bar/stacked-bar totals: sum-consistency checks.
  “Relaxed accuracy” with a numeric tolerance is a common pattern in chart QA benchmarking (e.g., exact match with 5% tolerance on numerical error). citeturn17view2
- **Source attribution text**: fuzzy match with high recall (you want to capture the text region even if OCR is imperfect) plus a downstream “linkability” metric (can it be matched to a known source list).

DSPy’s evaluation model is flexible here: a “metric” is just a function that assigns a score based on your definition of goodness, and can be as simple as accuracy/EM/F1 or more complex composite functions. citeturn16search0turn16search4turn0search5

### Scoring subjective fields without labeling everything

For key findings and synthetic alt text, you can avoid fully labeling every example by using:

- **Rubric-based LLM-as-judge** scoring (e.g., 1–5 on faithfulness-to-chart, salience, clarity, non-hallucination). The LLM-as-judge paradigm is well surveyed, including known limitations and reliability considerations. citeturn28search2turn28search17
- Optionally, a “dual-LLM” approach where an optimizer refines the judge prompt (as demonstrated in published work on extraction evaluation). citeturn28search8turn3search0

The operational trick: keep subjective scores **separate** from objective scores so that improvements in prose don’t hide regressions in data fidelity.

### Composite weighting and regression discipline

Weighting should reflect downstream harm:
- Wrong chart type, missing units, or incorrect time coverage can break grounding and mislead users—high weight.  
- Slight paraphrase differences in alt text are lower harm—lower weight.

ChartAB’s design is a strong hint that you should compute **task-specific metrics** rather than one universal metric: their benchmark defines different grounding tasks and provides templates/metrics tailored to those tasks, because a single metric won’t capture the right failure modes. citeturn27view0

For regression management, adopt a “software testing” view:
- Maintain a frozen **challenge set** of 8–15 charts representing edge cases.
- Every prompt/schema change must run your eval harness; only ship if challenge-set score doesn’t regress beyond a tolerance.

Promptfoo’s docs describe this workflow generically: define test cases, configure providers, run evaluation and record outputs, then use assertions/metrics (including “llm-rubric” style checks) to automate checks. citeturn3search1turn3search13turn3search17

## Optimizer and tooling landscape

You asked for an honest “effort-to-value” assessment at your scale.

### DSPy for vision extraction with complex structured outputs

DSPy now has first-class concepts that map well to your problem framing:

- **Multimodal inputs**: the adapter system explicitly supports converting pre-built DSPy types like `dspy.Image` into LM prompt messages. citeturn13view1turn13view0  
- **Complex structured outputs**: DSPy signatures define input/output fields; for non-primitive output types, the adapter includes JSON schema for the type and formats outputs so they can be parsed into structured data. citeturn13view1turn11search7
- **Native JSON / schema-constrained output**: DSPy’s `JSONAdapter` is intended for models that support native structured outputs through a `response_format` parameter. citeturn13view2turn12search9  
  In practice, this composes with Gemini via LiteLLM: LiteLLM documents “Structured Outputs (JSON Mode)” via `response_format: { type: "json_schema", ... }` and explicitly lists Gemini (Google AI Studio and Vertex AI) as supported. citeturn12search2turn12search0
- **Provider plumbing**: DSPy’s `dspy.LM` is a wrapper around LiteLLM, enabling many providers behind a consistent interface. citeturn12search1turn13view1

Where DSPy becomes especially relevant: **optimization**. MIPROv2 is documented as jointly optimizing few-shot examples and instructions using bootstrapping and Bayesian optimization; GEPA is reflective/evolutionary and supports text feedback in addition to scalar scores. citeturn4view0turn4view2turn1search0

Key caveat: your production runtime is TypeScript on Workers. DSPy would likely be used as an **offline compiler/optimizer** that emits prompt assets (instructions + few-shot examples) you then port into `prompts.ts`, rather than running DSPy in production.

### Ax in TypeScript

Ax explicitly positions itself as “DSPy for TypeScript,” with type-safe signatures and examples of nested objects/arrays plus validation constraints. citeturn14view0turn14view1 It also has explicit “optimization” documentation and a key operational feature: pass `maxMetricCalls` to bound evaluation cost, and GEPA and MiPRO share a unified optimized-program interface for save/load. citeturn15search0turn15search5turn15search3

At your scale (<50 examples), Ax is most compelling if you want to keep everything in TS and are comfortable with a newer ecosystem. It is still prudent to validate that Ax’s optimizer behaviors match the maturity and reproducibility you’d get from DSPy’s larger user base and documentation corpus.

### OPRO, TextGrad, and judge-driven optimization

- **OPRO (Optimization by PROmpting)** is a canonical “LLM-as-optimizer” method: the LLM proposes candidates based on previous candidates and scores, iterating to optimize task accuracy; it is explicitly demonstrated on prompt optimization and provides an open-source reference implementation. citeturn3search0turn3search20  
  However, there is published evidence that OPRO can be limited when the optimizer LLM is small and has constrained reasoning capacity—relevant if you were tempted to use a “Flash-class” model as the optimizer rather than as the evaluated target. citeturn3search16
- **TextGrad** frames prompt/system optimization as “automatic differentiation via text,” using LLM feedback as gradient-like signals to improve components of a compound system. citeturn1search5turn1search12  
  Follow-on work discussing TextGrad-style methods highlights practical issues like overfitting and the value/cost tradeoff of additional control structures (e.g., memory-augmented methods). citeturn1search2
- **LLM-as-judge** is increasingly formalized, with surveys on methodology and limitations. citeturn28search2turn28search4 For your subjective fields, this is the most pragmatic way to scale evaluation without labeling every sample.

### Promptfoo as the “production eval spine”

Promptfoo is not primarily a prompt optimizer; it is an evaluation harness with a strong configuration model for test cases, providers, and assertions (including model-graded or rubric-graded assertions). citeturn3search1turn3search13turn3search21 In a small team, it often becomes the backbone that makes *any* optimization approach safe—because you can’t improve what you can’t regression-test.

## Practical optimization workflow for this week

This is a concrete loop designed for your constraints: small team, 16 golden charts now, Gemini Flash in production, TypeScript pipeline, JSON Schema constrained output. The goal is to make progress without building a research platform.

### Establish a stable evaluation contract

Freeze (for now) the production schema and define three evaluation layers:

- **Gate checks**: valid schema-conforming JSON, required fields present, no empty critical arrays, no “null floods.” (Structured output should reduce invalid JSON, but you still need to detect “valid but useless.”) citeturn10search1turn3search3
- **Objective score**: chart type, axes, units, series list/mapping, temporal coverage, numeric extraction.
- **Subjective score**: key findings, alt text, judged by rubric.

Use the schema itself as a UX tool for the model: Google’s Vertex AI guidance calls out using the `description` field as a best practice to describe the schema’s purpose and properties (this matters because the schema text becomes part of what guides generation). citeturn10search3turn10search1turn10search7

### Expand from 16 to a more optimization-friendly set

Keep your 16 as a “core.” Add ~14–30 more charts to reach 30–50 total, prioritizing diversity in:
- stacked vs grouped bars, dual-axis, dense legends, low-resolution screenshots, rotated tick labels.

You can augment in-domain by scraping additional charts from similar expert threads (best), and supplement with out-of-domain robustness charts from OWID energy and other public sources (secondary). citeturn6search8turn23view0

### Build the metric functions you’ll actually optimize

Implement objective scoring as explicit functions. Examples:

- `chart_type_accuracy`: exact match over enum.
- `axis_label_score`: normalized EM + edit-distance threshold.
- `series_name_f1`: token-normalized F1 on series names.
- `series_mapping_score`: correctness of legend-to-series mapping (this will likely require canonicalizing colors/markers).
- `data_value_score`: per-point tolerance (e.g., abs(relative_error) <= 5%) inspired by “relaxed accuracy with tolerance” used in chart QA evaluations. citeturn17view2

For subjective fields, define a judge prompt and score 1–5 on:
- faithfulness (no invented numbers),
- salience (mentions main trend),
- clarity.

Ground this in LLM-as-judge best practices from survey literature (e.g., bias, consistency). citeturn28search2turn28search4

### Iterate with controlled search, not random edits

At 16–25 examples, start with **few-shot curation + manual iteration**, then optionally add automated search. When you reach ~30–50:

- **If you choose DSPy**: start with BootstrapFewShot (DSPy recommends it around ~10 examples) and move toward BootstrapFewShotWithRandomSearch as you approach 50+. citeturn5search11turn4view1  
  If you try MIPROv2, run “light” mode and keep validation strict; MIPROv2’s documented process explicitly uses bootstrapping and Bayesian optimization with trial evaluations. citeturn4view0  
  For GEPA, exploit its ability to use reflection and textual feedback (helpful when your metric can explain failures). citeturn4view2turn1search0
- **If you choose Ax**: wire your TS pipeline into Ax signatures and use its optimization guide to cap cost via `maxMetricCalls`, then export the optimized program/prompt asset. citeturn15search0turn14view0

In both cases, prefer a **stronger model** (e.g., a Pro-class model) as judge/teacher and keep Flash as the evaluated “student,” mirroring both DSPy’s “teacher settings” patterns and broader optimizer literature where optimizer strength matters. citeturn4view1turn3search16turn15search16

### Operationalize versioning and rollback

Treat prompt + schema as a versioned artifact:
- Add a prompt version ID into output metadata (even if not displayed).
- Store evaluation results per version.
- Rollback by switching the version pointer.

DSPy explicitly supports saving/loading programs (state-only or whole-program) in a way that maps cleanly to versioning compiled prompt assets. citeturn0search15

### Budgeting and cost containment

Gemini API pricing changes over time, so use the current official pricing page as source of truth. As of mid-March 2026, the Gemini Developer API pricing lists per-1M-token input and output prices (text/image/video share the same input price line items on that page). citeturn7search0

In optimization runs, your cost driver is **(number of evaluations) × (tokens per evaluation)**. Cap evaluations explicitly:
- Ax: `maxMetricCalls` guidance. citeturn15search0
- DSPy GEPA: parameters like `max_metric_calls`. citeturn4view2
- MIPROv2: limit candidates/trials/minibatch settings. citeturn4view0

## Chart-specific vision challenges that matter for your pipeline

The research and benchmark landscape is consistent: chart understanding is not “solved,” and failures cluster around perception and grounding, not just reasoning.

### Known failure modes

- **Bar charts remain a stress case**: DVQA is motivated by the claim that algorithms fail under minor bar-chart appearance variations and that state-of-the-art VQA performs poorly on bar-chart QA. citeturn24search0
- **Legend-to-series mapping is fragile**: LineEX’s comparative table marks legend-line mapping as missing in ChartOCR, and the paper frames legend mapping and scaling as explicit pipeline modules. citeturn26view0turn25view1
- **Color and spatial constraints**: MultiChartQA’s error analysis explicitly calls out struggles with visual perception and multi-step reasoning “especially when color or spatial constraints are involved,” which maps directly to stacked bars, area fills, and dense legends. citeturn23view0
- **Fine-grained grounding weaknesses and hallucinations**: ChartAB states that VLMs lack accurate perception of details and struggle to extract fine-grained structures; it reports hallucinations/misinterpretations and motivates multi-stage pipelines and structured templates. citeturn27view0
- **Real-world diversity regressions**: ChartQAPro reports large performance drops for strong models when moving from ChartQA-style distributions to more diverse “in the wild” charts—evidence that robustness is the real problem. citeturn22search2turn22search15

### Region-targeted prompting and multi-stage workflows

ChartAB provides unusually direct evidence on workflow structure: it proposes a multi-stage pipeline (ground each chart to structured representations, then compare), and reports that “direct alignment without grounding yields significantly weaker performance,” validating the idea that decomposition improves results. citeturn27view0

ChartOCR and LineEX similarly reflect a modular worldview: ChartOCR argues that chart style variation makes pure rule-based or naive end-to-end approaches problematic and proposes a hybrid framework; LineEX explicitly decomposes the system into keypoint extraction, element detection/text extraction, and grouping/legend mapping/scaling. citeturn25view0turn25view1

For your prompt optimization, this suggests a very practical A/B test:

- **Holistic single-shot extraction** (what you likely do now).
- **Decomposed extraction**: either (a) one prompt with explicit staged outputs inside JSON (axes block, legend block, data block), or (b) two calls/crops (legend+axes first, then values), merging downstream.

Then measure objectively whether bar/stacked-bar numeric and series mapping accuracy improve.

### The schema itself is part of prompt engineering

Your use of schema constraints is not just “output validation;” it is a control surface:

- Gemini Structured Outputs requires `response_mime_type: application/json` and `response_json_schema`, and outputs keys in the schema’s order—this affects determinism and downstream parsing. citeturn10search1turn10search7
- Vertex AI guidance explicitly recommends using schema `description` fields to describe the schema and its properties—these descriptions influence the model’s behavior. citeturn10search3

In practice, schema changes (enums vs free text, nullable vs required, tighter descriptions) can yield accuracy gains comparable to prompt wording changes—so include schema revisions in your experiment matrix (but version them carefully).

## Risks and limitations at your scale

Small golden sets are prone to “false certainty”: your initial 16-image success is a good sign, but it can mask brittleness.

Overfitting is a real risk in automated prompt search, especially for methods that do iterative self-improvement. Follow-on work on TextGrad-style optimization explicitly discusses susceptibility to overfitting and generalization instability in some approaches. citeturn1search2turn3search16

LLM-as-judge can dramatically reduce labeling effort, but it can also introduce bias, inconsistency, and self-reinforcing evaluation loops; this is why there are now extensive surveys on judge methodology and limitations. citeturn28search2turn28search4 Keep a small amount of human spot-checking in the loop.

Integration complexity can erase ROI: DSPy’s Gemini support is mediated through provider layers (LiteLLM) and can have provider-specific quirks; the DSPy community has ongoing issues/feature requests around Gemini usage and multimodal controls. citeturn13view1turn12search6turn0search2 This is another reason to treat DSPy as *offline optimization* rather than production runtime in your TS Workers stack.

Finally, cost surprises are operationally real in usage-based APIs; always bound evaluation calls and set quotas/alerts. Gemini pricing and platform costs should be treated as “current, checkable configuration,” not constants. citeturn7search0turn15search0

## Sources

DSPy framework and optimization:
- DSPy optimizers overview and dataset-size guidance (BootstrapFewShot ~10, RandomSearch ~50+, plus MIPROv2 guidance). citeturn5search11turn0search5  
- MIPROv2 algorithm description (bootstrapping, instruction proposals, Bayesian optimization). citeturn4view0  
- GEPA optimizer docs and GEPA paper framing (reflective/evolutionary, text feedback, fewer rollouts). citeturn4view2turn1search0  
- DSPy adapters and JSONAdapter (structured outputs via `response_format`, parsing to structured fields, `dspy.Image` support). citeturn13view1turn13view2turn13view0  
- DSPy “save/load program” tutorial for versioning prompt assets. citeturn0search15

Gemini structured outputs and pricing:
- Gemini Structured Outputs docs (`response_mime_type`, `response_json_schema`, key ordering). citeturn10search1turn3search3  
- Google blog on expanded JSON Schema support and improved adherence/property ordering (and compatibility with Pydantic/Zod). citeturn10search7  
- Gemini Developer API pricing (current as of March 2026 per the official page). citeturn7search0

Prompt optimization alternatives:
- OPRO (“Large Language Models as Optimizers”) primary paper + official code repo. citeturn3search0turn3search20  
- Limits of small-scale LLMs as optimizers (relevance to using smaller models in the optimizer role). citeturn3search16  
- TextGrad paper (automatic “differentiation” via text feedback). citeturn1search5  
- LLM-as-judge survey literature and a published dual-LLM judge+optimizer extraction-evaluation workflow. citeturn28search2turn28search8

Chart understanding benchmarks and failure analysis:
- DVQA (bar chart QA; motivated by sensitivity to appearance variation and poor performance of VQA baselines). citeturn24search0  
- DePlot (plot-to-table intermediate representation for reasoning). citeturn2search0turn2search12  
- MultiChartQA (error analysis: color/spatial constraints; multi-step reasoning; real-world chart sources incl. OWID). citeturn23view0  
- ChartQAPro (diverse charts; performance drops vs prior benchmarks). citeturn22search2turn22search15  
- ChartAB (multi-stage grounding/alignment pipeline; JSON templates; stronger than direct alignment). citeturn27view0  
- ChartOCR and LineEX (multi-module chart extraction pipelines; legend mapping and scaling as explicit modules; known limitations). citeturn25view0turn25view1turn26view0