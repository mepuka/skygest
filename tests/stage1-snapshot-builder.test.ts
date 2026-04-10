import { randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { SqlClient } from "effect/unstable/sql";
import { loadSnapshotFromString } from "../eval/resolution-stage1/shared";
import {
  buildStage1EvalSnapshot,
  loadResolverGoldSetManifest
} from "../src/eval/Stage1EvalSnapshotBuilder";
import { Stage1EvalSnapshotBuildError } from "../src/domain/errors";
import { Stage1EvalSnapshotBuildReport } from "../src/domain/stage1Eval";
import { CandidatePayloadService } from "../src/services/CandidatePayloadService";
import type { PostUri } from "../src/domain/types";
import { decodeJsonStringWith } from "../src/platform/Json";
import { layer as localFileSystemLayer } from "./helpers/LocalFileSystem";
import {
  makeBiLayer,
  makeSourceAttributionEnrichmentPayload,
  makeVisionEnrichmentPayload,
  sampleDid,
  seedKnowledgeBase,
  withTempSqliteFile
} from "./support/runtime";

const solarUri = `at://${sampleDid}/app.bsky.feed.post/post-solar` as PostUri;
const twitterUri = "x://twitter.example/post/123" as PostUri;
const decodeBuildReportJson = decodeJsonStringWith(Stage1EvalSnapshotBuildReport);

const withTempDirectory = async <A>(f: (dir: string) => Promise<A>) => {
  const dir = join("/tmp", `skygest-stage1-snapshot-${randomUUID()}`);
  await fs.mkdir(dir, { recursive: true });

  try {
    return await f(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
};

describe("Stage1EvalSnapshotBuilder", () => {
  it("decodes legacy build reports that still contain unsupported-post-source diagnostics", () => {
    const report = decodeBuildReportJson(`{
      "manifestPath": "/tmp/gold-set-resolver.json",
      "outputPath": "/tmp/snapshot.build-report.json",
      "diagnostics": [
        {
          "_tag": "UnsupportedPostSourceDiagnostic",
          "code": "unsupported-post-source",
          "slug": "001-twitter-post",
          "postUri": "x://twitter.example/post/123",
          "source": "twitter"
        }
      ]
    }`);

    expect(report.diagnostics).toHaveLength(1);
    expect(report.diagnostics[0]).toMatchObject({
      _tag: "UnsupportedPostSourceDiagnostic",
      code: "unsupported-post-source",
      postUri: twitterUri
    });
  });

  it.live("builds a non-hollow snapshot row from stored post context and enrichments", () =>
    Effect.promise(() =>
      withTempSqliteFile(async (filename) =>
        withTempDirectory(async (dir) => {
          const manifestPath = join(dir, "gold-set-resolver.json");
          const outputPath = join(dir, "snapshot.jsonl");
          const reportPath = join(dir, "snapshot.build-report.json");
          const layer = Layer.mergeAll(
            makeBiLayer({ filename }),
            localFileSystemLayer
          );

          await fs.writeFile(
            manifestPath,
            JSON.stringify([
              {
                uri: solarUri,
                handle: "seed.example.com",
                publisher: "example",
                includesLanes: ["url-exact-match"],
                notes: "builder smoke test"
              }
            ]),
            "utf-8"
          );

          await Effect.runPromise(
            Effect.gen(function* () {
              yield* seedKnowledgeBase();

              const payloads = yield* CandidatePayloadService;
              yield* payloads.capturePayload({
                postUri: solarUri,
                captureStage: "candidate",
                embedType: "link",
                embedPayload: {
                  kind: "link",
                  uri: "https://example.com/solar-storage",
                  title: "Solar storage buildout",
                  description: "Battery storage and transmission upgrades",
                  thumb: null
                }
              });
              yield* payloads.markPicked(solarUri);
              yield* payloads.saveEnrichment({
                postUri: solarUri,
                enrichmentType: "vision",
                enrichmentPayload: makeVisionEnrichmentPayload()
              });
              yield* payloads.saveEnrichment({
                postUri: solarUri,
                enrichmentType: "source-attribution",
                enrichmentPayload: makeSourceAttributionEnrichmentPayload()
              });

              const built = yield* buildStage1EvalSnapshot({
                manifestPath,
                outputPath,
                reportPath
              });
              expect(built.rowCount).toBe(1);
              expect(built.diagnosticCount).toBe(0);

              const raw = yield* Effect.tryPromise(() =>
                fs.readFile(outputPath, "utf-8")
              );
              const rows = yield* loadSnapshotFromString(raw);
              const report = decodeBuildReportJson(
                yield* Effect.tryPromise(() => fs.readFile(reportPath, "utf-8"))
              );

              expect(rows).toHaveLength(1);
              expect(rows[0]?.postContext.text.length).toBeGreaterThan(0);
              expect(rows[0]?.postContext.links.length).toBeGreaterThan(0);
              expect(rows[0]?.postContext.linkCards.length).toBeGreaterThan(0);
              expect(rows[0]?.vision).not.toBeNull();
              expect(rows[0]?.sourceAttribution).not.toBeNull();
              expect(rows[0]?.metadata.includesLanes).toEqual(["url-exact-match"]);
              expect(report.diagnostics).toEqual([]);
            }).pipe(Effect.provide(layer))
          );
        })
      )
    )
  );

  it.live("builds rows for mixed Bluesky and Twitter manifests while reporting non-blocking diagnostics separately", () =>
    Effect.promise(() =>
      withTempSqliteFile(async (filename) =>
        withTempDirectory(async (dir) => {
          const manifestPath = join(dir, "gold-set-resolver.json");
          const outputPath = join(dir, "snapshot.jsonl");
          const reportPath = join(dir, "snapshot.build-report.json");
          const layer = Layer.mergeAll(
            makeBiLayer({ filename }),
            localFileSystemLayer
          );

          await fs.writeFile(
            manifestPath,
            JSON.stringify([
              {
                uri: solarUri,
                handle: "seed.example.com",
                publisher: "example",
                includesLanes: ["url-exact-match"]
              },
              {
                uri: twitterUri,
                handle: "tweet-user",
                publisher: "twitter",
                includesLanes: ["provider-agent"]
              }
            ]),
            "utf-8"
          );

          const result = await Effect.runPromise(
            Effect.gen(function* () {
              yield* seedKnowledgeBase();
              const sql = yield* SqlClient.SqlClient;
              yield* sql`DELETE FROM links WHERE post_uri = ${solarUri}`.pipe(
                Effect.asVoid
              );
              const now = Date.now();

              yield* sql`
                INSERT INTO posts (
                  uri,
                  did,
                  cid,
                  text,
                  created_at,
                  indexed_at,
                  has_links,
                  status,
                  ingest_id,
                  embed_type
                ) VALUES (
                  ${twitterUri},
                  ${sampleDid},
                  ${"cid-twitter-stage1"},
                  ${"Imported Twitter grid update"},
                  ${now - 1000},
                  ${now - 1000},
                  ${1},
                  ${"active"},
                  ${"ingest-twitter-stage1"},
                  ${"link"}
                )
              `;

              yield* sql`
                INSERT INTO links (
                  post_uri,
                  url,
                  title,
                  description,
                  image_url,
                  domain,
                  extracted_at
                ) VALUES (
                  ${twitterUri},
                  ${"https://example.com/twitter-grid-update"},
                  ${"Twitter grid update"},
                  ${"Imported market context"},
                  ${null},
                  ${"example.com"},
                  ${now - 900}
                )
              `;

              const payloads = yield* CandidatePayloadService;
              yield* payloads.capturePayload({
                postUri: solarUri,
                captureStage: "candidate",
                embedType: "link",
                embedPayload: {
                  kind: "link",
                  uri: "https://example.com/solar-storage",
                  title: "Solar storage buildout",
                  description: "Battery storage and transmission upgrades",
                  thumb: null
                }
              });
              yield* payloads.markPicked(solarUri);
              yield* payloads.saveEnrichment({
                postUri: solarUri,
                enrichmentType: "vision",
                enrichmentPayload: makeVisionEnrichmentPayload()
              });
              yield* payloads.saveEnrichment({
                postUri: solarUri,
                enrichmentType: "source-attribution",
                enrichmentPayload: makeSourceAttributionEnrichmentPayload()
              });
              yield* payloads.capturePayload({
                postUri: twitterUri,
                captureStage: "candidate",
                embedType: "link",
                embedPayload: {
                  kind: "link",
                  uri: "https://example.com/twitter-grid-update",
                  title: "Twitter grid update",
                  description: "Imported market context",
                  thumb: null
                }
              });
              yield* payloads.markPicked(twitterUri);
              yield* payloads.saveEnrichment({
                postUri: twitterUri,
                enrichmentType: "vision",
                enrichmentPayload: makeVisionEnrichmentPayload()
              });
              yield* payloads.saveEnrichment({
                postUri: twitterUri,
                enrichmentType: "source-attribution",
                enrichmentPayload: makeSourceAttributionEnrichmentPayload()
              });

              return yield* buildStage1EvalSnapshot({
                manifestPath,
                outputPath,
                reportPath
              });
            }).pipe(Effect.provide(layer))
          );

          expect(result.rowCount).toBe(2);
          expect(result.diagnosticCount).toBe(1);
          expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
            "missing-links"
          ]);

          const raw = await fs.readFile(outputPath, "utf-8");
          const rows = await Effect.runPromise(loadSnapshotFromString(raw));
          expect(rows).toHaveLength(2);
          expect(rows.map((row) => row.postUri)).toEqual([solarUri, twitterUri]);
          expect(rows[0]?.postContext.links).toEqual([]);
          expect(rows[1]?.postContext.links).toHaveLength(1);
          expect(rows[1]?.postContext.linkCards).toHaveLength(1);

          const report = decodeBuildReportJson(
            await fs.readFile(reportPath, "utf-8")
          );
          expect(report.diagnostics).toHaveLength(1);
        })
      )
    )
  );

  it.live("returns a typed manifest decode diagnostic when the gold set shape is invalid", () =>
    Effect.promise(() =>
      withTempDirectory(async (dir) => {
        const manifestPath = join(dir, "gold-set-resolver.json");

        await fs.writeFile(
          manifestPath,
          JSON.stringify([
            {
              uri: solarUri,
              handle: "seed.example.com",
              publisher: "example",
              includesLanes: ["typo-lane"]
            }
          ]),
          "utf-8"
        );

        const error = await Effect.runPromise(
          loadResolverGoldSetManifest(manifestPath).pipe(
            Effect.provide(localFileSystemLayer),
            Effect.flip
          )
        );

        expect(error).toBeInstanceOf(Stage1EvalSnapshotBuildError);

        if (!(error instanceof Stage1EvalSnapshotBuildError)) {
          throw new Error("Expected Stage1EvalSnapshotBuildError");
        }

        expect(error.report.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
          "manifest-decode-failed"
        ]);
      })
    )
  );
});
