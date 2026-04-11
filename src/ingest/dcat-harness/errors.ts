import { Schema } from "effect";

export class IngestHarnessError extends Schema.TaggedErrorClass<IngestHarnessError>()(
  "IngestHarnessError",
  { message: Schema.String }
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
