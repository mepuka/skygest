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

/** All three checks must pass for the enrichment to be considered usable. */
export const isUsable: Predicate.Predicate<VisionEnrichment> = Predicate.and(
  hasAssets,
  Predicate.and(hasFindings, hasAnalysisSignal)
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
    predicate: hasFindings,
    reason: "vision produced no key findings across all assets"
  },
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
