import type { DataLayerGraphEdgeKind } from "./graph";

export type DataLayerGraphOntologyDeclaration =
  | "declared"
  | "implicit-external"
  | "pending-ontology";

export type DataLayerGraphOntologyDirection =
  | "aligned"
  | "inverse"
  | "projected"
  | "none";

export type DataLayerGraphOntologyMapping = {
  readonly ontologyCurie: string | null;
  readonly ontologyIri: string | null;
  readonly declaration: DataLayerGraphOntologyDeclaration;
  readonly direction: DataLayerGraphOntologyDirection;
  readonly cardinality: string;
  readonly notes: string;
};

export const dataLayerGraphEdgeOntologyMapping = {
  publishes: {
    ontologyCurie: "dct:publisher",
    ontologyIri: "http://purl.org/dc/terms/publisher",
    declaration: "implicit-external",
    direction: "inverse",
    cardinality: "0..n",
    notes:
      "Runtime projects Agent -> Dataset/DataService/Catalog; ontology uses Dataset -> Agent."
  },
  "parent-agent": {
    ontologyCurie: null,
    ontologyIri: null,
    declaration: "pending-ontology",
    direction: "none",
    cardinality: "0..1",
    notes:
      "No ontology property is declared yet; SKY-327 should pick the backing property."
  },
  "contains-record": {
    ontologyCurie: "dcat:record",
    ontologyIri: "http://www.w3.org/ns/dcat#record",
    declaration: "implicit-external",
    direction: "aligned",
    cardinality: "0..n",
    notes: "Direct Catalog -> CatalogRecord reuse of the DCAT record relationship."
  },
  "primary-topic-of": {
    ontologyCurie: "foaf:primaryTopic",
    ontologyIri: "http://xmlns.com/foaf/0.1/primaryTopic",
    declaration: "implicit-external",
    direction: "inverse",
    cardinality: "0..n",
    notes:
      "Runtime projects Dataset/DataService -> CatalogRecord; FOAF names the inverse direction."
  },
  "has-distribution": {
    ontologyCurie: "dcat:distribution",
    ontologyIri: "http://www.w3.org/ns/dcat#distribution",
    declaration: "declared",
    direction: "aligned",
    cardinality: "0..n",
    notes: "Direct Dataset -> Distribution reuse of the imported DCAT property."
  },
  "served-by": {
    ontologyCurie: "dcat:accessService",
    ontologyIri: "http://www.w3.org/ns/dcat#accessService",
    declaration: "implicit-external",
    direction: "projected",
    cardinality: "0..n",
    notes:
      "Runtime keeps a Dataset -> DataService convenience edge; the ontology relation is external and not declared in the local imports."
  },
  "has-series-member": {
    ontologyCurie: "dcat:inSeries",
    ontologyIri: "http://www.w3.org/ns/dcat#inSeries",
    declaration: "implicit-external",
    direction: "inverse",
    cardinality: "0..n",
    notes:
      "Runtime stores DatasetSeries -> Dataset; DCAT names the inverse Dataset -> DatasetSeries relationship."
  },
  "has-variable": {
    ontologyCurie: "sevocab:hasVariable",
    ontologyIri: "https://skygest.dev/vocab/energy/hasVariable",
    declaration: "declared",
    direction: "aligned",
    cardinality: "0..n",
    notes:
      "Denormalized Dataset -> Variable view retained on both sides with explicit origin tracking at runtime."
  },
  "published-in-dataset": {
    ontologyCurie: "sevocab:publishedInDataset",
    ontologyIri: "https://skygest.dev/vocab/energy/publishedInDataset",
    declaration: "declared",
    direction: "aligned",
    cardinality: "exactly 1",
    notes:
      "Functional Series -> Dataset structural edge; runtime kind stays kebab-case and maps here."
  },
  "implements-variable": {
    ontologyCurie: "sevocab:implementsVariable",
    ontologyIri: "https://skygest.dev/vocab/energy/implementsVariable",
    declaration: "declared",
    direction: "aligned",
    cardinality: "exactly 1",
    notes:
      "Functional Series -> Variable structural edge; runtime kind stays kebab-case and maps here."
  },
  "sources-from": {
    ontologyCurie: null,
    ontologyIri: null,
    declaration: "pending-ontology",
    direction: "none",
    cardinality: "0..n",
    notes:
      "Reserved for SKY-356 provenance work; do not emit until the ontology declares the matching property."
  }
} satisfies Record<DataLayerGraphEdgeKind, DataLayerGraphOntologyMapping>;
