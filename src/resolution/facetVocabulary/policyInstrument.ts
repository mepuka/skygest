import { Option, Result, Schema } from "effect";
import type { VocabularyCollisionError } from "../../domain/errors";
import {
  buildSurfaceFormLookup,
  makeSurfaceFormEntry,
  matchSurfaceForm,
  parseSurfaceForm,
  type SurfaceFormLookup
} from "./SurfaceFormEntry";

export const PolicyInstrumentSurfaceForm = makeSurfaceFormEntry(Schema.String);
export type PolicyInstrumentSurfaceForm = Schema.Schema.Type<
  typeof PolicyInstrumentSurfaceForm
>;

export const PolicyInstrumentVocabulary = Schema.Array(
  PolicyInstrumentSurfaceForm
);
export type PolicyInstrumentVocabulary = Schema.Schema.Type<
  typeof PolicyInstrumentVocabulary
>;

export type PolicyInstrumentLookup =
  SurfaceFormLookup<PolicyInstrumentSurfaceForm>;

export const buildPolicyInstrumentLookup = (
  entries: ReadonlyArray<PolicyInstrumentSurfaceForm>
): Result.Result<PolicyInstrumentLookup, VocabularyCollisionError> =>
  buildSurfaceFormLookup("policy-instrument", entries);

export const matchPolicyInstrument = (
  lookup: PolicyInstrumentLookup,
  text: string
): Option.Option<PolicyInstrumentSurfaceForm> =>
  matchSurfaceForm(lookup, text);

export const parsePolicyInstrument = (
  lookup: PolicyInstrumentLookup,
  text: string
): Option.Option<string> => parseSurfaceForm(lookup, text);
