import { Schema } from "effect";

export const ThreadCoverage = Schema.Literals([
  "focus-only",
  "author-thread"
]).annotate({
  description: "How much of the surrounding thread was included when building post context"
});
export type ThreadCoverage = Schema.Schema.Type<typeof ThreadCoverage>;

export const PostLinkCard = Schema.Struct({
  source: Schema.Literals(["embed", "media"]),
  uri: Schema.String,
  title: Schema.NullOr(Schema.String),
  description: Schema.NullOr(Schema.String),
  thumb: Schema.NullOr(Schema.String)
}).annotate({
  description: "Resolved link-card metadata attached to a post embed or media record"
});
export type PostLinkCard = Schema.Schema.Type<typeof PostLinkCard>;
