import { Cause, Effect, Exit, Layer, ServiceMap } from "effect";
import {
  PodcastStorageCoordinationError,
  type TranscriptStorageError
} from "../domain/errors";
import type {
  PodcastEpisodeBundle,
  PodcastTranscript
} from "../domain/podcast";
import type { TranscriptR2Key } from "../domain/types";
import { stringifyUnknown } from "../platform/Json";
import { PodcastRepo } from "./PodcastRepo";
import { TranscriptStorageService } from "./TranscriptStorageService";

const toErrorMessage = (cause: unknown) => {
  if (
    typeof cause === "object" &&
    cause !== null &&
    "message" in cause &&
    typeof cause.message === "string"
  ) {
    return cause.message;
  }

  return stringifyUnknown(cause);
};

const ensureMatchingTranscript = (
  bundle: PodcastEpisodeBundle,
  transcript: PodcastTranscript
) =>
  bundle.episode.episodeId === transcript.episodeId &&
  bundle.episode.showSlug === transcript.showSlug
    ? Effect.void
    : Effect.fail(
        new PodcastStorageCoordinationError({
          operation: "validateConsistency",
          message: "podcast episode bundle and transcript must reference the same show and episode"
        })
      );

const persistFailure = (transcriptKey: TranscriptR2Key, cause: unknown) =>
  new PodcastStorageCoordinationError({
    operation: "persistBundle",
    transcriptKey,
    message: `Failed to persist podcast episode bundle after uploading transcript: ${toErrorMessage(cause)}`
  });

const rollbackFailure = (
  transcriptKey: TranscriptR2Key,
  cause: unknown,
  rollbackCause: unknown
) =>
  new PodcastStorageCoordinationError({
    operation: "rollbackTranscript",
    transcriptKey,
    message: `Failed to persist podcast episode bundle after uploading transcript: ${toErrorMessage(cause)}. Transcript rollback also failed: ${toErrorMessage(rollbackCause)}`
  });

export class PodcastStorageService extends ServiceMap.Service<
  PodcastStorageService,
  {
    readonly upsertEpisodeBundleWithTranscript: (
      bundle: PodcastEpisodeBundle,
      transcript: PodcastTranscript
    ) => Effect.Effect<
      TranscriptR2Key,
      PodcastStorageCoordinationError | TranscriptStorageError
    >;
  }
>()("@skygest/PodcastStorageService") {
  static readonly layer = Layer.effect(
    PodcastStorageService,
    Effect.gen(function* () {
      const repo = yield* PodcastRepo;
      const transcriptStorage = yield* TranscriptStorageService;

      const upsertEpisodeBundleWithTranscript = Effect.fn(
        "PodcastStorageService.upsertEpisodeBundleWithTranscript"
      )(function* (
        bundle: PodcastEpisodeBundle,
        transcript: PodcastTranscript
      ) {
        yield* ensureMatchingTranscript(bundle, transcript);

        const transcriptKey = yield* transcriptStorage.upload(transcript);
        const bundleWithTranscript = {
          episode: {
            ...bundle.episode,
            transcriptR2Key: transcriptKey
          },
          segments: bundle.segments
        } satisfies PodcastEpisodeBundle;

        const persistExit = yield* Effect.exit(
          repo.upsertEpisodeBundle(bundleWithTranscript)
        );
        if (Exit.isSuccess(persistExit)) {
          return transcriptKey;
        }

        const persistCause = Cause.squash(persistExit.cause);
        const rollbackExit = yield* Effect.exit(
          transcriptStorage.delete(transcriptKey)
        );
        if (Exit.isFailure(rollbackExit)) {
          return yield* rollbackFailure(
            transcriptKey,
            persistCause,
            Cause.squash(rollbackExit.cause)
          );
        }

        return yield* persistFailure(transcriptKey, persistCause);
      });

      return PodcastStorageService.of({
        upsertEpisodeBundleWithTranscript
      });
    })
  );
}
