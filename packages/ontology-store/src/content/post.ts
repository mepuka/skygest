/**
 * Hand-written Post entity module.
 *
 * Mirrors the structure of agent/expert.ts and agent/organization.ts:
 *   1. Application schema — runtime shape Post consumers see (extends the
 *      codegen-generated structural Post in generated/media.ts with content
 *      fields not yet declared in media.ttl).
 *   2. RDF mapping — forward (toTriples) and reverse (fromTriples).
 *   3. AI Search projection — toKey/toBody/toMetadata.
 *
 * The IRI scheme derives from the at:// URI:
 *   `at://did:plc:xyz/app.bsky.feed.post/abc123`
 *     → `https://w3id.org/energy-intel/post/<sanitized-did>_<rkey>`
 *
 * Once media.ttl declares ei:text / ei:atUri / ei:postedAt as DatatypeProperties,
 * regenerate src/generated/media.ts and replace the hand-declared fields with
 * the generated property schemas.
 */

import { Effect, Schema } from "effect";
import { DataFactory, Store, type NamedNode } from "n3";

import { RdfMappingError } from "../Domain/Errors";
import {
  asPredicateIri,
  defineEntity,
  type EntityFact,
  type PredicateIri
} from "../Domain/EntityDefinition";
import {
  type EntityMetadata,
  type ProjectionContract,
  type ProjectionFixture
} from "../Domain/Projection";
import type { RdfQuad } from "../Domain/Rdf";
import { ExpertIri } from "../generated/agent";
import { PostIri } from "../generated/media";
import { EI, RDF } from "../iris";

const { quad, namedNode, literal } = DataFactory;
const predicate = (term: NamedNode): PredicateIri => asPredicateIri(term.value);

export { PostIri };

const SLUG_DISALLOWED = /[^A-Za-z0-9_-]+/g;
const slugify = (value: string): string => value.replace(SLUG_DISALLOWED, "_");

// `ei:text`, `ei:atUri`, `ei:did`, `ei:postedAt` are not declared in media.ttl
// yet, so they are absent from iris.ts. Construct the IRIs inline; once
// upstream adds them, regenerate iris.ts and replace these constants with the
// generated EI.text / EI.atUri / EI.did / EI.postedAt entries.
// TODO(ttl-properties): emit ei:text, ei:atUri, ei:did, ei:postedAt in iris.ts.
const EI_TEXT = namedNode("https://w3id.org/energy-intel/text");
const EI_AT_URI = namedNode("https://w3id.org/energy-intel/atUri");
const EI_DID = namedNode("https://w3id.org/energy-intel/did");
const EI_POSTED_AT = namedNode("https://w3id.org/energy-intel/postedAt");

/**
 * Application-level Post shape.
 *
 * `iri` is the codegen-driven branded identity. The other fields are
 * hand-declared until media.ttl gains property declarations (see file-level
 * docstring for the regen path). `authoredBy` is `optional` because legacy
 * posts may not yet be linked to an Expert.
 */
export class Post extends Schema.Class<Post>("Post")({
  iri: PostIri,
  did: Schema.String,
  atUri: Schema.String,
  text: Schema.String,
  postedAt: Schema.Number,
  authoredBy: Schema.optionalKey(ExpertIri),
  authoredByDisplayName: Schema.optionalKey(Schema.String),
  authoredByHandle: Schema.optionalKey(Schema.String),
  topics: Schema.optionalKey(Schema.Array(Schema.String))
}) {}

const decodePost = Schema.decodeUnknownEffect(Post);

// ---------------------------------------------------------------------------
// IRI derivation from at:// URI
// ---------------------------------------------------------------------------

const AT_URI_PARTS = /^at:\/\/([^/]+)\/[^/]+\/([^/]+)$/u;

/**
 * Derive a Post IRI from an at:// URI. Sanitises the DID and rkey separately
 * and joins with `_`. Round-trip stability is preserved by also storing the
 * original at:// URI as an `ei:atUri` literal triple — the IRI is for graph
 * identity, the at:// URI is for ATProto routing.
 *
 * Handle collisions are unlikely (rkey is a TID, globally unique per repo)
 * but possible across DIDs that sanitize to the same prefix. Callers that
 * care about collision detection should keep an `entities`-row uniqueness
 * check upstream of this helper.
 */
export const postIriFromAtUri = (atUri: string): PostIri => {
  const match = AT_URI_PARTS.exec(atUri);
  if (match === null) {
    throw new Error(`Invalid at:// URI: ${atUri}`);
  }
  const did = match[1];
  const rkey = match[2];
  if (did === undefined || rkey === undefined) {
    throw new Error(`Invalid at:// URI: ${atUri}`);
  }
  return Schema.decodeUnknownSync(PostIri)(
    `https://w3id.org/energy-intel/post/${slugify(did)}_${slugify(rkey)}`
  );
};

// ---------------------------------------------------------------------------
// Forward mapping: Post -> RDF quads
// ---------------------------------------------------------------------------

export const postToTriples = (post: Post): ReadonlyArray<RdfQuad> => {
  const subject = namedNode(post.iri);
  const triples: RdfQuad[] = [
    quad(subject, RDF.type, EI.Post),
    quad(subject, EI_AT_URI, literal(post.atUri)),
    quad(subject, EI_DID, literal(post.did)),
    quad(subject, EI_TEXT, literal(post.text)),
    quad(subject, EI_POSTED_AT, literal(String(post.postedAt)))
  ];
  if (post.authoredBy !== undefined) {
    triples.push(quad(subject, EI.authoredBy, namedNode(post.authoredBy)));
  }
  return triples;
};

// ---------------------------------------------------------------------------
// Reverse mapping: RDF quads -> Post
// ---------------------------------------------------------------------------

const requiredLiteral = (
  store: Store,
  subject: NamedNode,
  predicate: NamedNode,
  field: string,
  iri: string
): Effect.Effect<string, RdfMappingError> =>
  Effect.gen(function* () {
    const value = store.getQuads(subject, predicate, null, null)[0]?.object
      .value;
    if (value === undefined) {
      yield* new RdfMappingError({
        direction: "reverse",
        entity: "Post",
        iri,
        message: `missing required ${field}`
      });
    }
    return value ?? "";
  });

export const postFromTriples = (
  quads: ReadonlyArray<RdfQuad>,
  subject: string
): Effect.Effect<Post, RdfMappingError | Schema.SchemaError> =>
  Effect.gen(function* () {
    const store = new Store([...quads]);
    const subjectNode = namedNode(subject);
    const atUri = yield* requiredLiteral(
      store,
      subjectNode,
      EI_AT_URI,
      "ei:atUri",
      subject
    );
    const did = yield* requiredLiteral(
      store,
      subjectNode,
      EI_DID,
      "ei:did",
      subject
    );
    const text = yield* requiredLiteral(
      store,
      subjectNode,
      EI_TEXT,
      "ei:text",
      subject
    );
    const postedAtRaw = yield* requiredLiteral(
      store,
      subjectNode,
      EI_POSTED_AT,
      "ei:postedAt",
      subject
    );
    const authoredByQuad = store.getQuads(
      subjectNode,
      EI.authoredBy,
      null,
      null
    )[0];

    const candidate: Record<string, unknown> = {
      iri: subject,
      atUri,
      did,
      text,
      postedAt: Number(postedAtRaw)
    };
    if (
      authoredByQuad !== undefined &&
      authoredByQuad.object.termType === "NamedNode"
    ) {
      candidate.authoredBy = authoredByQuad.object.value;
    }
    return yield* decodePost(candidate);
  });

// ---------------------------------------------------------------------------
// AI Search projection
// ---------------------------------------------------------------------------

const isoDate = (millis: number): string => new Date(millis).toISOString();

const postByline = (post: Post): string | null => {
  const { authoredByDisplayName: name, authoredByHandle: handle } = post;
  if (name !== undefined && handle !== undefined) return `${name} (@${handle})`;
  if (name !== undefined) return name;
  if (handle !== undefined) return `@${handle}`;
  return null;
};

export const renderPostMarkdown = (post: Post): string => {
  const lines: string[] = [
    "---",
    `iri: ${post.iri}`,
    `at_uri: ${post.atUri}`,
    `did: ${post.did}`,
    `posted_at: ${isoDate(post.postedAt)}`
  ];
  if (post.authoredBy !== undefined) {
    lines.push(`authored_by: ${post.authoredBy}`);
  }
  if (post.authoredByDisplayName !== undefined) {
    lines.push(`author_name: ${post.authoredByDisplayName}`);
  }
  if (post.authoredByHandle !== undefined) {
    lines.push(`author_handle: ${post.authoredByHandle}`);
  }
  // Topics are stored on the snapshot for filter use via metadata.topic
  // but intentionally excluded from the body — slug strings dilute the
  // embedding without adding natural-language signal.
  lines.push("---", "");
  // Inline an author byline at the top of the body so the embedding picks
  // up the natural-language form (e.g. "Mark Z. Jacobson (@mz.bsky.social)
  // wrote:") even when the frontmatter is treated as metadata-only by the
  // tokenizer. Falls through to handle-only when displayName is missing
  // (most legacy experts have a handle but no displayName).
  const byline = postByline(post);
  if (byline !== null) {
    lines.push(`${byline} wrote:`, "");
  }
  lines.push(post.text);
  return lines.join("\n");
};

export const renderPostSummary = (post: Post): string =>
  `Post by ${post.did} on ${isoDate(post.postedAt).slice(0, 10)}`;

export const postFacts = (
  post: Post
): ReadonlyArray<EntityFact<typeof PostIri>> => {
  const facts: Array<EntityFact<typeof PostIri>> = [
    { subject: post.iri, predicate: predicate(EI_AT_URI), object: post.atUri },
    { subject: post.iri, predicate: predicate(EI_DID), object: post.did },
    {
      subject: post.iri,
      predicate: predicate(EI_POSTED_AT),
      object: post.postedAt
    }
  ];
  if (post.authoredBy !== undefined) {
    facts.push({
      subject: post.iri,
      predicate: predicate(EI.authoredBy),
      object: post.authoredBy
    });
  }
  return facts;
};

/**
 * Bucket a millisecond timestamp to `YYYY-MM` for AI Search filter use.
 * Time-bucket is the only metadata field that meaningfully filters posts;
 * other entities default to "unknown".
 */
export const postTimeBucket = (postedAt: number): string => {
  const d = new Date(postedAt);
  const year = String(d.getUTCFullYear());
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
};

export const postPrimaryTopic = (post: Post): string =>
  post.topics?.[0] ?? "unknown";

const POST_IRI_PREFIX = "https://w3id.org/energy-intel/post/";

const postKeySuffix = (post: Post): string =>
  post.iri.startsWith(POST_IRI_PREFIX)
    ? post.iri.slice(POST_IRI_PREFIX.length)
    : slugify(post.iri);

export const PostUnifiedProjection = {
  entityType: "Post",
  toKey: (post: Post): `entities/post/${string}.md` =>
    `entities/post/${postKeySuffix(post)}.md`,
  toBody: renderPostMarkdown,
  toMetadata: (post: Post): EntityMetadata => ({
    entity_type: "Post",
    iri: post.iri,
    topic: postPrimaryTopic(post),
    authority: "unknown",
    time_bucket: postTimeBucket(post.postedAt)
  })
} as const satisfies ProjectionContract<
  typeof Post,
  EntityMetadata,
  `entities/post/${string}.md`
>;

export const PostProjectionFixture = {
  entityType: "Post",
  fixture: Schema.decodeUnknownSync(Post)({
    iri: "https://w3id.org/energy-intel/post/did_plc_fixture_3kgvexample",
    did: "did:plc:fixture",
    atUri: "at://did:plc:fixture/app.bsky.feed.post/3kgvexample",
    text: "Fixture post body for testing the Post projection contract.",
    postedAt: 1700000000000,
    topics: ["grid-and-infrastructure"]
  }),
  projection: PostUnifiedProjection
} as const satisfies ProjectionFixture<typeof Post>;

// ---------------------------------------------------------------------------
// Module wiring
// ---------------------------------------------------------------------------

const derivePostIri = ({ handle }: { readonly handle: string }): PostIri =>
  Schema.decodeUnknownSync(PostIri)(
    `https://w3id.org/energy-intel/post/${slugify(handle)}`
  );

// ---------------------------------------------------------------------------
// Legacy migration helper (consumed by EntityPostBackfillService)
// ---------------------------------------------------------------------------

/**
 * Subset of the legacy `posts` D1 row shape this module needs to synthesise
 * an energy-intel Post. Defined locally because the legacy row schema lives
 * in `src/services/d1/` (worker tree) and the ontology-store package is
 * meant to be reachable without depending on the worker's domain layer.
 *
 * `cid` is optional and currently unused — kept for forward-compatibility
 * when ATProto record-version round-tripping lands.
 */
export interface LegacyPostRow {
  readonly uri: string;
  readonly did: string;
  readonly text: string;
  readonly createdAt: number;
  readonly cid?: string | null;
}

/**
 * Build a `Post` from a legacy D1 row. Used by EntityPostBackfillService to
 * migrate existing posts into the ontology store. The IRI is derived
 * deterministically from the at:// URI so repeated migrations of the same
 * post produce the same `entities` row (idempotent).
 *
 * `authoredBy` is intentionally left undefined here — DID→Expert IRI
 * resolution is a separate concern that depends on the experts already
 * being in the entity graph. A follow-up slice will add post→expert edge
 * backfill once the resolution path is designed.
 */
export const postFromLegacyRow = (
  row: LegacyPostRow
): Effect.Effect<Post, Schema.SchemaError> => {
  const iri = postIriFromAtUri(row.uri);
  const candidate: Record<string, unknown> = {
    iri,
    did: row.did,
    atUri: row.uri,
    text: row.text,
    postedAt: row.createdAt
  };
  return decodePost(candidate);
};

export const PostEntity = defineEntity({
  tag: "Post" as const,
  schema: Post,
  identity: {
    iri: PostIri,
    iriOf: (post) => post.iri,
    derive: derivePostIri
  },
  ontology: {
    classIri: EI.Post.value,
    typeChain: [EI.Post.value],
    shapeRef: "shapes/post.ttl",
    toTriples: postToTriples,
    fromTriples: postFromTriples
  },
  render: {
    summary: renderPostSummary,
    fulltext: renderPostMarkdown,
    facts: postFacts
  },
  relations: {
    authoredBy: {
      direction: "outbound",
      predicate: predicate(EI.authoredBy),
      target: "Expert",
      cardinality: "one"
    },
    aboutTechnology: {
      direction: "outbound",
      predicate: predicate(EI.aboutTechnology),
      target: "EnergyTopic",
      cardinality: "many"
    }
  },
  agentContext: {
    description:
      "A short-form social-media document, optionally authored by an Expert.",
    tools: ["search", "get", "linksOut"],
    summaryTemplate: (post) =>
      `Post by ${post.did} on ${isoDate(post.postedAt).slice(0, 10)}`
  }
});
