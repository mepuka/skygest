import { Schema } from "effect";
import { DataLayerRegistryIssue } from "../../domain/data-layer/registry";

export class IngestHarnessError extends Schema.TaggedErrorClass<IngestHarnessError>()(
  "IngestHarnessError",
  { message: Schema.String }
) {}

export class IngestGraphBuildError extends Schema.TaggedErrorClass<IngestGraphBuildError>()(
  "IngestGraphBuildError",
  {
    message: Schema.String,
    issues: Schema.Array(DataLayerRegistryIssue)
  }
) {}

export class IngestSchemaError extends Schema.TaggedErrorClass<IngestSchemaError>()(
  "IngestSchemaError",
  {
    kind: Schema.String,
    slug: Schema.String,
    message: Schema.String
  }
) {}

export class IngestFsError extends Schema.TaggedErrorClass<IngestFsError>()(
  "IngestFsError",
  {
    operation: Schema.String,
    path: Schema.String,
    message: Schema.String
  }
) {}

export class IngestLedgerError extends Schema.TaggedErrorClass<IngestLedgerError>()(
  "IngestLedgerError",
  { message: Schema.String }
) {}
