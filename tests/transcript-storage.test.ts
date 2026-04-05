import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer, Schema } from "effect";
import { PodcastTranscript as PodcastTranscriptSchema } from "../src/domain/podcast";
import { TranscriptR2Key } from "../src/domain/types";
import { CloudflareEnv, type EnvBindings } from "../src/platform/Env";
import {
  buildTranscriptR2Key,
  TranscriptStorageService
} from "../src/services/TranscriptStorageService";
import { createFakeR2Bucket, makeStoredObject } from "./support/fakeR2";

const makeTranscriptLayer = (
  bucketOptions?: Parameters<typeof createFakeR2Bucket>[0]
) => {
  const fakeBucket = createFakeR2Bucket(bucketOptions);
  const env = {
    DB: {} as D1Database,
    TRANSCRIPTS_BUCKET: fakeBucket.bucket
  } satisfies EnvBindings;

  const layer = TranscriptStorageService.layer.pipe(
    Layer.provide(CloudflareEnv.layer(env, { required: [] }))
  );

  return {
    layer,
    objects: fakeBucket.objects
  };
};

describe("TranscriptStorageService", () => {
  it.effect("uploads a transcript under the expected key and reads it back", () => {
    const { layer, objects } = makeTranscriptLayer();
    const transcript = Schema.decodeUnknownSync(PodcastTranscriptSchema)({
      format: "skygest-transcript-v1",
      showSlug: "catalyst-with-shayle-kann",
      episodeId: "catalyst-2026-04-04",
      durationMs: 120_000,
      speakers: [
        {
          id: "S0",
          resolvedDid: "did:plc:test-host",
          name: "Host"
        },
        {
          id: "S1",
          resolvedDid: "did:plc:test-guest",
          name: "Guest"
        }
      ],
      segments: [
        {
          startMs: 0,
          endMs: 60_000,
          speakerId: "S0",
          text: "Welcome back to Catalyst."
        },
        {
          startMs: 60_000,
          endMs: 120_000,
          speakerId: "S1",
          text: "Thanks for having me."
        }
      ]
    });

    return Effect.gen(function* () {
      const storage = yield* TranscriptStorageService;
      const key = yield* storage.upload(transcript);
      const exists = yield* storage.exists(key);
      const stored = yield* storage.get(key);

      expect(key).toBe("transcripts/catalyst-with-shayle-kann/catalyst-2026-04-04.json");
      expect(exists).toBe(true);
      expect(objects.has(key)).toBe(true);
      expect(stored).toEqual({
        ...transcript,
        transcriptR2Key: key
      });
    }).pipe(Effect.provide(layer));
  });

  it.effect("overwrites an existing transcript at the same key", () => {
    const { layer } = makeTranscriptLayer();
    const decodeTranscript = Schema.decodeUnknownSync(PodcastTranscriptSchema);

    const initialTranscript = decodeTranscript({
      format: "skygest-transcript-v1",
      showSlug: "the-carbon-copy",
      episodeId: "carbon-copy-2026-04-05",
      durationMs: 60_000,
      speakers: [
        {
          id: "S0",
          resolvedDid: null,
          name: "Host"
        }
      ],
      segments: [
        {
          startMs: 0,
          endMs: 60_000,
          speakerId: "S0",
          text: "Initial transcript."
        }
      ]
    });

    const updatedTranscript = decodeTranscript({
      format: "skygest-transcript-v1",
      showSlug: "the-carbon-copy",
      episodeId: "carbon-copy-2026-04-05",
      durationMs: 90_000,
      speakers: [
        {
          id: "S0",
          resolvedDid: null,
          name: "Host"
        }
      ],
      segments: [
        {
          startMs: 0,
          endMs: 90_000,
          speakerId: "S0",
          text: "Updated transcript."
        }
      ]
    });

    return Effect.gen(function* () {
      const storage = yield* TranscriptStorageService;
      const initialKey = yield* storage.upload(initialTranscript);
      const updatedKey = yield* storage.upload(updatedTranscript);
      const stored = yield* storage.get(updatedKey);

      expect(updatedKey).toBe(initialKey);
      expect(stored).toEqual({
        ...updatedTranscript,
        transcriptR2Key: updatedKey
      });
    }).pipe(Effect.provide(layer));
  });

  it.effect("returns false or null for missing transcript keys", () => {
    const { layer } = makeTranscriptLayer();
    const key = Schema.decodeUnknownSync(TranscriptR2Key)(
      "transcripts/missing/missing.json"
    );

    return Effect.gen(function* () {
      const storage = yield* TranscriptStorageService;
      const exists = yield* storage.exists(key);
      const stored = yield* storage.getOptional(key);
      const missing = yield* storage.get(key).pipe(Effect.flip);

      expect(exists).toBe(false);
      expect(stored).toBeNull();
      expect(missing._tag).toBe("TranscriptNotFoundError");
      expect(missing.key).toBe(key);
    }).pipe(Effect.provide(layer));
  });

  it.effect("fails upload when transcript identifiers would produce an unsafe R2 key", () => {
    const { layer } = makeTranscriptLayer();

    return Effect.gen(function* () {
      const storage = yield* TranscriptStorageService;
      const error = yield* storage.upload({
        format: "skygest-transcript-v1",
        showSlug: "bad/slug" as any,
        episodeId: "episode-2026-04-06" as any,
        durationMs: 30_000,
        speakers: [
          {
            id: "S0" as any,
            resolvedDid: null,
            name: "Host"
          }
        ],
        segments: [
          {
            startMs: 0,
            endMs: 30_000,
            speakerId: "S0" as any,
            text: "Unsafe slug."
          }
        ]
      }).pipe(Effect.flip);

      expect(error.operation).toBe("buildKey");
      expect(error.message).toContain("invalid transcript showSlug");
    }).pipe(Effect.provide(layer));
  });

  it.effect("exports a reusable transcript key builder", () =>
    Effect.gen(function* () {
      const key = yield* buildTranscriptR2Key(
        "catalyst-with-shayle-kann" as any,
        "catalyst-2026-04-04" as any
      );
      const failure = yield* buildTranscriptR2Key(
        "catalyst-with-shayle-kann" as any,
        "../bad-episode" as any
      ).pipe(Effect.flip);

      expect(key).toBe("transcripts/catalyst-with-shayle-kann/catalyst-2026-04-04.json");
      expect(failure.operation).toBe("buildKey");
    }));

  it.effect("fails get when the stored transcript payload does not match the schema", () => {
    const { layer, objects } = makeTranscriptLayer();
    const key = Schema.decodeUnknownSync(TranscriptR2Key)(
      "transcripts/catalyst-with-shayle-kann/bad-transcript.json"
    );

    objects.set(
      key,
      makeStoredObject(
        JSON.stringify({
          format: "skygest-transcript-v1",
          showSlug: "catalyst-with-shayle-kann",
          episodeId: "bad-transcript",
          transcriptR2Key: key,
          durationMs: 1_000,
          speakers: [
            {
              id: "S0",
              resolvedDid: null,
              name: "Host"
            }
          ],
          segments: [
            {
              startMs: 0,
              endMs: 500,
              speakerId: "missing-speaker",
              text: "This should fail schema validation."
            }
          ]
        })
      )
    );

    return Effect.gen(function* () {
      const storage = yield* TranscriptStorageService;
      const error = yield* storage.get(key).pipe(Effect.flip);

      expect(error._tag).toBe("TranscriptStorageError");
      if (error._tag !== "TranscriptStorageError") {
        throw new Error("expected TranscriptStorageError");
      }
      expect(error.operation).toBe("decode");
      expect(error.key).toBe(key);
      expect(error.message).toContain("speaker");
    }).pipe(Effect.provide(layer));
  });

  it.effect("fails when the R2 bucket throws during read", () => {
    const { layer, objects } = makeTranscriptLayer({ failGet: true });
    const key = Schema.decodeUnknownSync(TranscriptR2Key)(
      "transcripts/catalyst-with-shayle-kann/catalyst-2026-04-04.json"
    );

    objects.set(
      key,
      makeStoredObject(
        JSON.stringify({
          format: "skygest-transcript-v1",
          showSlug: "catalyst-with-shayle-kann",
          episodeId: "catalyst-2026-04-04",
          transcriptR2Key: key,
          durationMs: 1_000,
          speakers: [{ id: "S0", resolvedDid: null, name: "Host" }],
          segments: [
            {
              startMs: 0,
              endMs: 1_000,
              speakerId: "S0",
              text: "Stored transcript."
            }
          ]
        })
      )
    );

    return Effect.gen(function* () {
      const storage = yield* TranscriptStorageService;
      const error = yield* storage.getOptional(key).pipe(Effect.flip);

      expect(error.operation).toBe("get");
      expect(error.key).toBe(key);
      expect(error.message).toContain("forced get failure");
    }).pipe(Effect.provide(layer));
  });
});
