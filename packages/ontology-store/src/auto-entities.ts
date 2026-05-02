/**
 * Auto-generated runtime modules for the structural ontology types.
 *
 * Every entity declared here is a thin wrapper around its codegen schema +
 * IRI brand. The hand-written entities (Expert, Organization, Post) live in
 * `agent/expert.ts`, `agent/organization.ts`, and `content/post.ts` and
 * carry richer renders + RDF mappings. Auto-entities here cover the
 * structural types referenced by the predicate registry and the rest of
 * the energy-intel ontology — they exist so the data model is reachable
 * end-to-end (snapshot, edge, projection) the moment ingest produces them.
 *
 * Add a new auto-entity by appending a single defineAutoRuntimeModule
 * call below and adding the export to ENTITY_RUNTIME_CATALOG in
 * Provisioning.ts.
 */

import { defineAutoRuntimeModule } from "./Domain/AutoEntity";
import {
  DataProviderRole,
  DataProviderRoleIri,
  EnergyExpertRole,
  EnergyExpertRoleIri,
  PublisherRole,
  PublisherRoleIri
} from "./generated/agent";
import {
  CanonicalMeasurementClaim,
  CanonicalMeasurementClaimIri,
  ClaimTemporalWindow,
  ClaimTemporalWindowIri,
  Observation,
  ObservationIri,
  Series,
  SeriesIri,
  Variable,
  VariableIri
} from "./generated/measurement";
import {
  Chart,
  ChartIri,
  Conversation,
  ConversationIri,
  EvidenceSource,
  EvidenceSourceIri,
  Excerpt,
  ExcerptIri,
  GenericImageAttachment,
  GenericImageAttachmentIri,
  MediaAttachment,
  MediaAttachmentIri,
  PodcastEpisode,
  PodcastEpisodeIri,
  PodcastSegment,
  PodcastSegmentIri,
  Screenshot,
  ScreenshotIri,
  SocialThread,
  SocialThreadIri
} from "./generated/media";
import { EI } from "./iris";

// ---------------------------------------------------------------------------
// Roles (BFO realizable_entity types that an Agent can bear)
// ---------------------------------------------------------------------------

export const EnergyExpertRoleRuntimeModule = defineAutoRuntimeModule({
  tag: "EnergyExpertRole" as const,
  schema: EnergyExpertRole,
  iri: EnergyExpertRoleIri,
  classIri: EI.EnergyExpertRole.value,
  description: "A research / journalism / operations role borne by an Expert."
});

export const PublisherRoleRuntimeModule = defineAutoRuntimeModule({
  tag: "PublisherRole" as const,
  schema: PublisherRole,
  iri: PublisherRoleIri,
  classIri: EI.PublisherRole.value,
  description: "A publication role borne by an Organization (publisher of articles)."
});

export const DataProviderRoleRuntimeModule = defineAutoRuntimeModule({
  tag: "DataProviderRole" as const,
  schema: DataProviderRole,
  iri: DataProviderRoleIri,
  classIri: EI.DataProviderRole.value,
  description: "A data-provider role borne by an Organization (publishes Datasets / Series)."
});

// ---------------------------------------------------------------------------
// Media: documents, attachments, threads, evidence sources
// ---------------------------------------------------------------------------

export const ConversationRuntimeModule = defineAutoRuntimeModule({
  tag: "Conversation" as const,
  schema: Conversation,
  iri: ConversationIri,
  classIri: EI.Conversation.value,
  description: "Abstract parent of multi-turn communicative artefacts (threads, podcasts)."
});

export const SocialThreadRuntimeModule = defineAutoRuntimeModule({
  tag: "SocialThread" as const,
  schema: SocialThread,
  iri: SocialThreadIri,
  classIri: EI.SocialThread.value,
  description: "A reply / quote / repost graph on a social platform (a directed sequence of Posts)."
});

export const PodcastEpisodeRuntimeModule = defineAutoRuntimeModule({
  tag: "PodcastEpisode" as const,
  schema: PodcastEpisode,
  iri: PodcastEpisodeIri,
  classIri: EI.PodcastEpisode.value,
  description: "A discrete podcast episode — both an iao:Document and a Conversation."
});

export const PodcastSegmentRuntimeModule = defineAutoRuntimeModule({
  tag: "PodcastSegment" as const,
  schema: PodcastSegment,
  iri: PodcastSegmentIri,
  classIri: EI.PodcastSegment.value,
  description: "A bounded temporal span of a PodcastEpisode that may evidence a CMC."
});

export const MediaAttachmentRuntimeModule = defineAutoRuntimeModule({
  tag: "MediaAttachment" as const,
  schema: MediaAttachment,
  iri: MediaAttachmentIri,
  classIri: EI.MediaAttachment.value,
  description: "Abstract parent of image / text artefacts attached to a Post."
});

export const ScreenshotRuntimeModule = defineAutoRuntimeModule({
  tag: "Screenshot" as const,
  schema: Screenshot,
  iri: ScreenshotIri,
  classIri: EI.Screenshot.value,
  description: "A raster capture of a displayed document, UI, or data table."
});

export const ChartRuntimeModule = defineAutoRuntimeModule({
  tag: "Chart" as const,
  schema: Chart,
  iri: ChartIri,
  classIri: EI.Chart.value,
  description: "A data-visualisation image attached to a Post."
});

export const GenericImageAttachmentRuntimeModule = defineAutoRuntimeModule({
  tag: "GenericImageAttachment" as const,
  schema: GenericImageAttachment,
  iri: GenericImageAttachmentIri,
  classIri: EI.GenericImageAttachment.value,
  description: "Catch-all image attachment not classifiable as Chart or Screenshot."
});

export const ExcerptRuntimeModule = defineAutoRuntimeModule({
  tag: "Excerpt" as const,
  schema: Excerpt,
  iri: ExcerptIri,
  classIri: EI.Excerpt.value,
  description: "A text excerpt (quote / paragraph / table cell) embedded in or attached to a Post."
});

export const EvidenceSourceRuntimeModule = defineAutoRuntimeModule({
  tag: "EvidenceSource" as const,
  schema: EvidenceSource,
  iri: EvidenceSourceIri,
  classIri: EI.EvidenceSource.value,
  description: "Abstract parent of any artefact that can stand as evidence for a CanonicalMeasurementClaim."
});

// ---------------------------------------------------------------------------
// Measurement: variables, series, observations, claims
// ---------------------------------------------------------------------------

export const VariableRuntimeModule = defineAutoRuntimeModule({
  tag: "Variable" as const,
  schema: Variable,
  iri: VariableIri,
  classIri: EI.Variable.value,
  description: "A measurable energy quantity (e.g., 'installed solar PV capacity, US, monthly')."
});

export const SeriesRuntimeModule = defineAutoRuntimeModule({
  tag: "Series" as const,
  schema: Series,
  iri: SeriesIri,
  classIri: EI.Series.value,
  description: "A time-indexed sequence of Observations implementing a Variable."
});

export const ObservationRuntimeModule = defineAutoRuntimeModule({
  tag: "Observation" as const,
  schema: Observation,
  iri: ObservationIri,
  classIri: EI.Observation.value,
  description: "A single time-indexed numeric reading belonging to a Series."
});

export const ClaimTemporalWindowRuntimeModule = defineAutoRuntimeModule({
  tag: "ClaimTemporalWindow" as const,
  schema: ClaimTemporalWindow,
  iri: ClaimTemporalWindowIri,
  classIri: EI.ClaimTemporalWindow.value,
  description: "The temporal region a CanonicalMeasurementClaim refers to (year, month range, exact timestamp)."
});

export const CanonicalMeasurementClaimRuntimeModule = defineAutoRuntimeModule({
  tag: "CanonicalMeasurementClaim" as const,
  schema: CanonicalMeasurementClaim,
  iri: CanonicalMeasurementClaimIri,
  classIri: EI.CanonicalMeasurementClaim.value,
  description: "A numeric / categorical claim about an energy variable extracted from a Post or PodcastSegment, with source evidence and asserted value / unit / time."
});

// ---------------------------------------------------------------------------
// Bundle for Provisioning.ts to fold into ENTITY_RUNTIME_CATALOG.
// ---------------------------------------------------------------------------

export const AUTO_RUNTIME_MODULES = [
  EnergyExpertRoleRuntimeModule,
  PublisherRoleRuntimeModule,
  DataProviderRoleRuntimeModule,
  ConversationRuntimeModule,
  SocialThreadRuntimeModule,
  PodcastEpisodeRuntimeModule,
  PodcastSegmentRuntimeModule,
  MediaAttachmentRuntimeModule,
  ScreenshotRuntimeModule,
  ChartRuntimeModule,
  GenericImageAttachmentRuntimeModule,
  ExcerptRuntimeModule,
  EvidenceSourceRuntimeModule,
  VariableRuntimeModule,
  SeriesRuntimeModule,
  ObservationRuntimeModule,
  ClaimTemporalWindowRuntimeModule,
  CanonicalMeasurementClaimRuntimeModule
] as const;
