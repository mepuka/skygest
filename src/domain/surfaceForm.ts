import { Schema } from "effect";
import { IsoTimestamp } from "./types";

const NonEmptySurfaceFormString = Schema.String.pipe(
  Schema.check(Schema.isMinLength(1))
);

export const SurfaceFormProvenance = Schema.Literals([
  "cold-start-corpus",
  "hand-curated",
  "oeo-derived",
  "ucum-derived",
  "agent-curated",
  "eval-feedback"
]);
export type SurfaceFormProvenance = Schema.Schema.Type<
  typeof SurfaceFormProvenance
>;

type SurfaceFormTimestamp = Schema.Schema.Type<typeof IsoTimestamp>;
type SurfaceFormTimestampEncoded = Schema.Codec.Encoded<typeof IsoTimestamp>;

type SurfaceFormEntryValue<Canonical extends string> = {
  readonly surfaceForm: string;
  readonly normalizedSurfaceForm: string;
  readonly canonical: Canonical;
  readonly provenance: SurfaceFormProvenance;
  readonly notes?: string;
  readonly addedAt: SurfaceFormTimestamp;
  readonly source?: string;
};

type SurfaceFormEntryEncoded = {
  readonly surfaceForm: string;
  readonly normalizedSurfaceForm: string;
  readonly canonical: string;
  readonly provenance: SurfaceFormProvenance;
  readonly notes?: string;
  readonly addedAt: SurfaceFormTimestampEncoded;
  readonly source?: string;
};

const NotesRequiredSurfaceFormProvenances = new Set<SurfaceFormProvenance>([
  "agent-curated",
  "eval-feedback"
]);

const validateSurfaceFormEntry = (entry: {
  readonly provenance?: string;
  readonly notes?: string;
}) =>
  entry.provenance !== undefined &&
  NotesRequiredSurfaceFormProvenances.has(
    entry.provenance as SurfaceFormProvenance
  ) &&
  (entry.notes == null || entry.notes.length === 0)
    ? `notes are required when provenance is ${entry.provenance}`
    : undefined;

export const makeSurfaceFormEntry = <Canonical extends string>(
  canonical: Schema.Codec<Canonical, string, never, never>
): Schema.Codec<
  SurfaceFormEntryValue<Canonical>,
  SurfaceFormEntryEncoded,
  never,
  never
> =>
  Schema.Struct({
    surfaceForm: NonEmptySurfaceFormString,
    normalizedSurfaceForm: NonEmptySurfaceFormString,
    canonical,
    provenance: SurfaceFormProvenance,
    notes: Schema.optionalKey(NonEmptySurfaceFormString),
    addedAt: IsoTimestamp,
    source: Schema.optionalKey(NonEmptySurfaceFormString)
  }).pipe(Schema.check(Schema.makeFilter(validateSurfaceFormEntry)));

export const SurfaceFormEntryAny = makeSurfaceFormEntry(Schema.String);
export type SurfaceFormEntryAny = Schema.Schema.Type<typeof SurfaceFormEntryAny>;
