import { Option, Result, Schema } from "effect";
import type { VocabularyCollisionError } from "../../domain/errors";
import {
  buildSurfaceFormLookup,
  makeSurfaceFormEntry,
  matchSurfaceForm,
  parseSurfaceForm,
  type SurfaceFormLookup
} from "./SurfaceFormEntry";

export const MeasuredPropertySurfaceForm = makeSurfaceFormEntry(Schema.String);
export type MeasuredPropertySurfaceForm = Schema.Schema.Type<
  typeof MeasuredPropertySurfaceForm
>;

export const MeasuredPropertyVocabulary = Schema.Array(
  MeasuredPropertySurfaceForm
);
export type MeasuredPropertyVocabulary = Schema.Schema.Type<
  typeof MeasuredPropertyVocabulary
>;

export type MeasuredPropertyLookup =
  SurfaceFormLookup<MeasuredPropertySurfaceForm>;

export const buildMeasuredPropertyLookup = (
  entries: ReadonlyArray<MeasuredPropertySurfaceForm>
): Result.Result<MeasuredPropertyLookup, VocabularyCollisionError> =>
  buildSurfaceFormLookup("measured-property", entries);

export const matchMeasuredProperty = (
  lookup: MeasuredPropertyLookup,
  text: string
): Option.Option<MeasuredPropertySurfaceForm> =>
  matchSurfaceForm(lookup, text);

export const parseMeasuredProperty = (
  lookup: MeasuredPropertyLookup,
  text: string
): Option.Option<string> => parseSurfaceForm(lookup, text);
