import { Clock, Effect, Exit, Layer, Schema, ServiceMap } from "effect";
import { SqlClient } from "effect/unstable/sql";
import type { SqlError } from "effect/unstable/sql/SqlError";
import {
  EntityGraphRepo,
  EntityIngestionWriter,
  Organization,
  OrganizationEntity,
  OrganizationIri,
  PublisherRoleIri,
  asEntityIri,
  asEntityTag
} from "@skygest/ontology-store";
import type { DbError } from "../domain/errors";
import { PublicationRecord } from "../domain/bi";
import { decodeWithDbError } from "./d1/schemaDecode";
import { publicationDisplayLabel } from "../source/publicationResolver";

export interface EntityOrganizationBackfillInput {
  readonly limit?: number;
  readonly offset?: number;
}

export interface EntityOrganizationBackfillResult {
  readonly total: number;
  readonly scanned: number;
  readonly migrated: number;
  readonly queued: number;
  readonly bearsEdges: number;
  readonly failed: number;
  readonly failedPublicationIds: ReadonlyArray<string>;
}

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;
const BACKFILL_ASSERTED_BY = "EntityOrganizationBackfillService" as const;
const PUBLISHER_ROLE_ENTITY_TAG = asEntityTag("PublisherRole");

const normalizeLimit = (limit: number | undefined): number =>
  limit === undefined || !Number.isFinite(limit)
    ? DEFAULT_LIMIT
    : Math.min(MAX_LIMIT, Math.max(1, Math.floor(limit)));

const normalizeOffset = (offset: number | undefined): number =>
  offset === undefined || !Number.isFinite(offset)
    ? 0
    : Math.max(0, Math.floor(offset));

const CountRow = Schema.Struct({
  total: Schema.Number
});

const decodeCountRows = (rows: unknown) =>
  decodeWithDbError(
    Schema.Array(CountRow),
    rows,
    "Failed to decode publication count rows"
  );

const decodePublicationRows = (rows: unknown) =>
  decodeWithDbError(
    Schema.Array(PublicationRecord),
    rows,
    "Failed to decode publication rows for organization backfill"
  );

const slugify = (value: string): string =>
  value.replace(/[^A-Za-z0-9_-]+/g, "_");

const titleCaseSlug = (value: string): string =>
  value
    .replace(/[-_]+/g, " ")
    .replace(/\b[a-z]/g, (letter) => letter.toUpperCase());

const organizationIriForPublication = (
  publicationId: string
): Effect.Effect<OrganizationIri, Schema.SchemaError> =>
  Schema.decodeUnknownEffect(OrganizationIri)(
    `https://w3id.org/energy-intel/organization/${slugify(publicationId)}`
  );

const publisherRoleIriForPublication = (
  publicationId: string
): Effect.Effect<PublisherRoleIri, Schema.SchemaError> =>
  Schema.decodeUnknownEffect(PublisherRoleIri)(
    `https://w3id.org/energy-intel/publisherRole/${slugify(publicationId)}`
  );

const displayNameForPublication = (publication: PublicationRecord): string => {
  if (publication.hostname !== null) {
    return publicationDisplayLabel(publication.hostname) ?? publication.hostname;
  }
  if (publication.showSlug !== null) {
    return titleCaseSlug(publication.showSlug);
  }
  return publication.publicationId;
};

const organizationFromPublication = (
  publication: PublicationRecord
): Effect.Effect<Organization, Schema.SchemaError> =>
  Effect.gen(function* () {
    const iri = yield* organizationIriForPublication(publication.publicationId);
    const publisherRole = yield* publisherRoleIriForPublication(
      publication.publicationId
    );

    return yield* Schema.decodeUnknownEffect(Organization)({
      iri,
      displayName: displayNameForPublication(publication),
      roles: [publisherRole],
      ...(publication.tier === "energy-focused"
        ? { primaryTopic: "energy" }
        : {}),
      authority: publication.tier
    });
  });

export class EntityOrganizationBackfillService extends ServiceMap.Service<
  EntityOrganizationBackfillService,
  {
    readonly backfill: (
      input?: EntityOrganizationBackfillInput
    ) => Effect.Effect<
      EntityOrganizationBackfillResult,
      SqlError | DbError | Schema.SchemaError
    >;
  }
>()("@skygest/EntityOrganizationBackfillService") {
  static readonly layer = Layer.effect(
    EntityOrganizationBackfillService,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const writer = yield* EntityIngestionWriter;
      const entityGraph = yield* EntityGraphRepo;

      const writePublisherRoleEdge = Effect.fn(
        "EntityOrganizationBackfillService.writePublisherRoleEdge"
      )(function* (
        organizationIri: ReturnType<typeof asEntityIri>,
        publisherRoleIri: string,
        effectiveFrom: number
      ) {
        const roleIri = asEntityIri(publisherRoleIri);
        yield* entityGraph.upsertEntity(roleIri, PUBLISHER_ROLE_ENTITY_TAG);
        const link = yield* entityGraph.createLink({
          predicate: "bfo:bearerOf",
          subject: { iri: organizationIri, type: "Organization" },
          object: { iri: roleIri, type: "PublisherRole" },
          effectiveFrom
        });
        yield* entityGraph.recordEvidence(link.linkId, {
          assertedBy: BACKFILL_ASSERTED_BY,
          assertionKind: "imported",
          confidence: 1
        });
      });

      const saveAndQueue = Effect.fn(
        "EntityOrganizationBackfillService.saveAndQueue"
      )(function* (publication: PublicationRecord) {
        const organization = yield* organizationFromPublication(publication);
        const now = yield* Clock.currentTimeMillis;
        const writeResult = yield* writer.write(
          OrganizationEntity,
          organization,
          { nextAttemptAt: now }
        );

        let bearsEdges = 0;
        for (const roleIri of organization.roles ?? []) {
          yield* writePublisherRoleEdge(writeResult.iri, roleIri, now);
          bearsEdges += 1;
        }
        return { bearsEdges };
      });

      const backfill = Effect.fn("EntityOrganizationBackfillService.backfill")(
        function* (input?: EntityOrganizationBackfillInput) {
          const limit = normalizeLimit(input?.limit);
          const offset = normalizeOffset(input?.offset);

          const totalRows = yield* sql<{ total: number }>`
            SELECT COUNT(*) as total
            FROM publications
          `.pipe(Effect.flatMap(decodeCountRows));
          const total = totalRows[0]?.total ?? 0;

          const rows = yield* sql<PublicationRecord>`
            SELECT
              publication_id as publicationId,
              medium as medium,
              hostname as hostname,
              show_slug as showSlug,
              feed_url as feedUrl,
              apple_id as appleId,
              spotify_id as spotifyId,
              tier as tier,
              source as source,
              first_seen_at as firstSeenAt,
              last_seen_at as lastSeenAt
            FROM publications
            ORDER BY publication_id ASC
            LIMIT ${limit}
            OFFSET ${offset}
          `.pipe(Effect.flatMap(decodePublicationRows));

          const outcomes = yield* Effect.forEach(
            rows,
            (publication) => Effect.exit(saveAndQueue(publication)),
            { concurrency: 4 }
          );
          const migrated = outcomes.filter((outcome) => Exit.isSuccess(outcome))
            .length;
          const bearsEdges = outcomes.reduce(
            (totalEdges, outcome) =>
              Exit.isSuccess(outcome)
                ? totalEdges + outcome.value.bearsEdges
                : totalEdges,
            0
          );
          const failedPublicationIds = outcomes.flatMap((outcome, index) =>
            Exit.isSuccess(outcome)
              ? []
              : [rows[index]?.publicationId ?? "unknown"]
          );

          return {
            total,
            scanned: rows.length,
            migrated,
            queued: migrated,
            bearsEdges,
            failed: rows.length - migrated,
            failedPublicationIds
          };
        }
      );

      return EntityOrganizationBackfillService.of({ backfill });
    })
  );
}
