import type {
  AnyEntityDefinition,
  RelationDeclaration
} from "./Domain/EntityDefinition";
import {
  ENTITY_METADATA_FIELDS,
  type EntityMetadataKey
} from "./Domain/Projection";
import { DEFAULT_ENTITY_SEARCH_INSTANCE } from "./Service/AiSearchClient";
import { ExpertEntity } from "./agent/expert";
import { OrganizationEntity } from "./agent/organization";

export const ENERGY_INTEL_SEARCH_BINDING = "ENERGY_INTEL_SEARCH" as const;
export const ENERGY_INTEL_SEARCH_NAMESPACE = "energy-intel" as const;
export const ENERGY_INTEL_SEARCH_INSTANCE =
  DEFAULT_ENTITY_SEARCH_INSTANCE;
export const MAX_AI_SEARCH_CUSTOM_METADATA_FIELDS = 5 as const;

export type AiSearchCustomMetadataField = {
  readonly field_name: EntityMetadataKey;
  readonly data_type: "text" | "number" | "boolean";
};

export const ENTITY_SEARCH_CUSTOM_METADATA =
  ENTITY_METADATA_FIELDS satisfies ReadonlyArray<AiSearchCustomMetadataField>;

export const ENTITY_SEARCH_PROVISIONING = {
  binding: ENERGY_INTEL_SEARCH_BINDING,
  namespace: ENERGY_INTEL_SEARCH_NAMESPACE,
  instance: ENERGY_INTEL_SEARCH_INSTANCE,
  customMetadata: ENTITY_SEARCH_CUSTOM_METADATA
} as const;

export type EntityRelationProvisioning = {
  readonly name: string;
  readonly direction: RelationDeclaration<string>["direction"];
  readonly predicate: string;
  readonly target: string;
  readonly cardinality: RelationDeclaration<string>["cardinality"];
};

export type EntityProvisioningPlan = {
  readonly tag: string;
  readonly ontology: {
    readonly classIri: string;
    readonly shapeRef: string;
  };
  readonly relations: ReadonlyArray<EntityRelationProvisioning>;
  readonly search: typeof ENTITY_SEARCH_PROVISIONING;
  readonly agentContext: {
    readonly description: string;
    readonly tools: ReadonlyArray<string>;
  };
};

const relationProvisioning = (
  relations: AnyEntityDefinition["relations"]
): ReadonlyArray<EntityRelationProvisioning> =>
  Object.entries(relations).map(([name, relation]) => ({
    name,
    direction: relation.direction,
    predicate: relation.predicate,
    target: relation.target,
    cardinality: relation.cardinality
  }));

export const defineEntityProvisioning = <Def extends AnyEntityDefinition>(
  definition: Def
): EntityProvisioningPlan => ({
  tag: definition.tag,
  ontology: {
    classIri: definition.ontology.classIri,
    shapeRef: definition.ontology.shapeRef
  },
  relations: relationProvisioning(definition.relations),
  search: ENTITY_SEARCH_PROVISIONING,
  agentContext: {
    description: definition.agentContext.description,
    tools: definition.agentContext.tools
  }
});

export const ExpertProvisioning = defineEntityProvisioning(ExpertEntity);
export const OrganizationProvisioning =
  defineEntityProvisioning(OrganizationEntity);

export const ENTITY_PROVISIONING = [
  ExpertProvisioning,
  OrganizationProvisioning
] as const;
