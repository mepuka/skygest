import { Array as Arr, Either, Option, ParseResult, Schema } from "effect";
import type { LinkRecord } from "../domain/bi";
import { normalizeDomain } from "../domain/normalize";
import type { Did } from "../domain/types";
import { extractBlobCid, feedThumbnailUrl } from "./BskyCdn";

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
  description: Schema.String,
  thumb: Schema.optionalKey(Schema.Unknown)
});

const RecordEmbed = Schema.Struct({
  uri: Schema.optionalKey(Schema.String),
  value: Schema.optionalKey(Schema.Struct({
    text: Schema.optionalKey(Schema.String)
  }))
});

const Embed = Schema.Struct({
  $type: Schema.optionalKey(Schema.String),
  external: Schema.optionalKey(ExternalEmbed),
  record: Schema.optionalKey(RecordEmbed)
});

const Label = Schema.Struct({
  val: Schema.String
});

const SelfLabels = Schema.Struct({
  values: Schema.Array(Label)
});

export const BlueskyPostRecord = Schema.Struct({
  text: Schema.optionalKey(Schema.String),
  facets: Schema.optionalKey(Schema.Array(Facet)),
  embed: Schema.optionalKey(Embed),
  tags: Schema.optionalKey(Schema.Array(Schema.String)),
  labels: Schema.optionalKey(SelfLabels)
});
export type BlueskyPostRecord = Schema.Schema.Type<typeof BlueskyPostRecord>;

const EmbeddedExternal = Schema.Struct({
  uri: Schema.optionalKey(Schema.String),
  title: Schema.optionalKey(Schema.String),
  description: Schema.optionalKey(Schema.String),
  thumb: Schema.optionalKey(Schema.Unknown)
});

const EmbeddedRecord = Schema.Struct({
  uri: Schema.optionalKey(Schema.String),
  text: Schema.optionalKey(Schema.String)
});

export const SlimPostRecord = Schema.Struct({
  text: Schema.optionalKey(Schema.String),
  urls: Schema.optionalKey(Schema.Array(Schema.String)),
  tags: Schema.optionalKey(Schema.Array(Schema.String)),
  label_values: Schema.optionalKey(Schema.Array(Schema.String)),
  embed: Schema.optionalKey(Schema.Struct({
    $type: Schema.optionalKey(Schema.String),
    external: Schema.optionalKey(EmbeddedExternal),
    record: Schema.optionalKey(EmbeddedRecord)
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
            $type: post.embed.$type,
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

const normalizedHostnameFor = (value: string): string | null => {
  const hostname = hostnameFor(value);
  return hostname ? normalizeDomain(hostname) : null;
};

export const extractLinkRecords = (
  record: SlimPostRecord,
  did: Did,
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

  const thumbCid = record.embed?.external?.thumb
    ? extractBlobCid(record.embed.external.thumb)
    : null;
  const thumbnailUrl = thumbCid !== null ? feedThumbnailUrl(did, thumbCid) : null;

  return Array.from(urls).map((url) => {
    const isExternalEmbed = record.embed?.external?.uri === url;
    return {
      url,
      title: isExternalEmbed ? record.embed!.external!.title ?? null : null,
      description: isExternalEmbed ? record.embed!.external!.description ?? null : null,
      imageUrl: isExternalEmbed ? thumbnailUrl : null,
      domain: normalizedHostnameFor(url),
      extractedAt
    };
  });
};

export const collectMetadataTexts = (record: SlimPostRecord): ReadonlyArray<string> =>
  [
    record.embed?.external?.title,
    record.embed?.external?.description,
    ...(record.label_values ?? [])
  ].filter((value): value is string => typeof value === "string" && value.length > 0);
