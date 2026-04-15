import { Schema } from "effect";

export const LockFile = Schema.Struct({
  repo: Schema.String,
  ref: Schema.String,
  commit: Schema.String,
  manifestHash: Schema.String,
  snapshotPath: Schema.optionalKey(Schema.String)
});
export type LockFile = Schema.Schema.Type<typeof LockFile>;
