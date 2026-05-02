import {
  Clock,
  Duration,
  Effect,
  Exit,
  Layer,
  Random,
  Result,
  Schedule,
  Schema,
  ServiceMap
} from "effect";
import { SqlClient } from "effect/unstable/sql";
import { SqlError, UnknownError } from "effect/unstable/sql/SqlError";
import {
  REINDEX_QUEUE_UPSERT_SET_CLAUSE,
  type D1DatabaseBinding,
  EntityGraphRepo,
  EntityIngestionWriter,
  PostEntity,
  asEntityIri,
  asEntityTag,
  expertFromLegacyRow,
  optionalD1Database,
  predicateSpec,
  postFromLegacyRow,
  runD1Batch,
  type LegacyPostRow
} from "@skygest/ontology-store";
import type { DbError } from "../domain/errors";
import type { PostEnrichmentResult } from "../domain/enrichment";
import { validateStoredEnrichment } from "../enrichment/PostEnrichmentReadModel";
import { ExpertsRepo } from "./ExpertsRepo";
import { OntologyCatalog } from "./OntologyCatalog";

export interface EntityPostBackfillInput {
  readonly limit?: number;
  readonly offset?: number;
}

export interface EntityPostBackfillResult {
  readonly total: number;
  readonly scanned: number;
  readonly migrated: number;
  readonly queued: number;
  readonly authoredByEdges: number;
  readonly topicEdges: number;
  readonly failed: number;
  readonly failedUris: ReadonlyArray<string>;
}

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;
const WRITE_CONCURRENCY = 8;
const ROW_WRITE_RETRY_SCHEDULE = Schedule.exponential(
  Duration.millis(100)
).pipe(Schedule.jittered, Schedule.both(Schedule.recurs(2)));
const BACKFILL_ASSERTED_BY = "EntityPostBackfillService" as const;
const POST_ENTITY_TAG = asEntityTag("Post");
const EXPERT_ENTITY_TAG = asEntityTag("Expert");
const ENERGY_TOPIC_ENTITY_TAG = asEntityTag("EnergyTopic");
const DEFAULT_GRAPH_IRI = "urn:skygest:graph:default";
const COALESCE_WINDOW_MS = 30_000;
const AUTHORED_BY_PREDICATE_IRI = predicateSpec("ei:authoredBy").iri;
const TOPIC_MENTION_PREDICATE_IRI = predicateSpec("iao:mentions").iri;
const UNKNOWN_TOPIC_PRIORITY = 10_000;

const normalizeLimit = (limit: number | undefined): number =>
  limit === undefined || !Number.isFinite(limit)
    ? DEFAULT_LIMIT
    : Math.min(MAX_LIMIT, Math.max(1, Math.floor(limit)));

const normalizeOffset = (offset: number | undefined): number =>
  offset === undefined || !Number.isFinite(offset)
    ? 0
    : Math.max(0, Math.floor(offset));

const PostRow = Schema.Struct({
  uri: Schema.String,
  did: Schema.String,
  text: Schema.String,
  created_at: Schema.Number,
  topic_json: Schema.String
});
type PostRow = typeof PostRow.Type;

const PostCountRow = Schema.Struct({
  total: Schema.Number
});

const PostTopicMatchRow = Schema.Struct({
  topicSlug: Schema.String,
  matchedTerm: Schema.NullOr(Schema.String),
  matchSignal: Schema.String,
  matchValue: Schema.NullOr(Schema.String),
  matchScore: Schema.NullOr(Schema.Number),
  ontologyVersion: Schema.String,
  matcherVersion: Schema.String
});
type PostTopicMatchRow = typeof PostTopicMatchRow.Type;
const PostTopicMatchRowsFromJson = Schema.fromJsonString(
  Schema.Array(PostTopicMatchRow)
);

const PostEnrichmentRow = Schema.Struct({
  postUri: Schema.String,
  enrichmentType: Schema.String,
  enrichmentPayloadJson: Schema.String,
  enrichedAt: Schema.Number
});
type PostEnrichmentRow = typeof PostEnrichmentRow.Type;

const decodeSqlError = (cause: unknown, operation: string): SqlError =>
  new SqlError({
    reason: new UnknownError({
      cause,
      message: "Failed to decode posts row",
      operation
    })
  });

const decodeRows = (rows: unknown) =>
  Schema.decodeUnknownEffect(Schema.Array(PostRow))(rows).pipe(
    Effect.mapError((cause) => decodeSqlError(cause, "posts.list"))
  );

const decodeCount = (rows: unknown) =>
  Schema.decodeUnknownEffect(Schema.Array(PostCountRow))(rows).pipe(
    Effect.mapError((cause) => decodeSqlError(cause, "posts.count"))
  );

const decodeEnrichmentRows = (rows: unknown) =>
  Schema.decodeUnknownEffect(Schema.Array(PostEnrichmentRow))(rows).pipe(
    Effect.mapError((cause) =>
      decodeSqlError(cause, "post_enrichments.list")
    )
  );

const toLegacyRow = (row: PostRow): LegacyPostRow => ({
  uri: row.uri,
  did: row.did,
  text: row.text,
  createdAt: row.created_at
});

type PostValue = Schema.Schema.Type<typeof PostEntity.schema>;

interface AuthorInfo {
  readonly iri: string;
  readonly displayName: string | null;
  readonly handle: string | null;
}

interface TopicEdge {
  readonly sourceSlug: string;
  readonly canonicalSlug: string;
  readonly iri: string;
  readonly evidenceSpan: string;
  readonly confidence: number;
}

interface TopicLookupEntry {
  readonly canonicalSlug: string;
  readonly iris: ReadonlyArray<string>;
  readonly priority: number;
}

type TopicLookup = ReadonlyMap<string, TopicLookupEntry>;

interface PreparedPostRow {
  readonly source: PostRow;
  readonly post: PostValue;
  readonly iri: string;
  readonly payloadJson: string;
  readonly authorIri: string | null;
  readonly authoredByTripleHash: string | null;
  readonly topicEdges: ReadonlyArray<TopicEdge & {
    readonly tripleHash: string;
  }>;
}

const encodeJsonString = Schema.encodeUnknownEffect(
  Schema.UnknownFromJsonString
);

const encodePostPayload = (
  post: PostValue
): Effect.Effect<string, Schema.SchemaError> =>
  Schema.encodeUnknownEffect(PostEntity.schema)(post).pipe(
    Effect.flatMap((encoded) => encodeJsonString(encoded)),
    Effect.map(String)
  );

const hex = (bytes: ArrayBuffer): string =>
  [...new Uint8Array(bytes)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

const hashTriple = (
  subjectIri: string,
  predicateIri: string,
  objectIri: string,
  graphIri: string
): Effect.Effect<string, SqlError> =>
  Effect.tryPromise({
    try: async () => {
      const bytes = new TextEncoder().encode(
        `${subjectIri}\u0000${predicateIri}\u0000${objectIri}\u0000${graphIri}`
      );
      return hex(await crypto.subtle.digest("SHA-256", bytes));
    },
    catch: (cause) => decodeSqlError(cause, "post.authoredBy.tripleHash")
  });

const coalesceKey = (iri: string, now: number): string => {
  const bucket = Math.floor(now / COALESCE_WINDOW_MS);
  return `${POST_ENTITY_TAG}:${iri}:${String(bucket)}`;
};

const normalizeTopicKey = (value: string): string =>
  value
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[\s_]+/g, "-")
    .toLowerCase();

const uniqueSorted = (
  values: Iterable<string>,
  priorityOf: (value: string) => number
): ReadonlyArray<string> =>
  Array.from(new Set(values)).sort((left, right) => {
    const priorityDelta = priorityOf(left) - priorityOf(right);
    return priorityDelta === 0 ? left.localeCompare(right) : priorityDelta;
  });

const chunkValues = <A>(
  values: ReadonlyArray<A>,
  size: number
): ReadonlyArray<ReadonlyArray<A>> => {
  const chunks: A[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
};

const buildTopicLookup = (
  ontology: (typeof OntologyCatalog)["Service"]
): TopicLookup => {
  const conceptsBySlug = new Map(
    ontology.concepts.map((concept) => [concept.slug, concept] as const)
  );
  const priorityByCanonicalSlug = new Map<string, number>(
    ontology.topics.map((topic, index) => [String(topic.slug), index] as const)
  );
  const lookup = new Map<string, TopicLookupEntry>();

  const put = (
    key: string,
    entry: Omit<TopicLookupEntry, "priority">
  ): void => {
    const priority =
      priorityByCanonicalSlug.get(entry.canonicalSlug) ??
      UNKNOWN_TOPIC_PRIORITY;
    lookup.set(normalizeTopicKey(key), { ...entry, priority });
  };

  for (const topic of ontology.topics) {
    const iris = topic.rootConceptSlugs
      .map((slug) => conceptsBySlug.get(slug)?.iri)
      .filter((iri): iri is string => iri !== undefined);
    if (iris.length > 0) {
      put(topic.slug, { canonicalSlug: topic.slug, iris });
    }
  }

  for (const concept of ontology.concepts) {
    if (concept.canonicalTopicSlug === null) continue;
    put(concept.slug, {
      canonicalSlug: concept.canonicalTopicSlug,
      iris: [concept.iri]
    });
    put(concept.label, {
      canonicalSlug: concept.canonicalTopicSlug,
      iris: [concept.iri]
    });
  }

  return lookup;
};

const decodeTopicMatches = (
  row: PostRow
): Effect.Effect<ReadonlyArray<PostTopicMatchRow>, SqlError> =>
  Schema.decodeUnknownEffect(PostTopicMatchRowsFromJson)(row.topic_json).pipe(
    Effect.mapError((cause) => decodeSqlError(cause, "post_topics.decode"))
  );

const confidenceFromMatch = (match: PostTopicMatchRow): number => {
  if (match.matchScore === null) return 1;
  if (!Number.isFinite(match.matchScore)) return 1;
  return Math.min(1, Math.max(0, match.matchScore));
};

const nonEmpty = (value: string | null | undefined): value is string =>
  value !== null && value !== undefined && value.trim().length > 0;

const uniqueLines = (lines: ReadonlyArray<string>): ReadonlyArray<string> =>
  Array.from(new Set(lines.map((line) => line.trim()).filter(nonEmpty)));

const MAX_ENRICHMENT_LINES = 40;

const formatVisionEnrichment = (
  result: Extract<PostEnrichmentResult, { readonly kind: "vision" }>
): ReadonlyArray<string> => {
  const { payload } = result;
  const lines: string[] = [`Vision summary: ${payload.summary.text}`];
  for (const title of payload.summary.titles) {
    lines.push(`Visible title: ${title}`);
  }
  for (const finding of payload.summary.keyFindings) {
    lines.push(`Vision finding: ${finding.text}`);
  }
  for (const asset of payload.assets) {
    if (asset.analysis.title !== null) {
      lines.push(`Asset title: ${asset.analysis.title}`);
    }
    if (asset.analysis.altText !== null) {
      lines.push(`Alt text: ${asset.analysis.altText}`);
    }
    for (const finding of asset.analysis.keyFindings) {
      lines.push(`Asset finding: ${finding}`);
    }
    for (const sourceLine of asset.analysis.sourceLines) {
      lines.push(
        sourceLine.datasetName === null
          ? `Source line: ${sourceLine.sourceText}`
          : `Source line: ${sourceLine.sourceText} (${sourceLine.datasetName})`
      );
    }
    for (const url of asset.analysis.visibleUrls) {
      lines.push(`Visible URL: ${url}`);
    }
    for (const mention of asset.analysis.organizationMentions) {
      lines.push(`Organization mention: ${mention.name}`);
    }
    for (const logo of asset.analysis.logoText) {
      lines.push(`Logo text: ${logo}`);
    }
  }
  return lines;
};

const formatSourceAttributionEnrichment = (
  result: Extract<
    PostEnrichmentResult,
    { readonly kind: "source-attribution" }
  >
): ReadonlyArray<string> => {
  const { payload } = result;
  const lines: string[] = [];
  if (payload.provider !== null) {
    lines.push(`Source provider: ${payload.provider.providerLabel}`);
  }
  if (payload.contentSource !== null) {
    if (payload.contentSource.title !== null) {
      lines.push(`Source title: ${payload.contentSource.title}`);
    }
    if (payload.contentSource.domain !== null) {
      lines.push(`Source domain: ${payload.contentSource.domain}`);
    }
    if (payload.contentSource.publication !== null) {
      lines.push(`Publication: ${payload.contentSource.publication}`);
    }
    lines.push(`Source URL: ${payload.contentSource.url}`);
  }
  for (const candidate of payload.providerCandidates) {
    lines.push(`Provider candidate: ${candidate.providerLabel}`);
  }
  return lines;
};

const formatGroundingEnrichment = (
  result: Extract<PostEnrichmentResult, { readonly kind: "grounding" }>
): ReadonlyArray<string> => [
  `Grounded claim: ${result.payload.claimText}`,
  ...result.payload.supportingEvidence.flatMap((evidence) => [
    evidence.title === null
      ? `Supporting evidence: ${evidence.url}`
      : `Supporting evidence: ${evidence.title}`,
    evidence.url
  ])
];

const formatPostEnrichment = (
  result: PostEnrichmentResult
): ReadonlyArray<string> => {
  switch (result.kind) {
    case "vision":
      return formatVisionEnrichment(result);
    case "source-attribution":
      return formatSourceAttributionEnrichment(result);
    case "grounding":
      return formatGroundingEnrichment(result);
    case "data-ref-resolution":
      return ["Data-reference resolution available."];
  }
};

const enrichmentText = (
  enrichments: ReadonlyArray<PostEnrichmentResult>
): string | null => {
  const lines = uniqueLines(enrichments.flatMap(formatPostEnrichment)).slice(
    0,
    MAX_ENRICHMENT_LINES
  );
  return lines.length === 0 ? null : lines.join("\n");
};

const decodeStoredEnrichment = (
  row: PostEnrichmentRow
): PostEnrichmentResult | null => {
  const parsed = Schema.decodeUnknownResult(Schema.UnknownFromJsonString)(
    row.enrichmentPayloadJson
  );
  if (Result.isFailure(parsed)) return null;
  return validateStoredEnrichment({
    enrichmentType: row.enrichmentType,
    enrichmentPayload: parsed.success,
    enrichedAt: row.enrichedAt
  });
};

export class EntityPostBackfillService extends ServiceMap.Service<
  EntityPostBackfillService,
  {
    readonly backfill: (
      input?: EntityPostBackfillInput
    ) => Effect.Effect<EntityPostBackfillResult, SqlError | DbError>;
  }
>()("@skygest/EntityPostBackfillService") {
  static readonly layer = Layer.effect(
    EntityPostBackfillService,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const experts = yield* ExpertsRepo;
      const writer = yield* EntityIngestionWriter;
      const entityGraph = yield* EntityGraphRepo;
      const rawDb = yield* optionalD1Database;
      const ontology = yield* OntologyCatalog;
      const topicLookup = buildTopicLookup(ontology);

      const buildAuthorByDid = Effect.fn(
        "EntityPostBackfillService.buildAuthorByDid"
      )(function* (rows: ReadonlyArray<PostRow>) {
        const dids = Array.from(new Set(rows.map((row) => row.did)));
        if (dids.length === 0) return new Map<string, AuthorInfo>();
        const expertRecords = yield* experts.getByDids(dids);
        const entries = yield* Effect.forEach(
          expertRecords,
          (expertRecord) => Effect.gen(function* () {
            const expert = yield* expertFromLegacyRow({
              did: expertRecord.did,
              handle: expertRecord.handle,
              displayName: expertRecord.displayName,
              bio: expertRecord.description,
              tier: expertRecord.tier,
              primaryTopic: expertRecord.domain
            }).pipe(
              Effect.mapError((cause) =>
                decodeSqlError(cause, "experts.authorIri")
              )
            );
            const info: AuthorInfo = {
              iri: expert.iri,
              displayName: expertRecord.displayName,
              handle: expertRecord.handle
            };
            return [expertRecord.did, info] as const;
          }),
          { concurrency: WRITE_CONCURRENCY }
        );
        return new Map(entries);
      });

      const buildEnrichmentTextByPostUri = Effect.fn(
        "EntityPostBackfillService.buildEnrichmentTextByPostUri"
      )(function* (rows: ReadonlyArray<PostRow>) {
        const uris = Array.from(new Set(rows.map((row) => row.uri)));
        if (uris.length === 0) return new Map<string, string>();

        const enrichmentRows = yield* Effect.forEach(
          chunkValues(uris, 50),
          (chunk) => {
            const placeholders = chunk.map((uri) => sql`${uri}`);
            return sql<PostEnrichmentRow>`
              SELECT
                post_uri as postUri,
                enrichment_type as enrichmentType,
                enrichment_payload_json as enrichmentPayloadJson,
                enriched_at as enrichedAt
              FROM post_enrichments
              WHERE post_uri IN (${sql.join(", ", false)(placeholders)})
              ORDER BY post_uri ASC, enrichment_type ASC
            `.pipe(Effect.flatMap(decodeEnrichmentRows));
          }
        ).pipe(Effect.map((chunks) => chunks.flat()));

        const byPostUri = new Map<string, PostEnrichmentResult[]>();
        for (const row of enrichmentRows) {
          const decoded = decodeStoredEnrichment(row);
          if (decoded === null) continue;
          const existing = byPostUri.get(row.postUri) ?? [];
          byPostUri.set(row.postUri, [...existing, decoded]);
        }

        return new Map(
          Array.from(byPostUri).flatMap(([postUri, enrichments]) => {
            const text = enrichmentText(enrichments);
            return text === null ? [] : [[postUri, text] as const];
          })
        );
      });

      const upsertAuthors = Effect.fn(
        "EntityPostBackfillService.upsertAuthors"
      )(function* (authorByDid: ReadonlyMap<string, AuthorInfo>) {
        const authorIris = Array.from(
          new Set([...authorByDid.values()].map((info) => info.iri))
        );
        yield* Effect.forEach(
          authorIris,
          (authorIri) =>
            entityGraph.upsertEntity(asEntityIri(authorIri), EXPERT_ENTITY_TAG),
          { concurrency: WRITE_CONCURRENCY }
        );
      });

      const writeAuthoredByEdge = Effect.fn(
        "EntityPostBackfillService.writeAuthoredByEdge"
      )(function* (
        postIri: ReturnType<typeof asEntityIri>,
        expertIri: ReturnType<typeof asEntityIri>,
        effectiveFrom: number
      ) {
        const link = yield* entityGraph.createLink({
          predicate: "ei:authoredBy",
          subject: { iri: postIri, type: "Post" },
          object: { iri: expertIri, type: "Expert" },
          effectiveFrom
        });
        yield* entityGraph.recordEvidence(link.linkId, {
          assertedBy: BACKFILL_ASSERTED_BY,
          assertionKind: "imported",
          confidence: 1
        });
      });

      const resolveTopicEdges = Effect.fn(
        "EntityPostBackfillService.resolveTopicEdges"
      )(function* (row: PostRow) {
        const matches = yield* decodeTopicMatches(row);
        const canonicalPriority = (slug: string): number =>
          topicLookup.get(normalizeTopicKey(slug))?.priority ??
          UNKNOWN_TOPIC_PRIORITY;
        const canonicalSlugs = uniqueSorted(
          matches.flatMap((match) => {
            const entry = topicLookup.get(normalizeTopicKey(match.topicSlug));
            return entry === undefined ? [] : [entry.canonicalSlug];
          }),
          canonicalPriority
        );
        const edges: TopicEdge[] = [];
        const seenEdgeIris = new Set<string>();
        for (const match of matches) {
          const entry = topicLookup.get(normalizeTopicKey(match.topicSlug));
          if (entry === undefined) continue;
          const evidenceSpan = yield* encodeJsonString({
            topicSlug: match.topicSlug,
            canonicalTopicSlug: entry.canonicalSlug,
            matchedTerm: match.matchedTerm,
            matchSignal: match.matchSignal,
            matchValue: match.matchValue,
            matchScore: match.matchScore,
            ontologyVersion: match.ontologyVersion,
            matcherVersion: match.matcherVersion
          }).pipe(Effect.map(String));
          for (const iri of entry.iris) {
            if (seenEdgeIris.has(iri)) continue;
            seenEdgeIris.add(iri);
            edges.push({
              sourceSlug: match.topicSlug,
              canonicalSlug: entry.canonicalSlug,
              iri,
              evidenceSpan,
              confidence: confidenceFromMatch(match)
            });
          }
        }
        return { canonicalSlugs, edges };
      });

      const preparePostRow = Effect.fn(
        "EntityPostBackfillService.preparePostRow"
      )(function* (
        row: PostRow,
        authorByDid: ReadonlyMap<string, AuthorInfo>,
        enrichmentTextByPostUri: ReadonlyMap<string, string>
      ) {
        const basePost = yield* postFromLegacyRow(toLegacyRow(row));
        const author = authorByDid.get(row.did) ?? null;
        const authorIri = author?.iri ?? null;
        const topics = yield* resolveTopicEdges(row);
        const authorFields =
          author === null
            ? {}
            : {
                authoredBy: author.iri,
                ...(author.displayName === null
                  ? {}
                  : { authoredByDisplayName: author.displayName }),
                ...(author.handle === null
                  ? {}
                  : { authoredByHandle: author.handle })
              };
        const post = yield* Schema.decodeUnknownEffect(PostEntity.schema)({
          ...basePost,
          ...authorFields,
          topics: topics.canonicalSlugs,
          ...(enrichmentTextByPostUri.has(row.uri)
            ? { enrichmentText: enrichmentTextByPostUri.get(row.uri) }
            : {})
        });
        const payloadJson = yield* encodePostPayload(post);
        const iri = String(post.iri);
        const authoredByTripleHash =
          authorIri === null
            ? null
            : yield* hashTriple(
                iri,
                AUTHORED_BY_PREDICATE_IRI,
                authorIri,
                DEFAULT_GRAPH_IRI
              );
        const topicEdges = yield* Effect.forEach(
          topics.edges,
          (edge) =>
            Effect.gen(function* () {
              const tripleHash = yield* hashTriple(
                iri,
                TOPIC_MENTION_PREDICATE_IRI,
                edge.iri,
                DEFAULT_GRAPH_IRI
              );
              return { ...edge, tripleHash };
            }),
          { concurrency: WRITE_CONCURRENCY }
        );
        return {
          source: row,
          post,
          iri,
          payloadJson,
          authorIri,
          authoredByTripleHash,
          topicEdges
        } satisfies PreparedPostRow;
      });

      const bulkWritePrepared = Effect.fn(
        "EntityPostBackfillService.bulkWritePrepared"
      )(function* (
        db: D1DatabaseBinding,
        preparedRows: ReadonlyArray<PreparedPostRow>,
        authorByDid: ReadonlyMap<string, AuthorInfo>
      ) {
        if (preparedRows.length === 0) return;
        const now = yield* Clock.currentTimeMillis;
        const statements = [db.prepare("PRAGMA foreign_keys = ON")];

        const upsertEntityStatement = db.prepare(
          `INSERT INTO entities (iri, entity_type, created_at, updated_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(iri) DO UPDATE SET
             entity_type = excluded.entity_type,
             updated_at = excluded.updated_at`
        );
        const upsertSnapshotStatement = db.prepare(
          `INSERT INTO entity_snapshots (
             iri,
             entity_type,
             payload_json,
             created_at,
             updated_at
           ) VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(iri) DO UPDATE SET
             entity_type = excluded.entity_type,
             payload_json = excluded.payload_json,
             updated_at = excluded.updated_at`
        );
        const upsertQueueStatement = db.prepare(
          `INSERT INTO reindex_queue (
             queue_id,
             coalesce_key,
             target_entity_type,
             target_iri,
             origin_iri,
             cause,
             cause_priority,
             propagation_depth,
             attempts,
             next_attempt_at,
             enqueued_at,
             updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(coalesce_key) DO UPDATE SET
           ${REINDEX_QUEUE_UPSERT_SET_CLAUSE}`
        );
        const upsertAuthoredByLinkStatement = db.prepare(
          `INSERT INTO entity_links (
             link_id,
             triple_hash,
             subject_iri,
             predicate_iri,
             object_iri,
             object_value,
             object_datatype,
             graph_iri,
             subject_type,
             object_type,
             state,
             effective_from,
             effective_until,
             superseded_by,
             created_at,
             updated_at
           ) VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, 'active', ?, NULL, NULL, ?, ?)
           ON CONFLICT(triple_hash) WHERE state = 'active' DO UPDATE SET
             updated_at = excluded.updated_at`
        );
        const upsertTopicLinkStatement = db.prepare(
          `INSERT INTO entity_links (
             link_id,
             triple_hash,
             subject_iri,
             predicate_iri,
             object_iri,
             object_value,
             object_datatype,
             graph_iri,
             subject_type,
             object_type,
             state,
             effective_from,
             effective_until,
             superseded_by,
             created_at,
             updated_at
           ) VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, 'active', ?, NULL, NULL, ?, ?)
           ON CONFLICT(triple_hash) WHERE state = 'active' DO UPDATE SET
             updated_at = excluded.updated_at`
        );
        const insertEvidenceStatement = db.prepare(
          `INSERT INTO entity_link_evidence (
             evidence_id,
             link_id,
             asserted_by,
             assertion_kind,
             confidence,
             evidence_span,
             source_iri,
             review_state,
             reviewer,
             reviewed_at,
             asserted_at
           )
           SELECT ?, link_id, ?, ?, ?, NULL, NULL, 'pending', NULL, NULL, ?
           FROM entity_links
           WHERE triple_hash = ?
             AND state = 'active'
             AND NOT EXISTS (
               SELECT 1
               FROM entity_link_evidence existing
               WHERE existing.link_id = entity_links.link_id
                 AND existing.asserted_by = ?
                 AND existing.assertion_kind = ?
             )`
        );
        const insertTopicEvidenceStatement = db.prepare(
          `INSERT INTO entity_link_evidence (
             evidence_id,
             link_id,
             asserted_by,
             assertion_kind,
             confidence,
             evidence_span,
             source_iri,
             review_state,
             reviewer,
             reviewed_at,
             asserted_at
           )
           SELECT ?, link_id, ?, ?, ?, ?, NULL, 'pending', NULL, NULL, ?
           FROM entity_links
           WHERE triple_hash = ?
             AND state = 'active'
             AND NOT EXISTS (
               SELECT 1
               FROM entity_link_evidence existing
               WHERE existing.link_id = entity_links.link_id
                 AND existing.asserted_by = ?
                 AND existing.assertion_kind = ?
             )`
        );

        const authorIris = Array.from(
          new Set([...authorByDid.values()].map((info) => info.iri))
        );
        const topicIris = Array.from(
          new Set(
            preparedRows.flatMap((row) =>
              row.topicEdges.map((edge) => edge.iri)
            )
          )
        );
        for (const authorIri of authorIris) {
          statements.push(
            upsertEntityStatement.bind(
              authorIri,
              EXPERT_ENTITY_TAG,
              now,
              now
            )
          );
        }
        for (const topicIri of topicIris) {
          statements.push(
            upsertEntityStatement.bind(
              topicIri,
              ENERGY_TOPIC_ENTITY_TAG,
              now,
              now
            )
          );
        }

        for (const row of preparedRows) {
          statements.push(
            upsertEntityStatement.bind(row.iri, POST_ENTITY_TAG, now, now),
            upsertSnapshotStatement.bind(
              row.iri,
              POST_ENTITY_TAG,
              row.payloadJson,
              now,
              now
            ),
            upsertQueueStatement.bind(
              yield* Random.nextUUIDv4,
              coalesceKey(row.iri, now),
              POST_ENTITY_TAG,
              row.iri,
              row.iri,
              "entity-changed",
              0,
              0,
              0,
              now,
              now,
              now
            )
          );
          if (
            row.authorIri !== null &&
            row.authoredByTripleHash !== null
          ) {
            statements.push(
              upsertAuthoredByLinkStatement.bind(
                yield* Random.nextUUIDv4,
                row.authoredByTripleHash,
                row.iri,
                AUTHORED_BY_PREDICATE_IRI,
                row.authorIri,
                DEFAULT_GRAPH_IRI,
                POST_ENTITY_TAG,
                EXPERT_ENTITY_TAG,
                row.post.postedAt,
                now,
                now
              ),
              insertEvidenceStatement.bind(
                yield* Random.nextUUIDv4,
                BACKFILL_ASSERTED_BY,
                "imported",
                1,
                now,
                row.authoredByTripleHash,
                BACKFILL_ASSERTED_BY,
                "imported"
              )
            );
          }
          for (const edge of row.topicEdges) {
            statements.push(
              upsertTopicLinkStatement.bind(
                yield* Random.nextUUIDv4,
                edge.tripleHash,
                row.iri,
                TOPIC_MENTION_PREDICATE_IRI,
                edge.iri,
                DEFAULT_GRAPH_IRI,
                POST_ENTITY_TAG,
                ENERGY_TOPIC_ENTITY_TAG,
                row.post.postedAt,
                now,
                now
              ),
              insertTopicEvidenceStatement.bind(
                yield* Random.nextUUIDv4,
                BACKFILL_ASSERTED_BY,
                "imported",
                edge.confidence,
                edge.evidenceSpan,
                now,
                edge.tripleHash,
                BACKFILL_ASSERTED_BY,
                "imported"
              )
            );
          }
        }

        yield* runD1Batch(
          db,
          statements,
          "EntityPostBackfillService.bulkWritePrepared"
        );
      });

      const backfillWithD1Batch = Effect.fn(
        "EntityPostBackfillService.backfillWithD1Batch"
      )(function* (
        db: D1DatabaseBinding,
        rows: ReadonlyArray<PostRow>,
        authorByDid: ReadonlyMap<string, AuthorInfo>,
        enrichmentTextByPostUri: ReadonlyMap<string, string>
      ) {
        const outcomes = yield* Effect.forEach(
          rows,
          (row) =>
            Effect.exit(
              preparePostRow(row, authorByDid, enrichmentTextByPostUri)
            ),
          { concurrency: WRITE_CONCURRENCY }
        );
        const preparedRows = outcomes.flatMap((outcome) =>
          Exit.isSuccess(outcome) ? [outcome.value] : []
        );
        yield* bulkWritePrepared(db, preparedRows, authorByDid);
        const failedUris = outcomes.flatMap((outcome, index) =>
          Exit.isSuccess(outcome) ? [] : [rows[index]?.uri ?? "unknown"]
        );
        return {
          migrated: preparedRows.length,
          queued: preparedRows.length,
          authoredByEdges: preparedRows.filter((row) => row.authorIri !== null)
            .length,
          topicEdges: preparedRows.reduce(
            (total, row) => total + row.topicEdges.length,
            0
          ),
          failed: rows.length - preparedRows.length,
          failedUris
        };
      });

      const saveAndQueue = Effect.fn(
        "EntityPostBackfillService.saveAndQueue"
      )(function* (
        row: PostRow,
        authorByDid: ReadonlyMap<string, AuthorInfo>,
        enrichmentTextByPostUri: ReadonlyMap<string, string>
      ) {
        const basePost = yield* postFromLegacyRow(toLegacyRow(row));
        const author = authorByDid.get(row.did) ?? null;
        const authorIri = author?.iri ?? null;
        const topics = yield* resolveTopicEdges(row);
        const authorFields =
          author === null
            ? {}
            : {
                authoredBy: author.iri,
                ...(author.displayName === null
                  ? {}
                  : { authoredByDisplayName: author.displayName }),
                ...(author.handle === null
                  ? {}
                  : { authoredByHandle: author.handle })
              };
        const post = yield* Schema.decodeUnknownEffect(PostEntity.schema)({
          ...basePost,
          ...authorFields,
          topics: topics.canonicalSlugs,
          ...(enrichmentTextByPostUri.has(row.uri)
            ? { enrichmentText: enrichmentTextByPostUri.get(row.uri) }
            : {})
        });
        const writeResult = yield* writer.write(PostEntity, post);
        const iri = writeResult.iri;
        yield* Effect.forEach(
          topics.edges,
          (edge) =>
            Effect.gen(function* () {
              const topicIri = asEntityIri(edge.iri);
              yield* entityGraph.upsertEntity(
                topicIri,
                ENERGY_TOPIC_ENTITY_TAG
              );
              const link = yield* entityGraph.createLink({
                predicate: "iao:mentions",
                subject: { iri, type: "Post" },
                object: { iri: topicIri, type: "EnergyTopic" },
                effectiveFrom: post.postedAt
              });
              yield* entityGraph.recordEvidence(link.linkId, {
                assertedBy: BACKFILL_ASSERTED_BY,
                assertionKind: "imported",
                confidence: edge.confidence,
                evidenceSpan: edge.evidenceSpan
              });
            }),
          { concurrency: WRITE_CONCURRENCY }
        );
        if (authorIri !== null) {
          yield* writeAuthoredByEdge(
            iri,
            asEntityIri(authorIri),
            post.postedAt
          );
        }
        return {
          authoredByEdges: authorIri === null ? 0 : 1,
          topicEdges: topics.edges.length
        };
      });

      const backfill = Effect.fn("EntityPostBackfillService.backfill")(
        function* (input?: EntityPostBackfillInput) {
          const limit = normalizeLimit(input?.limit);
          const offset = normalizeOffset(input?.offset);

          const totalRows = yield* sql<{ total: number }>`
            SELECT COUNT(*) as total
            FROM posts
            WHERE status = 'active'
              AND uri LIKE 'at://%'
          `.pipe(Effect.flatMap(decodeCount));
          const total = totalRows[0]?.total ?? 0;

          const rawRows = yield* sql<PostRow>`
            SELECT
              p.uri as uri,
              p.did as did,
              p.text as text,
              p.created_at as created_at,
              COALESCE(
                '[' || GROUP_CONCAT(
                  CASE
                    WHEN pt.topic_slug IS NULL THEN NULL
                    ELSE json_object(
                      'topicSlug', pt.topic_slug,
                      'matchedTerm', pt.matched_term,
                      'matchSignal', pt.match_signal,
                      'matchValue', pt.match_value,
                      'matchScore', pt.match_score,
                      'ontologyVersion', pt.ontology_version,
                      'matcherVersion', pt.matcher_version
                    )
                  END
                ) || ']',
                '[]'
              ) as topic_json
            FROM posts p
            LEFT JOIN post_topics pt ON pt.post_uri = p.uri
            WHERE p.status = 'active'
              AND p.uri LIKE 'at://%'
            GROUP BY p.uri, p.did, p.text, p.created_at
            ORDER BY p.created_at ASC
            LIMIT ${limit}
            OFFSET ${offset}
          `;
          const rows = yield* decodeRows(rawRows);
          const authorByDid = yield* buildAuthorByDid(rows);
          const enrichmentTextByPostUri = yield* buildEnrichmentTextByPostUri(
            rows
          );
          const result =
            rawDb === null
              ? yield* Effect.gen(function* () {
                  yield* upsertAuthors(authorByDid);
                  const outcomes = yield* Effect.forEach(
                    rows,
                    (row) =>
                      Effect.exit(
                        saveAndQueue(
                          row,
                          authorByDid,
                          enrichmentTextByPostUri
                        ).pipe(
                          Effect.retry({ schedule: ROW_WRITE_RETRY_SCHEDULE })
                        )
                      ),
                    { concurrency: WRITE_CONCURRENCY }
                  );
                  const migrated = outcomes.filter((outcome) =>
                    Exit.isSuccess(outcome)
                  ).length;
                  const authoredByEdges = outcomes.reduce(
                    (total, outcome) =>
                      Exit.isSuccess(outcome)
                        ? total + outcome.value.authoredByEdges
                        : total,
                    0
                  );
                  const topicEdges = outcomes.reduce(
                    (total, outcome) =>
                      Exit.isSuccess(outcome)
                        ? total + outcome.value.topicEdges
                        : total,
                    0
                  );
                  const failedUris = outcomes.flatMap((outcome, index) =>
                    Exit.isSuccess(outcome)
                      ? []
                      : [rows[index]?.uri ?? "unknown"]
                  );
                  return {
                    migrated,
                    queued: migrated,
                    authoredByEdges,
                    topicEdges,
                    failed: rows.length - migrated,
                    failedUris
                  };
                })
              : yield* backfillWithD1Batch(
                  rawDb,
                  rows,
                  authorByDid,
                  enrichmentTextByPostUri
                );

          return {
            total,
            scanned: rows.length,
            ...result
          };
        }
      );

      return EntityPostBackfillService.of({ backfill });
    })
  );
}
