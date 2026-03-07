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
import { processBatch } from "../filter/FilterWorker";
import { AppConfig } from "../platform/Config";
import { withMutationAudit } from "../platform/MutationLog";
import { ExpertsRepo } from "./ExpertsRepo";
import { KnowledgeRepo } from "./KnowledgeRepo";
import { OntologyCatalog } from "./OntologyCatalog";
import { runMigrations } from "../db/migrate";
import { makeSmokeFixtureBatch, smokeFixtureUris } from "../staging/SmokeFixture";

const MUTATION_LABEL = "staging ops mutation";

export class StagingOpsService extends Context.Tag("@skygest/StagingOpsService")<
  StagingOpsService,
  {
    readonly migrate: (
      actor: AccessIdentity
    ) => Effect.Effect<{ readonly ok: true }, SqlError>;
    readonly bootstrapExperts: (
      actor: AccessIdentity
    ) => Effect.Effect<BootstrapExpertsResult, SqlError>;
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

      const shardCount = Math.max(1, Math.trunc(config.ingestShardCount));

      const migrate = Effect.fn("StagingOpsService.migrate")(function* (
        actor: AccessIdentity
      ) {
        const program = runMigrations.pipe(
          Effect.provideService(SqlClient.SqlClient, sql),
          Effect.as({ ok: true } as const)
        );

        return yield* program.pipe(
          withMutationAudit({
            label: MUTATION_LABEL,
            actor,
            action: "ops_migrate"
          })
        );
      });

      const bootstrapCheckedInExperts = Effect.fn(
        "StagingOpsService.bootstrapExperts"
      )(function* (actor: AccessIdentity) {
        const program = bootstrapExperts(energySeedManifest, shardCount).pipe(
          Effect.provideService(ExpertsRepo, expertsRepo)
        );

        return yield* program.pipe(
          withMutationAudit({
            label: MUTATION_LABEL,
            actor,
            action: "bootstrap_experts",
            annotations: {
              domain: energySeedManifest.domain
            },
            onSuccess: (result) => ({
              count: result.count
            })
          })
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
          withMutationAudit({
            label: MUTATION_LABEL,
            actor,
            action: "load_smoke_fixture",
            onSuccess: (result) => ({
              posts: result.posts,
              links: result.links,
              topics: result.topics
            })
          })
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
