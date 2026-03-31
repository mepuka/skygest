import { SqlClient } from "@effect/sql";
import { Effect, Layer } from "effect";
import { describe, expect, it } from "@effect/vitest";
import type { KnowledgePost } from "../src/domain/bi";
import type { EmbedKind } from "../src/domain/embed";
import { KnowledgeRepo } from "../src/services/KnowledgeRepo";
import { KnowledgeRepoD1 } from "../src/services/d1/KnowledgeRepoD1";
import { makeSqliteLayer } from "./support/runtime";
import { runMigrations } from "../src/db/migrate";

const makeLayer = () => {
  const sqliteLayer = makeSqliteLayer();
  return KnowledgeRepoD1.layer.pipe(Layer.provideMerge(sqliteLayer));
};

const makePost = (uri: string, embedType: EmbedKind | null): KnowledgePost => ({
  uri: uri as any,
  did: "did:plc:test" as any,
  cid: null,
  text: "test post",
  createdAt: Date.now(),
  indexedAt: Date.now(),
  hasLinks: false,
  status: "active" as const,
  ingestId: `${uri}:create:none:${Date.now()}`,
  embedType,
  topics: [],
  links: []
});

const seedTestExpert = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    INSERT OR IGNORE INTO experts (did, handle, display_name, description, domain, source, shard, active, added_at)
    VALUES ('did:plc:test', 'test.bsky.social', 'Test Expert', null, 'energy', 'manual', 0, 1, 0)
  `.pipe(Effect.asVoid);
});

describe("embed type persisted during ingest", () => {
  it.effect("stores embed_type=img for image posts", () =>
    Effect.gen(function* () {
      yield* runMigrations;
      yield* seedTestExpert;
      const repo = yield* KnowledgeRepo;
      yield* repo.upsertPosts([makePost("at://did:plc:test/app.bsky.feed.post/img1", "img")]);

      const sql = yield* SqlClient.SqlClient;
      const rows = yield* sql<{ embed_type: string | null }>`
        SELECT embed_type FROM posts WHERE uri = ${"at://did:plc:test/app.bsky.feed.post/img1"}
      `;
      expect(rows[0]?.embed_type).toBe("img");
    }).pipe(Effect.provide(makeLayer()))
  );

  it.effect("stores embed_type=link for link card posts", () =>
    Effect.gen(function* () {
      yield* runMigrations;
      yield* seedTestExpert;
      const repo = yield* KnowledgeRepo;
      yield* repo.upsertPosts([makePost("at://did:plc:test/app.bsky.feed.post/link1", "link")]);

      const sql = yield* SqlClient.SqlClient;
      const rows = yield* sql<{ embed_type: string | null }>`
        SELECT embed_type FROM posts WHERE uri = ${"at://did:plc:test/app.bsky.feed.post/link1"}
      `;
      expect(rows[0]?.embed_type).toBe("link");
    }).pipe(Effect.provide(makeLayer()))
  );

  it.effect("stores embed_type=null for text-only posts", () =>
    Effect.gen(function* () {
      yield* runMigrations;
      yield* seedTestExpert;
      const repo = yield* KnowledgeRepo;
      yield* repo.upsertPosts([makePost("at://did:plc:test/app.bsky.feed.post/text1", null)]);

      const sql = yield* SqlClient.SqlClient;
      const rows = yield* sql<{ embed_type: string | null }>`
        SELECT embed_type FROM posts WHERE uri = ${"at://did:plc:test/app.bsky.feed.post/text1"}
      `;
      expect(rows[0]?.embed_type).toBeNull();
    }).pipe(Effect.provide(makeLayer()))
  );
});
