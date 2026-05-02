/**
 * Hand-written Expert agent module.
 *
 * Canonical reference for every per-entity ontology module under
 * packages/ontology-store/. Implements the OntologyEntityModule
 * contract (Domain/OntologyEntity.ts) for the energy-intel Expert.
 *
 * Three responsibilities co-exist in a single file by design:
 *   1. Application schema — the runtime shape Expert consumers see.
 *   2. RDF mapping — forward (toTriples) + reverse (fromTriples).
 *   3. AI Search projection — toKey/toBody/toMetadata.
 *
 * The application schema extends beyond the codegen output because
 * agent.ttl does not yet declare owl:DatatypeProperty / ObjectProperty
 * for displayName / did / bio / tier / primaryTopic. Once those are
 * declared upstream, regenerate src/generated/agent.ts and replace the
 * hand-declared fields with the generated property schemas to make
 * this fully codegen-driven. The branded ExpertIri / EnergyExpertRoleIri
 * imports below are already codegen-driven.
 *
 * Description-logic axiom (informational):
 *   Expert ≡ foaf:Person ⊓ ∃bfo:bearerOf.EnergyExpertRole
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
import type { OntologyEntityModule } from "../Domain/OntologyEntity";
import {
  type EntityMetadata,
  type ProjectionContract,
  type ProjectionFixture
} from "../Domain/Projection";
import type { RdfQuad } from "../Domain/Rdf";
import {
  EnergyExpertRoleIri,
  ExpertIri
} from "../generated/agent";
import { BFO, EI, FOAF, RDF } from "../iris";

const { quad, namedNode, literal } = DataFactory;
const predicate = (term: NamedNode): PredicateIri => asPredicateIri(term.value);

// Re-export the branded IRI brands so downstream consumers of this
// module can reach for them through one import.
export { EnergyExpertRoleIri, ExpertIri };

/**
 * Application-level Expert shape.
 *
 * `iri` is the codegen-driven branded identity. The other fields are
 * hand-declared until agent.ttl gains property declarations; see the
 * file-level docstring for the regen path.
 *
 * `did` is intentionally `Schema.String` here rather than the worker's
 * `Did` brand because the ontology-store package does not depend on
 * `src/domain/`. Consumers that already hold a branded `Did` may pass
 * it directly — the brand is structurally compatible. A future revision
 * may lift `Did` into a shared domain crate.
 */
export class Expert extends Schema.Class<Expert>("Expert")({
  iri: ExpertIri,
  did: Schema.String,
  displayName: Schema.String,
  roles: Schema.NonEmptyArray(EnergyExpertRoleIri),
  bio: Schema.optionalKey(Schema.String),
  tier: Schema.optionalKey(Schema.String),
  primaryTopic: Schema.optionalKey(Schema.String)
}) {}

/**
 * Metadata key set for AI Search projection. The five keys here are
 * the contract with the Alchemy `experts` AI Search instance — adding
 * or removing a key without matching alchemy.run.ts surfaces as a TS
 * structural mismatch on `OntologyEntityModule<typeof Expert,
 * ExpertMetadata>`.
 */
export const EXPERT_METADATA_KEYS = [
  "entity_type",
  "did",
  "iri",
  "tier",
  "topic"
] as const;
export type ExpertMetadataKey = (typeof EXPERT_METADATA_KEYS)[number];
export type ExpertMetadata = Readonly<Record<ExpertMetadataKey, string>>;

// ---------------------------------------------------------------------------
// Forward mapping: Expert -> RDF quads
// ---------------------------------------------------------------------------

// `ei:bio` is not declared in agent.ttl yet, so it is absent from
// iris.ts. Construct the IRI inline; once agent.ttl declares
// `ei:bio a owl:DatatypeProperty`, regenerate iris.ts and replace
// this with `EI.bio`.
// TODO(ttl-properties): emit ei:bio in iris.ts after upstream adds it.
const EI_BIO = namedNode("https://w3id.org/energy-intel/bio");

// `ei:did` is not declared in agent.ttl yet either. Construct the IRI
// inline; once agent.ttl declares `ei:did a owl:DatatypeProperty`,
// regenerate iris.ts and replace this with `EI.did`. The triple is
// load-bearing for round-trip identity stability — see
// `expertFromTriples`.
// TODO(ttl-properties): emit ei:did in iris.ts after upstream adds it.
const EI_DID = namedNode("https://w3id.org/energy-intel/did");

/**
 * Forward mapping. Re-expands the flattened TS `Expert` into BFO
 * inherence triples.
 *
 * For each role IRI, three triples are emitted:
 *   (role, rdf:type,  ei:EnergyExpertRole)
 *   (role, bfo:inheresIn, expert)         // BFO_0000052
 *   (expert, bfo:bearerOf, role)          // BFO_0000053
 *
 * Plus the standard typing and properties on the expert subject:
 *   (expert, rdf:type, ei:Expert)
 *   (expert, rdf:type, foaf:Person)
 *   (expert, foaf:name, "displayName")
 *   (expert, ei:did,  "did:plc:xyz")
 *   (expert, ei:bio,  "bio")              // when present
 */
export const expertToTriples = (e: Expert): ReadonlyArray<RdfQuad> => {
  const subject = namedNode(e.iri);
  const triples: RdfQuad[] = [
    quad(subject, RDF.type, EI.Expert),
    quad(subject, RDF.type, FOAF.Person),
    quad(subject, FOAF.name, literal(e.displayName)),
    quad(subject, EI_DID, literal(e.did))
  ];
  for (const roleIri of e.roles) {
    const role = namedNode(roleIri);
    triples.push(quad(role, RDF.type, EI.EnergyExpertRole));
    triples.push(quad(role, BFO.inheresIn, subject));
    triples.push(quad(subject, BFO.bearerOf, role));
  }
  if (e.bio !== undefined) {
    triples.push(quad(subject, EI_BIO, literal(e.bio)));
  }
  return triples;
};

// ---------------------------------------------------------------------------
// Reverse mapping: RDF quads -> Expert
// ---------------------------------------------------------------------------

// Why this is policy-driven:
// fromTriples receives an arbitrary slab of quads — it deliberately
// ignores anything it does not recognise (different subject, foreign
// predicates, role IRIs not typed as ei:EnergyExpertRole). Required
// fields are checked explicitly and raise RdfMappingError; optional
// fields silently become `undefined`. Schema.decodeUnknownEffect adds
// the structural validation pass.

const decodeExpert = Schema.decodeUnknownEffect(Expert);

/**
 * Reverse mapping. Walks the n3 Store, picks up the recognised triples,
 * and decodes through `Schema.decodeUnknownEffect` for validation.
 *
 * Lossy fields:
 *   - tier and primaryTopic: not represented as triples in this slice;
 *     dropped on round-trip until upstream declares them.
 *   - profile facets such as tier and primaryTopic: not represented as
 *     triples in this slice; dropped on round-trip until upstream declares
 *     them.
 *
 * `did` is round-trip stable — it is stored as a `(expert, ei:did,
 * "did:plc:...")` literal triple by `expertToTriples` and read back
 * here. Older migration paths used handle-derived IRIs, so deriving `did`
 * from the IRI tail drifted identity (e.g. `expert/MarkZJacobson` parsed
 * back as did "MarkZJacobson" instead of "did:plc:xyz"). The AI Search
 * projection key is derived from `did`, so the drift was load-bearing.
 */
export const expertFromTriples = (
  quads: ReadonlyArray<RdfQuad>,
  subject: string
): Effect.Effect<Expert, RdfMappingError | Schema.SchemaError> =>
  Effect.gen(function* () {
    const store = new Store([...quads]);
    const subjectNode = namedNode(subject);

    // displayName: foaf:name (required)
    const nameQuads = store.getQuads(subjectNode, FOAF.name, null, null);
    const nameQuad = nameQuads[0];
    if (!nameQuad) {
      yield* new RdfMappingError({
        direction: "reverse",
        entity: "Expert",
        iri: subject,
        message: "missing required foaf:name"
      });
    }
    const displayName = nameQuad?.object.value ?? "";

    // bio: ei:bio (optional)
    const bioQuads = store.getQuads(subjectNode, EI_BIO, null, null);
    const bioQuad = bioQuads[0];

    // roles: bfo:bearerOf objects whose type is ei:EnergyExpertRole.
    // The type filter discards bearerOf links pointing at PublisherRole
    // or DataProviderRole, so a single store can mix expert/org agents
    // without cross-contamination on reverse.
    const bearerOfQuads = store.getQuads(
      subjectNode,
      BFO.bearerOf,
      null,
      null
    );
    const roles: string[] = [];
    for (const bq of bearerOfQuads) {
      if (bq.object.termType !== "NamedNode") continue;
      const typed = store.getQuads(
        bq.object,
        RDF.type,
        EI.EnergyExpertRole,
        null
      );
      if (typed.length > 0) roles.push(bq.object.value);
    }
    if (roles.length === 0) {
      yield* new RdfMappingError({
        direction: "reverse",
        entity: "Expert",
        iri: subject,
        message: "Expert must bear at least one EnergyExpertRole"
      });
    }

    // did: required ei:did literal. Stored as a triple by the forward
    // mapping (rather than derived from the IRI tail) so every Expert IRI
    // stays tied to its true DID.
    const didQuads = store.getQuads(subjectNode, EI_DID, null, null);
    const didQuad = didQuads[0];
    if (!didQuad) {
      yield* new RdfMappingError({
        direction: "reverse",
        entity: "Expert",
        iri: subject,
        message: "missing required ei:did"
      });
    }
    const did = didQuad?.object.value ?? "";

    // Build the candidate object with conditional assignment so absent
    // optional fields stay absent (Schema.optionalKey under
    // exactOptionalPropertyTypes treats `{ bio: undefined }` differently
    // from `{}` and rejects the former). Mirrors `expertFromLegacyRow`.
    const candidate: Record<string, unknown> = {
      iri: subject,
      did,
      displayName,
      roles
    };
    if (bioQuad !== undefined) candidate.bio = bioQuad.object.value;
    return yield* decodeExpert(candidate);
  });

// ---------------------------------------------------------------------------
// AI Search projection
// ---------------------------------------------------------------------------

const renderExpertMarkdown = (e: Expert): string => {
  const lines: string[] = [
    "---",
    `displayName: ${e.displayName}`,
    `did: ${e.did}`,
    `iri: ${e.iri}`,
    "roles:"
  ];
  for (const r of e.roles) lines.push(`  - ${r}`);
  if (e.tier !== undefined) lines.push(`tier: ${e.tier}`);
  if (e.primaryTopic !== undefined)
    lines.push(`primary_topic: ${e.primaryTopic}`);
  lines.push("---", "", `# ${e.displayName}`, "");
  if (e.bio !== undefined) lines.push(e.bio);
  return lines.join("\n");
};

export const renderExpertSummary = (e: Expert): string => {
  const authority = e.tier ?? "expert";
  const topic = e.primaryTopic ?? "energy topics";
  return `${e.displayName}, ${authority} on ${topic}`;
};

export const expertFacts = (
  e: Expert
): ReadonlyArray<EntityFact<typeof ExpertIri>> => {
  const facts: Array<EntityFact<typeof ExpertIri>> = [
    { subject: e.iri, predicate: predicate(EI_DID), object: e.did },
    { subject: e.iri, predicate: predicate(FOAF.name), object: e.displayName }
  ];
  for (const role of e.roles) {
    facts.push({ subject: e.iri, predicate: predicate(BFO.bearerOf), object: role });
  }
  return facts;
};

export const ExpertProjection = {
  toKey: (e: Expert): string => `expert/${e.did}.md`,
  toBody: renderExpertMarkdown,
  toMetadata: (e: Expert): ExpertMetadata => ({
    entity_type: "Expert",
    did: e.did,
    iri: e.iri,
    tier: e.tier ?? "unknown",
    topic: e.primaryTopic ?? "unknown"
  })
} as const;

const slugifyKeyPart = (value: string): string =>
  value.replace(/[^A-Za-z0-9_-]+/g, "_");

export const ExpertUnifiedProjection = {
  entityType: "Expert",
  toKey: (e: Expert): `entities/expert/${string}.md` =>
    `entities/expert/${slugifyKeyPart(e.did)}.md`,
  toBody: renderExpertMarkdown,
  toMetadata: (e: Expert): EntityMetadata => ({
    entity_type: "Expert",
    iri: e.iri,
    topic: e.primaryTopic ?? "unknown",
    authority: e.tier ?? "unknown",
    time_bucket: "unknown"
  })
} as const satisfies ProjectionContract<
  typeof Expert,
  EntityMetadata,
  `entities/expert/${string}.md`
>;

export const ExpertProjectionFixture = {
  entityType: "Expert",
  fixture: Schema.decodeUnknownSync(Expert)({
    iri: "https://w3id.org/energy-intel/expert/FixtureExpert",
    did: "did:plc:fixture",
    displayName: "Fixture Expert",
    roles: ["https://w3id.org/energy-intel/energyExpertRole/research"],
    tier: "core",
    primaryTopic: "grid"
  }),
  projection: ExpertUnifiedProjection
} as const satisfies ProjectionFixture<typeof Expert>;

// ---------------------------------------------------------------------------
// Module wiring
// ---------------------------------------------------------------------------

const iriOf = (e: Expert): string => e.iri;
const deriveExpertIri = ({ handle }: { readonly handle: string }): ExpertIri =>
  Schema.decodeUnknownSync(ExpertIri)(
    `https://w3id.org/energy-intel/expert/${handle.replace(SLUG_DISALLOWED, "_")}`
  );

export const ExpertEntity = defineEntity({
  tag: "Expert" as const,
  schema: Expert,
  identity: {
    iri: ExpertIri,
    iriOf: (e) => e.iri,
    derive: deriveExpertIri
  },
  ontology: {
    classIri: EI.Expert.value,
    typeChain: [FOAF.Person.value, EI.Expert.value],
    shapeRef: "shapes/expert.ttl",
    toTriples: expertToTriples,
    fromTriples: expertFromTriples
  },
  render: {
    summary: renderExpertSummary,
    fulltext: renderExpertMarkdown,
    facts: expertFacts
  },
  relations: {
    bears: {
      direction: "outbound",
      predicate: predicate(BFO.bearerOf),
      target: "EnergyExpertRole",
      cardinality: "many"
    }
  },
  agentContext: {
    description:
      "A foaf:Person bearing at least one EnergyExpertRole.",
    tools: ["search", "get", "linksOut", "linksIn"],
    summaryTemplate: (e) => `Expert ${e.displayName} (${e.did})`
  }
});

/**
 * Canonical OntologyEntityModule for Expert.
 *
 * Every future entity module (Organization, Dataset, etc.) follows this
 * exact shape: a single `<Module>` const that satisfies the
 * `OntologyEntityModule` contract structurally, exporting the
 * underlying transforms for direct use where the contract surface is
 * not needed.
 */
export const ExpertModule: OntologyEntityModule<typeof Expert, ExpertMetadata> =
  {
    schema: Expert,
    iriOf,
    toTriples: expertToTriples,
    fromTriples: expertFromTriples,
    toAiSearchKey: ExpertProjection.toKey,
    toAiSearchBody: ExpertProjection.toBody,
    toAiSearchMetadata: ExpertProjection.toMetadata
  };

// ---------------------------------------------------------------------------
// Legacy migration helper (consumed by Task 19's OntologyExpertRepo)
// ---------------------------------------------------------------------------

/**
 * Subset of the legacy `experts` D1 row shape this module needs to
 * synthesise an energy-intel Expert. Defined locally because the
 * legacy row schema lives in `src/services/d1/` (worker tree) and the
 * ontology-store package is meant to be reachable without depending on
 * the worker's domain layer.
 */
export interface LegacyExpertRow {
  readonly did: string;
  readonly handle?: string | null;
  readonly displayName?: string | null;
  readonly bio?: string | null;
  readonly tier?: string | null;
  readonly primaryTopic?: string | null;
}

const SLUG_DISALLOWED = /[^A-Za-z0-9_-]+/g;

// The default role IRI is a stub. Task 19 (`OntologyExpertRepo`) is
// expected to refine this — most likely by carrying per-expert role
// hints on the legacy row or by deriving the role from `tier`.
const DEFAULT_LEGACY_ROLE_IRI =
  "https://w3id.org/energy-intel/energyExpertRole/default";

/**
 * Build an `Expert` from a legacy D1 row. The DID is URL-sanitised before
 * being interpolated into the IRI so entity identity stays stable even when
 * handles change or collide after slugging.
 */
export const expertFromLegacyRow = (
  row: LegacyExpertRow
): Effect.Effect<Expert, Schema.SchemaError> => {
  const safeDid = row.did.replace(SLUG_DISALLOWED, "_");
  const candidate: Record<string, unknown> = {
    iri: `https://w3id.org/energy-intel/expert/${safeDid}`,
    did: row.did,
    displayName: row.displayName ?? row.handle ?? row.did,
    roles: [DEFAULT_LEGACY_ROLE_IRI]
  };
  if (row.bio != null) candidate.bio = row.bio;
  if (row.tier != null) candidate.tier = row.tier;
  if (row.primaryTopic != null) candidate.primaryTopic = row.primaryTopic;
  return decodeExpert(candidate);
};
