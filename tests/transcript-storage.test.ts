import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer, Schema } from "effect";
import { PodcastTranscript as PodcastTranscriptSchema } from "../src/domain/podcast";
import { TranscriptR2Key } from "../src/domain/types";
import { CloudflareEnv, type EnvBindings } from "../src/platform/Env";
import { TranscriptStorageService } from "../src/services/TranscriptStorageService";

type StoredObject = {
  readonly body: string;
  readonly httpMetadata: R2HTTPMetadata;
  readonly customMetadata: Record<string, string>;
  readonly uploaded: Date;
};

const makeStoredObject = (
  body: string,
  metadata?: Partial<Pick<StoredObject, "httpMetadata" | "customMetadata" | "uploaded">>
): StoredObject => ({
  body,
  httpMetadata: metadata?.httpMetadata ?? {},
  customMetadata: metadata?.customMetadata ?? {},
  uploaded: metadata?.uploaded ?? new Date()
});

const createFakeR2Bucket = () => {
  const objects = new Map<string, StoredObject>();

  const normalizeHttpMetadata = (
    value: Headers | R2HTTPMetadata | undefined
  ): R2HTTPMetadata =>
    value == null || value instanceof Headers ? {} : value;

  const toMetadataObject = (key: string, object: StoredObject) =>
    ({
      key,
      version: "v1",
      size: object.body.length,
      etag: "etag",
      httpEtag: '"etag"',
      uploaded: object.uploaded,
      httpMetadata: object.httpMetadata,
      customMetadata: object.customMetadata,
      storageClass: "Standard",
      checksums: {}
    }) as R2Object;

  const bucket = {
    put: async (
      key: string,
      value: string,
      options?: R2PutOptions
    ) => {
      const object = makeStoredObject(value, {
        httpMetadata: normalizeHttpMetadata(options?.httpMetadata),
        ...(options?.customMetadata === undefined
          ? {}
          : { customMetadata: options.customMetadata })
      });
      objects.set(key, object);
      return toMetadataObject(key, object);
    },
    get: async (key: string) => {
      const object = objects.get(key);
      if (object === undefined) {
        return null;
      }

      return {
        ...toMetadataObject(key, object),
        body: new Response(object.body).body,
        text: async () => object.body,
        json: async () => JSON.parse(object.body),
        arrayBuffer: async () => new TextEncoder().encode(object.body).buffer
      } as R2ObjectBody;
    },
    head: async (key: string) => {
      const object = objects.get(key);
      return object === undefined ? null : toMetadataObject(key, object);
    }
  } as R2Bucket;

  return {
    bucket,
    objects
  };
};

const makeTranscriptLayer = () => {
  const fakeBucket = createFakeR2Bucket();
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
      const stored = yield* storage.get(key);

      expect(exists).toBe(false);
      expect(stored).toBeNull();
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

      expect(error.operation).toBe("decode");
      expect(error.key).toBe(key);
      expect(error.message).toContain("speaker");
    }).pipe(Effect.provide(layer));
  });
});
