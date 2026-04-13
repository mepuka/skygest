import { Option, Result, Schema } from "effect";
import type { VocabularyCollisionError } from "../../domain/errors";
import {
  buildSurfaceFormLookup,
  makeSurfaceFormEntry,
  matchAllSurfaceForms,
  matchSurfaceForm,
  parseSurfaceForm,
  type SurfaceFormLookup
} from "./SurfaceFormEntry";

export const TechnologyOrFuelSurfaceForm = makeSurfaceFormEntry(Schema.String);
export type TechnologyOrFuelSurfaceForm = Schema.Schema.Type<
  typeof TechnologyOrFuelSurfaceForm
>;

export const TechnologyOrFuelVocabulary = Schema.Array(
  TechnologyOrFuelSurfaceForm
);
export type TechnologyOrFuelVocabulary = Schema.Schema.Type<
  typeof TechnologyOrFuelVocabulary
>;

export type TechnologyOrFuelLookup =
  SurfaceFormLookup<TechnologyOrFuelSurfaceForm>;

export const buildTechnologyOrFuelLookup = (
  entries: ReadonlyArray<TechnologyOrFuelSurfaceForm>
): Result.Result<TechnologyOrFuelLookup, VocabularyCollisionError> =>
  buildSurfaceFormLookup("technology-or-fuel", entries);

export const matchTechnologyOrFuel = (
  lookup: TechnologyOrFuelLookup,
  text: string
): Option.Option<TechnologyOrFuelSurfaceForm> =>
  matchSurfaceForm(lookup, text);

export const matchAllTechnologyOrFuel = (
  lookup: TechnologyOrFuelLookup,
  text: string
): ReadonlyArray<TechnologyOrFuelSurfaceForm> =>
  matchAllSurfaceForms(lookup, text);

export const parseTechnologyOrFuel = (
  lookup: TechnologyOrFuelLookup,
  text: string
): Option.Option<string> => parseSurfaceForm(lookup, text);
