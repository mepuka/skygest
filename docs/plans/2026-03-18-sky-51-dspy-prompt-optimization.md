# SKY-51 — DSPy Prompt Optimization Research

## DSPy Setup for Vision Extraction

### Gemini Integration

```python
import dspy
lm = dspy.LM(model="gemini/gemini-2.5-flash")
dspy.configure(lm=lm)
```

### Vision Signature

```python
class ChartClassification(dspy.Signature):
    """Classify an energy chart image."""
    image: dspy.Image = dspy.InputField()
    media_type: str = dspy.OutputField(desc="chart, document-excerpt, photo, infographic, or video")
    chart_types: list[str] = dspy.OutputField(desc="Chart types from the ontology enum")
    has_data_points: bool = dspy.OutputField()

class ChartExtraction(dspy.Signature):
    """Extract structured data from an energy chart image using Charts-of-Thought."""
    image: dspy.Image = dspy.InputField()
    chart_data: ChartData = dspy.OutputField()  # Pydantic model matching VisionEnrichment
```

### Optimizer Choice

With ~16 golden examples: **BootstrapFewShot** (designed for ~10 examples).
- MIPROv2 needs 200+ examples to avoid overfitting
- BootstrapFewShot bootstraps demonstration examples and selects those that pass the metric

### Metrics

```python
def chart_extraction_metric(example, prediction):
    score = 0.0
    # Deterministic: chart type match
    if set(prediction.chart_data.chart_types) & set(example.chart_types):
        score += 0.2
    # Deterministic: series count
    if len(prediction.chart_data.series) == len(example.series):
        score += 0.2
    # Deterministic: source lines present
    if prediction.chart_data.source_lines and example.source_lines:
        score += 0.2
    # Deterministic: temporal coverage
    if prediction.chart_data.temporal_coverage == example.temporal_coverage:
        score += 0.2
    # Semantic: key findings (LLM-as-judge or embedding similarity)
    score += 0.2 * findings_similarity(prediction.chart_data.key_findings, example.key_findings)
    return score
```

## Alternative: Ax (TypeScript DSPy)

Endorsed by DSPy creator Omar Khattab as the "official" TypeScript port.

```typescript
import { AxAI, AxChainOfThought, AxSignature } from "@ax-llm/ax";

const sig = new AxSignature("image:image -> chartData:json");
const program = new AxChainOfThought(sig);

const ai = new AxAI({ name: "google-gemini", model: "gemini-2.5-flash" });
const result = await program.forward(ai, { image: imageUrl });
```

- AxGEPA optimizer runs entirely in TypeScript
- Could integrate with Effect pipeline
- Less mature than Python DSPy for vision tasks

## Alternative: Promptfoo for Quick A/B

No code changes needed. YAML config:

```yaml
providers:
  - id: google:gemini-2.5-flash
    config:
      response_format:
        type: json_schema

prompts:
  - file://prompts/extraction-v1.txt
  - file://prompts/extraction-v2-with-examples.txt

tests:
  - vars:
      image: file://eval/vision/images/shaffer-hydro-01.jpg
    assert:
      - type: is-json
      - type: javascript
        value: |
          const d = JSON.parse(output);
          return d.chartTypes?.includes('bar-chart') ? 1.0 : 0.0;
```

## Recommended Project Structure

```
optimization/
  pyproject.toml          ← uv-managed Python project
  src/
    signatures.py         ← DSPy signatures (Classification, Extraction)
    models.py             ← Pydantic models matching VisionEnrichment
    metrics.py            ← Scoring functions (field-level)
    dataset.py            ← Load golden-set.jsonl + hand-annotated expected outputs
    optimize.py           ← BootstrapFewShot optimization runner
    evaluate.py           ← Run evaluation, print score report
    export.py             ← Export optimized prompts to prompts.ts format
  README.md
eval/vision/
  golden-set.jsonl        ← Shared input (used by TS eval + DSPy)
  expected/               ← Hand-annotated expected outputs (ground truth)
  runs/                   ← TS eval outputs
```

## Workflow

1. Run `bun scripts/run-eval.ts` → baseline extraction results
2. Hand-annotate expected outputs for key images → `eval/vision/expected/`
3. Run `uv run python optimization/src/evaluate.py` → field-level scores
4. Run `uv run python optimization/src/optimize.py` → BootstrapFewShot finds better prompts
5. Review optimized prompt, copy to `src/enrichment/prompts.ts`
6. Re-run `bun scripts/run-eval.ts` → verify improvement
7. Repeat

## Sources

- DSPy: https://dspy.ai/
- DSPy BootstrapFewShot: https://dspy.ai/api/optimizers/BootstrapFewShot/
- DSPy Vision: https://github.com/stanfordnlp/dspy/issues/459
- Ax Framework: https://github.com/ax-llm/ax
- Promptfoo: https://www.promptfoo.dev/
- DSPy + Gemini blog: https://saptak.in/writing/2025/04/25/building-ai-applications-with-dspy-and-gemini-flash
- 20pp improvement with DSPy GEPA: https://kmad.ai/DSPy-Optimization
