import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
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
  seedKnowledgeBase
} from "./support/runtime";

const solarUri = `at://${sampleDid}/app.bsky.feed.post/post-solar` as PostUri;
const chartUri = `at://${sampleDid}/app.bsky.feed.post/post-chart` as PostUri;
const twitterUri = "x://twitter.example/post/123" as PostUri;
const decodeBuildReportJson = decodeJsonStringWith(Stage1EvalSnapshotBuildReport);

const withTempDirectoryEffect = <A, E, R>(
  f: (dir: string) => Effect.Effect<A, E, R>
) =>
  Effect.acquireUseRelease(
    Effect.tryPromise(() =>
      fs.mkdtemp(join("/tmp", `skygest-stage1-snapshot-${randomUUID()}`))
    ),
    f,
    (dir) =>
      Effect.tryPromise(() =>
        fs.rm(dir, { recursive: true, force: true })
      ).pipe(Effect.orDie)
  );

const withTempSqliteFileEffect = <A, E, R>(
  f: (filename: string) => Effect.Effect<A, E, R>
) =>
  Effect.acquireUseRelease(
    Effect.sync(() => join("/tmp", `skygest-bi-${randomUUID()}.sqlite`)),
    f,
    (filename) =>
      Effect.sync(() => {
        rmSync(filename, { force: true });
      }).pipe(Effect.orDie)
  );

// SKIPPED: this builder only exists to feed the resolver-kernel.test.ts suite, which is itself skipped under SKY-348 (OEO + prompt-layer extraction). Restore once the kernel rewrite has its own snapshot builder requirements.
describe.skip("Stage1EvalSnapshotBuilder", () => {
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
    withTempSqliteFileEffect((filename) =>
      withTempDirectoryEffect((dir) => {
        const manifestPath = join(dir, "gold-set-resolver.json");
        const outputPath = join(dir, "snapshot.jsonl");
        const reportPath = join(dir, "snapshot.build-report.json");
        const layer = Layer.mergeAll(
          makeBiLayer({ filename }),
          localFileSystemLayer
        );

        return Effect.gen(function* () {
          yield* Effect.tryPromise(() =>
            fs.writeFile(
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
            )
          );

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

          const raw = yield* Effect.tryPromise(() => fs.readFile(outputPath, "utf-8"));
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
        }).pipe(Effect.provide(layer));
      })
    )
  );

  it.live("drops rows when candidate payload and enrichments are missing", () =>
    withTempSqliteFileEffect((filename) =>
      withTempDirectoryEffect((dir) => {
        const manifestPath = join(dir, "gold-set-resolver.json");
        const outputPath = join(dir, "snapshot.jsonl");
        const reportPath = join(dir, "snapshot.build-report.json");
        const layer = Layer.mergeAll(
          makeBiLayer({ filename }),
          localFileSystemLayer
        );

        return Effect.gen(function* () {
          yield* Effect.tryPromise(() =>
            fs.writeFile(
              manifestPath,
              JSON.stringify([
                {
                  uri: solarUri,
                  handle: "seed.example.com",
                  publisher: "example",
                  includesLanes: ["url-exact-match"]
                }
              ]),
              "utf-8"
            )
          );

          yield* seedKnowledgeBase();

          const result = yield* buildStage1EvalSnapshot({
            manifestPath,
            outputPath,
            reportPath
          });

          expect(result.rowCount).toBe(0);
          expect(result.diagnosticCount).toBe(3);
          expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
            "missing-candidate-payload",
            "missing-vision",
            "missing-source-attribution"
          ]);

          const raw = yield* Effect.tryPromise(() => fs.readFile(outputPath, "utf-8"));
          const rows = yield* loadSnapshotFromString(raw);
          const report = decodeBuildReportJson(
            yield* Effect.tryPromise(() => fs.readFile(reportPath, "utf-8"))
          );

          expect(rows).toHaveLength(0);
          expect(report.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
            "missing-candidate-payload",
            "missing-vision",
            "missing-source-attribution"
          ]);
        }).pipe(Effect.provide(layer));
      })
    )
  );

  it.live("drops chart rows when link cards and enrichments are missing", () =>
    withTempSqliteFileEffect((filename) =>
      withTempDirectoryEffect((dir) => {
        const manifestPath = join(dir, "gold-set-resolver.json");
        const outputPath = join(dir, "snapshot.jsonl");
        const reportPath = join(dir, "snapshot.build-report.json");
        const layer = Layer.mergeAll(
          makeBiLayer({ filename }),
          localFileSystemLayer
        );

        return Effect.gen(function* () {
          yield* Effect.tryPromise(() =>
            fs.writeFile(
              manifestPath,
              JSON.stringify([
                {
                  uri: chartUri,
                  handle: "seed.example.com",
                  publisher: "example",
                  includesLanes: ["dataset-title"]
                }
              ]),
              "utf-8"
            )
          );

          yield* seedKnowledgeBase();
          const sql = yield* SqlClient.SqlClient;
          const payloads = yield* CandidatePayloadService;
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
              ${chartUri},
              ${sampleDid},
              ${"cid-chart-stage1"},
              ${"Chart post with no link-preview context"},
              ${now - 1000},
              ${now - 1000},
              ${0},
              ${"active"},
              ${"ingest-chart-stage1"},
              ${"img"}
            )
          `;

          yield* payloads.capturePayload({
            postUri: chartUri,
            captureStage: "candidate",
            embedType: "img",
            embedPayload: {
              kind: "img",
              images: [
                {
                  alt: "Chart",
                  fullsize: "https://example.com/chart.jpg",
                  thumb: "https://example.com/chart-thumb.jpg"
                }
              ]
            }
          });

          const result = yield* buildStage1EvalSnapshot({
            manifestPath,
            outputPath,
            reportPath
          });

          expect(result.rowCount).toBe(0);
          expect(result.diagnosticCount).toBe(4);
          expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
            "missing-links",
            "missing-link-cards",
            "missing-vision",
            "missing-source-attribution"
          ]);

          const raw = yield* Effect.tryPromise(() => fs.readFile(outputPath, "utf-8"));
          const rows = yield* loadSnapshotFromString(raw);
          const report = decodeBuildReportJson(
            yield* Effect.tryPromise(() => fs.readFile(reportPath, "utf-8"))
          );

          expect(rows).toHaveLength(0);
          expect(report.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
            "missing-links",
            "missing-link-cards",
            "missing-vision",
            "missing-source-attribution"
          ]);
        }).pipe(Effect.provide(layer));
      })
    )
  );

  it.live("builds rows for mixed Bluesky and Twitter manifests while reporting non-blocking diagnostics separately", () =>
    withTempSqliteFileEffect((filename) =>
      withTempDirectoryEffect((dir) => {
        const manifestPath = join(dir, "gold-set-resolver.json");
        const outputPath = join(dir, "snapshot.jsonl");
        const reportPath = join(dir, "snapshot.build-report.json");
        const layer = Layer.mergeAll(
          makeBiLayer({ filename }),
          localFileSystemLayer
        );

        return Effect.gen(function* () {
          yield* Effect.tryPromise(() =>
            fs.writeFile(
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
            )
          );

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

          const result = yield* buildStage1EvalSnapshot({
            manifestPath,
            outputPath,
            reportPath
          });

          expect(result.rowCount).toBe(2);
          expect(result.diagnosticCount).toBe(1);
          expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
            "missing-links"
          ]);

          const raw = yield* Effect.tryPromise(() => fs.readFile(outputPath, "utf-8"));
          const rows = yield* loadSnapshotFromString(raw);
          expect(rows).toHaveLength(2);
          expect(rows.map((row) => row.postUri)).toEqual([solarUri, twitterUri]);
          expect(rows[0]?.postContext.links).toEqual([]);
          expect(rows[1]?.postContext.links).toHaveLength(1);
          expect(rows[1]?.postContext.linkCards).toHaveLength(1);

          const report = decodeBuildReportJson(
            yield* Effect.tryPromise(() => fs.readFile(reportPath, "utf-8"))
          );
          expect(report.diagnostics).toHaveLength(1);
        }).pipe(Effect.provide(layer));
      })
    )
  );

  it.live("returns a typed manifest decode diagnostic when the gold set shape is invalid", () =>
    withTempDirectoryEffect((dir) => {
      const manifestPath = join(dir, "gold-set-resolver.json");

      return Effect.gen(function* () {
        yield* Effect.tryPromise(() =>
          fs.writeFile(
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
          )
        );

        const error = yield* loadResolverGoldSetManifest(manifestPath).pipe(
          Effect.provide(localFileSystemLayer),
          Effect.flip
        );

        expect(error).toBeInstanceOf(Stage1EvalSnapshotBuildError);

        if (!(error instanceof Stage1EvalSnapshotBuildError)) {
          throw new Error("Expected Stage1EvalSnapshotBuildError");
        }

        expect(error.report.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
          "manifest-decode-failed"
        ]);
      });
    })
  );
});
