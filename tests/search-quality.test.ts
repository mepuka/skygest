import { SqlClient } from "effect/unstable/sql";
import { Effect } from "effect";
import { describe, expect, it } from "@effect/vitest";
import { bootstrapExperts } from "../src/bootstrap/ExpertSeeds";
import { runMigrations } from "../src/db/migrate";
import type { KnowledgePost, MatchedTopic } from "../src/domain/bi";
import { KnowledgeRepo } from "../src/services/KnowledgeRepo";
import { makeBiLayer } from "./support/runtime";

const assessmentNow = 1_710_000_100_000;

const assessmentManifest = {
  domain: "energy",
  experts: [
    {
      did: "did:plc:solar",
      handle: "solar-desk.bsky.social",
      displayName: "Solar Desk",
      source: "manual",
      active: true
    },
    {
      did: "did:plc:hydrogen",
      handle: "hydrogen-desk.bsky.social",
      displayName: "Hydrogen Desk",
      source: "manual",
      active: true
    },
    {
      did: "did:plc:grid",
      handle: "gridwonk.bsky.social",
      displayName: "Grid Wonk",
      source: "manual",
      active: true
    }
  ]
} as const;

const makeTopic = (slug: string, matchedTerm: string): MatchedTopic =>
  ({
    topicSlug: slug,
    matchedTerm,
    matchSignal: "term",
    matchValue: matchedTerm,
    matchScore: 0.9,
    ontologyVersion: "test-v1",
    matcherVersion: "test-v1"
  }) as unknown as MatchedTopic;

const assessmentPosts: ReadonlyArray<KnowledgePost> = [
  {
    uri: "at://did:plc:solar/app.bsky.feed.post/exact-phrase" as any,
    did: "did:plc:solar" as any,
    cid: null,
    text: "Solar battery storage projects are accelerating.",
    createdAt: assessmentNow,
    indexedAt: assessmentNow,
    hasLinks: false,
    status: "active",
    ingestId: "assessment-exact-phrase",
    embedType: null,
    topics: [makeTopic("solar", "solar battery storage")],
    links: []
  },
  {
    uri: "at://did:plc:solar/app.bsky.feed.post/loose-phrase" as any,
    did: "did:plc:solar" as any,
    cid: null,
    text: "Solar projects rely on large battery storage systems.",
    createdAt: assessmentNow + 1,
    indexedAt: assessmentNow + 1,
    hasLinks: false,
    status: "active",
    ingestId: "assessment-loose-phrase",
    embedType: null,
    topics: [makeTopic("solar", "battery storage")],
    links: []
  },
  {
    uri: "at://did:plc:hydrogen/app.bsky.feed.post/h2" as any,
    did: "did:plc:hydrogen" as any,
    cid: null,
    text: "Green H2 electrolyzer projects need cheaper power.",
    createdAt: assessmentNow + 2,
    indexedAt: assessmentNow + 2,
    hasLinks: false,
    status: "active",
    ingestId: "assessment-h2",
    embedType: null,
    topics: [makeTopic("hydrogen", "H2")],
    links: []
  },
  {
    uri: "at://did:plc:grid/app.bsky.feed.post/interconnection" as any,
    did: "did:plc:grid" as any,
    cid: null,
    text: "FERC Order 2023 aims to speed interconnection reform.",
    createdAt: assessmentNow + 3,
    indexedAt: assessmentNow + 3,
    hasLinks: false,
    status: "active",
    ingestId: "assessment-interconnection",
    embedType: null,
    topics: [makeTopic("transmission", "interconnection")],
    links: []
  },
  {
    uri: "at://did:plc:solar/app.bsky.feed.post/topic-only" as any,
    did: "did:plc:solar" as any,
    cid: null,
    text: "Rooftop installations are rising across Texas.",
    createdAt: assessmentNow + 4,
    indexedAt: assessmentNow + 4,
    hasLinks: false,
    status: "active",
    ingestId: "assessment-topic-only",
    embedType: null,
    topics: [makeTopic("solar", "PV")],
    links: []
  }
];

const seedAssessmentPosts = Effect.gen(function* () {
  yield* runMigrations;
  yield* bootstrapExperts(assessmentManifest as any, 1, assessmentNow);
  const repo = yield* KnowledgeRepo;
  yield* repo.upsertPosts(assessmentPosts);
  return repo;
});

describe("search quality assessment", () => {
  it.effect("uses D1 FTS5 with porter stemming and indexes text plus search metadata", () =>
    Effect.gen(function* () {
      yield* runMigrations;
      const sql = yield* SqlClient.SqlClient;
      const rows = yield* sql<{ sql: string | null }>`
        SELECT sql as sql
        FROM sqlite_master
        WHERE type = 'table'
          AND name = 'posts_fts'
      `;

      const ddl = rows[0]?.sql ?? "";
      expect(ddl).toContain("USING fts5");
      expect(ddl).toContain("text");
      expect(ddl).toContain("handle");
      expect(ddl).toContain("topic_terms");
      expect(ddl).toContain("tokenize='porter unicode61'");
      expect(ddl).not.toContain("content='posts'");
    }).pipe(Effect.provide(makeBiLayer()))
  );

  it.effect("finds plain text energy terms in post bodies", () =>
    Effect.gen(function* () {
      const repo = yield* seedAssessmentPosts;
      const results = yield* repo.searchPosts({ query: "interconnection", limit: 10 });

      expect(results.map((result) => result.uri)).toEqual([
        "at://did:plc:grid/app.bsky.feed.post/interconnection"
      ]);
    }).pipe(Effect.provide(makeBiLayer()))
  );

  it.effect("searches author handles after indexing them alongside post text", () =>
    Effect.gen(function* () {
      const repo = yield* seedAssessmentPosts;
      const results = yield* repo.searchPosts({ query: "gridwonk", limit: 10 });

      expect(results.map((result) => result.uri)).toEqual([
        "at://did:plc:grid/app.bsky.feed.post/interconnection"
      ]);
    }).pipe(Effect.provide(makeBiLayer()))
  );

  it.effect("searches matched topic terms even when they do not appear in body text", () =>
    Effect.gen(function* () {
      const repo = yield* seedAssessmentPosts;
      const results = yield* repo.searchPosts({ query: "pv", limit: 10 });

      expect(results.map((result) => result.uri)).toEqual([
        "at://did:plc:solar/app.bsky.feed.post/topic-only"
      ]);
    }).pipe(Effect.provide(makeBiLayer()))
  );

  it.effect("preserves phrase queries so SQLite can enforce adjacency", () =>
    Effect.gen(function* () {
      const repo = yield* seedAssessmentPosts;
      const results = yield* repo.searchPosts({ query: "\"solar battery storage\"", limit: 10 });

      expect(results.map((result) => result.uri)).toEqual([
        "at://did:plc:solar/app.bsky.feed.post/exact-phrase"
      ]);
    }).pipe(Effect.provide(makeBiLayer()))
  );

  it.effect("preserves OR queries so alternative branches remain searchable", () =>
    Effect.gen(function* () {
      const repo = yield* seedAssessmentPosts;
      const results = yield* repo.searchPosts({ query: "solar OR hydrogen", limit: 10 });

      expect(new Set(results.map((result) => result.uri))).toEqual(new Set([
        "at://did:plc:solar/app.bsky.feed.post/exact-phrase",
        "at://did:plc:solar/app.bsky.feed.post/loose-phrase",
        "at://did:plc:solar/app.bsky.feed.post/topic-only",
        "at://did:plc:hydrogen/app.bsky.feed.post/h2"
      ]));
    }).pipe(Effect.provide(makeBiLayer()))
  );

  it.effect("preserves prefix search syntax so SQLite can expand partial tokens", () =>
    Effect.gen(function* () {
      const repo = yield* seedAssessmentPosts;
      const exact = yield* repo.searchPosts({ query: "electrolyzer", limit: 10 });
      const prefix = yield* repo.searchPosts({ query: "electro*", limit: 10 });

      expect(exact.map((result) => result.uri)).toEqual([
        "at://did:plc:hydrogen/app.bsky.feed.post/h2"
      ]);
      expect(prefix.map((result) => result.uri)).toEqual([
        "at://did:plc:hydrogen/app.bsky.feed.post/h2"
      ]);
    }).pipe(Effect.provide(makeBiLayer()))
  );

  it.effect("preserves NOT queries so exclusions are handled by SQLite instead of being flattened away", () =>
    Effect.gen(function* () {
      const repo = yield* seedAssessmentPosts;
      const results = yield* repo.searchPosts({ query: "solar AND NOT hydrogen", limit: 10 });

      expect(results.every((result) => result.uri !== "at://did:plc:hydrogen/app.bsky.feed.post/h2")).toBe(true);
      expect(new Set(results.map((result) => result.uri))).toEqual(new Set([
        "at://did:plc:solar/app.bsky.feed.post/exact-phrase",
        "at://did:plc:solar/app.bsky.feed.post/loose-phrase",
        "at://did:plc:solar/app.bsky.feed.post/topic-only"
      ]));
    }).pipe(Effect.provide(makeBiLayer()))
  );
});
