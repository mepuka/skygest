import { Option, Result, Schema } from "effect";
import { StatisticType } from "../../domain/data-layer/variable";
import type { VocabularyCollisionError } from "../../domain/errors";
import {
  buildSurfaceFormLookup,
  makeSurfaceFormEntry,
  matchSurfaceForm,
  parseSurfaceForm,
  type SurfaceFormLookup
} from "./SurfaceFormEntry";

export const StatisticTypeSurfaceForm = makeSurfaceFormEntry(StatisticType);
export type StatisticTypeSurfaceForm = Schema.Schema.Type<
  typeof StatisticTypeSurfaceForm
>;

export const StatisticTypeVocabulary = Schema.Array(StatisticTypeSurfaceForm);
export type StatisticTypeVocabulary = Schema.Schema.Type<
  typeof StatisticTypeVocabulary
>;

export type StatisticTypeLookup = SurfaceFormLookup<StatisticTypeSurfaceForm>;

export const buildStatisticTypeLookup = (
  entries: ReadonlyArray<StatisticTypeSurfaceForm>
): Result.Result<StatisticTypeLookup, VocabularyCollisionError> =>
  buildSurfaceFormLookup("statistic-type", entries);

export const matchStatisticType = (
  lookup: StatisticTypeLookup,
  text: string
): Option.Option<StatisticTypeSurfaceForm> => matchSurfaceForm(lookup, text);

export const parseStatisticType = (
  lookup: StatisticTypeLookup,
  text: string
): Option.Option<Schema.Schema.Type<typeof StatisticType>> =>
  parseSurfaceForm(lookup, text);
