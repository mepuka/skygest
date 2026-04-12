import { Schema } from "effect";

export const ZeroToOneScore = Schema.Number.pipe(
  Schema.check(Schema.isBetween({ minimum: 0, maximum: 1 }))
).annotate({
  description: "Closed score range used for confidence-like signals"
});
export type ZeroToOneScore = Schema.Schema.Type<typeof ZeroToOneScore>;
