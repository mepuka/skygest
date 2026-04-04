import { Clock, ServiceMap, Effect, Layer, Option } from "effect";
import { SqlError } from "effect/unstable/sql/SqlError";
import type { DbError } from "../domain/errors";
import { BlueskyApiError } from "../domain/errors";
import type { PostUri } from "../domain/types";
import type {
  BulkCurateInput,
  BulkCurateOutput,
  CurationCandidateCountOutput,
  CurationCandidateExportPageOutput,
  CurationCandidatePageOutput,
  CuratePostOutput,
  ListCurationCandidatesInput,
  CuratePostInput,
  CurationRecord
} from "../domain/curation";
import { CurationPostNotFoundError } from "../domain/curation";
import type { KnowledgePost } from "../domain/bi";
import {
  defaultSchemaVersionForEnrichmentKind,
  type EnrichmentKind
} from "../domain/enrichment";
import type { EmbedPayload } from "../domain/embed";
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
import { EnrichmentWorkflowLauncher } from "../enrichment/EnrichmentWorkflowLauncher";

export class CurationService extends ServiceMap.Service<
  CurationService,
  {
    readonly flagBatch: (
      posts: ReadonlyArray<KnowledgePost>
    ) => Effect.Effect<number, SqlError | DbError>;

    readonly listCandidates: (
      input: ListCurationCandidatesInput
    ) => Effect.Effect<CurationCandidatePageOutput, SqlError | DbError>;

    readonly exportCandidates: (
      input: ListCurationCandidatesInput
    ) => Effect.Effect<CurationCandidateExportPageOutput, SqlError | DbError>;

    readonly countCandidates: (
      input: ListCurationCandidatesInput
    ) => Effect.Effect<CurationCandidateCountOutput, SqlError | DbError>;

    readonly curatePost: (
      input: CuratePostInput,
      curator: string
    ) => Effect.Effect<CuratePostOutput, SqlError | DbError | CurationPostNotFoundError | BlueskyApiError>;

    readonly bulkCurate: (
      input: BulkCurateInput,
      curator: string
    ) => Effect.Effect<BulkCurateOutput>;
  }
>()("@skygest/CurationService") {
  static readonly layer = Layer.effect(CurationService, Effect.gen(function* () {
    const curationRepo = yield* CurationRepo;
    const expertsRepo = yield* ExpertsRepo;
    const publicationsRepo = yield* PublicationsRepo;
    const payloadService = yield* CandidatePayloadService;
    const bskyClient = yield* BlueskyClient;
    const config = yield* AppConfig;

    const clampCurationLimit = (limit: number | undefined) =>
      clampLimit(limit, config.mcpLimitDefault, config.mcpLimitMax);

    const hasVisualAssets = (embedPayload: EmbedPayload | null): boolean => {
      if (embedPayload === null) {
        return false;
      }

      switch (embedPayload.kind) {
        case "img":
        case "video":
          return true;
        case "media":
          return embedPayload.media !== null && hasVisualAssets(embedPayload.media);
        default:
          return false;
      }
    };

    const queuePickedEnrichment = Effect.fn(
      "CurationService.queuePickedEnrichment"
    )(function* (postUri: PostUri, embedPayload: EmbedPayload | null, curator: string) {
      const maybeLauncher = yield* Effect.serviceOption(EnrichmentWorkflowLauncher);

      if (Option.isNone(maybeLauncher)) {
        return false;
      }

      const enrichmentType: EnrichmentKind = hasVisualAssets(embedPayload)
        ? "vision"
        : "source-attribution";

      return yield* maybeLauncher.value.startIfAbsent({
        postUri,
        enrichmentType,
        schemaVersion: defaultSchemaVersionForEnrichmentKind(enrichmentType),
        triggeredBy: "pick",
        requestedBy: curator
      });
    });

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

    const exportCandidates = Effect.fn("CurationService.exportCandidates")(
      function* (input: ListCurationCandidatesInput) {
        return yield* curationRepo.exportCandidates({
          ...input,
          limit: clampCurationLimit(input.limit)
        });
      }
    );

    const countCandidates = Effect.fn("CurationService.countCandidates")(
      function* (input: ListCurationCandidatesInput) {
        return yield* curationRepo.countCandidates(input);
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
          return yield* new CurationPostNotFoundError({ postUri: input.postUri });
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

        // Twitter posts: skip Bluesky thread fetch, use stored payload from import
        const isTwitter = (input.postUri as string).startsWith("x://");

        if (isTwitter && input.action === "curate") {
          const existingPayload = yield* payloadService.getPayload(input.postUri);
          const storedEmbedType = yield* curationRepo.getPostEmbedType(input.postUri);

          if (storedEmbedType !== null && existingPayload?.embedPayload == null) {
            return yield* new BlueskyApiError({
              message: `Imported post ${input.postUri} is missing stored media details and cannot be curated yet`
            });
          }

          if (existingPayload !== null && existingPayload.captureStage !== "picked") {
            yield* payloadService.markPicked(input.postUri);
          }

          yield* curationRepo.updateStatus(input.postUri, "curated", curator, input.note ?? null, now);

          if (existingPayload !== null) {
            yield* queuePickedEnrichment(input.postUri, existingPayload.embedPayload, curator)
              .pipe(Effect.catch(() => Effect.succeed(false)));
          }

          return { postUri: input.postUri, action: input.action, previousStatus, newStatus: "curated" as const };
        }

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
        // Check if payload already exists (e.g., captured at import time by CLI ingest-url)
        const existingPayload = yield* payloadService.getPayload(input.postUri);
        const storedEmbedType = yield* curationRepo.getPostEmbedType(input.postUri);

        if (existingPayload !== null && existingPayload.embedPayload != null) {
          // Payload exists from import — use stored data, skip live fetch
          // (mirrors the Twitter path at lines 214-235)
          if (existingPayload.captureStage !== "picked") {
            yield* payloadService.markPicked(input.postUri);
          }

          yield* curationRepo.updateStatus(input.postUri, "curated", curator, input.note ?? null, now);

          yield* queuePickedEnrichment(input.postUri, existingPayload.embedPayload, curator)
            .pipe(Effect.catch(() => Effect.succeed(false)));

          return { postUri: input.postUri, action: input.action, previousStatus, newStatus: "curated" as const };
        }

        // Guard: if the post has a known embed type but the stored payload is null,
        // it cannot be curated yet — same guard as the Twitter path (line 218)
        if (storedEmbedType !== null && existingPayload?.embedPayload == null && existingPayload !== null) {
          return yield* new BlueskyApiError({
            message: `Post ${input.postUri} has embed type "${String(storedEmbedType)}" but no stored media data — cannot curate yet`
          });
        }

        // No stored payload — fetch live thread from Bluesky (existing behavior)
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
          postUri: input.postUri,
          captureStage: "candidate",
          embedType: embedType as any,
          embedPayload
        });

        yield* payloadService.markPicked(input.postUri);

        yield* curationRepo.updateStatus(
          input.postUri,
          "curated",
          curator,
          input.note ?? null,
          now
        );

        yield* queuePickedEnrichment(
          input.postUri,
          embedPayload,
          curator
        ).pipe(
          Effect.catch(() => Effect.succeed(false))
        );

        return {
          postUri: input.postUri,
          action: input.action,
          previousStatus,
          newStatus: "curated" as const
        };
      }
    );

    const bulkCurate = Effect.fn("CurationService.bulkCurate")(
      function* (input: BulkCurateInput, curator: string) {
        const results = yield* Effect.forEach(
          input.decisions,
          (decision) =>
            curatePost(decision, curator).pipe(
              Effect.match({
                onFailure: (error) => ({
                  postUri: decision.postUri,
                  error: error.message
                }),
                onSuccess: (result) => result
              })
            ),
          { concurrency: 8 }
        );

        let curated = 0;
        let rejected = 0;
        let skipped = 0;
        const errors: Array<BulkCurateOutput["errors"][number]> = [];

        for (const result of results) {
          if ("error" in result) {
            errors.push(result);
            continue;
          }

          if (result.previousStatus === result.newStatus) {
            skipped += 1;
            continue;
          }

          if (result.newStatus === "curated") {
            curated += 1;
            continue;
          }

          rejected += 1;
        }

        return {
          curated,
          rejected,
          skipped,
          errors
        };
      }
    );

    return {
      flagBatch,
      listCandidates,
      exportCandidates,
      countCandidates,
      curatePost,
      bulkCurate
    };
  }));
}
