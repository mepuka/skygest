import { Option, Result, Schema } from "effect";
import { Aggregation } from "../../domain/data-layer/variable";
import type { VocabularyCollisionError } from "../../domain/errors";
import {
  buildSurfaceFormLookup,
  makeSurfaceFormEntry,
  matchSurfaceForm,
  parseSurfaceForm,
  type SurfaceFormLookup
} from "./SurfaceFormEntry";

export const AggregationSurfaceForm = makeSurfaceFormEntry(Aggregation);
export type AggregationSurfaceForm = Schema.Schema.Type<
  typeof AggregationSurfaceForm
>;

export const AggregationVocabulary = Schema.Array(AggregationSurfaceForm);
export type AggregationVocabulary = Schema.Schema.Type<
  typeof AggregationVocabulary
>;

export type AggregationLookup = SurfaceFormLookup<AggregationSurfaceForm>;

export const buildAggregationLookup = (
  entries: ReadonlyArray<AggregationSurfaceForm>
): Result.Result<AggregationLookup, VocabularyCollisionError> =>
  buildSurfaceFormLookup("aggregation", entries);

export const matchAggregation = (
  lookup: AggregationLookup,
  text: string
): Option.Option<AggregationSurfaceForm> => matchSurfaceForm(lookup, text);

export const parseAggregation = (
  lookup: AggregationLookup,
  text: string
): Option.Option<Schema.Schema.Type<typeof Aggregation>> =>
  parseSurfaceForm(lookup, text);
