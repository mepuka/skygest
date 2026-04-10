import { Schema } from "effect";
import { DesignDecision } from "./annotations";

const makeEntityId = <B extends string>(
  entityKind: string,
  prefix: string,
  brand: B
) => {
  const pattern = new RegExp(
    `^https://id\\.skygest\\.io/${entityKind}/${prefix}_[A-Za-z0-9]{10,}$`
  );
  return Schema.String.pipe(
    Schema.check(Schema.isPattern(pattern)),
    Schema.brand(brand)
  ).annotate({
    description: `Canonical Skygest ${entityKind} URI — https://id.skygest.io/${entityKind}/${prefix}_<ULID>`,
    [DesignDecision]: "D3"
  });
};

const decodeEntityIdSync = <A>(schema: Schema.Decoder<unknown>) =>
  Schema.decodeUnknownSync(schema) as (input: unknown) => A;

export const VariableId = makeEntityId("variable", "var", "VariableId");
export type VariableId = Schema.Schema.Type<typeof VariableId>;

export const SeriesId = makeEntityId("series", "ser", "SeriesId");
export type SeriesId = Schema.Schema.Type<typeof SeriesId>;

export const ObservationId = makeEntityId("observation", "obs", "ObservationId");
export type ObservationId = Schema.Schema.Type<typeof ObservationId>;

export const AgentId = makeEntityId("agent", "ag", "AgentId");
export type AgentId = Schema.Schema.Type<typeof AgentId>;

export const CatalogId = makeEntityId("catalog", "cat", "CatalogId");
export type CatalogId = Schema.Schema.Type<typeof CatalogId>;

export const CatalogRecordId = makeEntityId("catalog-record", "cr", "CatalogRecordId");
export type CatalogRecordId = Schema.Schema.Type<typeof CatalogRecordId>;
export const makeCatalogRecordId =
  decodeEntityIdSync<CatalogRecordId>(CatalogRecordId);

export const DatasetId = makeEntityId("dataset", "ds", "DatasetId");
export type DatasetId = Schema.Schema.Type<typeof DatasetId>;
export const makeDatasetId = decodeEntityIdSync<DatasetId>(DatasetId);

export const DistributionId = makeEntityId("distribution", "dist", "DistributionId");
export type DistributionId = Schema.Schema.Type<typeof DistributionId>;
export const makeDistributionId =
  decodeEntityIdSync<DistributionId>(DistributionId);

export const DataServiceId = makeEntityId("data-service", "svc", "DataServiceId");
export type DataServiceId = Schema.Schema.Type<typeof DataServiceId>;

export const DatasetSeriesId = makeEntityId("dataset-series", "dser", "DatasetSeriesId");
export type DatasetSeriesId = Schema.Schema.Type<typeof DatasetSeriesId>;

export const CandidateId = makeEntityId("candidate", "cand", "CandidateId");
export type CandidateId = Schema.Schema.Type<typeof CandidateId>;
