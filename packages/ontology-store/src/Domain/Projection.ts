import { Effect, Schema } from "effect";

export const ENTITY_METADATA_FIELDS = [
  { field_name: "entity_type", data_type: "text" },
  { field_name: "iri", data_type: "text" },
  { field_name: "topic", data_type: "text" },
  { field_name: "authority", data_type: "text" },
  { field_name: "time_bucket", data_type: "text" }
] as const satisfies ReadonlyArray<{
  readonly field_name: string;
  readonly data_type: "text" | "number" | "boolean" | "datetime";
}>;

export const UNIFIED_METADATA_KEYS = ENTITY_METADATA_FIELDS.map(
  (field) => field.field_name
) as ReadonlyArray<EntityMetadataKey>;

export type EntityMetadataKey =
  (typeof ENTITY_METADATA_FIELDS)[number]["field_name"];
export type EntityMetadata = Readonly<Record<EntityMetadataKey, string>>;

export class ProjectionWriteError extends Schema.TaggedErrorClass<ProjectionWriteError>()(
  "ProjectionWriteError",
  {
    op: Schema.String,
    cause: Schema.Unknown
  }
) {}

export class ProjectionMetadataDriftError extends Schema.TaggedErrorClass<ProjectionMetadataDriftError>()(
  "ProjectionMetadataDriftError",
  {
    entityType: Schema.String,
    fields: Schema.Array(Schema.String)
  }
) {}

export interface ProjectionContract<
  Self extends Schema.Top,
  Meta extends Readonly<Record<string, string | number | boolean>>,
  Key extends string = string
> {
  readonly entityType: string;
  readonly toKey: (entity: Schema.Schema.Type<Self>) => Key;
  readonly toBody: (entity: Schema.Schema.Type<Self>) => string;
  readonly toMetadata: (entity: Schema.Schema.Type<Self>) => Meta;
  readonly previousKeys?: (
    entity: Schema.Schema.Type<Self>
  ) => ReadonlyArray<Key>;
}

export interface ProjectionAdapter<
  Self extends Schema.Top,
  Meta extends Readonly<Record<string, string | number | boolean>>
> {
  readonly upsert: (
    entity: Schema.Schema.Type<Self>
  ) => Effect.Effect<void, ProjectionWriteError>;
  readonly delete: (iri: string) => Effect.Effect<void, ProjectionWriteError>;
  readonly rename: (
    entity: Schema.Schema.Type<Self>
  ) => Effect.Effect<void, ProjectionWriteError>;
}

export interface ProjectionFixture<Self extends Schema.Top> {
  readonly entityType: string;
  readonly fixture: Schema.Schema.Type<Self>;
  readonly projection: ProjectionContract<Self, EntityMetadata>;
}

export const assertNoMetadataDrift = (
  fixtures: ReadonlyArray<ProjectionFixture<any>>
): Effect.Effect<void, ProjectionMetadataDriftError> =>
  Effect.gen(function* () {
    const declared = new Set<string>(
      ENTITY_METADATA_FIELDS.map((field) => field.field_name)
    );
    for (const fixture of fixtures) {
      const sample = fixture.projection.toMetadata(fixture.fixture);
      const drift = Object.keys(sample).filter((key) => !declared.has(key));
      if (drift.length > 0) {
        yield* new ProjectionMetadataDriftError({
          entityType: fixture.entityType,
          fields: drift
        });
      }
    }
  });
