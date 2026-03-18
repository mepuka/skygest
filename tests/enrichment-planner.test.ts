import { Effect, Layer } from "effect";
import { describe, expect, it } from "@effect/vitest";
import {
  CandidatePayloadNotPickedError
} from "../src/domain/candidatePayload";
import { EnrichmentPlanner } from "../src/enrichment/EnrichmentPlanner";
import { CandidatePayloadService } from "../src/services/CandidatePayloadService";
import {
  makeBiLayer,
  sampleDid,
  seedKnowledgeBase
} from "./support/runtime";
import type { AtUri } from "../src/domain/types";

const solarUri = `at://${sampleDid}/app.bsky.feed.post/post-solar` as AtUri;

const makeLayer = () => {
  const baseLayer = makeBiLayer();
  const plannerLayer = EnrichmentPlanner.layer.pipe(
    Layer.provideMerge(baseLayer)
  );

  return Layer.mergeAll(baseLayer, plannerLayer);
};

describe("EnrichmentPlanner", () => {
  it.effect("builds an asset-level execution plan for a picked multi-image post", () =>
    Effect.gen(function* () {
      yield* seedKnowledgeBase();
      const payloads = yield* CandidatePayloadService;
      const planner = yield* EnrichmentPlanner;

      yield* payloads.capturePayload({
        postUri: solarUri,
        captureStage: "candidate",
        embedType: "img",
        embedPayload: {
          kind: "img",
          images: [
            {
              thumb: "https://cdn.bsky.app/thumb-1.jpg",
              fullsize: "https://cdn.bsky.app/full-1.jpg",
              alt: "Chart one"
            },
            {
              thumb: "https://cdn.bsky.app/thumb-2.jpg",
              fullsize: "https://cdn.bsky.app/full-2.jpg",
              alt: null
            }
          ]
        }
      });
      yield* payloads.markPicked(solarUri);

      const plan = yield* planner.plan({
        postUri: solarUri,
        enrichmentType: "vision",
        schemaVersion: "v1"
      });

      expect(plan.decision).toBe("execute");
      expect(plan.post.text).toContain(
        "Utility-scale solar photovoltaic battery storage"
      );
      expect(plan.post.threadCoverage).toBe("focus-only");
      expect(plan.assets).toHaveLength(2);
      expect(plan.assets[0]).toEqual(
        expect.objectContaining({
          assetType: "image",
          source: "embed",
          index: 0,
          fullsize: "https://cdn.bsky.app/full-1.jpg",
          alt: "Chart one"
        })
      );
      expect(plan.links).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            url: "https://example.com/solar-storage"
          })
        ])
      );
      expect(plan.topicMatches.some((topic) => topic.topicSlug === "solar")).toBe(
        true
      );
      expect(plan.quote).toBeNull();
      expect(plan.linkCards).toEqual([]);
      expect(plan.existingEnrichments).toEqual([]);
    }).pipe(Effect.provide(makeLayer()))
  );

  it.effect("stops vision planning cleanly when a picked post has no visual assets", () =>
    Effect.gen(function* () {
      yield* seedKnowledgeBase();
      const payloads = yield* CandidatePayloadService;
      const planner = yield* EnrichmentPlanner;

      yield* payloads.capturePayload({
        postUri: solarUri,
        captureStage: "candidate",
        embedType: "link",
        embedPayload: {
          kind: "link",
          uri: "https://example.com/report",
          title: "Grid report",
          description: "Useful context",
          thumb: "https://example.com/thumb.jpg"
        }
      });
      yield* payloads.markPicked(solarUri);

      const plan = yield* planner.plan({
        postUri: solarUri,
        enrichmentType: "vision",
        schemaVersion: "v1"
      });

      expect(plan.decision).toBe("skip");
      expect(plan.stopReason).toBe("no-visual-assets");
      expect(plan.assets).toEqual([]);
      expect(plan.linkCards).toEqual([
        {
          source: "embed",
          uri: "https://example.com/report",
          title: "Grid report",
          description: "Useful context",
          thumb: "https://example.com/thumb.jpg"
        }
      ]);
    }).pipe(Effect.provide(makeLayer()))
  );

  it.effect("assembles quote context and valid existing enrichments for source attribution", () =>
    Effect.gen(function* () {
      yield* seedKnowledgeBase();
      const payloads = yield* CandidatePayloadService;
      const planner = yield* EnrichmentPlanner;

      yield* payloads.capturePayload({
        postUri: solarUri,
        captureStage: "candidate",
        embedType: "media",
        embedPayload: {
          kind: "media",
          record: {
            uri: "at://did:plc:quoted/app.bsky.feed.post/quoted-1",
            text: "Quoted context about balancing authority data",
            author: "quoted.author"
          },
          media: {
            kind: "img",
            images: [
              {
                thumb: "https://cdn.bsky.app/thumb-media.jpg",
                fullsize: "https://cdn.bsky.app/full-media.jpg",
                alt: "Chart screenshot"
              }
            ]
          }
        }
      });
      yield* payloads.markPicked(solarUri);
      yield* payloads.saveEnrichment({
        postUri: solarUri,
        enrichmentType: "source-attribution",
        enrichmentPayload: {
          kind: "source-attribution",
          imageSource: null,
          contentSource: {
            url: "https://example.com/solar-storage",
            title: "Solar storage buildout",
            publication: "Example"
          },
          dataSource: null,
          processedAt: 123
        }
      });
      yield* payloads.saveEnrichment({
        postUri: solarUri,
        enrichmentType: "vision",
        enrichmentPayload: {
          summary: "legacy shape that should be ignored"
        }
      });

      const plan = yield* planner.plan({
        postUri: solarUri,
        enrichmentType: "source-attribution",
        schemaVersion: "v1"
      });

      expect(plan.decision).toBe("execute");
      expect(plan.quote).toEqual({
        source: "media",
        uri: "at://did:plc:quoted/app.bsky.feed.post/quoted-1",
        text: "Quoted context about balancing authority data",
        author: "quoted.author"
      });
      expect(plan.assets).toHaveLength(1);
      expect(plan.existingEnrichments).toHaveLength(1);
      expect(plan.existingEnrichments[0]?.output.kind).toBe("source-attribution");
    }).pipe(Effect.provide(makeLayer()))
  );

  it.effect("fails when the stored payload has not been picked", () =>
    Effect.gen(function* () {
      yield* seedKnowledgeBase();
      const payloads = yield* CandidatePayloadService;
      const planner = yield* EnrichmentPlanner;

      yield* payloads.capturePayload({
        postUri: solarUri,
        captureStage: "candidate",
        embedType: "img",
        embedPayload: {
          kind: "img",
          images: [
            {
              thumb: "https://cdn.bsky.app/thumb-1.jpg",
              fullsize: "https://cdn.bsky.app/full-1.jpg",
              alt: null
            }
          ]
        }
      });

      const error = yield* planner.plan({
        postUri: solarUri,
        enrichmentType: "vision",
        schemaVersion: "v1"
      }).pipe(Effect.flip);

      expect(error).toBeInstanceOf(CandidatePayloadNotPickedError);
      if (error instanceof CandidatePayloadNotPickedError) {
        expect(error.captureStage).toBe("candidate");
      }
    }).pipe(Effect.provide(makeLayer()))
  );
});
