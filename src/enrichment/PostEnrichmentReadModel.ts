import { Either, Schema } from "effect";
import {
  EnrichmentOutput,
  type PostEnrichmentResult,
  type EnrichmentReadiness,
  type PostEnrichmentRunSummary
} from "../domain/enrichment";

/**
 * Validate a stored enrichment record by decoding the payload and
 * verifying the kind discriminator matches the stored enrichment type.
 *
 * Returns null for decode failures or kind mismatches — these are
 * filtered out rather than surfaced as errors.
 */
export const validateStoredEnrichment = (enrichment: {
  readonly enrichmentType: string;
  readonly enrichmentPayload: unknown;
  readonly enrichedAt: number;
}): PostEnrichmentResult | null => {
  const decoded = Schema.decodeUnknownEither(EnrichmentOutput)(
    enrichment.enrichmentPayload
  );

  if (Either.isLeft(decoded)) {
    return null;
  }

  if (decoded.right.kind !== enrichment.enrichmentType) {
    return null;
  }

  return {
    kind: decoded.right.kind,
    payload: decoded.right,
    enrichedAt: enrichment.enrichedAt
  } as PostEnrichmentResult;
};

/**
 * Compute enrichment readiness from validated enrichments and latest
 * run summaries. Active runs always take precedence — a post is only
 * `complete` when enrichments exist AND no runs are still active.
 *
 * Priority order:
 * 1. any run is needs-review                        → needs-review
 * 2. any run is failed                              → failed
 * 3. any run is queued/running                      → pending
 * 4. validated enrichments exist (no active runs)   → complete
 * 5. else                                           → none
 *
 * This matches the glossary definition: a post is Reviewable only
 * when ALL enrichments are finished successfully.
 */
export const computeReadiness = (
  enrichments: ReadonlyArray<PostEnrichmentResult>,
  latestRuns: ReadonlyArray<PostEnrichmentRunSummary>
): EnrichmentReadiness => {
  if (latestRuns.some((r) => r.status === "needs-review")) return "needs-review";
  if (latestRuns.some((r) => r.status === "failed")) return "failed";
  if (latestRuns.some((r) => r.status === "queued" || r.status === "running")) return "pending";
  if (enrichments.length > 0) return "complete";
  return "none";
};
