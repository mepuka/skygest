import { ServiceMap, Effect, Layer } from "effect";
import { SqlError } from "effect/unstable/sql/SqlError";
import type { AccessIdentity } from "../auth/AuthService";
import { computeShard } from "../bootstrap/ExpertSeeds";
import { parseAvatarUrl } from "../bluesky/BskyCdn";
import type {
  ImportExpertInput,
  ImportPostInput,
  ImportPostsInput,
  ImportPostsOutput
} from "../domain/api";
import type { ExpertRecord, KnowledgePost, LinkRecord } from "../domain/bi";
import type { DbError } from "../domain/errors";
import { AppConfig } from "../platform/Config";
import { withMutationAudit } from "../platform/MutationLog";
import { CandidatePayloadService } from "./CandidatePayloadService";
import { CurationService } from "./CurationService";
import { ExpertsRepo } from "./ExpertsRepo";
import { KnowledgeRepo } from "./KnowledgeRepo";
import { OntologyCatalog } from "./OntologyCatalog";

const MUTATION_LABEL = "post import mutation";

const importExpertToRecord = (
  expert: ImportExpertInput,
  shardCount: number,
  addedAt: number
): ExpertRecord => ({
  did: expert.did,
  handle: expert.handle,
  displayName: expert.displayName ?? null,
  description: null,
  avatar: expert.avatar ? parseAvatarUrl(expert.avatar) : null,
  domain: expert.domain,
  source: expert.source,
  sourceRef: null,
  shard: computeShard(expert.did, shardCount),
  active: false,
  tier: expert.tier,
  addedAt,
  lastSyncedAt: null
});

const mergeImportedExpertRecord = (
  imported: ImportExpertInput,
  existing: ExpertRecord | undefined,
  shardCount: number,
  addedAt: number
): ExpertRecord =>
  existing === undefined
    ? importExpertToRecord(imported, shardCount, addedAt)
    : {
        ...existing,
        handle: imported.handle,
        displayName: imported.displayName ?? existing.displayName,
        avatar: imported.avatar ? parseAvatarUrl(imported.avatar) : existing.avatar
      };

const importLinkToLinkRecord = (
  link: ImportPostInput["links"][number],
  indexedAt: number
): LinkRecord => ({
  url: link.url,
  title: link.title ?? null,
  description: link.description ?? null,
  imageUrl: null,
  domain: link.domain ?? null,
  extractedAt: indexedAt
});

export class PostImportService extends ServiceMap.Service<
  PostImportService,
  {
    readonly importPosts: (
      actor: AccessIdentity,
      payload: ImportPostsInput
    ) => Effect.Effect<ImportPostsOutput, SqlError | DbError>;
  }
>()("@skygest/PostImportService") {
  static readonly layer = Layer.effect(
    PostImportService,
    Effect.gen(function* () {
      const config = yield* AppConfig;
      const expertsRepo = yield* ExpertsRepo;
      const knowledgeRepo = yield* KnowledgeRepo;
      const curationService = yield* CurationService;
      const payloadService = yield* CandidatePayloadService;
      const ontology = yield* OntologyCatalog;

      const importPosts = Effect.fn("PostImportService.importPosts")(function* (
        actor: AccessIdentity,
        payload: ImportPostsInput
      ) {
        const now = Date.now();

        const program = Effect.gen(function* () {
          if (payload.experts.length > 0) {
            const existingExperts = yield* expertsRepo.getByDids(
              [...new Set(payload.experts.map((expert) => expert.did))]
            );
            const existingByDid = new Map(
              existingExperts.map((expert) => [expert.did, expert])
            );
            const expertRecords = payload.experts.map((expert) =>
              mergeImportedExpertRecord(
                expert,
                existingByDid.get(expert.did),
                config.ingestShardCount,
                now
              )
            );
            yield* expertsRepo.upsertMany(expertRecords);
          }

          const importedPosts: Array<KnowledgePost> = [];
          const importedPostUris = new Set<string>();
          let skipped = 0;

          for (const post of payload.posts) {
            const links = post.links.map((link) => importLinkToLinkRecord(link, now));
            const topics = yield* ontology.match({
              text: post.text,
              metadataTexts: links.flatMap((link) =>
                [link.title, link.description].filter(
                  (value): value is string => value !== null
                )
              ),
              hashtags: post.hashtags ?? [],
              domains: links.flatMap((link) =>
                link.domain === null ? [] : [link.domain]
              )
            });

            if (topics.length === 0 && !payload.operatorOverride) {
              skipped += 1;
              continue;
            }

            importedPosts.push({
              uri: post.uri,
              did: post.did,
              cid: null,
              text: post.text,
              createdAt: post.createdAt,
              indexedAt: now,
              hasLinks: links.length > 0,
              status: "active",
              ingestId: `import:${post.uri}:${String(now)}`,
              embedType: post.embedType ?? null,
              topics,
              links
            });
            importedPostUris.add(post.uri);
          }

          if (importedPosts.length > 0) {
            yield* knowledgeRepo.upsertPosts(importedPosts);
          }

          for (const post of payload.posts) {
            if (!importedPostUris.has(post.uri)) {
              continue;
            }

            const embedPayload = post.embedPayload ?? null;
            if (embedPayload === null) {
              continue;
            }

            yield* payloadService.capturePayload({
              postUri: post.uri,
              captureStage: "candidate",
              embedType: post.embedType ?? null,
              embedPayload
            }).pipe(
              Effect.tapError((error) =>
                Effect.logWarning("import payload save failed").pipe(
                  Effect.annotateLogs({
                    postUri: post.uri,
                    error: String(error)
                  })
                )
              )
            );
          }

          let flagged = 0;
          if (importedPosts.length > 0) {
            flagged = yield* curationService.flagBatch(importedPosts).pipe(
              Effect.tapError((error) =>
                Effect.logWarning("import curation flagging failed, continuing").pipe(
                  Effect.annotateLogs({ error: String(error) })
                )
              ),
              Effect.catch(() => Effect.succeed(0))
            );
          }

          return {
            imported: importedPosts.length,
            flagged,
            skipped
          } satisfies ImportPostsOutput;
        });

        return yield* program.pipe(
          withMutationAudit({
            label: MUTATION_LABEL,
            actor,
            action: "import_posts",
            annotations: {
              expertCount: payload.experts.length,
              postCount: payload.posts.length,
              operatorOverride: payload.operatorOverride ?? false
            },
            onSuccess: (result) => ({
              imported: result.imported,
              flagged: result.flagged,
              skipped: result.skipped
            })
          })
        );
      });

      return PostImportService.of({ importPosts });
    })
  );
}
