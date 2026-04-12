import { Schema } from "effect";
import { DcatClass, DcatProperty, DesignDecision, SchemaOrgType } from "./annotations";
import { DateLike, TimestampedAliasedFields, WebUrl } from "./base";
import {
  AgentId,
  CatalogId,
  CatalogRecordId,
  DataServiceId,
  DatasetId,
  DatasetSeriesId,
  DistributionId,
  VariableId
} from "./ids";

// ---------------------------------------------------------------------------
// Shared enums
// ---------------------------------------------------------------------------

export const AgentKind = Schema.Literals([
  "organization", "person", "consortium", "program", "other"
]).annotate({ description: "Kind of agent (FOAF-aligned)" });
export type AgentKind = Schema.Schema.Type<typeof AgentKind>;

export const DistributionKind = Schema.Literals([
  "download", "api-access", "landing-page", "interactive-web-app",
  "documentation", "archive", "other"
]).annotate({ description: "Kind of distribution access" });
export type DistributionKind = Schema.Schema.Type<typeof DistributionKind>;

export const AccessRights = Schema.Literals([
  "public", "restricted", "nonPublic", "unknown"
]).annotate({ description: "Access rights classification" });
export type AccessRights = Schema.Schema.Type<typeof AccessRights>;

export const Cadence = Schema.Literals([
  "annual", "quarterly", "monthly", "weekly", "daily", "irregular"
]).annotate({ description: "Publication cadence for dataset series" });
export type Cadence = Schema.Schema.Type<typeof Cadence>;

// ---------------------------------------------------------------------------
// Agent
// ---------------------------------------------------------------------------

export const Agent = Schema.Struct({
  _tag: Schema.Literal("Agent"),
  id: AgentId,
  kind: AgentKind,
  name: Schema.String.annotate({
    [DcatProperty]: "http://xmlns.com/foaf/0.1/name"
  }),
  alternateNames: Schema.optionalKey(Schema.Array(Schema.String)),
  homepage: Schema.optionalKey(WebUrl.annotate({
    [DcatProperty]: "http://xmlns.com/foaf/0.1/homepage"
  })),
  parentAgentId: Schema.optionalKey(AgentId),
  ...TimestampedAliasedFields
}).annotate({
  description: "Agent responsible for publishing or curating resources (D5)",
  [DcatClass]: "http://xmlns.com/foaf/0.1/Agent",
  [DesignDecision]: "D5"
});
export type Agent = Schema.Schema.Type<typeof Agent>;

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

export const Catalog = Schema.Struct({
  _tag: Schema.Literal("Catalog"),
  id: CatalogId,
  title: Schema.String.annotate({
    [DcatProperty]: "http://purl.org/dc/terms/title"
  }),
  description: Schema.optionalKey(Schema.String.annotate({
    [DcatProperty]: "http://purl.org/dc/terms/description"
  })),
  publisherAgentId: AgentId.annotate({
    [DcatProperty]: "http://purl.org/dc/terms/publisher"
  }),
  homepage: Schema.optionalKey(WebUrl.annotate({
    [DcatProperty]: "http://xmlns.com/foaf/0.1/homepage"
  })),
  ...TimestampedAliasedFields
}).annotate({
  description: "Curated collection of metadata about resources (D5)",
  [DcatClass]: "http://www.w3.org/ns/dcat#Catalog",
  [DesignDecision]: "D5"
});
export type Catalog = Schema.Schema.Type<typeof Catalog>;

// ---------------------------------------------------------------------------
// CatalogRecord — NO TimestampedAliasedFields, NO aliases
// ---------------------------------------------------------------------------

const DATASET_ID_PATTERN = /^https:\/\/id\.skygest\.io\/dataset\/ds_[A-Za-z0-9]{10,}$/;
const DATA_SERVICE_ID_PATTERN = /^https:\/\/id\.skygest\.io\/data-service\/svc_[A-Za-z0-9]{10,}$/;

const validatePrimaryTopicId = (record: {
  readonly primaryTopicType: "dataset" | "dataService";
  readonly primaryTopicId: string;
}) => {
  const pattern = record.primaryTopicType === "dataset" ? DATASET_ID_PATTERN : DATA_SERVICE_ID_PATTERN;
  return pattern.test(record.primaryTopicId)
    ? undefined
    : `primaryTopicId must be a valid ${record.primaryTopicType === "dataset" ? "DatasetId" : "DataServiceId"} URI for primaryTopicType "${record.primaryTopicType}"`;
};

export const CatalogRecord = Schema.Struct({
  _tag: Schema.Literal("CatalogRecord"),
  id: CatalogRecordId,
  catalogId: CatalogId,
  primaryTopicType: Schema.Literals(["dataset", "dataService"]).annotate({
    [DcatProperty]: "http://xmlns.com/foaf/0.1/primaryTopic"
  }),
  primaryTopicId: Schema.String.annotate({
    description: "Must match the entity kind indicated by primaryTopicType (DatasetId or DataServiceId)"
  }),
  sourceRecordId: Schema.optionalKey(Schema.String),
  harvestedFrom: Schema.optionalKey(Schema.String),
  firstSeen: Schema.optionalKey(DateLike.annotate({
    [DcatProperty]: "http://purl.org/dc/terms/issued"
  })),
  lastSeen: Schema.optionalKey(DateLike.annotate({
    [DcatProperty]: "http://purl.org/dc/terms/modified"
  })),
  sourceModified: Schema.optionalKey(DateLike),
  isAuthoritative: Schema.optionalKey(Schema.Boolean),
  duplicateOf: Schema.optionalKey(CatalogRecordId)
}).annotate({
  description: "Catalog's view of a resource — carries only catalog-tracking dates, not Skygest-managed timestamps (D5). primaryTopicId is validated against primaryTopicType.",
  [DcatClass]: "http://www.w3.org/ns/dcat#CatalogRecord",
  [DesignDecision]: "D5"
}).pipe(
  Schema.check(Schema.makeFilter(validatePrimaryTopicId))
);
export type CatalogRecord = Schema.Schema.Type<typeof CatalogRecord>;

// ---------------------------------------------------------------------------
// Dataset
// ---------------------------------------------------------------------------

export const Dataset = Schema.Struct({
  _tag: Schema.Literal("Dataset"),
  id: DatasetId,
  title: Schema.String.annotate({
    [DcatProperty]: "http://purl.org/dc/terms/title"
  }),
  description: Schema.optionalKey(Schema.String.annotate({
    [DcatProperty]: "http://purl.org/dc/terms/description"
  })),
  creatorAgentId: Schema.optionalKey(AgentId.annotate({
    [DcatProperty]: "http://purl.org/dc/terms/creator"
  })),
  wasDerivedFrom: Schema.optionalKey(
    Schema.Array(AgentId).annotate({
      [DcatProperty]: "http://www.w3.org/ns/prov#wasDerivedFrom"
    })
  ),
  publisherAgentId: Schema.optionalKey(AgentId.annotate({
    [DcatProperty]: "http://purl.org/dc/terms/publisher"
  })),
  landingPage: Schema.optionalKey(WebUrl.annotate({
    [DcatProperty]: "http://www.w3.org/ns/dcat#landingPage"
  })),
  accessRights: Schema.optionalKey(AccessRights),
  license: Schema.optionalKey(Schema.String.annotate({
    [DcatProperty]: "http://purl.org/dc/terms/license"
  })),
  temporal: Schema.optionalKey(Schema.String.annotate({
    [DcatProperty]: "http://purl.org/dc/terms/temporal"
  })),
  keywords: Schema.optionalKey(Schema.Array(Schema.String).annotate({
    [DcatProperty]: "http://www.w3.org/ns/dcat#keyword"
  })),
  themes: Schema.optionalKey(Schema.Array(Schema.String).annotate({
    [DcatProperty]: "http://www.w3.org/ns/dcat#theme"
  })),
  variableIds: Schema.optionalKey(Schema.Array(VariableId).annotate({
    [DcatProperty]: "https://skygest.dev/vocab/energy/hasVariable"
  })),
  distributionIds: Schema.optionalKey(Schema.Array(DistributionId).annotate({
    [DcatProperty]: "http://www.w3.org/ns/dcat#distribution"
  })),
  dataServiceIds: Schema.optionalKey(Schema.Array(DataServiceId)),
  inSeries: Schema.optionalKey(DatasetSeriesId.annotate({
    [DcatProperty]: "http://www.w3.org/ns/dcat#inSeries"
  })),
  ...TimestampedAliasedFields
}).annotate({
  description: "Collection of data published or curated by a single source (D5)",
  [DcatClass]: "http://www.w3.org/ns/dcat#Dataset",
  [SchemaOrgType]: "https://schema.org/Dataset",
  [DesignDecision]: "D5"
});
export type Dataset = Schema.Schema.Type<typeof Dataset>;

// ---------------------------------------------------------------------------
// Distribution
// ---------------------------------------------------------------------------

export const Distribution = Schema.Struct({
  _tag: Schema.Literal("Distribution"),
  id: DistributionId,
  datasetId: DatasetId,
  kind: DistributionKind,
  title: Schema.optionalKey(Schema.String.annotate({
    [DcatProperty]: "http://purl.org/dc/terms/title"
  })),
  description: Schema.optionalKey(Schema.String.annotate({
    [DcatProperty]: "http://purl.org/dc/terms/description"
  })),
  accessURL: Schema.optionalKey(WebUrl.annotate({
    [DcatProperty]: "http://www.w3.org/ns/dcat#accessURL"
  })),
  downloadURL: Schema.optionalKey(WebUrl.annotate({
    [DcatProperty]: "http://www.w3.org/ns/dcat#downloadURL"
  })),
  mediaType: Schema.optionalKey(Schema.String.annotate({
    [DcatProperty]: "http://www.w3.org/ns/dcat#mediaType"
  })),
  format: Schema.optionalKey(Schema.String.annotate({
    [DcatProperty]: "http://purl.org/dc/terms/format"
  })),
  byteSize: Schema.optionalKey(Schema.Number.annotate({
    [DcatProperty]: "http://www.w3.org/ns/dcat#byteSize"
  })),
  checksum: Schema.optionalKey(Schema.String.annotate({
    [DcatProperty]: "http://spdx.org/rdf/terms#checksum"
  })),
  accessRights: Schema.optionalKey(AccessRights),
  license: Schema.optionalKey(Schema.String.annotate({
    [DcatProperty]: "http://purl.org/dc/terms/license"
  })),
  accessServiceId: Schema.optionalKey(DataServiceId.annotate({
    [DcatProperty]: "http://www.w3.org/ns/dcat#accessService"
  })),
  ...TimestampedAliasedFields
}).annotate({
  description: "Specific representation of a dataset — download, API, or landing page (D5)",
  [DcatClass]: "http://www.w3.org/ns/dcat#Distribution",
  [SchemaOrgType]: "https://schema.org/DataDownload",
  [DesignDecision]: "D5"
});
export type Distribution = Schema.Schema.Type<typeof Distribution>;

// ---------------------------------------------------------------------------
// DataService
// ---------------------------------------------------------------------------

export const DataService = Schema.Struct({
  _tag: Schema.Literal("DataService"),
  id: DataServiceId,
  title: Schema.String.annotate({
    [DcatProperty]: "http://purl.org/dc/terms/title"
  }),
  description: Schema.optionalKey(Schema.String.annotate({
    [DcatProperty]: "http://purl.org/dc/terms/description"
  })),
  publisherAgentId: Schema.optionalKey(AgentId.annotate({
    [DcatProperty]: "http://purl.org/dc/terms/publisher"
  })),
  endpointURLs: Schema.Array(WebUrl).annotate({
    [DcatProperty]: "http://www.w3.org/ns/dcat#endpointURL"
  }),
  endpointDescription: Schema.optionalKey(WebUrl.annotate({
    [DcatProperty]: "http://www.w3.org/ns/dcat#endpointDescription"
  })),
  conformsTo: Schema.optionalKey(Schema.String.annotate({
    [DcatProperty]: "http://purl.org/dc/terms/conformsTo"
  })),
  servesDatasetIds: Schema.Array(DatasetId).annotate({
    [DcatProperty]: "http://www.w3.org/ns/dcat#servesDataset"
  }),
  accessRights: Schema.optionalKey(AccessRights),
  license: Schema.optionalKey(Schema.String.annotate({
    [DcatProperty]: "http://purl.org/dc/terms/license"
  })),
  ...TimestampedAliasedFields
}).annotate({
  description: "Site or endpoint providing operations on data or related resources (D5)",
  [DcatClass]: "http://www.w3.org/ns/dcat#DataService",
  [DesignDecision]: "D5"
});
export type DataService = Schema.Schema.Type<typeof DataService>;

// ---------------------------------------------------------------------------
// DatasetSeries
// ---------------------------------------------------------------------------

export const DatasetSeries = Schema.Struct({
  _tag: Schema.Literal("DatasetSeries"),
  id: DatasetSeriesId,
  title: Schema.String.annotate({
    [DcatProperty]: "http://purl.org/dc/terms/title"
  }),
  description: Schema.optionalKey(Schema.String.annotate({
    [DcatProperty]: "http://purl.org/dc/terms/description"
  })),
  publisherAgentId: Schema.optionalKey(AgentId.annotate({
    [DcatProperty]: "http://purl.org/dc/terms/publisher"
  })),
  cadence: Cadence.annotate({
    [DcatProperty]: "http://purl.org/dc/terms/accrualPeriodicity"
  }),
  ...TimestampedAliasedFields
}).annotate({
  description: "Collection of datasets published separately but grouped by shared characteristics (D5)",
  [DcatClass]: "http://www.w3.org/ns/dcat#DatasetSeries",
  [DesignDecision]: "D5"
});
export type DatasetSeries = Schema.Schema.Type<typeof DatasetSeries>;
