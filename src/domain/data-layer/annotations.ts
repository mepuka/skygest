/** DCAT 3 class IRI — e.g., "http://www.w3.org/ns/dcat#Dataset" */
export const DcatClass = Symbol.for("skygest/dcat-class");

/** DCAT 3 property IRI — e.g., "http://www.w3.org/ns/dcat#distribution" */
export const DcatProperty = Symbol.for("skygest/dcat-property");

/** SKOS mapping property IRI — e.g., "http://www.w3.org/2004/02/skos/core#exactMatch" */
export const SkosMapping = Symbol.for("skygest/skos-mapping");

/** schema.org type IRI for the export codec target — e.g., "https://schema.org/Dataset" */
export const SchemaOrgType = Symbol.for("skygest/schema-org-type");

/** SDMX information model concept — e.g., "SeriesKey", "Observation", "ConceptScheme" */
export const SdmxConcept = Symbol.for("skygest/sdmx-concept");

/** Design decision reference — e.g., "D1", "D5", "D12" */
export const DesignDecision = Symbol.for("skygest/design-decision");
