import { Option, Result, Schema } from "effect";
import type { VocabularyCollisionError } from "../../domain/errors";
import {
  buildSurfaceFormLookup,
  makeSurfaceFormEntry,
  matchSurfaceForm,
  parseSurfaceForm,
  type SurfaceFormLookup
} from "./SurfaceFormEntry";

export const DomainObjectSurfaceForm = makeSurfaceFormEntry(Schema.String);
export type DomainObjectSurfaceForm = Schema.Schema.Type<
  typeof DomainObjectSurfaceForm
>;

export const DomainObjectVocabulary = Schema.Array(
  DomainObjectSurfaceForm
);
export type DomainObjectVocabulary = Schema.Schema.Type<
  typeof DomainObjectVocabulary
>;

export type DomainObjectLookup =
  SurfaceFormLookup<DomainObjectSurfaceForm>;

export const buildDomainObjectLookup = (
  entries: ReadonlyArray<DomainObjectSurfaceForm>
): Result.Result<DomainObjectLookup, VocabularyCollisionError> =>
  buildSurfaceFormLookup("domain-object", entries);

export const matchDomainObject = (
  lookup: DomainObjectLookup,
  text: string
): Option.Option<DomainObjectSurfaceForm> =>
  matchSurfaceForm(lookup, text);

export const parseDomainObject = (
  lookup: DomainObjectLookup,
  text: string
): Option.Option<string> => parseSurfaceForm(lookup, text);
