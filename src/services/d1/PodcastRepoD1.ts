import { Effect, Layer, Schema } from "effect";
import { SqlClient } from "effect/unstable/sql";
import type {
  PodcastEpisodeBundle,
  PodcastEpisodeRecord,
  PodcastSegmentRecord,
  PodcastSegmentTopicMatch
} from "../../domain/podcast";
import {
  PodcastChapterMarker as PodcastChapterMarkerSchema,
  PodcastEpisodeBundle as PodcastEpisodeBundleSchema,
  PodcastEpisodeRecord as PodcastEpisodeRecordSchema,
  PodcastSegmentRecord as PodcastSegmentRecordSchema,
  PodcastSegmentTopicMatch as PodcastSegmentTopicMatchSchema
} from "../../domain/podcast";
import {
  Did,
  PodcastEpisodeId,
  PublicationId,
  type PodcastEpisodeId as PodcastEpisodeIdType
} from "../../domain/types";
import { PodcastRepo } from "../PodcastRepo";
import {
  decodeJsonColumnWithDbError,
  encodeJsonColumnWithDbError
} from "./jsonColumns";
import { decodeWithDbError } from "./schemaDecode";

const EpisodeRowSchema = Schema.Struct({
  episodeId: Schema.String,
  showSlug: Schema.String,
  title: Schema.String,
  publishedAt: Schema.Number,
  audioUrl: Schema.NullOr(Schema.String),
  durationSeconds: Schema.NullOr(Schema.Number),
  speakerDidsJson: Schema.String,
  chapterMarkersJson: Schema.NullOr(Schema.String),
  transcriptR2Key: Schema.NullOr(Schema.String),
  lifecycleState: Schema.String,
  createdAt: Schema.Number,
  updatedAt: Schema.Number
});
const EpisodeRowsSchema = Schema.Array(EpisodeRowSchema);
type EpisodeRow = Schema.Schema.Type<typeof EpisodeRowSchema>;

const SegmentRowSchema = Schema.Struct({
  segmentId: Schema.String,
  episodeId: Schema.String,
  segmentIndex: Schema.Number,
  primarySpeakerDid: Schema.String,
  speakerDidsJson: Schema.String,
  startTimestampMs: Schema.Number,
  endTimestampMs: Schema.Number,
  text: Schema.String,
  createdAt: Schema.Number
});
const SegmentRowsSchema = Schema.Array(SegmentRowSchema);
type SegmentRow = Schema.Schema.Type<typeof SegmentRowSchema>;

const SegmentTopicRowSchema = Schema.Struct({
  segmentId: Schema.String,
  topicSlug: Schema.String,
  matchedTerm: Schema.NullOr(Schema.String),
  matchSignal: Schema.String,
  matchValue: Schema.NullOr(Schema.String),
  matchScore: Schema.NullOr(Schema.Number),
  ontologyVersion: Schema.String,
  matcherVersion: Schema.String
});
const SegmentTopicRowsSchema = Schema.Array(SegmentTopicRowSchema);
type SegmentTopicRow = Schema.Schema.Type<typeof SegmentTopicRowSchema>;

const DidArraySchema = Schema.Array(Did);
const ChapterMarkerArrayOrNullSchema = Schema.NullOr(
  Schema.Array(PodcastChapterMarkerSchema)
);

const decodeSpeakerDids = (value: string, field: string) =>
  decodeJsonColumnWithDbError(value, field).pipe(
    Effect.flatMap((decoded) =>
      decodeWithDbError(
        DidArraySchema,
        decoded,
        `Failed to normalize ${field}`
      )
    )
  );

const decodeChapterMarkers = (value: string | null, field: string) =>
  decodeJsonColumnWithDbError(value, field).pipe(
    Effect.flatMap((decoded) =>
      decodeWithDbError(
        ChapterMarkerArrayOrNullSchema,
        decoded,
        `Failed to normalize ${field}`
      )
    )
  );

const toPodcastEpisodeRecord = (row: EpisodeRow) =>
  Effect.all({
    speakerDids: decodeSpeakerDids(
      row.speakerDidsJson,
      `speaker dids for ${row.episodeId}`
    ),
    chapterMarkers: decodeChapterMarkers(
      row.chapterMarkersJson,
      `chapter markers for ${row.episodeId}`
    )
  }).pipe(
    Effect.flatMap(({ chapterMarkers, speakerDids }) =>
      decodeWithDbError(
        PodcastEpisodeRecordSchema,
        {
          episodeId: row.episodeId,
          showSlug: row.showSlug,
          title: row.title,
          publishedAt: row.publishedAt,
          audioUrl: row.audioUrl,
          durationSeconds: row.durationSeconds,
          speakerDids,
          chapterMarkers,
          transcriptR2Key: row.transcriptR2Key,
          lifecycleState: row.lifecycleState,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt
        },
        `Failed to normalize podcast episode ${row.episodeId}`
      )
    )
  );

const toPodcastSegmentTopicMatch = (row: SegmentTopicRow) =>
  decodeWithDbError(
    PodcastSegmentTopicMatchSchema,
    {
      topicSlug: row.topicSlug,
      matchedTerm: row.matchedTerm,
      matchSignal: row.matchSignal,
      matchValue: row.matchValue,
      matchScore: row.matchScore,
      ontologyVersion: row.ontologyVersion,
      matcherVersion: row.matcherVersion
    },
    `Failed to normalize topic matches for ${row.segmentId}`
  );

const toPodcastSegmentRecord = (
  row: SegmentRow,
  topicMatches: ReadonlyArray<PodcastSegmentTopicMatch>
) =>
  decodeSpeakerDids(
    row.speakerDidsJson,
    `segment speaker dids for ${row.segmentId}`
  ).pipe(
    Effect.flatMap((speakerDids) =>
      decodeWithDbError(
        PodcastSegmentRecordSchema,
        {
          segmentId: row.segmentId,
          episodeId: row.episodeId,
          segmentIndex: row.segmentIndex,
          primarySpeakerDid: row.primarySpeakerDid,
          speakerDids,
          startTimestampMs: row.startTimestampMs,
          endTimestampMs: row.endTimestampMs,
          text: row.text,
          createdAt: row.createdAt,
          topicMatches
        },
        `Failed to normalize podcast segment ${row.segmentId}`
      )
    )
  );

const encodeEpisodeJsonColumns = (episode: PodcastEpisodeRecord) =>
  Effect.all({
    speakerDidsJson: encodeJsonColumnWithDbError(
      episode.speakerDids,
      `speaker dids for ${episode.episodeId}`
    ),
    chapterMarkersJson: encodeJsonColumnWithDbError(
      episode.chapterMarkers,
      `chapter markers for ${episode.episodeId}`
    )
  });

const encodeSegmentSpeakerDids = (segment: PodcastSegmentRecord) =>
  encodeJsonColumnWithDbError(
    segment.speakerDids,
    `speaker dids for ${segment.segmentId}`
  );

const listEpisodesByShowSlugRowQuery = (
  sql: SqlClient.SqlClient,
  showSlug: string
) =>
  sql<any>`
    SELECT
      episode_id as episodeId,
      show_slug as showSlug,
      title as title,
      published_at as publishedAt,
      audio_url as audioUrl,
      duration_seconds as durationSeconds,
      speaker_dids as speakerDidsJson,
      chapter_markers as chapterMarkersJson,
      transcript_r2_key as transcriptR2Key,
      lifecycle_state as lifecycleState,
      created_at as createdAt,
      updated_at as updatedAt
    FROM podcast_episodes
    WHERE show_slug = ${showSlug}
    ORDER BY published_at DESC, episode_id ASC
  `;

const getEpisodeRowQuery = (
  sql: SqlClient.SqlClient,
  episodeId: PodcastEpisodeIdType
) =>
  sql<any>`
    SELECT
      episode_id as episodeId,
      show_slug as showSlug,
      title as title,
      published_at as publishedAt,
      audio_url as audioUrl,
      duration_seconds as durationSeconds,
      speaker_dids as speakerDidsJson,
      chapter_markers as chapterMarkersJson,
      transcript_r2_key as transcriptR2Key,
      lifecycle_state as lifecycleState,
      created_at as createdAt,
      updated_at as updatedAt
    FROM podcast_episodes
    WHERE episode_id = ${episodeId}
    LIMIT 1
  `;

const getSegmentRowsQuery = (
  sql: SqlClient.SqlClient,
  episodeId: PodcastEpisodeIdType
) =>
  sql<any>`
    SELECT
      segment_id as segmentId,
      episode_id as episodeId,
      segment_index as segmentIndex,
      primary_speaker_did as primarySpeakerDid,
      speaker_dids as speakerDidsJson,
      start_timestamp_ms as startTimestampMs,
      end_timestamp_ms as endTimestampMs,
      text as text,
      created_at as createdAt
    FROM podcast_segments
    WHERE episode_id = ${episodeId}
    ORDER BY segment_index ASC, segment_id ASC
  `;

const getSegmentTopicRowsQuery = (
  sql: SqlClient.SqlClient,
  episodeId: PodcastEpisodeIdType
) =>
  sql<any>`
    SELECT
      pst.segment_id as segmentId,
      pst.topic_slug as topicSlug,
      pst.matched_term as matchedTerm,
      pst.match_signal as matchSignal,
      pst.match_value as matchValue,
      pst.match_score as matchScore,
      pst.ontology_version as ontologyVersion,
      pst.matcher_version as matcherVersion
    FROM podcast_segment_topics pst
    JOIN podcast_segments ps ON ps.segment_id = pst.segment_id
    WHERE ps.episode_id = ${episodeId}
    ORDER BY ps.segment_index ASC, pst.topic_slug ASC
  `;

export const PodcastRepoD1 = {
  layer: Layer.effect(PodcastRepo, Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;

    const upsertEpisodeBundle = (bundle: PodcastEpisodeBundle) =>
      decodeWithDbError(
        PodcastEpisodeBundleSchema,
        bundle,
        "Invalid podcast episode bundle"
      ).pipe(
        Effect.flatMap((validated) =>
          encodeEpisodeJsonColumns(validated.episode).pipe(
            Effect.flatMap(({ chapterMarkersJson, speakerDidsJson }) =>
              sql.withTransaction(
                Effect.gen(function* () {
                  yield* sql`
                    INSERT INTO podcast_episodes (
                      episode_id,
                      show_slug,
                      title,
                      published_at,
                      audio_url,
                      duration_seconds,
                      speaker_dids,
                      chapter_markers,
                      transcript_r2_key,
                      lifecycle_state,
                      created_at,
                      updated_at
                    ) VALUES (
                      ${validated.episode.episodeId},
                      ${validated.episode.showSlug},
                      ${validated.episode.title},
                      ${validated.episode.publishedAt},
                      ${validated.episode.audioUrl},
                      ${validated.episode.durationSeconds},
                      ${speakerDidsJson},
                      ${chapterMarkersJson},
                      ${validated.episode.transcriptR2Key},
                      ${validated.episode.lifecycleState},
                      ${validated.episode.createdAt},
                      ${validated.episode.updatedAt}
                    )
                    ON CONFLICT(episode_id) DO UPDATE SET
                      show_slug = excluded.show_slug,
                      title = excluded.title,
                      published_at = excluded.published_at,
                      audio_url = excluded.audio_url,
                      duration_seconds = excluded.duration_seconds,
                      speaker_dids = excluded.speaker_dids,
                      chapter_markers = excluded.chapter_markers,
                      transcript_r2_key = excluded.transcript_r2_key,
                      lifecycle_state = excluded.lifecycle_state,
                      updated_at = excluded.updated_at
                  `.pipe(Effect.asVoid);

                  yield* sql`
                    DELETE FROM podcast_segment_topics
                    WHERE segment_id IN (
                      SELECT segment_id
                      FROM podcast_segments
                      WHERE episode_id = ${validated.episode.episodeId}
                    )
                  `.pipe(Effect.asVoid);
                  yield* sql`
                    DELETE FROM podcast_segments
                    WHERE episode_id = ${validated.episode.episodeId}
                  `.pipe(Effect.asVoid);

                  yield* Effect.forEach(
                    validated.segments,
                    (segment) =>
                      encodeSegmentSpeakerDids(segment).pipe(
                        Effect.flatMap((speakerDidsJson) =>
                          sql`
                            INSERT INTO podcast_segments (
                              segment_id,
                              episode_id,
                              segment_index,
                              primary_speaker_did,
                              speaker_dids,
                              start_timestamp_ms,
                              end_timestamp_ms,
                              text,
                              created_at
                            ) VALUES (
                              ${segment.segmentId},
                              ${segment.episodeId},
                              ${segment.segmentIndex},
                              ${segment.primarySpeakerDid},
                              ${speakerDidsJson},
                              ${segment.startTimestampMs},
                              ${segment.endTimestampMs},
                              ${segment.text},
                              ${segment.createdAt}
                            )
                          `.pipe(
                            Effect.asVoid,
                            Effect.flatMap(() =>
                              Effect.forEach(
                                segment.topicMatches,
                                (topicMatch) =>
                                  sql`
                                    INSERT INTO podcast_segment_topics (
                                      segment_id,
                                      topic_slug,
                                      matched_term,
                                      match_signal,
                                      match_value,
                                      match_score,
                                      ontology_version,
                                      matcher_version
                                    ) VALUES (
                                      ${segment.segmentId},
                                      ${topicMatch.topicSlug},
                                      ${topicMatch.matchedTerm},
                                      ${topicMatch.matchSignal},
                                      ${topicMatch.matchValue},
                                      ${topicMatch.matchScore},
                                      ${topicMatch.ontologyVersion},
                                      ${topicMatch.matcherVersion}
                                    )
                                  `.pipe(Effect.asVoid),
                                { discard: true }
                              )
                            )
                          )
                        )
                      ),
                    { discard: true }
                  );
                })
              )
            )
          )
        )
      );

    const getEpisodeBundle = (episodeId: PodcastEpisodeIdType) =>
      decodeWithDbError(
        PodcastEpisodeId,
        episodeId,
        "Invalid podcast episode id"
      ).pipe(
        Effect.flatMap((validatedEpisodeId) =>
          getEpisodeRowQuery(sql, validatedEpisodeId).pipe(
            Effect.flatMap((rows) =>
              decodeWithDbError(
                EpisodeRowsSchema,
                rows,
                `Failed to decode podcast episode row for ${validatedEpisodeId}`
              )
            ),
            Effect.flatMap((rows) => {
              const episodeRow = rows[0];
              if (episodeRow === undefined) {
                return Effect.succeed(null);
              }

              return Effect.all({
                episode: toPodcastEpisodeRecord(episodeRow),
                segmentRows: getSegmentRowsQuery(sql, validatedEpisodeId).pipe(
                  Effect.flatMap((rows) =>
                    decodeWithDbError(
                      SegmentRowsSchema,
                      rows,
                      `Failed to decode podcast segment rows for ${validatedEpisodeId}`
                    )
                  )
                ),
                topicRows: getSegmentTopicRowsQuery(sql, validatedEpisodeId).pipe(
                  Effect.flatMap((rows) =>
                    decodeWithDbError(
                      SegmentTopicRowsSchema,
                      rows,
                      `Failed to decode podcast segment topic rows for ${validatedEpisodeId}`
                    )
                  )
                )
              }).pipe(
                Effect.flatMap(({ episode, segmentRows, topicRows }) =>
                  Effect.forEach(
                    topicRows,
                    (row) =>
                      toPodcastSegmentTopicMatch(row).pipe(
                        Effect.map((topicMatch) => ({
                          segmentId: row.segmentId,
                          topicMatch
                        }))
                      )
                    ,
                    { discard: false }
                  ).pipe(
                    Effect.flatMap((decodedTopicRows) => {
                      const topicMatchesBySegmentId = new Map<
                        string,
                        Array<PodcastSegmentTopicMatch>
                      >();

                      for (const { segmentId, topicMatch } of decodedTopicRows) {
                        const existing = topicMatchesBySegmentId.get(segmentId) ?? [];
                        existing.push(topicMatch);
                        topicMatchesBySegmentId.set(segmentId, existing);
                      }

                      return Effect.forEach(
                        segmentRows,
                        (segmentRow) =>
                          toPodcastSegmentRecord(
                            segmentRow,
                            topicMatchesBySegmentId.get(segmentRow.segmentId) ?? []
                          ),
                        { discard: false }
                      ).pipe(
                        Effect.flatMap((segments) =>
                          decodeWithDbError(
                            PodcastEpisodeBundleSchema,
                            {
                              episode,
                              segments
                            },
                            `Failed to normalize podcast episode bundle ${validatedEpisodeId}`
                          )
                        )
                      );
                    })
                  )
                )
              );
            })
          )
        )
      );

    const listEpisodesByShowSlug = (showSlug: string) =>
      decodeWithDbError(
        PublicationId,
        showSlug,
        "Invalid podcast show slug"
      ).pipe(
        Effect.flatMap((validatedShowSlug) =>
          listEpisodesByShowSlugRowQuery(sql, validatedShowSlug).pipe(
            Effect.flatMap((rows) =>
              decodeWithDbError(
                EpisodeRowsSchema,
                rows,
                `Failed to decode podcast episodes for ${validatedShowSlug}`
              )
            ),
            Effect.flatMap((rows) =>
              Effect.forEach(rows, (row) => toPodcastEpisodeRecord(row), {
                discard: false
              })
            )
          )
        )
      );

    return PodcastRepo.of({
      upsertEpisodeBundle,
      getEpisodeBundle,
      listEpisodesByShowSlug
    });
  }))
};
