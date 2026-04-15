/**
 * RDF annotation markers for the data-layer Schema types.
 *
 * Which annotations are projected to RDF by the ontology-store's EmitSpec
 * generator (as of milestone 1):
 *
 *  Projected to RDF:
 *  - `DcatClass` → primary class IRI (emit-spec: `primaryClassIri`)
 *  - `DcatProperty` → predicate on the forward side (emit-spec: `predicate`)
 *  - `SchemaOrgType` → additional class IRI (emit-spec: `additionalClassIris[]`)
 *  - `XsdDatatype` → literal datatype (emit-spec: `valueKind.xsdDatatype`)
 *
 *  Non-projected (annotation-only, deferred):
 *  - `SdmxConcept` — SDMX lacks a single canonical IRI namespace for its
 *    information model (Concept, SeriesKey, etc.). Minting sevocab-local
 *    URIs for these would pollute the neuro-symbolic alignment target
 *    (see project_neuro_symbolic_loop.md in user memory). The annotation
 *    stays on runtime Schemas so a future milestone can project it once
 *    the policy is locked.
 *  - `DesignDecision` — documentation-only, traces runtime types back to
 *    the design-decision registry. Has no RDF meaning.
 *
 *  Runtime-only (not EmitSpec-related):
 *  - `SkosMapping` — carried on alias relation records (see alias.ts);
 *    used by the alias emitter, not the Schema-walking generator.
 */

/** DCAT 3 class IRI — e.g., "http://www.w3.org/ns/dcat#Dataset" */
export const DcatClass = Symbol.for("skygest/dcat-class");

/** DCAT 3 property IRI — e.g., "http://www.w3.org/ns/dcat#distribution" */
export const DcatProperty = Symbol.for("skygest/dcat-property");

/** SKOS mapping property IRI — e.g., "http://www.w3.org/2004/02/skos/core#exactMatch" */
export const SkosMapping = Symbol.for("skygest/skos-mapping");

/** schema.org type IRI for the export codec target — e.g., "https://schema.org/Dataset" */
export const SchemaOrgType = Symbol.for("skygest/schema-org-type");

/**
 * SDMX information model concept — e.g., "SeriesKey", "Observation",
 * "ConceptScheme".
 *
 * **Non-projected** in milestone 1. See the header comment above for
 * rationale. Annotation stays on Schemas so a future milestone can
 * decide the SDMX IRI namespace policy once and apply it here.
 */
export const SdmxConcept = Symbol.for("skygest/sdmx-concept");

/**
 * Design decision reference — e.g., "D1", "D5", "D12".
 *
 * **Documentation-only** — never projected to RDF. Used to trace runtime
 * types back to the design-decision registry that authored them.
 */
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
