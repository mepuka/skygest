import { Effect, Layer, Schema } from "effect";
import { SqlClient } from "effect/unstable/sql";
import { PublicationsRepo } from "../PublicationsRepo";
import type {
  ListPublicationsInput,
  PublicationRecord,
  PublicationSeed,
  PublicationSeedManifest,
  SeedPublicationsResult
} from "../../domain/bi";
import {
  ListPublicationsInput as ListPublicationsInputSchema,
  PublicationSeedManifest as PublicationSeedManifestSchema,
  SeedPublicationsResult as SeedPublicationsResultSchema,
  PublicationListItem as PublicationListItemSchema,
  PublicationRecord as PublicationRecordSchema
} from "../../domain/bi";
import { decodeWithDbError } from "./schemaDecode";

const isDefined = <A>(value: A | null): value is A => value !== null;

const emptyPublicationRecords: ReadonlyArray<PublicationRecord> = [];

const chunkValues = <A>(values: ReadonlyArray<A>, size: number) => {
  const chunks: Array<ReadonlyArray<A>> = [];
  for (let i = 0; i < values.length; i += size) {
    chunks.push(values.slice(i, i + size));
  }
  return chunks;
};

const publicationIdFromSeed = (publication: PublicationSeed) => {
  if (publication.medium === "text" && publication.hostname !== null) {
    return publication.hostname;
  }
  if (publication.medium === "podcast" && publication.showSlug !== null) {
    return publication.showSlug;
  }

  return null;
};

const PublicationListRowSchema = Schema.Struct({
  publicationId: Schema.String,
  medium: Schema.String,
  hostname: Schema.NullOr(Schema.String),
  showSlug: Schema.NullOr(Schema.String),
  feedUrl: Schema.NullOr(Schema.String),
  appleId: Schema.NullOr(Schema.String),
  spotifyId: Schema.NullOr(Schema.String),
  tier: Schema.String,
  source: Schema.String,
  postCount: Schema.Number,
  latestPostAt: Schema.NullOr(Schema.Number)
});
const PublicationListRowsSchema = Schema.Array(PublicationListRowSchema);

export const PublicationsRepoD1 = {
  layer: Layer.effect(PublicationsRepo, Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;

    const seedCurated = (manifest: PublicationSeedManifest, observedAt: number) =>
      decodeWithDbError(
        PublicationSeedManifestSchema,
        manifest,
        "Invalid publication seed manifest"
      ).pipe(
        Effect.flatMap((validated) =>
          Effect.forEach(
            validated.publications,
            (pub) => {
              const publicationId = publicationIdFromSeed(pub);

              if (publicationId === null) {
                return Effect.die(
                  new Error("publication seed identity invariant violated after validation")
                );
              }

              return pub.medium === "text"
                ? sql`
                    INSERT INTO publications (
                      publication_id,
                      medium,
                      hostname,
                      show_slug,
                      feed_url,
                      apple_id,
                      spotify_id,
                      tier,
                      source,
                      first_seen_at,
                      last_seen_at
                    ) VALUES (
                      ${publicationId},
                      ${pub.medium},
                      ${pub.hostname},
                      NULL,
                      NULL,
                      NULL,
                      NULL,
                      ${pub.tier},
                      'seed',
                      ${observedAt},
                      ${observedAt}
                    )
                    ON CONFLICT(hostname) DO UPDATE SET
                      publication_id = excluded.publication_id,
                      medium = excluded.medium,
                      tier = excluded.tier,
                      source = 'seed',
                      show_slug = NULL,
                      feed_url = NULL,
                      apple_id = NULL,
                      spotify_id = NULL,
                      last_seen_at = excluded.last_seen_at,
                      first_seen_at = MIN(publications.first_seen_at, excluded.first_seen_at)
                  `.pipe(Effect.asVoid)
                : sql`
                    INSERT INTO publications (
                      publication_id,
                      medium,
                      hostname,
                      show_slug,
                      feed_url,
                      apple_id,
                      spotify_id,
                      tier,
                      source,
                      first_seen_at,
                      last_seen_at
                    ) VALUES (
                      ${publicationId},
                      ${pub.medium},
                      NULL,
                      ${pub.showSlug},
                      ${pub.feedUrl},
                      ${pub.appleId},
                      ${pub.spotifyId},
                      ${pub.tier},
                      'seed',
                      ${observedAt},
                      ${observedAt}
                    )
                    ON CONFLICT(show_slug) DO UPDATE SET
                      publication_id = excluded.publication_id,
                      medium = excluded.medium,
                      tier = excluded.tier,
                      source = 'seed',
                      feed_url = excluded.feed_url,
                      apple_id = excluded.apple_id,
                      spotify_id = excluded.spotify_id,
                      last_seen_at = excluded.last_seen_at,
                      first_seen_at = MIN(publications.first_seen_at, excluded.first_seen_at)
                  `.pipe(Effect.asVoid);
            },
            { discard: true }
          ).pipe(
            Effect.map(() => ({
              seeded: validated.publications.length,
              snapshotVersion: validated.snapshotVersion
            })),
            Effect.flatMap((result) =>
              decodeWithDbError(
                SeedPublicationsResultSchema,
                result,
                "Failed to encode seed publications result"
              )
            )
          )
        )
      );

    const list = (input: ListPublicationsInput) =>
      decodeWithDbError(
        ListPublicationsInputSchema,
        input,
        "Invalid list publications input"
      ).pipe(
        Effect.flatMap((validated) => {
          const conditions = [
            validated.tier === undefined ? null : sql`p.tier = ${validated.tier}`,
            validated.source === undefined ? null : sql`p.source = ${validated.source}`
          ].filter(isDefined);

          const whereClause = conditions.length === 0
            ? sql`1 = 1`
            : sql.join(" AND ", false)(conditions);

          const limit = Math.min(validated.limit ?? 50, 100);

          return sql<any>`
            SELECT
              p.publication_id as publicationId,
              p.medium as medium,
              p.hostname as hostname,
              p.show_slug as showSlug,
              p.feed_url as feedUrl,
              p.apple_id as appleId,
              p.spotify_id as spotifyId,
              p.tier as tier,
              p.source as source,
              COUNT(DISTINCT l.post_uri) as postCount,
              MAX(l.extracted_at) as latestPostAt
            FROM publications p
            LEFT JOIN links l ON p.hostname IS NOT NULL AND l.domain = p.hostname
            WHERE ${whereClause}
            GROUP BY
              p.publication_id,
              p.medium,
              p.hostname,
              p.show_slug,
              p.feed_url,
              p.apple_id,
              p.spotify_id,
              p.tier,
              p.source
            ORDER BY postCount DESC, COALESCE(p.hostname, p.show_slug, p.publication_id) ASC
            LIMIT ${limit}
          `.pipe(
            Effect.flatMap((rows) =>
              decodeWithDbError(
                PublicationListRowsSchema,
                rows,
                "Failed to decode publication list rows"
              )
            ),
            Effect.flatMap((rows) =>
              decodeWithDbError(
                Schema.Array(PublicationListItemSchema),
                rows,
                "Failed to normalize publication list rows"
              )
            )
          );
        })
      );

    const ensureDomains = (hostnames: ReadonlyArray<string>, observedAt: number) => {
      const validHostnames = hostnames.filter(
        (h) => h !== null && h !== undefined && h.length > 0
      );

      if (validHostnames.length === 0) {
        return Effect.void;
      }

      return Effect.forEach(
        validHostnames,
        (hostname) =>
          sql`
            INSERT INTO publications (
              publication_id,
              medium,
              hostname,
              show_slug,
              feed_url,
              apple_id,
              spotify_id,
              tier,
              source,
              first_seen_at,
              last_seen_at
            ) VALUES (
              ${hostname},
              'text',
              ${hostname},
              NULL,
              NULL,
              NULL,
              NULL,
              'unknown',
              'discovered',
              ${observedAt},
              ${observedAt}
            )
            ON CONFLICT(hostname) DO UPDATE SET
              last_seen_at = CASE
                WHEN publications.source = 'discovered'
                THEN MAX(publications.last_seen_at, excluded.last_seen_at)
                ELSE publications.last_seen_at
              END
          `.pipe(Effect.asVoid),
        { discard: true }
      );
    };

    const PublicationRecordRowSchema = Schema.Struct({
      publicationId: Schema.String,
      medium: Schema.String,
      hostname: Schema.NullOr(Schema.String),
      showSlug: Schema.NullOr(Schema.String),
      feedUrl: Schema.NullOr(Schema.String),
      appleId: Schema.NullOr(Schema.String),
      spotifyId: Schema.NullOr(Schema.String),
      tier: Schema.String,
      source: Schema.String,
      firstSeenAt: Schema.Number,
      lastSeenAt: Schema.Number
    });
    const PublicationRecordRowsSchema = Schema.Array(PublicationRecordRowSchema);

    const getByHostnames = (hostnames: ReadonlyArray<string>) => {
      if (hostnames.length === 0) return Effect.succeed(emptyPublicationRecords);

      const chunks = chunkValues(hostnames, 50);

      return Effect.forEach(chunks, (chunk) => {
        const placeholders = chunk.map((h) => sql`${h}`);
        return sql<any>`
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
          WHERE hostname IN (${sql.join(", ", false)(placeholders)})
        `.pipe(
          Effect.flatMap((rows) =>
            decodeWithDbError(
              PublicationRecordRowsSchema,
              rows,
              "Failed to decode publication rows for batch lookup"
            )
          ),
          Effect.flatMap((rows) =>
            decodeWithDbError(
              Schema.Array(PublicationRecordSchema),
              rows,
              "Failed to normalize publication rows for batch lookup"
            )
          )
        );
      }).pipe(
        Effect.map((chunks) => chunks.flat())
      );
    };

    const getByShowSlugs = (showSlugs: ReadonlyArray<string>) => {
      if (showSlugs.length === 0) return Effect.succeed(emptyPublicationRecords);

      const chunks = chunkValues(showSlugs, 50);

      return Effect.forEach(chunks, (chunk) => {
        const placeholders = chunk.map((showSlug) => sql`${showSlug}`);
        return sql<any>`
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
          WHERE show_slug IN (${sql.join(", ", false)(placeholders)})
        `.pipe(
          Effect.flatMap((rows) =>
            decodeWithDbError(
              PublicationRecordRowsSchema,
              rows,
              "Failed to decode podcast publication rows for batch lookup"
            )
          ),
          Effect.flatMap((rows) =>
            decodeWithDbError(
              Schema.Array(PublicationRecordSchema),
              rows,
              "Failed to normalize podcast publication rows for batch lookup"
            )
          )
        );
      }).pipe(
        Effect.map((chunks) => chunks.flat())
      );
    };

    return {
      seedCurated,
      list,
      ensureDomains,
      getByHostnames,
      getByShowSlugs
    };
  }))
};
