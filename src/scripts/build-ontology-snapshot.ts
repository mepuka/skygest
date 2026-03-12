import { resolve } from "node:path";
import { buildOntologySnapshot, encodeOntologySnapshot } from "../ontology/buildSnapshot";

const repoRoot = resolve(import.meta.dir, "../..");
const ontologyRoot = process.argv[2] === undefined
  ? resolve(repoRoot, "../ontology_skill/ontologies/energy-news")
  : resolve(repoRoot, process.argv[2]);
const outputPath = process.argv[3] === undefined
  ? resolve(repoRoot, "config/ontology/energy-snapshot.json")
  : resolve(repoRoot, process.argv[3]);

const readRequired = async (path: string) => {
  const file = Bun.file(path);

  if (!(await file.exists())) {
    throw new Error(`Missing ontology source file: ${path}`);
  }

  return file.text();
};

const snapshot = buildOntologySnapshot({
  ttl: await readRequired(resolve(ontologyRoot, "release/energy-news-reference-individuals.ttl")),
  derivedStoreFilter: await readRequired(resolve(ontologyRoot, "docs/derived-store-filter.md")),
  owlJson: await readRequired(resolve(ontologyRoot, "release/energy-news.json"))
});

await Bun.write(outputPath, encodeOntologySnapshot(snapshot));

console.log(`Wrote ontology snapshot to ${outputPath}`);
console.log(`ontologyVersion=${snapshot.ontologyVersion}`);
console.log(`snapshotVersion=${snapshot.snapshotVersion}`);
console.log(`canonicalTopics=${snapshot.canonicalTopics.length}`);
console.log(`concepts=${snapshot.concepts.length}`);
console.log(`anomalies=${snapshot.anomalies.length}`);
