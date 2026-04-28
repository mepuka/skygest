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
import {
  DataProviderRoleIri,
  OrganizationIri,
  PublisherRoleIri
} from "../generated/agent";
import { BFO, EI, FOAF, RDF } from "../iris";

const { quad, namedNode, literal } = DataFactory;
const predicate = (term: NamedNode): PredicateIri => asPredicateIri(term.value);

export { DataProviderRoleIri, OrganizationIri, PublisherRoleIri };

export class Organization extends Schema.Class<Organization>("Organization")({
  iri: OrganizationIri,
  displayName: Schema.String,
  roles: Schema.optionalKey(
    Schema.Array(Schema.Union([PublisherRoleIri, DataProviderRoleIri]))
  ),
  primaryTopic: Schema.optionalKey(Schema.String),
  authority: Schema.optionalKey(Schema.String)
}) {}

const decodeOrganization = Schema.decodeUnknownEffect(Organization);

export const organizationToTriples = (
  organization: Organization
): ReadonlyArray<RdfQuad> => {
  const subject = namedNode(organization.iri);
  const triples: RdfQuad[] = [
    quad(subject, RDF.type, EI.Organization),
    quad(subject, RDF.type, FOAF.Organization),
    quad(subject, FOAF.name, literal(organization.displayName))
  ];
  for (const roleIri of organization.roles ?? []) {
    const role = namedNode(roleIri);
    triples.push(quad(subject, BFO.bearerOf, role));
  }
  return triples;
};

export const organizationFromTriples = (
  quads: ReadonlyArray<RdfQuad>,
  subject: string
): Effect.Effect<Organization, RdfMappingError | Schema.SchemaError> =>
  Effect.gen(function* () {
    const store = new Store([...quads]);
    const subjectNode = namedNode(subject);
    const nameQuad = store.getQuads(subjectNode, FOAF.name, null, null)[0];
    if (!nameQuad) {
      yield* new RdfMappingError({
        direction: "reverse",
        entity: "Organization",
        iri: subject,
        message: "missing required foaf:name"
      });
    }
    const roles = store
      .getQuads(subjectNode, BFO.bearerOf, null, null)
      .map((q) => q.object)
      .filter((term): term is NamedNode => term.termType === "NamedNode")
      .map((term) => term.value);
    const candidate: Record<string, unknown> = {
      iri: subject,
      displayName: nameQuad?.object.value ?? ""
    };
    if (roles.length > 0) candidate.roles = roles;
    return yield* decodeOrganization(candidate);
  });

export const renderOrganizationSummary = (organization: Organization): string =>
  `${organization.displayName}, ${organization.authority ?? "organization"} on ${
    organization.primaryTopic ?? "energy topics"
  }`;

export const renderOrganizationMarkdown = (
  organization: Organization
): string => {
  const lines = [
    "---",
    `displayName: ${organization.displayName}`,
    `iri: ${organization.iri}`
  ];
  if (organization.primaryTopic !== undefined) {
    lines.push(`topic: ${organization.primaryTopic}`);
  }
  if (organization.authority !== undefined) {
    lines.push(`authority: ${organization.authority}`);
  }
  lines.push("---", "", `# ${organization.displayName}`);
  return lines.join("\n");
};

export const organizationFacts = (
  organization: Organization
): ReadonlyArray<EntityFact<typeof OrganizationIri>> => {
  const facts: Array<EntityFact<typeof OrganizationIri>> = [
    {
      subject: organization.iri,
      predicate: predicate(FOAF.name),
      object: organization.displayName
    }
  ];
  for (const role of organization.roles ?? []) {
    facts.push({
      subject: organization.iri,
      predicate: predicate(BFO.bearerOf),
      object: role
    });
  }
  return facts;
};

const slugifyKeyPart = (value: string): string =>
  value.replace(/[^A-Za-z0-9_-]+/g, "_");

export const OrganizationUnifiedProjection = {
  entityType: "Organization",
  toKey: (organization: Organization): `entities/organization/${string}.md` =>
    `entities/organization/${slugifyKeyPart(organization.iri)}.md`,
  toBody: renderOrganizationMarkdown,
  toMetadata: (organization: Organization): EntityMetadata => ({
    entity_type: "Organization",
    iri: organization.iri,
    topic: organization.primaryTopic ?? "unknown",
    authority: organization.authority ?? "unknown",
    time_bucket: "unknown"
  })
} as const satisfies ProjectionContract<
  typeof Organization,
  EntityMetadata,
  `entities/organization/${string}.md`
>;

export const OrganizationProjectionFixture = {
  entityType: "Organization",
  fixture: Schema.decodeUnknownSync(Organization)({
    iri: "https://w3id.org/energy-intel/organization/FixtureOrg",
    displayName: "Fixture Organization",
    primaryTopic: "grid",
    authority: "research"
  }),
  projection: OrganizationUnifiedProjection
} as const satisfies ProjectionFixture<typeof Organization>;

const deriveOrganizationIri = ({
  handle
}: {
  readonly handle: string;
}): OrganizationIri =>
  Schema.decodeUnknownSync(OrganizationIri)(
    `https://w3id.org/energy-intel/organization/${handle.replace(/[^A-Za-z0-9_-]+/g, "_")}`
  );

export const OrganizationEntity = defineEntity({
  tag: "Organization" as const,
  schema: Organization,
  identity: {
    iri: OrganizationIri,
    iriOf: (organization) => organization.iri,
    derive: deriveOrganizationIri
  },
  ontology: {
    classIri: EI.Organization.value,
    typeChain: [FOAF.Organization.value, EI.Organization.value],
    shapeRef: "shapes/organization.ttl",
    toTriples: organizationToTriples,
    fromTriples: organizationFromTriples
  },
  render: {
    summary: renderOrganizationSummary,
    fulltext: renderOrganizationMarkdown,
    facts: organizationFacts
  },
  relations: {
    bears: {
      direction: "outbound",
      predicate: predicate(BFO.bearerOf),
      target: "PublisherRole",
      cardinality: "many"
    }
  },
  agentContext: {
    description:
      "An organized group of people or institutions in the energy domain.",
    tools: ["search", "get", "linksOut", "linksIn"],
    summaryTemplate: (organization) =>
      `Organization ${organization.displayName}`
  }
});
