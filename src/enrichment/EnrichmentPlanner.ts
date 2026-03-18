import { SqlClient } from "@effect/sql";
import type { SqlError } from "@effect/sql/SqlError";
import { Context, Effect, Either, Layer, Schema } from "effect";
import {
  CandidatePayloadNotPickedError,
  type CandidatePayloadRecord
} from "../domain/candidatePayload";
import { isPickedCandidatePayloadRecord } from "../domain/CandidatePayloadPredicates";
import type { DbError } from "../domain/errors";
import {
  EnrichmentPayloadMissingError,
  EnrichmentPostContextMissingError
} from "../domain/errors";
import {
  type EnrichmentPlannedAsset,
  EnrichmentExecutionPlan,
  EnrichmentPlannerInput
} from "../domain/enrichmentPlan";
import { EnrichmentOutput } from "../domain/enrichment";
import type { EmbedPayload, LinkEmbed } from "../domain/embed";
import type { AtUri } from "../domain/types";
import { CandidatePayloadRepo } from "../services/CandidatePayloadRepo";
import { decodeWithDbError } from "../services/d1/schemaDecode";
import {
  evaluateEnrichmentPlanningDecision,
  type EnrichmentPlanningContext
} from "./EnrichmentPredicates";

const PlannerPostRowSchema = Schema.Struct({
  postUri: Schema.String,
  did: Schema.String,
  text: Schema.String,
  createdAt: Schema.NonNegativeInt,
  status: Schema.String
});
const PlannerPostRowsSchema = Schema.Array(PlannerPostRowSchema);

const PlannerLinkRowSchema = Schema.Struct({
  url: Schema.String,
  title: Schema.NullOr(Schema.String),
  description: Schema.NullOr(Schema.String),
  imageUrl: Schema.NullOr(Schema.String),
  domain: Schema.NullOr(Schema.String),
  extractedAt: Schema.NonNegativeInt
});
const PlannerLinkRowsSchema = Schema.Array(PlannerLinkRowSchema);

const PlannerTopicRowSchema = Schema.Struct({
  postUri: Schema.String,
  topicSlug: Schema.String,
  matchedTerm: Schema.NullOr(Schema.String),
  matchSignal: Schema.String,
  matchValue: Schema.NullOr(Schema.String),
  matchScore: Schema.NullOr(Schema.Number),
  ontologyVersion: Schema.String,
  matcherVersion: Schema.String
});
const PlannerTopicRowsSchema = Schema.Array(PlannerTopicRowSchema);

const toAssetKey = (
  source: "embed" | "media",
  index: number,
  stableRef: string | null
) => `${source}:${index}:${stableRef ?? "missing-ref"}`;

const toLinkCardContext = (
  source: "embed" | "media",
  link: LinkEmbed
) => ({
  source,
  uri: link.uri,
  title: link.title,
  description: link.description,
  thumb: link.thumb
});

const extractQuoteContext = (embedPayload: EmbedPayload | null) => {
  if (embedPayload === null) {
    return null;
  }

  switch (embedPayload.kind) {
    case "quote":
      return {
        source: "embed" as const,
        uri: embedPayload.uri,
        text: embedPayload.text,
        author: embedPayload.author
      };
    case "media":
      return embedPayload.record === null
        ? null
        : {
            source: "media" as const,
            uri: embedPayload.record.uri,
            text: embedPayload.record.text,
            author: embedPayload.record.author
          };
    default:
      return null;
  }
};

const extractLinkCards = (embedPayload: EmbedPayload | null) => {
  if (embedPayload === null) {
    return [];
  }

  switch (embedPayload.kind) {
    case "link":
      return [toLinkCardContext("embed", embedPayload)];
    case "media":
      return embedPayload.media?.kind === "link"
        ? [toLinkCardContext("media", embedPayload.media)]
        : [];
    default:
      return [];
  }
};

const extractAssetsFromMedia = (
  source: "embed" | "media",
  embedPayload: Exclude<EmbedPayload, { kind: "quote" | "link" }>
): ReadonlyArray<EnrichmentPlannedAsset> => {
  switch (embedPayload.kind) {
    case "img":
      return embedPayload.images.map((image, index) => ({
        assetKey: toAssetKey(source, index, image.fullsize),
        assetType: "image" as const,
        source,
        index,
        thumb: image.thumb,
        fullsize: image.fullsize,
        alt: image.alt
      }));
    case "video":
      return [
        {
          assetKey: toAssetKey(source, 0, embedPayload.playlist),
          assetType: "video" as const,
          source,
          index: 0,
          playlist: embedPayload.playlist,
          thumbnail: embedPayload.thumbnail,
          alt: embedPayload.alt
        }
      ];
    case "media":
      return embedPayload.media === null ||
        (embedPayload.media.kind !== "img" && embedPayload.media.kind !== "video")
        ? []
        : extractAssetsFromMedia("media", embedPayload.media);
  }
};

const extractAssets = (embedPayload: EmbedPayload | null) => {
  if (embedPayload === null) {
    return [];
  }

  switch (embedPayload.kind) {
    case "img":
    case "video":
    case "media":
      return extractAssetsFromMedia("embed", embedPayload);
    default:
      return [];
  }
};

const decodeExistingEnrichments = (payload: CandidatePayloadRecord) =>
  payload.enrichments.flatMap((enrichment) => {
    const decoded = Schema.decodeUnknownEither(EnrichmentOutput)(
      enrichment.enrichmentPayload
    );

    return Either.isRight(decoded)
      ? [
          {
            output: decoded.right,
            updatedAt: enrichment.updatedAt,
            enrichedAt: enrichment.enrichedAt
          }
        ]
      : [];
  });

export class EnrichmentPlanner extends Context.Tag("@skygest/EnrichmentPlanner")<
  EnrichmentPlanner,
  {
    readonly plan: (
      input: Schema.Schema.Type<typeof EnrichmentPlannerInput>
    ) => Effect.Effect<
      Schema.Schema.Type<typeof EnrichmentExecutionPlan>,
      | SqlError
      | DbError
      | EnrichmentPayloadMissingError
      | CandidatePayloadNotPickedError
      | EnrichmentPostContextMissingError
    >;
  }
>() {
  static readonly layer = Layer.effect(
    EnrichmentPlanner,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const payloads = yield* CandidatePayloadRepo;

      const loadPickedPayload = Effect.fn("EnrichmentPlanner.loadPickedPayload")(
        function* (postUri: AtUri) {
          const payload = yield* payloads.getByPostUri(postUri);

          if (payload === null) {
            return yield* EnrichmentPayloadMissingError.make({ postUri });
          }

          if (!isPickedCandidatePayloadRecord(payload)) {
            return yield* CandidatePayloadNotPickedError.make({
              postUri,
              captureStage: payload.captureStage
            });
          }

          return payload;
        }
      );

      const loadPostContext = Effect.fn("EnrichmentPlanner.loadPostContext")(
        function* (postUri: AtUri) {
          const rows = yield* sql<any>`
            SELECT
              uri as postUri,
              did as did,
              text as text,
              created_at as createdAt,
              status as status
            FROM posts
            WHERE uri = ${postUri}
            LIMIT 1
          `.pipe(
            Effect.flatMap((rawRows) =>
              decodeWithDbError(
                PlannerPostRowsSchema,
                rawRows,
                `Failed to decode stored post context for ${postUri}`
              )
            )
          );

          const row = rows[0];
          if (row === undefined || row.status !== "active") {
            return yield* EnrichmentPostContextMissingError.make({ postUri });
          }

          const links = yield* sql<any>`
            SELECT
              url as url,
              title as title,
              description as description,
              image_url as imageUrl,
              domain as domain,
              extracted_at as extractedAt
            FROM links
            WHERE post_uri = ${postUri}
            ORDER BY extracted_at ASC, url ASC
          `.pipe(
            Effect.flatMap((rawRows) =>
              decodeWithDbError(
                PlannerLinkRowsSchema,
                rawRows,
                `Failed to decode stored links for ${postUri}`
              )
            )
          );

          const topicMatches = yield* sql<any>`
            SELECT
              post_uri as postUri,
              topic_slug as topicSlug,
              matched_term as matchedTerm,
              match_signal as matchSignal,
              match_value as matchValue,
              match_score as matchScore,
              ontology_version as ontologyVersion,
              matcher_version as matcherVersion
            FROM post_topics
            WHERE post_uri = ${postUri}
            ORDER BY topic_slug ASC
          `.pipe(
            Effect.flatMap((rawRows) =>
              decodeWithDbError(
                PlannerTopicRowsSchema,
                rawRows,
                `Failed to decode stored topic matches for ${postUri}`
              )
            )
          );

          return {
            post: {
              postUri: row.postUri as AtUri,
              did: row.did,
              text: row.text,
              createdAt: row.createdAt,
              threadCoverage: "focus-only" as const
            },
            links,
            topicMatches
          };
        }
      );

      const plan = Effect.fn("EnrichmentPlanner.plan")(function* (
        input: Schema.Schema.Type<typeof EnrichmentPlannerInput>
      ) {
        const validated = yield* decodeWithDbError(
          EnrichmentPlannerInput,
          input,
          "Invalid enrichment planner input"
        );
        const payload = yield* loadPickedPayload(validated.postUri);
        const postContext = yield* loadPostContext(validated.postUri);
        const assets = extractAssets(payload.embedPayload);
        const quote = extractQuoteContext(payload.embedPayload);
        const linkCards = extractLinkCards(payload.embedPayload);
        const existingEnrichments = decodeExistingEnrichments(payload);
        const planningContext: EnrichmentPlanningContext = {
          enrichmentType: validated.enrichmentType,
          assets,
          links: postContext.links,
          quote,
          linkCards,
          existingEnrichments
        };
        const outcome = evaluateEnrichmentPlanningDecision(planningContext);

        return yield* decodeWithDbError(
          EnrichmentExecutionPlan,
          {
            postUri: validated.postUri,
            enrichmentType: validated.enrichmentType,
            schemaVersion: validated.schemaVersion,
            decision: outcome.decision,
            ...(outcome.decision === "skip"
              ? { stopReason: outcome.stopReason }
              : {}),
            captureStage: "picked",
            post: postContext.post,
            embedType: payload.embedType,
            embedPayload: payload.embedPayload,
            links: postContext.links,
            topicMatches: postContext.topicMatches,
            quote,
            linkCards,
            assets,
            existingEnrichments
          },
          `Failed to normalize enrichment execution plan for ${validated.postUri}`
        );
      });

      return EnrichmentPlanner.of({
        plan
      });
    })
  );
}
