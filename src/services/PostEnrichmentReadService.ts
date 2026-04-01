/**
 * Service for reading enrichment data for a post.
 *
 * Stub — implementation in SKY-77 Task 4.
 */

import { Context } from "effect";
import type { GetPostEnrichmentsOutput } from "../domain/enrichment";

export class PostEnrichmentReadService extends Context.Tag(
  "PostEnrichmentReadService"
)<PostEnrichmentReadService, {}>() {}
