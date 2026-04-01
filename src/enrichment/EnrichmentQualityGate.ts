import { Predicate } from "effect";
import type { VisionEnrichment } from "../domain/enrichment";

// ---------------------------------------------------------------------------
// Individual quality predicates
// ---------------------------------------------------------------------------

/** At least one asset was analyzed. */
export const hasAssets: Predicate.Predicate<VisionEnrichment> =
  (e) => e.assets.length > 0;

/** At least one key finding exists (asset-level or summary-level). */
export const hasFindings: Predicate.Predicate<VisionEnrichment> =
  (e) =>
    e.assets.some((a) => a.analysis.keyFindings.length > 0) ||
    e.summary.keyFindings.length > 0;

/**
 * At least one asset produced a useful analysis signal.
 * Charts, screenshots with source clues, and images with org/logo
 * identification all count — not just chart type detection.
 */
export const hasAnalysisSignal: Predicate.Predicate<VisionEnrichment> =
  (e) =>
    e.assets.some((a) =>
      a.analysis.chartTypes.length > 0 ||
      a.analysis.visibleUrls.length > 0 ||
      a.analysis.organizationMentions.length > 0 ||
      a.analysis.sourceLines.length > 0 ||
      a.analysis.logoText.length > 0 ||
      a.analysis.title !== null
    );

// ---------------------------------------------------------------------------
// Composed gate
// ---------------------------------------------------------------------------

/**
 * Gate predicates: hasAssets AND hasAnalysisSignal.
 *
 * hasFindings is intentionally NOT part of the gate. A screenshot with
 * strong source clues (URLs, org mentions, source lines) but no explicit
 * "key findings" text is still useful for downstream source attribution.
 * hasFindings is exported for eval/reporting (SKY-42) but does not block
 * the Enriching → Reviewable transition.
 */
export const isUsable: Predicate.Predicate<VisionEnrichment> = Predicate.and(
  hasAssets,
  hasAnalysisSignal
);

// ---------------------------------------------------------------------------
// Verdict with reason (for workflow validation step)
// ---------------------------------------------------------------------------

export type GateVerdict =
  | { readonly outcome: "usable" }
  | { readonly outcome: "needs-review"; readonly reason: string };

type QualityCheck = {
  readonly predicate: Predicate.Predicate<VisionEnrichment>;
  readonly reason: string;
};

const qualityChecks: ReadonlyArray<QualityCheck> = [
  { predicate: hasAssets, reason: "vision produced zero asset analyses" },
  {
    predicate: hasAnalysisSignal,
    reason: "vision produced no analysis signal (no chart types, URLs, organizations, sources, logos, or titles)"
  }
];

export const assessVisionQuality = (
  enrichment: VisionEnrichment
): GateVerdict => {
  for (const check of qualityChecks) {
    if (!check.predicate(enrichment)) {
      return { outcome: "needs-review", reason: check.reason };
    }
  }
  return { outcome: "usable" };
};
