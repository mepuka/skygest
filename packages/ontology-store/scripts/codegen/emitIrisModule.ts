/**
 * Stage 4 of the TTL → Effect Schema codegen pipeline: produce a TS source
 * string for `packages/ontology-store/src/iris.ts` — namespace constants
 * keyed by short prefix (`EI`, `BFO`, `FOAF`, `RDF`, `RDFS`, `OWL`, `SKOS`,
 * `XSD`) whose values are `n3.NamedNode`s.
 *
 * Generated code shape (excerpt):
 *
 *   import { DataFactory } from "n3"
 *   const { namedNode } = DataFactory
 *   export const EI = {
 *     Expert: namedNode("https://w3id.org/energy-intel/Expert"),
 *     ...
 *   } as const
 *
 * Discovery rules:
 * - `EI` includes every class IRI under `https://w3id.org/energy-intel/`
 *   plus every property with that prefix.
 * - `BFO` includes every property under `http://purl.obolibrary.org/obo/BFO_`.
 *   Curated terms (see `BFO_ALIASES`) emit a friendly key (`bearerOf`,
 *   `inheresIn`); other terms fall back to their `BFO_NNNNNNN` segment so
 *   the writer can still reference them by raw ID.
 * - `FOAF` includes every property under `http://xmlns.com/foaf/0.1/` plus
 *   the always-needed `name`, `Person`, `Organization` terms.
 * - `RDF`, `RDFS`, `OWL`, `SKOS`, `XSD` use a fixed common-term set so the
 *   generated module always exports the predicates Task 9's writer needs to
 *   reference.
 *
 * Scope: pure function, returns a string. No file IO (Task 9 writes it).
 */
import type { ClassTable } from "./parseTtl.ts";

const NS_EI = "https://w3id.org/energy-intel/";
const NS_BFO = "http://purl.obolibrary.org/obo/";
const NS_FOAF = "http://xmlns.com/foaf/0.1/";
const NS_RDF = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
const NS_RDFS = "http://www.w3.org/2000/01/rdf-schema#";
const NS_OWL = "http://www.w3.org/2002/07/owl#";
const NS_SKOS = "http://www.w3.org/2004/02/skos/core#";
const NS_XSD = "http://www.w3.org/2001/XMLSchema#";

/**
 * Curated aliases for BFO terms. Generated TS source emits the mapped
 * key (`bearerOf`) instead of the raw `BFO_NNNNNNN` segment so consumers
 * read more naturally (`BFO.bearerOf` vs. `BFO.BFO_0000053`). Terms not
 * present here keep the `BFO_NNNNNNN` form as a safe fallback. Add new
 * entries as the slice ontology grows.
 */
const BFO_ALIASES: Readonly<Record<string, string>> = {
  BFO_0000023: "role",
  BFO_0000027: "objectAggregate",
  BFO_0000030: "object",
  BFO_0000052: "inheresIn",
  BFO_0000053: "bearerOf"
};

/**
 * Trailing segment of `iri` after `prefix`, or `undefined` if `iri` does not
 * begin with `prefix`. Used to bucket each class/property IRI into its
 * namespace below.
 */
const stripPrefix = (iri: string, prefix: string): string | undefined =>
  iri.startsWith(prefix) ? iri.slice(prefix.length) : undefined;

const renderEntry = (term: string, fullIri: string): string =>
  `  ${term}: namedNode("${fullIri}"),`;

const renderConst = (
  name: string,
  prefix: string,
  terms: ReadonlyMap<string, string>
): string => {
  const sortedKeys = [...terms.keys()].sort();
  const body = sortedKeys
    .map((term) => renderEntry(term, terms.get(term) ?? `${prefix}${term}`))
    .join("\n");
  return `export const ${name} = {\n${body}\n} as const;\n`;
};

export const emitIrisModule = (table: ClassTable): string => {
  // Maps from short term name to full IRI. Using a Map preserves the
  // canonical IRI for each term (e.g. for BFO_0000053 the local name is
  // already the full segment) while still letting us de-dup by short name.
  const ei = new Map<string, string>();
  const bfo = new Map<string, string>();
  const foaf = new Map<string, string>();

  for (const cls of table.classes) {
    const eiTail = stripPrefix(cls.iri, NS_EI);
    if (eiTail !== undefined) ei.set(eiTail, cls.iri);

    for (const prop of cls.properties) {
      const eiPropTail = stripPrefix(prop.iri, NS_EI);
      if (eiPropTail !== undefined) ei.set(eiPropTail, prop.iri);

      const bfoTail = stripPrefix(prop.iri, NS_BFO);
      // Only keep BFO_NNNNNNN form (skip e.g. RO_, IAO_) — the slice ontology
      // only references BFO terms, but the namespace bucket is `purl.obo`
      // shared. Filter by the conventional BFO_ prefix. Apply the curated
      // alias table when present so generated source reads `BFO.bearerOf`
      // instead of `BFO.BFO_0000053`; otherwise keep the raw segment.
      if (bfoTail !== undefined && bfoTail.startsWith("BFO_")) {
        const key = BFO_ALIASES[bfoTail] ?? bfoTail;
        bfo.set(key, prop.iri);
      }

      const foafTail = stripPrefix(prop.iri, NS_FOAF);
      if (foafTail !== undefined) foaf.set(foafTail, prop.iri);
    }

    // BFO terms in agent.ttl (and similar TTLs) only appear inside
    // owl:Restriction.onProperty references on owl:equivalentClass — they are
    // not declared as owl:ObjectProperty, so cls.properties[] never sees them.
    // Walk the restrictions to surface those IRIs as well.
    for (const restriction of cls.equivalentClassRestrictions) {
      const bfoTail = stripPrefix(restriction.onProperty, NS_BFO);
      if (bfoTail !== undefined && bfoTail.startsWith("BFO_")) {
        const key = BFO_ALIASES[bfoTail] ?? bfoTail;
        bfo.set(key, restriction.onProperty);
      }
    }
  }

  // Always-on FOAF terms the writer needs even if the slice ontology didn't
  // surface them as properties.
  for (const term of ["name", "Person", "Organization"]) {
    if (!foaf.has(term)) foaf.set(term, `${NS_FOAF}${term}`);
  }

  const lines: Array<string> = [
    "// Generated by packages/ontology-store/scripts/generate-from-ttl.ts.",
    "// Do not edit by hand.",
    "",
    `import { DataFactory } from "n3";`,
    "",
    "const { namedNode } = DataFactory;",
    ""
  ];

  lines.push(renderConst("EI", NS_EI, ei));
  lines.push(renderConst("BFO", NS_BFO, bfo));
  lines.push(renderConst("FOAF", NS_FOAF, foaf));

  // Standard namespaces ship a fixed set of common terms — Task 9's writer
  // only references these few and there's no ontology signal to grow them
  // dynamically.
  const stdRdf = new Map<string, string>([
    ["type", `${NS_RDF}type`],
    ["first", `${NS_RDF}first`],
    ["rest", `${NS_RDF}rest`],
    ["nil", `${NS_RDF}nil`]
  ]);
  const stdRdfs = new Map<string, string>([
    ["label", `${NS_RDFS}label`],
    ["subClassOf", `${NS_RDFS}subClassOf`]
  ]);
  const stdOwl = new Map<string, string>([
    ["Class", `${NS_OWL}Class`],
    ["Restriction", `${NS_OWL}Restriction`]
  ]);
  const stdSkos = new Map<string, string>([
    ["definition", `${NS_SKOS}definition`]
  ]);
  const stdXsd = new Map<string, string>([
    ["string", `${NS_XSD}string`],
    ["integer", `${NS_XSD}integer`],
    ["dateTime", `${NS_XSD}dateTime`]
  ]);

  lines.push(renderConst("RDF", NS_RDF, stdRdf));
  lines.push(renderConst("RDFS", NS_RDFS, stdRdfs));
  lines.push(renderConst("OWL", NS_OWL, stdOwl));
  lines.push(renderConst("SKOS", NS_SKOS, stdSkos));
  lines.push(renderConst("XSD", NS_XSD, stdXsd));

  return lines.join("\n");
};
