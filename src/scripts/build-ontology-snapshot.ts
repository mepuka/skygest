import { resolve } from "node:path";
import { buildOntologyArtifacts, encodeOntologySnapshot, encodePublicationsSeed } from "../ontology/buildSnapshot";

const repoRoot = resolve(import.meta.dir, "../..");
const ontologyRoot = process.argv[2] === undefined
  ? resolve(repoRoot, "../ontology_skill/ontologies/energy-news")
  : resolve(repoRoot, process.argv[2]);
const snapshotOutputPath = process.argv[3] === undefined
  ? resolve(repoRoot, "config/ontology/energy-snapshot.json")
  : resolve(repoRoot, process.argv[3]);
const publicationsSeedOutputPath = resolve(
  snapshotOutputPath,
  "../publications-seed.json"
);

const readRequired = async (path: string) => {
  const file = Bun.file(path);

  if (!(await file.exists())) {
    throw new Error(`Missing ontology source file: ${path}`);
  }

  return file.text();
};

const readOptional = async (path: string) => {
  const file = Bun.file(path);
  return (await file.exists()) ? file.text() : undefined;
};

const aboxPath = resolve(ontologyRoot, "data/abox-snapshot.ttl");
const aboxTtl = await readOptional(aboxPath);

if (aboxTtl !== undefined) {
  console.log(`Found ABox snapshot: ${aboxPath}`);
} else {
  console.log(`No ABox snapshot found at ${aboxPath} — skipping ABox enrichment`);
}

const { snapshot, publicationsSeed } = buildOntologyArtifacts({
  ttl: await readRequired(resolve(ontologyRoot, "release/energy-news-reference-individuals.ttl")),
  derivedStoreFilter: await readRequired(resolve(ontologyRoot, "docs/derived-store-filter.md")),
  owlJson: await readRequired(resolve(ontologyRoot, "release/energy-news.json")),
  ...(aboxTtl !== undefined ? { aboxTtl } : {})
});

await Bun.write(snapshotOutputPath, encodeOntologySnapshot(snapshot));
await Bun.write(publicationsSeedOutputPath, encodePublicationsSeed(publicationsSeed));

console.log(`Wrote ontology snapshot to ${snapshotOutputPath}`);
console.log(`Wrote publications seed to ${publicationsSeedOutputPath}`);
console.log(`ontologyVersion=${snapshot.ontologyVersion}`);
console.log(`snapshotVersion=${snapshot.snapshotVersion}`);
console.log(`canonicalTopics=${snapshot.canonicalTopics.length}`);
console.log(`concepts=${snapshot.concepts.length}`);
console.log(`publications=${publicationsSeed.publications.length}`);
console.log(`anomalies=${snapshot.anomalies.length}`);
