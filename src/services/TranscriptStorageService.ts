import { Effect, Layer, Schema, ServiceMap } from "effect";
import {
  type PodcastTranscript,
  PodcastTranscript as PodcastTranscriptSchema
} from "../domain/podcast";
import { TranscriptStorageError } from "../domain/errors";
import {
  type PodcastEpisodeId as PodcastEpisodeIdType,
  type PublicationId as PublicationIdType,
  TranscriptR2Key,
  type TranscriptR2Key as TranscriptR2KeyType
} from "../domain/types";
import { CloudflareEnv, EnvError } from "../platform/Env";
import {
  formatSchemaParseError,
  stringifyUnknown,
  stripUndefined
} from "../platform/Json";

const PodcastTranscriptJsonSchema = Schema.fromJsonString(PodcastTranscriptSchema);
const decodeTranscript = Schema.decodeUnknownEffect(PodcastTranscriptSchema);
const decodeTranscriptR2Key = Schema.decodeUnknownEffect(TranscriptR2Key);
const encodeTranscriptJsonSchema = Schema.encodeEffect(PodcastTranscriptJsonSchema);
const decodeTranscriptJsonSchema = Schema.decodeUnknownEffect(
  PodcastTranscriptJsonSchema
);

type SchemaParseCause = Parameters<typeof formatSchemaParseError>[0];

const schemaStorageError = (
  operation: string,
  cause: SchemaParseCause,
  key?: TranscriptR2KeyType
) =>
  new TranscriptStorageError(stripUndefined({
    operation,
    key,
    message: formatSchemaParseError(cause)
  }));

const storageDefectError = (
  operation: string,
  cause: unknown,
  key?: TranscriptR2KeyType
) =>
  new TranscriptStorageError(stripUndefined({
    operation,
    key,
    message: stringifyUnknown(cause)
  }));

const validateKeySegment = (
  value: string,
  label: "showSlug" | "episodeId"
): Effect.Effect<string, TranscriptStorageError> => {
  if (
    value.length === 0 ||
    value.startsWith("/") ||
    value.includes("/") ||
    value.includes("\\") ||
    value.includes("..")
  ) {
    return Effect.fail(
      new TranscriptStorageError({
        operation: "buildKey",
        message: `invalid transcript ${label} for R2 key: ${value}`
      })
    );
  }

  return Effect.succeed(value);
};

const makeTranscriptR2Key = (
  showSlug: PublicationIdType,
  episodeId: PodcastEpisodeIdType
): Effect.Effect<TranscriptR2KeyType, TranscriptStorageError> =>
  Effect.all({
    safeShowSlug: validateKeySegment(showSlug, "showSlug"),
    safeEpisodeId: validateKeySegment(episodeId, "episodeId")
  }).pipe(
    Effect.map(
      ({ safeEpisodeId, safeShowSlug }) =>
        `transcripts/${safeShowSlug}/${safeEpisodeId}.json`
    ),
    Effect.flatMap((key) =>
      decodeTranscriptR2Key(key).pipe(
        Effect.mapError((cause) => schemaStorageError("buildKey", cause))
      )
    )
  );

const encodeTranscriptJson = (transcript: PodcastTranscript) =>
  encodeTranscriptJsonSchema(transcript).pipe(
    Effect.mapError(
      (cause) => schemaStorageError("encode", cause, transcript.transcriptR2Key)
    )
  );

const decodeTranscriptJson = (text: string, key: TranscriptR2KeyType) =>
  decodeTranscriptJsonSchema(text).pipe(
    Effect.mapError(
      (cause) => schemaStorageError("decode", cause, key)
    )
  );

const validateStoredKey = (
  key: TranscriptR2KeyType,
  operation: "validateGetKey" | "validateExistsKey"
) =>
  decodeTranscriptR2Key(key).pipe(
    Effect.mapError((cause) => schemaStorageError(operation, cause))
  );

const tryBucket = <A>(
  operation: string,
  evaluate: () => Promise<A>,
  key?: TranscriptR2KeyType
) =>
  Effect.tryPromise({
    try: evaluate,
    catch: (cause) => storageDefectError(operation, cause, key)
  });

export class TranscriptStorageService extends ServiceMap.Service<
  TranscriptStorageService,
  {
    readonly upload: (
      transcript: PodcastTranscript
    ) => Effect.Effect<
      TranscriptR2KeyType,
      TranscriptStorageError
    >;
    readonly get: (
      key: TranscriptR2KeyType
    ) => Effect.Effect<PodcastTranscript | null, TranscriptStorageError>;
    readonly exists: (
      key: TranscriptR2KeyType
    ) => Effect.Effect<boolean, TranscriptStorageError>;
  }
>()("@skygest/TranscriptStorageService") {
  static layer = Layer.effect(
    TranscriptStorageService,
    Effect.gen(function* () {
      const env = yield* CloudflareEnv;
      const bucket = env.TRANSCRIPTS_BUCKET;

      if (bucket == null) {
        return yield* new EnvError({ missing: "TRANSCRIPTS_BUCKET" });
      }

      const upload = Effect.fn("TranscriptStorageService.upload")(function* (
        transcript: PodcastTranscript
      ) {
        const validatedTranscript = yield* decodeTranscript(transcript).pipe(
          Effect.mapError(
            (cause) => schemaStorageError("validateUpload", cause)
          )
        );
        const key = yield* makeTranscriptR2Key(
          validatedTranscript.showSlug,
          validatedTranscript.episodeId
        );
        const encodedTranscript = yield* encodeTranscriptJson({
          ...validatedTranscript,
          transcriptR2Key: key
        });

        yield* tryBucket(
          "upload",
          () =>
            bucket.put(key, encodedTranscript, {
              httpMetadata: {
                contentType: "application/json; charset=utf-8"
              },
              customMetadata: {
                format: validatedTranscript.format,
                episodeId: validatedTranscript.episodeId,
                showSlug: validatedTranscript.showSlug
              }
            }),
          key
        );

        return key;
      });

      const get = Effect.fn("TranscriptStorageService.get")(function* (
        key: TranscriptR2KeyType
      ) {
        const validatedKey = yield* validateStoredKey(key, "validateGetKey");

        const object = yield* tryBucket("get", () => bucket.get(validatedKey), validatedKey);

        if (object === null) {
          return null;
        }

        const text = yield* tryBucket(
          "readBody",
          () => object.text(),
          validatedKey
        );

        return yield* decodeTranscriptJson(text, validatedKey);
      });

      const exists = Effect.fn("TranscriptStorageService.exists")(function* (
        key: TranscriptR2KeyType
      ) {
        const validatedKey = yield* validateStoredKey(key, "validateExistsKey");

        const object = yield* tryBucket(
          "exists",
          () => bucket.head(validatedKey),
          validatedKey
        );

        return object !== null;
      });

      return TranscriptStorageService.of({
        upload,
        get,
        exists
      });
    })
  );
}
