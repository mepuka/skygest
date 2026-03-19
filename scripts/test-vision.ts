/**
 * Local test harness for GeminiVisionService.
 *
 * Usage:
 *   GOOGLE_API_KEY=<key> bun scripts/test-vision.ts <image-url>
 *   GOOGLE_API_KEY=<key> bun scripts/test-vision.ts --classify <image-url>
 *   GOOGLE_API_KEY=<key> bun scripts/test-vision.ts --extract <image-url>
 *
 * Reuses GeminiVisionService — no duplication of extraction logic.
 */

import { Args, Command, Options } from "@effect/cli";
import { BunContext, BunRuntime } from "@effect/platform-bun";
import { ConfigProvider, Effect, Layer, Logger, LogLevel } from "effect";
import {
  GeminiVisionService,
  ImageClassification
} from "../src/enrichment/GeminiVisionService";
import { GeminiVisionServiceLive } from "../src/enrichment/GeminiVisionServiceLive";
import { VisionAssetAnalysis } from "../src/domain/enrichment";
import { encodeJsonStringWith } from "../src/platform/Json";

const encodeClassification = encodeJsonStringWith(ImageClassification);
const encodeEnrichment = encodeJsonStringWith(VisionAssetAnalysis);

const inferMimeType = (url: string) =>
  url.endsWith(".png") ? "image/png" : "image/jpeg";

const imageUrl = Args.text({ name: "image-url" });
const classifyOnly = Options.boolean("classify").pipe(Options.withDefault(false));
const extractOnly = Options.boolean("extract").pipe(Options.withDefault(false));

const testVision = Command.make(
  "test-vision",
  { imageUrl, classifyOnly, extractOnly },
  ({ imageUrl, classifyOnly, extractOnly }) =>
    Effect.gen(function* () {
      const svc = yield* GeminiVisionService;
      const mimeType = inferMimeType(imageUrl);

      yield* Effect.log(`Image: ${imageUrl}`);

      if (!extractOnly) {
        yield* Effect.log("Running classification...");
        const classification = yield* svc.classifyImage(imageUrl, mimeType);
        yield* Effect.log(`Classification:\n${encodeClassification(classification)}`);
      }

      if (!classifyOnly) {
        yield* Effect.log("Running full extraction...");
        const extraction = yield* svc.extractChartData(imageUrl, mimeType);
        yield* Effect.log(`Extraction:\n${encodeEnrichment(extraction)}`);
      }
    })
);

const configLayer = Layer.setConfigProvider(ConfigProvider.fromEnv());
const visionLayer = GeminiVisionServiceLive.pipe(Layer.provide(configLayer));

const cli = Command.run(testVision, {
  name: "test-vision",
  version: "0.1.0"
});

cli(process.argv).pipe(
  Effect.provide(Layer.mergeAll(visionLayer, BunContext.layer)),
  Logger.withMinimumLogLevel(LogLevel.Debug),
  BunRuntime.runMain
);
