import { Option, Result, Schema } from "effect";
import { UnitFamily } from "../../domain/data-layer/variable";
import type { VocabularyCollisionError } from "../../domain/errors";
import {
  buildSurfaceFormLookup,
  makeSurfaceFormEntry,
  matchSurfaceForm,
  parseSurfaceForm,
  type SurfaceFormLookup
} from "./SurfaceFormEntry";

export const UnitFamilySurfaceForm = makeSurfaceFormEntry(UnitFamily);
export type UnitFamilySurfaceForm = Schema.Schema.Type<
  typeof UnitFamilySurfaceForm
>;

export const UnitFamilyVocabulary = Schema.Array(UnitFamilySurfaceForm);
export type UnitFamilyVocabulary = Schema.Schema.Type<typeof UnitFamilyVocabulary>;

export type UnitFamilyLookup = SurfaceFormLookup<UnitFamilySurfaceForm>;

export const buildUnitFamilyLookup = (
  entries: ReadonlyArray<UnitFamilySurfaceForm>
): Result.Result<UnitFamilyLookup, VocabularyCollisionError> =>
  buildSurfaceFormLookup("unit-family", entries);

export const matchUnitFamily = (
  lookup: UnitFamilyLookup,
  text: string
): Option.Option<UnitFamilySurfaceForm> => matchSurfaceForm(lookup, text);

export const parseUnitFamily = (
  lookup: UnitFamilyLookup,
  text: string
): Option.Option<Schema.Schema.Type<typeof UnitFamily>> =>
  parseSurfaceForm(lookup, text);
