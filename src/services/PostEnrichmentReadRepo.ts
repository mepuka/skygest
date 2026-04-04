import { ServiceMap, Effect } from "effect";
import { SqlError } from "effect/unstable/sql/SqlError";
import type { DbError } from "../domain/errors";
import type { EmbedPayload } from "../domain/embed";
import type {
  EnrichmentIssueItem,
  ListEnrichmentGapsInput,
  ListEnrichmentIssuesInput
} from "../domain/enrichment";
import type { PostUri } from "../domain/types";

export type GapCandidateRunStatus =
  | "queued"
  | "running"
  | "complete"
  | "failed"
  | "needs-review";

export type EnrichmentGapCandidate = {
  readonly postUri: PostUri;
  readonly hasLinks: boolean;
  readonly embedPayload: EmbedPayload | null;
  readonly hasVisionEnrichment: boolean;
  readonly hasSourceAttributionEnrichment: boolean;
  readonly latestVisionStatus: GapCandidateRunStatus | null;
  readonly latestSourceAttributionStatus: GapCandidateRunStatus | null;
};

export type ListGapCandidatesRepoInput = Pick<
  ListEnrichmentGapsInput,
  "platform" | "enrichmentType" | "since"
> & {
  readonly scanLimit: number;
};

export type ListEnrichmentIssuesRepoInput = Pick<
  ListEnrichmentIssuesInput,
  "status"
> & {
  readonly limit: number;
};

export class PostEnrichmentReadRepo extends ServiceMap.Service<
  PostEnrichmentReadRepo,
  {
    readonly listGapCandidates: (
      input: ListGapCandidatesRepoInput
    ) => Effect.Effect<ReadonlyArray<EnrichmentGapCandidate>, SqlError | DbError>;

    readonly listIssues: (
      input: ListEnrichmentIssuesRepoInput
    ) => Effect.Effect<ReadonlyArray<EnrichmentIssueItem>, SqlError | DbError>;
  }
>()("@skygest/PostEnrichmentReadRepo") {}
