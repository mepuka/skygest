import { randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { loadSnapshotFromString } from "../eval/resolution-stage1/shared";
import { buildStage1EvalSnapshot } from "../src/eval/Stage1EvalSnapshotBuilder";
import { Stage1EvalSnapshotBuildError } from "../src/domain/stage1Eval";
import { CandidatePayloadService } from "../src/services/CandidatePayloadService";
import type { PostUri } from "../src/domain/types";
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
  it.live("builds a non-hollow snapshot row from stored post context and enrichments", () =>
    Effect.promise(() =>
      withTempSqliteFile(async (filename) =>
        withTempDirectory(async (dir) => {
          const manifestPath = join(dir, "gold-set-resolver.json");
          const outputPath = join(dir, "snapshot.jsonl");
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
                outputPath
              });
              expect(built.rowCount).toBe(1);

              const raw = yield* Effect.tryPromise(() =>
                fs.readFile(outputPath, "utf-8")
              );
              const rows = yield* loadSnapshotFromString(raw);

              expect(rows).toHaveLength(1);
              expect(rows[0]?.postContext.text.length).toBeGreaterThan(0);
              expect(rows[0]?.postContext.links.length).toBeGreaterThan(0);
              expect(rows[0]?.postContext.linkCards.length).toBeGreaterThan(0);
              expect(rows[0]?.vision).not.toBeNull();
              expect(rows[0]?.sourceAttribution).not.toBeNull();
              expect(rows[0]?.metadata.includesLanes).toEqual(["url-exact-match"]);
            }).pipe(Effect.provide(layer))
          );
        })
      )
    )
  );

  it.live("aggregates typed diagnostics instead of writing a partial snapshot", () =>
    Effect.promise(() =>
      withTempSqliteFile(async (filename) =>
        withTempDirectory(async (dir) => {
          const manifestPath = join(dir, "gold-set-resolver.json");
          const outputPath = join(dir, "snapshot.jsonl");
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
                uri: "x://twitter.example/post/123",
                handle: "tweet-user",
                publisher: "twitter",
                includesLanes: ["provider-agent"]
              }
            ]),
            "utf-8"
          );

          const error = await Effect.runPromise(
            Effect.gen(function* () {
              yield* seedKnowledgeBase();
              return yield* buildStage1EvalSnapshot({
                manifestPath,
                outputPath
              }).pipe(Effect.flip);
            }).pipe(Effect.provide(layer))
          );

          expect(error).toBeInstanceOf(Stage1EvalSnapshotBuildError);

          if (!(error instanceof Stage1EvalSnapshotBuildError)) {
            throw new Error("Expected Stage1EvalSnapshotBuildError");
          }

          expect(error.report.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(
            expect.arrayContaining([
              "missing-candidate-payload",
              "missing-vision",
              "missing-source-attribution",
              "unsupported-post-source"
            ])
          );

          await expect(fs.stat(outputPath)).rejects.toThrow();
        })
      )
    )
  );
});
