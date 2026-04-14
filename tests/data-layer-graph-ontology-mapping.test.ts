import { describe, expect, it } from "@effect/vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { type DataLayerGraphEdgeKind } from "../src/domain/data-layer/graph";
import { dataLayerGraphEdgeOntologyMapping } from "../src/domain/data-layer/graph-ontology-mapping";

const expectedEdgeKinds: ReadonlyArray<DataLayerGraphEdgeKind> = [
  "publishes",
  "parent-agent",
  "contains-record",
  "primary-topic-of",
  "has-distribution",
  "served-by",
  "has-series-member",
  "has-variable",
  "published-in-dataset",
  "implements-variable",
  "sources-from",
];

const ontologyRoot = resolve(
  process.cwd(),
  "../ontology_skill/ontologies/skygest-energy-vocab",
);
const ontologyDeclarationCorpus = [
  readFileSync(join(ontologyRoot, "skygest-energy-vocab.ttl"), "utf8"),
  ...readdirSync(join(ontologyRoot, "imports")).map((filename) =>
    readFileSync(join(ontologyRoot, "imports", filename), "utf8"),
  ),
].join("\n");

describe("data-layer graph ontology mapping", () => {
  it("covers every runtime edge kind", () => {
    expect(Object.keys(dataLayerGraphEdgeOntologyMapping).sort()).toEqual(
      [...expectedEdgeKinds].sort(),
    );
  });

  it("pins the kebab-case series edges to the sevocab structural properties", () => {
    expect(dataLayerGraphEdgeOntologyMapping["implements-variable"]).toMatchObject({
      ontologyCurie: "sevocab:implementsVariable",
      declaration: "declared",
      direction: "aligned",
    });
    expect(dataLayerGraphEdgeOntologyMapping["published-in-dataset"]).toMatchObject({
      ontologyCurie: "sevocab:publishedInDataset",
      declaration: "declared",
      direction: "aligned",
    });
    expect(dataLayerGraphEdgeOntologyMapping["has-variable"]).toMatchObject({
      ontologyCurie: "sevocab:hasVariable",
      declaration: "declared",
      direction: "aligned",
    });
  });

  it("keeps every locally declared ontology reference grep-findable in the vocab TTL or imports", () => {
    for (const entry of Object.values(dataLayerGraphEdgeOntologyMapping)) {
      if (
        entry.declaration !== "declared" ||
        entry.ontologyCurie === null
      ) {
        continue;
      }

      expect(ontologyDeclarationCorpus).toContain(entry.ontologyCurie);
    }
  });
});
