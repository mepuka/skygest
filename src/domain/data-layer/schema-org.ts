/**
 * schema.org JSON-LD export codecs (D6).
 * Unidirectional: internal Effect Schema types -> schema.org JSON-LD.
 * Lossy by design -- see code comments for what each codec drops.
 *
 * Lossiness summary:
 * - Seven-facet Variable composition -> flattened to name/description
 * - SKOS alias relations beyond sameAs -> all emitted as sameAs regardless of strength
 * - CatalogRecord-vs-Dataset distinction -> no CatalogRecord in schema.org
 * - DataService as first-class entity -> emitted as Dataset (no DataService in schema.org)
 * - DatasetSeries -> emitted as Dataset (no DatasetSeries in schema.org)
 * - Series -> emitted as Dataset with variableMeasured (Series identity lost)
 * - StatisticalVariable and Observation are pending schema.org types, not yet core
 */

import type { Variable, Series, Observation } from "./variable";
import type { Agent, Dataset, Distribution, DataService, DatasetSeries } from "./catalog";
import type { ExternalIdentifier } from "./alias";

type JsonLd = Record<string, unknown>;

const collectSameAs = (aliases: ReadonlyArray<ExternalIdentifier>): string[] | undefined => {
  const uris = aliases.flatMap((a) => a.uri != null ? [a.uri] : []);
  return uris.length > 0 ? uris : undefined;
};

/**
 * Variable -> schema:StatisticalVariable (pending).
 *
 * Drops: seven-facet composition (domainObject, technologyOrFuel, policyInstrument,
 * aggregation, unitFamily), alias relation strengths. All alias URIs
 * become sameAs regardless of SKOS relation type.
 */
export const variableToSchemaOrg = (v: Variable): JsonLd => ({
  "@context": "https://schema.org",
  "@type": "StatisticalVariable",
  "@id": v.id,
  name: v.label,
  ...(v.definition != null && { description: v.definition }),
  ...(v.measuredProperty != null && { measuredProperty: v.measuredProperty }),
  ...(v.statisticType != null && { statType: v.statisticType }),
  ...(collectSameAs(v.aliases) != null && { sameAs: collectSameAs(v.aliases) })
});

/**
 * Series -> schema:Dataset with variableMeasured.
 *
 * Drops: Series identity (no schema.org Series type), fixedDims beyond
 * place (sector, market, frequency, extra are lost), alias relation
 * strengths. spatialCoverage emitted only when fixedDims.place exists.
 */
export const seriesToSchemaOrg = (s: Series): JsonLd => ({
  "@context": "https://schema.org",
  "@type": "Dataset",
  "@id": s.id,
  name: s.label,
  variableMeasured: { "@id": s.variableId },
  ...(s.fixedDims.place != null && {
    spatialCoverage: { "@type": "Place", name: s.fixedDims.place }
  }),
  ...(collectSameAs(s.aliases) != null && { sameAs: collectSameAs(s.aliases) })
});

/**
 * Observation -> schema:Observation (pending).
 *
 * Drops: seriesId (no way to reference parent series), sourceDistributionId
 * (no provenance chain in schema.org), qualification, time.end (only
 * time.start is emitted as observationDate).
 */
export const observationToSchemaOrg = (o: Observation): JsonLd => ({
  "@context": "https://schema.org",
  "@type": "Observation",
  "@id": o.id,
  observationDate: o.time.start,
  value: o.value,
  unitCode: o.unit
});

/**
 * Agent -> schema:Organization or schema:Person.
 *
 * Maps "person" kind to Person; all other kinds (organization, consortium,
 * program, other) map to Organization. Drops: parentAgentId (no parent
 * relation in flat output), alias relation strengths, expert tier/ranking.
 */
export const agentToSchemaOrg = (a: Agent): JsonLd => ({
  "@context": "https://schema.org",
  "@type": a.kind === "person" ? "Person" : "Organization",
  "@id": a.id,
  name: a.name,
  ...(a.homepage != null && { url: a.homepage }),
  ...(a.alternateNames != null && a.alternateNames.length > 0 && {
    alternateName: a.alternateNames
  }),
  ...(collectSameAs(a.aliases) != null && { sameAs: collectSameAs(a.aliases) })
});

/**
 * Dataset -> schema:Dataset.
 *
 * Closest 1:1 mapping. Drops: accessRights, themes, distributionIds,
 * dataServiceIds, inSeries, alias relation strengths. landingPage becomes
 * url. creatorAgentId is emitted as a linked creator reference.
 * wasDerivedFrom is emitted as isBasedOn. keywords preserved as-is.
 */
export const datasetToSchemaOrg = (d: Dataset): JsonLd => ({
  "@context": "https://schema.org",
  "@type": "Dataset",
  "@id": d.id,
  name: d.title,
  ...(d.description != null && { description: d.description }),
  ...(d.creatorAgentId != null && { creator: { "@id": d.creatorAgentId } }),
  ...(d.wasDerivedFrom != null &&
    d.wasDerivedFrom.length > 0 && {
      isBasedOn:
        d.wasDerivedFrom.length === 1
          ? { "@id": d.wasDerivedFrom[0] }
          : d.wasDerivedFrom.map((uri) => ({ "@id": uri }))
    }),
  ...(d.landingPage != null && { url: d.landingPage }),
  ...(d.license != null && { license: d.license }),
  ...(d.keywords != null && d.keywords.length > 0 && { keywords: d.keywords }),
  ...(collectSameAs(d.aliases) != null && { sameAs: collectSameAs(d.aliases) })
});

/**
 * Distribution -> schema:DataDownload.
 *
 * Drops: kind, datasetId, byteSize, checksum, accessRights, license,
 * accessServiceId, alias relation strengths. accessURL or downloadURL
 * becomes contentUrl (downloadURL preferred). mediaType becomes
 * encodingFormat; format becomes fileFormat.
 */
export const distributionToSchemaOrg = (dist: Distribution): JsonLd => ({
  "@context": "https://schema.org",
  "@type": "DataDownload",
  "@id": dist.id,
  ...(dist.title != null && { name: dist.title }),
  ...((dist.downloadURL ?? dist.accessURL) != null && {
    contentUrl: dist.downloadURL ?? dist.accessURL
  }),
  ...(dist.mediaType != null && { encodingFormat: dist.mediaType }),
  ...(dist.format != null && { fileFormat: dist.format }),
  ...(collectSameAs(dist.aliases) != null && { sameAs: collectSameAs(dist.aliases) })
});

/**
 * DataService -> schema:Dataset (lossy).
 *
 * schema.org has no DataService type. Emitted as Dataset with url from
 * first endpointURL. Drops: all endpointURLs beyond the first,
 * endpointDescription, conformsTo, servesDatasetIds, accessRights,
 * license, alias relation strengths. The entire service-vs-dataset
 * distinction is lost.
 */
export const dataServiceToSchemaOrg = (svc: DataService): JsonLd => ({
  "@context": "https://schema.org",
  "@type": "Dataset",
  "@id": svc.id,
  name: svc.title,
  ...(svc.description != null && { description: svc.description }),
  ...(svc.endpointURLs.length > 0 && { url: svc.endpointURLs[0] }),
  ...(collectSameAs(svc.aliases) != null && { sameAs: collectSameAs(svc.aliases) })
});

/**
 * DatasetSeries -> schema:Dataset (lossy).
 *
 * schema.org has no DatasetSeries type. Emitted as Dataset. Drops:
 * cadence (no temporal resolution in schema.org), publisherAgentId,
 * alias relation strengths. The series-of-datasets grouping semantics
 * are lost.
 */
export const datasetSeriesToSchemaOrg = (dser: DatasetSeries): JsonLd => ({
  "@context": "https://schema.org",
  "@type": "Dataset",
  "@id": dser.id,
  name: dser.title,
  ...(dser.description != null && { description: dser.description }),
  ...(collectSameAs(dser.aliases) != null && { sameAs: collectSameAs(dser.aliases) })
});
