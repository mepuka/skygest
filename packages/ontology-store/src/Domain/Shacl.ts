import { Schema } from "effect";

/**
 * ShaclSeverity — the three severity levels in the SHACL specification.
 * Milestone 1 treats every constraint as `Violation`; Info and Warning are
 * reserved for staged strictness ratcheting in a later milestone.
 */
export const ShaclSeverity = Schema.Literals(["Violation", "Warning", "Info"]);
export type ShaclSeverity = Schema.Schema.Type<typeof ShaclSeverity>;

/**
 * ShaclViolation — one failed constraint from a validation run.
 *
 * `focusNode` is the subject IRI that failed; `sourceShape` names the shape
 * that fired; `sourceConstraint` is the constraint component
 * (e.g. `sh:MinCountConstraintComponent`); `path` is the SHACL property
 * path string when the violation is property-scoped; `value` is the
 * offending value when it can be serialized as a string.
 */
export const ShaclViolation = Schema.Struct({
  focusNode: Schema.String,
  sourceShape: Schema.String,
  sourceConstraint: Schema.String,
  severity: ShaclSeverity,
  message: Schema.String,
  path: Schema.optionalKey(Schema.String),
  value: Schema.optionalKey(Schema.String)
});
export type ShaclViolation = Schema.Schema.Type<typeof ShaclViolation>;

/**
 * ShaclValidationReport — the result of running shacl-engine over a data
 * store and a shapes store. `conforms` is the top-level pass/fail flag;
 * `violations` enumerates every triggered constraint in the run.
 *
 * A non-conforming report is NOT an error — it is a successful Effect
 * result. Callers decide how to respond (throw, log, group-and-report).
 */
export const ShaclValidationReport = Schema.Struct({
  conforms: Schema.Boolean,
  violations: Schema.Array(ShaclViolation)
});
export type ShaclValidationReport = Schema.Schema.Type<typeof ShaclValidationReport>;

/**
 * ShapesLoadError — tagged error for failures loading a SHACL shapes file
 * into an RDF store. Typically a Turtle parse failure or a missing shapes
 * file on disk.
 */
export class ShapesLoadError extends Schema.TaggedErrorClass<ShapesLoadError>()(
  "ShapesLoadError",
  {
    operation: Schema.String,
    message: Schema.String,
    cause: Schema.optionalKey(Schema.String)
  }
) {}

/**
 * ShaclValidationError — tagged error for failures inside shacl-engine
 * itself (e.g. a malformed shapes graph that the validator rejects before
 * running). A non-conforming validation result is NOT this error — it is a
 * successful ShaclValidationReport with `conforms: false`.
 */
export class ShaclValidationError extends Schema.TaggedErrorClass<ShaclValidationError>()(
  "ShaclValidationError",
  {
    operation: Schema.String,
    message: Schema.String,
    cause: Schema.optionalKey(Schema.String)
  }
) {}
