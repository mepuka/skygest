import { SqlClient } from "@effect/sql";
import type { SqlError } from "@effect/sql/SqlError";
import { Context, Effect, Layer } from "effect";
import type { AccessIdentity } from "../auth/AuthService";
import { energySeedDid, energySeedManifest } from "../bootstrap/CheckedInExpertSeeds";
import { bootstrapExperts } from "../bootstrap/ExpertSeeds";
import type {
  BootstrapExpertsResult,
  LoadSmokeFixtureResult
} from "../domain/bi";
import { IngestorPingError } from "../domain/errors";
import { processBatch } from "../filter/FilterWorker";
import { AppConfig } from "../platform/Config";
import { ExpertsRepo } from "./ExpertsRepo";
import { IngestShardRefresher } from "./IngestShardRefresher";
import { KnowledgeRepo } from "./KnowledgeRepo";
import { OntologyCatalog } from "./OntologyCatalog";
import { runMigrations } from "../db/migrate";
import { makeSmokeFixtureBatch, smokeFixtureUris } from "../staging/SmokeFixture";

const makeAnnotations = (
  actor: AccessIdentity,
  annotations: Record<string, string | number | boolean | null | undefined>
) => {
  const result: Record<string, string | number | boolean> = {};

  for (const [key, value] of Object.entries({
    actorSubject: actor.subject,
    actorEmail: actor.email,
    ...annotations
  })) {
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      result[key] = value;
    }
  }

  return result;
};

const logMutationSuccess = (
  actor: AccessIdentity,
  annotations: Record<string, string | number | boolean | null | undefined>
) =>
  Effect.logInfo("staging ops mutation").pipe(
    Effect.annotateLogs(makeAnnotations(actor, {
      ...annotations,
      outcome: "success"
    }))
  );

const logMutationFailure = (
  actor: AccessIdentity,
  annotations: Record<string, string | number | boolean | null | undefined>
) =>
  Effect.logWarning("staging ops mutation").pipe(
    Effect.annotateLogs(makeAnnotations(actor, {
      ...annotations,
      outcome: "failure"
    }))
  );

export class StagingOpsService extends Context.Tag("@skygest/StagingOpsService")<
  StagingOpsService,
  {
    readonly migrate: (
      actor: AccessIdentity
    ) => Effect.Effect<{ readonly ok: true }, SqlError>;
    readonly bootstrapExperts: (
      actor: AccessIdentity
    ) => Effect.Effect<BootstrapExpertsResult, SqlError | IngestorPingError>;
    readonly loadSmokeFixture: (
      actor: AccessIdentity
    ) => Effect.Effect<LoadSmokeFixtureResult, SqlError>;
  }
>() {
  static readonly layer = Layer.effect(
    StagingOpsService,
    Effect.gen(function* () {
      const config = yield* AppConfig;
      const sql = yield* SqlClient.SqlClient;
      const expertsRepo = yield* ExpertsRepo;
      const knowledgeRepo = yield* KnowledgeRepo;
      const ontology = yield* OntologyCatalog;
      const refresher = yield* IngestShardRefresher;

      const shardCount = Math.max(1, Math.trunc(config.ingestShardCount));

      const migrate = Effect.fn("StagingOpsService.migrate")(function* (
        actor: AccessIdentity
      ) {
        const program = runMigrations.pipe(
          Effect.provideService(SqlClient.SqlClient, sql),
          Effect.as({ ok: true } as const)
        );

        return yield* program.pipe(
          Effect.tap(() =>
            logMutationSuccess(actor, {
              action: "ops_migrate"
            })
          ),
          Effect.tapError(() =>
            logMutationFailure(actor, {
              action: "ops_migrate"
            })
          )
        );
      });

      const bootstrapCheckedInExperts = Effect.fn(
        "StagingOpsService.bootstrapExperts"
      )(function* (actor: AccessIdentity) {
        const program = Effect.gen(function* () {
          const result = yield* bootstrapExperts(energySeedManifest, shardCount).pipe(
            Effect.provideService(ExpertsRepo, expertsRepo)
          );
          const refreshedShards = yield* refresher.refreshAllShards();

          return {
            ...result,
            refreshedShards
          } satisfies BootstrapExpertsResult;
        });

        return yield* program.pipe(
          Effect.tap((result) =>
            logMutationSuccess(actor, {
              action: "bootstrap_experts",
              domain: result.domain,
              count: result.count,
              refreshedCount: result.refreshedShards.length
            })
          ),
          Effect.tapError(() =>
            logMutationFailure(actor, {
              action: "bootstrap_experts",
              domain: energySeedManifest.domain
            })
          )
        );
      });

      const loadSmokeFixture = Effect.fn("StagingOpsService.loadSmokeFixture")(function* (
        actor: AccessIdentity
      ) {
        const fixtureDid = energySeedDid;
        const fixtureUris = smokeFixtureUris(fixtureDid);
        const uriConditions = fixtureUris.map((uri) => sql`uri = ${uri}`);
        const postUriConditions = fixtureUris.map((uri) => sql`post_uri = ${uri}`);

        const program = Effect.gen(function* () {
          yield* processBatch(makeSmokeFixtureBatch(fixtureDid)).pipe(
            Effect.provideService(KnowledgeRepo, knowledgeRepo),
            Effect.provideService(OntologyCatalog, ontology)
          );

          const rows = yield* sql<LoadSmokeFixtureResult>`
            SELECT
              (
                SELECT COUNT(*)
                FROM posts
                WHERE status = 'active'
                  AND (${sql.join(" OR ", false)(uriConditions)})
              ) as posts,
              (
                SELECT COUNT(*)
                FROM links
                WHERE ${sql.join(" OR ", false)(postUriConditions)}
              ) as links,
              (
                SELECT COUNT(*)
                FROM post_topics
                WHERE ${sql.join(" OR ", false)(postUriConditions)}
              ) as topics
          `;

          return rows[0] ?? {
            posts: 0,
            links: 0,
            topics: 0
          };
        });

        return yield* program.pipe(
          Effect.tap((result) =>
            logMutationSuccess(actor, {
              action: "load_smoke_fixture",
              posts: result.posts,
              links: result.links,
              topics: result.topics
            })
          ),
          Effect.tapError(() =>
            logMutationFailure(actor, {
              action: "load_smoke_fixture"
            })
          )
        );
      });

      return StagingOpsService.of({
        migrate,
        bootstrapExperts: bootstrapCheckedInExperts,
        loadSmokeFixture
      });
    })
  );
}
