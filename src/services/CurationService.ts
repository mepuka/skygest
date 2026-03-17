import { Clock, Context, Effect, Layer } from "effect";
import type { SqlError } from "@effect/sql/SqlError";
import type { DbError } from "../domain/errors";
import { BlueskyApiError } from "../domain/errors";
import type { AtUri } from "../domain/types";
import type {
  CurationCandidateOutput,
  CuratePostOutput,
  ListCurationCandidatesInput,
  CuratePostInput,
  CurationRecord
} from "../domain/curation";
import { CurationPostNotFoundError } from "../domain/curation";
import type { KnowledgePost } from "../domain/bi";
import { AppConfig } from "../platform/Config";
import { clampLimit } from "../platform/Limit";
import { CurationRepo } from "./CurationRepo";
import { ExpertsRepo } from "./ExpertsRepo";
import { PublicationsRepo } from "./PublicationsRepo";
import { CandidatePayloadService } from "./CandidatePayloadService";
import { BlueskyClient } from "../bluesky/BlueskyClient";
import { extractEmbedKind, buildTypedEmbed } from "../bluesky/EmbedExtract";
import { flattenThread } from "../bluesky/ThreadFlatten";
import {
  evaluateSignal,
  shouldFlag,
  defaultPredicates
} from "../curation/CurationPredicates";
import type { PostContext } from "../curation/CurationPredicates";

export class CurationService extends Context.Tag("@skygest/CurationService")<
  CurationService,
  {
    readonly flagBatch: (
      posts: ReadonlyArray<KnowledgePost>
    ) => Effect.Effect<number, SqlError | DbError>;

    readonly listCandidates: (
      input: ListCurationCandidatesInput
    ) => Effect.Effect<ReadonlyArray<CurationCandidateOutput>, SqlError | DbError>;

    readonly curatePost: (
      input: CuratePostInput,
      curator: string
    ) => Effect.Effect<CuratePostOutput, SqlError | DbError | CurationPostNotFoundError | BlueskyApiError>;
  }
>() {
  static readonly layer = Layer.effect(CurationService, Effect.gen(function* () {
    const curationRepo = yield* CurationRepo;
    const expertsRepo = yield* ExpertsRepo;
    const publicationsRepo = yield* PublicationsRepo;
    const payloadService = yield* CandidatePayloadService;
    const bskyClient = yield* BlueskyClient;
    const config = yield* AppConfig;

    const clampCurationLimit = (limit: number | undefined) =>
      clampLimit(limit, config.mcpLimitDefault, config.mcpLimitMax);

    // ---------------------------------------------------------------------------
    // flagBatch — batch-evaluate predicates, bulk-upsert flags into post_curation
    // ---------------------------------------------------------------------------
    const flagBatch = Effect.fn("CurationService.flagBatch")(
      function* (posts: ReadonlyArray<KnowledgePost>) {
        if (posts.length === 0) return 0;

        const now = yield* Clock.currentTimeMillis;

        // Pre-fetch expert tiers (amortized per batch)
        const uniqueDids = [...new Set(posts.map((p) => p.did))];
        const experts = yield* expertsRepo.getByDids(uniqueDids);
        const tierByDid = new Map(experts.map((e) => [e.did, e.tier]));

        // Pre-fetch publication tiers for link domains
        const allDomains = [...new Set(
          posts.flatMap((p) =>
            p.links
              .map((l) => l.domain)
              .filter((d): d is string => d !== null && d.length > 0)
          )
        )];
        const publications = yield* publicationsRepo.getByHostnames(allDomains);
        const publicationTiers: ReadonlyMap<string, string> = new Map(
          publications.map((p) => [p.hostname, p.tier])
        );

        // Evaluate predicates
        const threshold = config.curationMinSignalScore;
        const flagRecords: CurationRecord[] = [];

        for (const post of posts) {
          const ctx: PostContext = {
            post,
            expertTier: tierByDid.get(post.did) ?? null,
            publicationTiers
          };

          const signal = evaluateSignal(defaultPredicates, ctx);
          if (shouldFlag(signal, threshold)) {
            flagRecords.push({
              postUri: post.uri,
              status: "flagged",
              signalScore: signal.totalScore as any,
              predicatesApplied: signal.predicates.map((p) => p.name),
              flaggedAt: now,
              curatedAt: null,
              curatedBy: null,
              reviewNote: null
            } as CurationRecord);
          }
        }

        if (flagRecords.length === 0) return 0;
        return yield* curationRepo.bulkUpsertFlags(flagRecords);
      }
    );

    // ---------------------------------------------------------------------------
    // listCandidates
    // ---------------------------------------------------------------------------
    const listCandidates = Effect.fn("CurationService.listCandidates")(
      function* (input: ListCurationCandidatesInput) {
        return yield* curationRepo.listCandidates({
          ...input,
          limit: clampCurationLimit(input.limit)
        });
      }
    );

    // ---------------------------------------------------------------------------
    // curatePost — fetch embed data, atomically write curation + payload
    // ---------------------------------------------------------------------------
    const curatePost = Effect.fn("CurationService.curatePost")(
      function* (input: CuratePostInput, curator: string) {
        const now = yield* Clock.currentTimeMillis;

        // Verify post exists in D1
        const exists = yield* curationRepo.postExists(input.postUri);
        if (!exists) {
          return yield* CurationPostNotFoundError.make({ postUri: input.postUri });
        }

        // Check current curation state
        const existing = yield* curationRepo.getByPostUri(input.postUri);

        // Idempotency: if already in target state, return current state
        if (existing) {
          if (input.action === "curate" && existing.status === "curated") {
            return {
              postUri: input.postUri,
              action: input.action,
              previousStatus: existing.status,
              newStatus: "curated" as const
            };
          }
          if (input.action === "reject" && existing.status === "rejected") {
            return {
              postUri: input.postUri,
              action: input.action,
              previousStatus: existing.status,
              newStatus: "rejected" as const
            };
          }
        }

        const previousStatus = existing?.status ?? null;

        if (input.action === "reject") {
          yield* curationRepo.updateStatus(
            input.postUri,
            "rejected",
            curator,
            input.note ?? null,
            now
          );
          return {
            postUri: input.postUri,
            action: input.action,
            previousStatus,
            newStatus: "rejected" as const
          };
        }

        // action === "curate"
        // Fetch live thread from Bluesky to get embed data
        const threadResponse = yield* bskyClient.getPostThread(input.postUri, {
          depth: 0,
          parentHeight: 0
        });

        const flat = flattenThread(threadResponse.thread);
        const focusPost = flat?.focus?.post;

        if (!focusPost) {
          return yield* new BlueskyApiError({
            message: `Thread data unavailable for ${input.postUri} — cannot curate without embed data`
          });
        }

        // Extract typed embed from the focus post
        const embedType = extractEmbedKind(focusPost.embed as any);
        const embedPayload = buildTypedEmbed(focusPost.embed);

        // Write payload FIRST — if this fails, status stays flagged and retry works.
        // Writing status last ensures the idempotency guard (early return on "curated")
        // only triggers after payload is safely persisted.
        yield* payloadService.capturePayload({
          postUri: input.postUri as AtUri,
          captureStage: "candidate",
          embedType: embedType as any,
          embedPayload
        });

        yield* payloadService.markPicked(input.postUri as AtUri);

        yield* curationRepo.updateStatus(
          input.postUri,
          "curated",
          curator,
          input.note ?? null,
          now
        );

        return {
          postUri: input.postUri,
          action: input.action,
          previousStatus,
          newStatus: "curated" as const
        };
      }
    );

    return CurationService.of({
      flagBatch,
      listCandidates,
      curatePost
    });
  }));
}
