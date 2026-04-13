/**
 * AUTO-GENERATED. DO NOT EDIT.
 *
 * Source manifest: references/data-layer-spine/manifest.json
 * Manifest version: 1
 * Ontology version: 0.2.0
 * Source commit: 458c5e416c589dff1c2b6e29dc0e4e4529fb5492
 * Generated at: 2026-04-13T12:00:00.000Z
 * Input hash: sha256:54280c2f3ec10cf4f6f70602418926839486fa19c5a8d6f4162f8fd4c7fb5627
 * Generation command: bun run gen:data-layer-spine
 */

import { Schema } from "effect";
import { DcatProperty } from "../data-layer/annotations";
import { WebUrl } from "../data-layer/base";
import { AgentId, DatasetId, DatasetSeriesId, DistributionId, VariableId } from "../data-layer/ids";
import { Aggregation, StatisticType, UnitFamily } from "../data-layer/variable-enums";

export const AgentOntologyFields = {
  name: Schema.String.annotate({ [DcatProperty]: "http://xmlns.com/foaf/0.1/name" }),
  alternateNames: Schema.optionalKey(Schema.Array(Schema.String)),
  homepage: Schema.optionalKey(WebUrl.annotate({ [DcatProperty]: "http://xmlns.com/foaf/0.1/homepage" })),
} as const;

export const DatasetOntologyFields = {
  title: Schema.String.annotate({ [DcatProperty]: "http://purl.org/dc/terms/title" }),
  description: Schema.optionalKey(Schema.String.annotate({ [DcatProperty]: "http://purl.org/dc/terms/description" })),
  creatorAgentId: Schema.optionalKey(AgentId.annotate({ [DcatProperty]: "http://purl.org/dc/terms/creator" })),
  wasDerivedFrom: Schema.optionalKey(Schema.Array(AgentId).annotate({ [DcatProperty]: "http://www.w3.org/ns/prov#wasDerivedFrom" })),
  publisherAgentId: Schema.optionalKey(AgentId.annotate({ [DcatProperty]: "http://purl.org/dc/terms/publisher" })),
  landingPage: Schema.optionalKey(WebUrl.annotate({ [DcatProperty]: "http://www.w3.org/ns/dcat#landingPage" })),
  license: Schema.optionalKey(Schema.String.annotate({ [DcatProperty]: "http://purl.org/dc/terms/license" })),
  temporal: Schema.optionalKey(Schema.String.annotate({ [DcatProperty]: "http://purl.org/dc/terms/temporal" })),
  keywords: Schema.optionalKey(Schema.Array(Schema.String).annotate({ [DcatProperty]: "http://www.w3.org/ns/dcat#keyword" })),
  themes: Schema.optionalKey(Schema.Array(Schema.String).annotate({ [DcatProperty]: "http://www.w3.org/ns/dcat#theme" })),
  variableIds: Schema.optionalKey(Schema.Array(VariableId).annotate({ [DcatProperty]: "https://skygest.dev/vocab/energy/hasVariable" })),
  distributionIds: Schema.optionalKey(Schema.Array(DistributionId).annotate({ [DcatProperty]: "http://www.w3.org/ns/dcat#distribution" })),
  inSeries: Schema.optionalKey(DatasetSeriesId.annotate({ [DcatProperty]: "http://www.w3.org/ns/dcat#inSeries" })),
} as const;

export const VariableOntologyFields = {
  label: Schema.String.annotate({ [DcatProperty]: "http://www.w3.org/2000/01/rdf-schema#label" }),
  definition: Schema.optionalKey(Schema.String.annotate({ [DcatProperty]: "http://www.w3.org/2004/02/skos/core#definition" })),
  measuredProperty: Schema.optionalKey(Schema.String.annotate({ [DcatProperty]: "https://skygest.dev/vocab/energy/measuredProperty" })),
  domainObject: Schema.optionalKey(Schema.String.annotate({ [DcatProperty]: "https://skygest.dev/vocab/energy/domainObject" })),
  technologyOrFuel: Schema.optionalKey(Schema.String.annotate({ [DcatProperty]: "https://skygest.dev/vocab/energy/technologyOrFuel" })),
  statisticType: Schema.optionalKey(StatisticType.annotate({ [DcatProperty]: "https://skygest.dev/vocab/energy/statisticType" })),
  aggregation: Schema.optionalKey(Aggregation.annotate({ [DcatProperty]: "https://skygest.dev/vocab/energy/aggregation" })),
  unitFamily: Schema.optionalKey(UnitFamily.annotate({ [DcatProperty]: "https://skygest.dev/vocab/energy/unitFamily" })),
  policyInstrument: Schema.optionalKey(Schema.String.annotate({ [DcatProperty]: "https://skygest.dev/vocab/energy/policyInstrument" })),
} as const;

export const SeriesOntologyFields = {
  label: Schema.String.annotate({ [DcatProperty]: "http://www.w3.org/2000/01/rdf-schema#label" }),
  variableId: VariableId.annotate({ [DcatProperty]: "https://skygest.dev/vocab/energy/implementsVariable" }),
  datasetId: Schema.optionalKey(DatasetId.annotate({ [DcatProperty]: "https://skygest.dev/vocab/energy/publishedInDataset" })),
} as const;
