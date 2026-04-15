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

/**
 * XSD datatype marker for String-valued filters that carry a specific RDF
 * literal datatype. Emitted by the ontology-store's EmitSpec generator into
 * `ValueKind.Literal.xsdDatatype` so forward mapping can attach the right
 * `xsd:*` datatype URI and SHACL shapes can validate with `sh:datatype`.
 *
 * Current users: `DateLike` (`xsd:date`), `IsoTimestamp` (`xsd:dateTime`) —
 * both annotated on their base filter in src/domain/types.ts. Other string
 * / number / boolean types fall through to the generator's default
 * classification.
 */
export const XsdDatatype = Symbol.for("skygest/xsd-datatype");
