import { Schema } from "effect";
import { ProviderId } from "../source";
import { Did, PostUri } from "../types";
import { EditorialScore } from "../editorial";
import {
  DateStamp,
  DiscourseLevel,
  IsoTimestamp,
  NonEmptyNarrativeText
} from "./story";

export const PostAnnotationEnrichments = Schema.Struct({
  // [hydratable] whether vision enrichment completed for this post
  vision: Schema.Boolean,
  // [hydratable] whether source attribution enrichment completed for this post
  source_attribution: Schema.Boolean
});
export type PostAnnotationEnrichments = Schema.Schema.Type<
  typeof PostAnnotationEnrichments
>;

export const PostAnnotationFrontmatter = Schema.Struct({
  // [hydratable] canonical post uri for the annotated post
  post_uri: PostUri,
  // [hydratable] author DID copied from the source post
  author: Did,
  // [hydratable] source post capture timestamp
  captured_at: IsoTimestamp,
  // [hydratable] date the post was promoted into editorial picks
  curation_date: DateStamp,
  // [hydratable] editorial score copied from the pick record
  editorial_score: EditorialScore,
  // [hydratable] enrichment readiness flags relevant to annotation scaffolding
  enrichments: PostAnnotationEnrichments,
  // [hydratable] normalized source providers resolved from attribution
  source_providers: Schema.Array(ProviderId),
  // [hydratable] early data refs cache, starts empty until extraction is structured
  data_refs: Schema.Array(Schema.String),
  // [hydratable] early entity cache, starts empty until extraction is structured
  entities: Schema.Array(Schema.String),

  // [editorial] optional argument-pattern assignment
  argument_pattern: Schema.optionalKey(NonEmptyNarrativeText),
  // [editorial] optional discourse-level classification
  discourse_level: Schema.optionalKey(DiscourseLevel),
  // [editorial] optional editor note attached to the annotation
  editor_note: Schema.optionalKey(NonEmptyNarrativeText)
});
export type PostAnnotationFrontmatter = Schema.Schema.Type<
  typeof PostAnnotationFrontmatter
>;
