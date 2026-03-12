import { Array as Arr, Either, Option, ParseResult, Schema } from "effect";
import type { LinkRecord } from "../domain/bi";

const LinkFeature = Schema.Struct({
  $type: Schema.Literal("app.bsky.richtext.facet#link"),
  uri: Schema.String
});

const Facet = Schema.Struct({
  features: Schema.Array(Schema.Union(
    LinkFeature,
    Schema.Unknown
  ))
});

const ExternalEmbed = Schema.Struct({
  uri: Schema.String,
  title: Schema.String,
  description: Schema.String
});

const RecordEmbed = Schema.Struct({
  uri: Schema.optional(Schema.String),
  value: Schema.optional(Schema.Struct({
    text: Schema.optional(Schema.String)
  }))
});

const Embed = Schema.Struct({
  $type: Schema.optional(Schema.String),
  external: Schema.optional(ExternalEmbed),
  record: Schema.optional(RecordEmbed)
});

const Label = Schema.Struct({
  val: Schema.String
});

const SelfLabels = Schema.Struct({
  values: Schema.Array(Label)
});

export const BlueskyPostRecord = Schema.Struct({
  text: Schema.optional(Schema.String),
  facets: Schema.optional(Schema.Array(Facet)),
  embed: Schema.optional(Embed),
  tags: Schema.optional(Schema.Array(Schema.String)),
  labels: Schema.optional(SelfLabels)
});
export type BlueskyPostRecord = Schema.Schema.Type<typeof BlueskyPostRecord>;

const EmbeddedExternal = Schema.Struct({
  uri: Schema.optional(Schema.String),
  title: Schema.optional(Schema.String),
  description: Schema.optional(Schema.String)
});

const EmbeddedRecord = Schema.Struct({
  uri: Schema.optional(Schema.String),
  text: Schema.optional(Schema.String)
});

export const SlimPostRecord = Schema.Struct({
  text: Schema.optional(Schema.String),
  urls: Schema.optional(Schema.Array(Schema.String)),
  tags: Schema.optional(Schema.Array(Schema.String)),
  label_values: Schema.optional(Schema.Array(Schema.String)),
  embed: Schema.optional(Schema.Struct({
    external: Schema.optional(EmbeddedExternal),
    record: Schema.optional(EmbeddedRecord)
  }))
});
export type SlimPostRecord = Schema.Schema.Type<typeof SlimPostRecord>;

const decodeBlueskyPostRecord = Schema.decodeUnknownOption(BlueskyPostRecord);
export const decodeSlimPostRecordEither = Schema.decodeUnknownEither(SlimPostRecord);
export const decodeSlimPostRecord = (input: unknown) =>
  Either.match(decodeSlimPostRecordEither(input), {
    onLeft: () => Option.none(),
    onRight: Option.some
  });

export const formatSlimPostRecordDecodeError = (error: ParseResult.ParseError) =>
  ParseResult.TreeFormatter.formatErrorSync(error);

export const extractFacetUrls = (
  facets: ReadonlyArray<{ readonly features: ReadonlyArray<unknown> }> | undefined
): Array<string> => {
  if (!facets) {
    return [];
  }

  return Arr.flatMap(facets, (facet) =>
    Arr.filterMap(facet.features, (feature) => {
      if (typeof feature === "object" && feature !== null) {
        const value = feature as Record<string, unknown>;
        if (value.$type === "app.bsky.richtext.facet#link" && typeof value.uri === "string") {
          return Option.some(value.uri);
        }
      }

      return Option.none();
    })
  );
};

export const slimPostRecordFromUnknown = (record: unknown): SlimPostRecord =>
  Option.match(decodeBlueskyPostRecord(record), {
    onNone: () => ({}),
    onSome: (post) => ({
      text: post.text,
      urls: extractFacetUrls(post.facets),
      tags: post.tags,
      label_values: post.labels?.values.map((label) => label.val),
      embed: post.embed
        ? {
            external: post.embed.external
              ? {
                  uri: post.embed.external.uri,
                  title: post.embed.external.title,
                  description: post.embed.external.description
                }
              : undefined,
            record: post.embed.record
              ? {
                  text: post.embed.record.value?.text,
                  uri: post.embed.record.uri
                }
              : undefined
          }
        : undefined
    })
  });

const hostnameFor = (value: string): string | null => {
  try {
    return new URL(value).hostname;
  } catch {
    return null;
  }
};

export const extractLinkRecords = (
  record: SlimPostRecord,
  extractedAt: number
): ReadonlyArray<LinkRecord> => {
  const urls = new Set<string>();

  for (const url of record.urls ?? []) {
    urls.add(url);
  }

  const externalUri = record.embed?.external?.uri;
  if (externalUri) {
    urls.add(externalUri);
  }

  return Array.from(urls).map((url) => ({
    url,
    title: record.embed?.external?.uri === url ? record.embed.external.title ?? null : null,
    description: record.embed?.external?.uri === url ? record.embed.external.description ?? null : null,
    domain: hostnameFor(url),
    extractedAt
  }));
};

export const collectMetadataTexts = (record: SlimPostRecord): ReadonlyArray<string> =>
  [
    record.embed?.external?.title,
    record.embed?.external?.description,
    ...(record.label_values ?? [])
  ].filter((value): value is string => typeof value === "string" && value.length > 0);
