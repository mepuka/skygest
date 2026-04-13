import { Schema } from "effect";
import { FlexibleNumber } from "../bi";
import { Did, PostUri } from "../types";
import { AliasScheme } from "./alias";
import { AssertedTime, ResolutionState } from "./candidate";
import {
  AgentId,
  CatalogId,
  CatalogRecordId,
  DataServiceId,
  DatasetId,
  DatasetSeriesId,
  DistributionId,
  SeriesId,
  VariableId
} from "./ids";
import { DateLike } from "./base";
import { DataLayerRegistryEntity } from "./registry";

export const DataLayerRegistryCanonicalUri = Schema.Union([
  AgentId,
  CatalogId,
  CatalogRecordId,
  DataServiceId,
  DatasetId,
  DatasetSeriesId,
  DistributionId,
  SeriesId,
  VariableId
]).annotate({
  description:
    "Canonical Skygest URI for a registry entity, e.g. https://id.skygest.io/variable/var_<ULID>"
});
export type DataLayerRegistryCanonicalUri = Schema.Schema.Type<
  typeof DataLayerRegistryCanonicalUri
>;

export const ResolveDataRefAlias = Schema.Struct({
  scheme: AliasScheme,
  value: Schema.String.pipe(Schema.check(Schema.isMinLength(1)))
}).annotate({
  description: "External alias pair used for exact data-layer lookup"
});
export type ResolveDataRefAlias = Schema.Schema.Type<typeof ResolveDataRefAlias>;

export const ResolveDataRefInput = Schema.Union([
  Schema.Struct({
    canonicalUri: DataLayerRegistryCanonicalUri
  }),
  Schema.Struct({
    alias: ResolveDataRefAlias
  })
]).annotate({
  description:
    "Single-argument exact lookup. Provide either a canonical Skygest URI or an external alias pair."
});
export type ResolveDataRefInput = Schema.Schema.Type<typeof ResolveDataRefInput>;

export const ResolveDataRefOutput = Schema.Struct({
  entity: Schema.NullOr(DataLayerRegistryEntity)
}).annotate({
  description:
    "Exact registry lookup result. Returns the matching registry entity, or null when no exact match exists."
});
export type ResolveDataRefOutput = Schema.Schema.Type<typeof ResolveDataRefOutput>;

export const DataRefEntityId = Schema.Union([
  AgentId,
  DatasetId,
  DistributionId,
  SeriesId,
  VariableId
]).annotate({
  description:
    "Data-layer entity URI accepted by reverse lookup (Agent, Dataset, Distribution, Series, or Variable)."
});
export type DataRefEntityId = Schema.Schema.Type<typeof DataRefEntityId>;

export const FindCandidatesByDataRefCursor = Schema.Struct({
  hasObservationTime: Schema.Boolean,
  observationSortKey: Schema.String,
  sourcePostUri: PostUri,
  rowId: Schema.Number.pipe(Schema.check(Schema.isInt()))
}).annotate({
  description: "Opaque cursor payload for stable reverse-lookup pagination"
});
export type FindCandidatesByDataRefCursor = Schema.Schema.Type<
  typeof FindCandidatesByDataRefCursor
>;

export const FindCandidatesByDataRefInput = Schema.Struct({
  entityId: DataRefEntityId,
  observedSince: Schema.optionalKey(
    DateLike.annotate({
      description:
        "Only include claims whose observation window ends on or after this date-like value (YYYY, YYYY-MM, YYYY-MM-DD, or ISO 8601)."
    })
  ),
  observedUntil: Schema.optionalKey(
    DateLike.annotate({
      description:
        "Only include claims whose observation window starts on or before this date-like value (YYYY, YYYY-MM, YYYY-MM-DD, or ISO 8601)."
    })
  ),
  cursor: Schema.optionalKey(FindCandidatesByDataRefCursor),
  limit: Schema.optionalKey(
    FlexibleNumber.pipe(
      Schema.check(Schema.isInt()),
      Schema.check(Schema.isGreaterThanOrEqualTo(1))
    ).annotate({
      description: "Maximum number of rows to return"
    })
  )
}).annotate({
  description:
    "Reverse lookup for stored candidate citations referencing one data-layer entity."
});
export type FindCandidatesByDataRefInput = Schema.Schema.Type<
  typeof FindCandidatesByDataRefInput
>;

export const FindCandidatesByDataRefExpert = Schema.Struct({
  did: Did,
  handle: Schema.NullOr(Schema.String),
  displayName: Schema.NullOr(Schema.String)
});
export type FindCandidatesByDataRefExpert = Schema.Schema.Type<
  typeof FindCandidatesByDataRefExpert
>;

export const FindCandidatesByDataRefHit = Schema.Struct({
  sourcePostUri: PostUri,
  expert: FindCandidatesByDataRefExpert,
  resolutionState: ResolutionState,
  assertedValue: Schema.NullOr(Schema.Union([Schema.Number, Schema.String])),
  assertedUnit: Schema.NullOr(Schema.String),
  observationTime: Schema.NullOr(AssertedTime)
}).annotate({
  description:
    "One stored citation row referencing the requested data-layer entity."
});
export type FindCandidatesByDataRefHit = Schema.Schema.Type<
  typeof FindCandidatesByDataRefHit
>;

export const FindCandidatesByDataRefOutput = Schema.Struct({
  items: Schema.Array(FindCandidatesByDataRefHit),
  nextCursor: Schema.NullOr(FindCandidatesByDataRefCursor)
}).annotate({
  description:
    "Paged reverse-lookup results over stored candidate citations for one data-layer entity."
});
export type FindCandidatesByDataRefOutput = Schema.Schema.Type<
  typeof FindCandidatesByDataRefOutput
>;
