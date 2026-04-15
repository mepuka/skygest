import { Schema } from "effect";
import { IsoTimestamp } from "../domain/types";

const NonEmptyString = Schema.String.pipe(Schema.check(Schema.isMinLength(1)));

const SnapshotManifestBaseFields = {
  manifestVersion: Schema.Literal(1),
  generatedAt: IsoTimestamp,
  sourceCommit: NonEmptyString,
  inputHash: NonEmptyString,
  // The manifest itself is separately protected by the lock file's
  // manifestHash, so treeHash covers the rest of the snapshot tree.
  treeHash: NonEmptyString
} as const;

export const SnapshotManifestBase = Schema.Struct({
  ...SnapshotManifestBaseFields
});
export type SnapshotManifestBase = Schema.Schema.Type<
  typeof SnapshotManifestBase
>;

export const IngestArtifactsManifest = Schema.Struct({
  ...SnapshotManifestBaseFields,
  kind: Schema.Literal("ingest-artifacts"),
  counts: Schema.Record(Schema.String, Schema.Number)
});
export type IngestArtifactsManifest = Schema.Schema.Type<
  typeof IngestArtifactsManifest
>;

export const OntologySnapshotManifest = Schema.Struct({
  ...SnapshotManifestBaseFields,
  kind: Schema.Literal("ontology-snapshot"),
  ontologyIri: NonEmptyString,
  ontologyVersion: NonEmptyString,
  tripleCount: Schema.Number
});
export type OntologySnapshotManifest = Schema.Schema.Type<
  typeof OntologySnapshotManifest
>;

export const Manifest = Schema.Union([
  IngestArtifactsManifest,
  OntologySnapshotManifest
]);
export type Manifest = Schema.Schema.Type<typeof Manifest>;
