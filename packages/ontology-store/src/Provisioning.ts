import { Schema } from "effect";
import type {
  AnyEntityDefinition,
  RelationDeclaration
} from "./Domain/EntityDefinition";
import {
  ENTITY_METADATA_FIELDS,
  type EntityMetadata,
  type EntityMetadataKey,
  type ProjectionContract,
  type ProjectionFixture
} from "./Domain/Projection";
import { DEFAULT_ENTITY_SEARCH_INSTANCE } from "./Service/AiSearchClient";
import {
  ExpertEntity,
  ExpertProjectionFixture,
  ExpertUnifiedProjection
} from "./agent/expert";
import {
  OrganizationEntity,
  OrganizationProjectionFixture,
  OrganizationUnifiedProjection
} from "./agent/organization";

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

export type EntityRuntimeModule<
  Def extends AnyEntityDefinition = AnyEntityDefinition
> = {
  readonly definition: Def;
  readonly projection: ProjectionContract<Def["schema"], EntityMetadata>;
  readonly fixture: ProjectionFixture<Def["schema"]>;
};

export const defineEntityRuntimeModule = <
  Def extends AnyEntityDefinition
>(
  module: EntityRuntimeModule<Def>
): EntityRuntimeModule<Def> => module;

export class EntityRuntimeCatalogError extends Schema.TaggedErrorClass<EntityRuntimeCatalogError>()(
  "EntityRuntimeCatalogError",
  {
    kind: Schema.Literals([
      "DuplicateTag",
      "ProjectionEntityTypeMismatch",
      "FixtureEntityTypeMismatch",
      "MetadataFieldMismatch",
      "FixtureIriMismatch"
    ]),
    tag: Schema.String,
    message: Schema.String
  }
) {}

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

export type EntityRuntimeCatalog<
  Modules extends ReadonlyArray<EntityRuntimeModule> = ReadonlyArray<EntityRuntimeModule>
> = {
  readonly modules: Modules;
  readonly tags: ReadonlyArray<string>;
  readonly provisioning: ReadonlyArray<EntityProvisioningPlan>;
  readonly projectionSpecs: ReadonlyArray<{
    readonly definition: AnyEntityDefinition;
    readonly projection: ProjectionContract<AnyEntityDefinition["schema"], EntityMetadata>;
  }>;
  readonly fixtures: ReadonlyArray<ProjectionFixture<any>>;
};

const failCatalog = (
  error: EntityRuntimeCatalogError
): never => {
  throw error;
};

const assertRuntimeModule = (
  module: EntityRuntimeModule,
  seenTags: Set<string>
): void => {
  const tag = module.definition.tag;
  if (seenTags.has(tag)) {
    failCatalog(
      new EntityRuntimeCatalogError({
        kind: "DuplicateTag",
        tag,
        message: `Duplicate entity runtime module tag: ${tag}`
      })
    );
  }
  seenTags.add(tag);

  if (module.projection.entityType !== tag) {
    failCatalog(
      new EntityRuntimeCatalogError({
        kind: "ProjectionEntityTypeMismatch",
        tag,
        message: `Projection entity type ${module.projection.entityType} does not match definition tag ${tag}`
      })
    );
  }

  if (
    module.fixture.entityType !== tag ||
    module.fixture.projection.entityType !== tag
  ) {
    failCatalog(
      new EntityRuntimeCatalogError({
        kind: "FixtureEntityTypeMismatch",
        tag,
        message: `Projection fixture does not match definition tag ${tag}`
      })
    );
  }

  const metadata = module.projection.toMetadata(module.fixture.fixture);
  const expectedKeys = ENTITY_METADATA_FIELDS.map((field) => field.field_name);
  const actualKeys = Object.keys(metadata);
  const expected = new Set<string>(expectedKeys);
  const actual = new Set(actualKeys);
  const mismatch =
    expectedKeys.some((key) => !actual.has(key)) ||
    actualKeys.some((key) => !expected.has(key));
  if (mismatch) {
    failCatalog(
      new EntityRuntimeCatalogError({
        kind: "MetadataFieldMismatch",
        tag,
        message: `Projection metadata for ${tag} must emit exactly ${expectedKeys.join(", ")}`
      })
    );
  }

  const fixtureIri = module.definition.identity.iriOf(
    module.fixture.fixture as never
  );
  if (metadata.iri !== fixtureIri) {
    failCatalog(
      new EntityRuntimeCatalogError({
        kind: "FixtureIriMismatch",
        tag,
        message: `Projection metadata iri ${metadata.iri} does not match fixture identity ${fixtureIri}`
      })
    );
  }
};

export const defineEntityRuntimeCatalog = <
  Modules extends ReadonlyArray<EntityRuntimeModule>
>(
  modules: Modules
): EntityRuntimeCatalog<Modules> => {
  const seenTags = new Set<string>();
  for (const module of modules) {
    assertRuntimeModule(module, seenTags);
  }

  return {
    modules,
    tags: modules.map((module) => module.definition.tag),
    provisioning: modules.map((module) =>
      defineEntityProvisioning(module.definition)
    ),
    projectionSpecs: modules.map((module) => ({
      definition: module.definition,
      projection: module.projection
    })),
    fixtures: modules.map((module) => module.fixture)
  };
};

// The concrete runtime registry is intentionally limited to ontology-store
// modules backed by generated IRIs and pinned TTL/codegen drift tests.
export const ExpertRuntimeModule = defineEntityRuntimeModule({
  definition: ExpertEntity,
  projection: ExpertUnifiedProjection,
  fixture: ExpertProjectionFixture
});
export const OrganizationRuntimeModule = defineEntityRuntimeModule({
  definition: OrganizationEntity,
  projection: OrganizationUnifiedProjection,
  fixture: OrganizationProjectionFixture
});

export const ENTITY_RUNTIME_CATALOG = defineEntityRuntimeCatalog([
  ExpertRuntimeModule,
  OrganizationRuntimeModule
] as const);

export const ENTITY_RUNTIME_MODULES = ENTITY_RUNTIME_CATALOG.modules;

export const ExpertProvisioning = defineEntityProvisioning(
  ExpertRuntimeModule.definition
);
export const OrganizationProvisioning = defineEntityProvisioning(
  OrganizationRuntimeModule.definition
);

export const ENTITY_PROVISIONING = ENTITY_RUNTIME_CATALOG.provisioning;

export const ENTITY_PROJECTION_SPECS =
  ENTITY_RUNTIME_CATALOG.projectionSpecs;

export const ENTITY_PROJECTION_FIXTURES =
  ENTITY_RUNTIME_CATALOG.fixtures;

const customMetadataEqual = (
  left: typeof ENTITY_SEARCH_CUSTOM_METADATA,
  right: typeof ENTITY_SEARCH_CUSTOM_METADATA
): boolean =>
  left.length === right.length &&
  left.every(
    (field, index) =>
      field.field_name === right[index]?.field_name &&
      field.data_type === right[index]?.data_type
  );

export const defineUnifiedEntitySearchProvisioning = (
  plans: ReadonlyArray<EntityProvisioningPlan>
): typeof ENTITY_SEARCH_PROVISIONING => {
  const first = plans[0];
  if (first === undefined) {
    throw new Error("At least one entity provisioning plan is required");
  }

  for (const plan of plans) {
    if (
      plan.search.binding !== first.search.binding ||
      plan.search.namespace !== first.search.namespace ||
      plan.search.instance !== first.search.instance ||
      !customMetadataEqual(
        plan.search.customMetadata,
        first.search.customMetadata
      )
    ) {
      throw new Error(
        `Entity ${plan.tag} declares a search provisioning plan that does not match the unified entity-search contract`
      );
    }
  }

  return first.search;
};
