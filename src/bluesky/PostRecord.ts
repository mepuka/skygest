import { Array as Arr, Result, Option, Schema, SchemaIssue } from "effect";
import type { LinkRecord } from "../domain/bi";
import { stripUndefined } from "../platform/Json";
import { normalizeLinkedHostname } from "../platform/Normalize";
import type { Did } from "../domain/types";
import { extractBlobCid, feedThumbnailUrl } from "./BskyCdn";

const LinkFeature = Schema.Struct({
  $type: Schema.Literal("app.bsky.richtext.facet#link"),
  uri: Schema.String
});

const Facet = Schema.Struct({
  features: Schema.Array(Schema.Union([
    LinkFeature,
    Schema.Unknown
  ]))
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

const decodeBlueskyPostRecord = Schema.decodeUnknownResult(BlueskyPostRecord);
export const decodeSlimPostRecordEither = Schema.decodeUnknownResult(SlimPostRecord);
export const decodeSlimPostRecord = (input: unknown) =>
  Result.match(decodeSlimPostRecordEither(input), {
    onFailure: () => Option.none(),
    onSuccess: Option.some
  });

const _issueFormatter = SchemaIssue.makeFormatterDefault();
export const formatSlimPostRecordDecodeError = (error: SchemaIssue.Issue) =>
  _issueFormatter(error);

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
          return Result.succeed(value.uri);
        }
      }

      return Result.failVoid;
    })
  );
};

export const slimPostRecordFromUnknown = (record: unknown): SlimPostRecord =>
  Result.match(decodeBlueskyPostRecord(record), {
    onFailure: () => ({}),
    onSuccess: (post) => stripUndefined({
      text: post.text,
      urls: extractFacetUrls(post.facets),
      tags: post.tags,
      label_values: post.labels?.values.map((label) => label.val),
      embed: post.embed
        ? stripUndefined({
            $type: post.embed.$type,
            external: post.embed.external
              ? stripUndefined({
                  uri: post.embed.external.uri,
                  title: post.embed.external.title,
                  description: post.embed.external.description
                })
              : undefined,
            record: post.embed.record
              ? stripUndefined({
                  text: post.embed.record.value?.text,
                  uri: post.embed.record.uri
                })
              : undefined
          })
        : undefined
    }) as SlimPostRecord
  });

const normalizedHostnameFor = (value: string): string | null => {
  return normalizeLinkedHostname(value);
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
