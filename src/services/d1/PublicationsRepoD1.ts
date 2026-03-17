import { Effect, Layer, Schema } from "effect";
import { SqlClient } from "@effect/sql";
import { PublicationsRepo } from "../PublicationsRepo";
import type {
  ListPublicationsInput,
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

const PublicationListRowSchema = Schema.Struct({
  hostname: Schema.String,
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
            (pub) =>
              sql`
                INSERT INTO publications (
                  hostname, tier, source, first_seen_at, last_seen_at
                ) VALUES (
                  ${pub.hostname},
                  ${pub.tier},
                  'seed',
                  ${observedAt},
                  ${observedAt}
                )
                ON CONFLICT(hostname) DO UPDATE SET
                  tier = excluded.tier,
                  source = 'seed',
                  last_seen_at = excluded.last_seen_at,
                  first_seen_at = MIN(publications.first_seen_at, excluded.first_seen_at)
              `.pipe(Effect.asVoid),
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
              p.hostname as hostname,
              p.tier as tier,
              p.source as source,
              COUNT(DISTINCT l.post_uri) as postCount,
              MAX(l.extracted_at) as latestPostAt
            FROM publications p
            LEFT JOIN links l ON l.domain = p.hostname
            WHERE ${whereClause}
            GROUP BY p.hostname, p.tier, p.source
            ORDER BY postCount DESC, p.hostname ASC
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
              hostname, tier, source, first_seen_at, last_seen_at
            ) VALUES (
              ${hostname},
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
      hostname: Schema.String,
      tier: Schema.String,
      source: Schema.String,
      firstSeenAt: Schema.Number,
      lastSeenAt: Schema.Number
    });
    const PublicationRecordRowsSchema = Schema.Array(PublicationRecordRowSchema);

    const getByHostnames = (hostnames: ReadonlyArray<string>) => {
      if (hostnames.length === 0) return Effect.succeed([] as any[]);

      const chunks: string[][] = [];
      for (let i = 0; i < hostnames.length; i += 50) {
        chunks.push(hostnames.slice(i, i + 50) as string[]);
      }

      return Effect.forEach(chunks, (chunk) => {
        const placeholders = chunk.map((h) => sql`${h}`);
        return sql<any>`
          SELECT
            hostname as hostname,
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

    return PublicationsRepo.of({
      seedCurated,
      list,
      ensureDomains,
      getByHostnames
    });
  }))
};
