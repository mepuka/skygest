/**
 * Pure read model for post enrichment data.
 *
 * Stub — implementation in SKY-77 Task 2.
 */

import { Effect } from "effect";
import type { PostEnrichmentResult, EnrichmentReadiness } from "../domain/enrichment";

/** Validate a stored enrichment JSON blob into a typed result. */
export const validateStoredEnrichment = (
  _raw: unknown
): Effect.Effect<PostEnrichmentResult> =>
  Effect.die("PostEnrichmentReadModel.validateStoredEnrichment not implemented");

/** Compute overall readiness from enrichment results and run summaries. */
export const computeReadiness = (
  _enrichments: ReadonlyArray<PostEnrichmentResult>,
  _runs: ReadonlyArray<unknown>
): EnrichmentReadiness => "none" as EnrichmentReadiness;
