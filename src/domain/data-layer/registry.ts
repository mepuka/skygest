import { Schema } from "effect";
import { Agent, Catalog, CatalogRecord, Dataset, DataService, DatasetSeries, Distribution } from "./catalog";
import { Series, Variable } from "./variable";

export const DataLayerRegistryEntity = Schema.Union([
  Agent,
  Catalog,
  CatalogRecord,
  Dataset,
  Distribution,
  DataService,
  DatasetSeries,
  Variable,
  Series
]);
export type DataLayerRegistryEntity = Schema.Schema.Type<
  typeof DataLayerRegistryEntity
>;

export const DataLayerRegistrySeed = Schema.Struct({
  agents: Schema.Array(Agent),
  catalogs: Schema.Array(Catalog),
  catalogRecords: Schema.Array(CatalogRecord),
  datasets: Schema.Array(Dataset),
  distributions: Schema.Array(Distribution),
  dataServices: Schema.Array(DataService),
  datasetSeries: Schema.Array(DatasetSeries),
  variables: Schema.Array(Variable),
  series: Schema.Array(Series)
}).annotate({
  description: "Broad checked-in entity seed used to prepare the in-memory data-layer registry"
});
export type DataLayerRegistrySeed = Schema.Schema.Type<
  typeof DataLayerRegistrySeed
>;

export const FileReadIssue = Schema.TaggedStruct("FileReadIssue", {
  path: Schema.String,
  message: Schema.String
});
export type FileReadIssue = Schema.Schema.Type<typeof FileReadIssue>;

export const JsonParseIssue = Schema.TaggedStruct("JsonParseIssue", {
  path: Schema.String,
  message: Schema.String
});
export type JsonParseIssue = Schema.Schema.Type<typeof JsonParseIssue>;

export const TagMismatchIssue = Schema.TaggedStruct("TagMismatchIssue", {
  path: Schema.String,
  expectedTag: Schema.String,
  actualTag: Schema.NullOr(Schema.String)
});
export type TagMismatchIssue = Schema.Schema.Type<typeof TagMismatchIssue>;

export const SchemaDecodeIssue = Schema.TaggedStruct("SchemaDecodeIssue", {
  path: Schema.String,
  entityTag: Schema.String,
  message: Schema.String
});
export type SchemaDecodeIssue = Schema.Schema.Type<typeof SchemaDecodeIssue>;

export const DuplicateCanonicalIdIssue = Schema.TaggedStruct(
  "DuplicateCanonicalIdIssue",
  {
  canonicalId: Schema.String,
  paths: Schema.Array(Schema.String)
});
export type DuplicateCanonicalIdIssue = Schema.Schema.Type<
  typeof DuplicateCanonicalIdIssue
>;

export const MissingReferenceIssue = Schema.TaggedStruct("MissingReferenceIssue", {
  path: Schema.String,
  field: Schema.String,
  targetId: Schema.String,
  expectedTag: Schema.String
});
export type MissingReferenceIssue = Schema.Schema.Type<
  typeof MissingReferenceIssue
>;

export const SemanticConsistencyIssue = Schema.TaggedStruct(
  "SemanticConsistencyIssue",
  {
  path: Schema.String,
  message: Schema.String
});
export type SemanticConsistencyIssue = Schema.Schema.Type<
  typeof SemanticConsistencyIssue
>;

export const UnknownVocabularyValueIssue = Schema.TaggedStruct(
  "UnknownVocabularyValueIssue",
  {
    path: Schema.String,
    facet: Schema.String,
    value: Schema.String
  }
);
export type UnknownVocabularyValueIssue = Schema.Schema.Type<
  typeof UnknownVocabularyValueIssue
>;

export const LookupCollisionIssue = Schema.TaggedStruct("LookupCollisionIssue", {
  lookup: Schema.String,
  key: Schema.String,
  entityIds: Schema.Array(Schema.String)
});
export type LookupCollisionIssue = Schema.Schema.Type<
  typeof LookupCollisionIssue
>;

export const DataLayerRegistryIssue = Schema.Union([
  FileReadIssue,
  JsonParseIssue,
  TagMismatchIssue,
  SchemaDecodeIssue,
  DuplicateCanonicalIdIssue,
  MissingReferenceIssue,
  SemanticConsistencyIssue,
  UnknownVocabularyValueIssue,
  LookupCollisionIssue
]);
export type DataLayerRegistryIssue = Schema.Schema.Type<
  typeof DataLayerRegistryIssue
>;

export const DataLayerRegistryDiagnostic = Schema.Struct({
  root: Schema.String,
  issues: Schema.Array(DataLayerRegistryIssue)
}).annotate({
  description: "Aggregated registry preparation and checked-in data validation issues"
});
export type DataLayerRegistryDiagnostic = Schema.Schema.Type<
  typeof DataLayerRegistryDiagnostic
>;
